'use strict';

const { describeStylePolicy } = require('./stylePolicy');
const { sanitizeLivePresentationProfile } = require('./runtimeTruthAuthority');

const STAGE_ORDER = Object.freeze(['new', 'familiar', 'warming', 'trust_building', 'deep_trust']);
const COUNTRY_ALIASES = Object.freeze({
  'österreich':'austria','austria':'austria','奥地利':'austria',
  'deutschland':'germany','germany':'germany','德国':'germany',
  'schweiz':'switzerland','suisse':'switzerland','svizzera':'switzerland','switzerland':'switzerland','瑞士':'switzerland',
  'italien':'italy','italia':'italy','italy':'italy','意大利':'italy',
  'frankreich':'france','france':'france','法国':'france',
  'spanien':'spain','españa':'spain','spain':'spain','西班牙':'spain',
  'portugal':'portugal','葡萄牙':'portugal',
  'niederlande':'netherlands','the netherlands':'netherlands','netherlands':'netherlands','荷兰':'netherlands',
  'vereinigtes königreich':'united kingdom','uk':'united kingdom','united kingdom':'united kingdom','英国':'united kingdom',
  'dänemark':'denmark','denmark':'denmark','丹麦':'denmark',
  'norwegen':'norway','norway':'norway','挪威':'norway',
  'südkorea':'south korea','korea':'south korea','south korea':'south korea','韩国':'south korea',
  'japan':'japan','日本':'japan','tschechien':'czech republic','czechia':'czech republic','czech republic':'czech republic','捷克':'czech republic',
  'griechenland':'greece','greece':'greece','希腊':'greece','kroatien':'croatia','croatia':'croatia','克罗地亚':'croatia',
  'slowenien':'slovenia','slovenia':'slovenia','斯洛文尼亚':'slovenia',
  'wien':'vienna','vienna':'vienna','维也纳':'vienna','berlin':'berlin','柏林':'berlin',
  'münchen':'munich','munich':'munich','慕尼黑':'munich','köln':'cologne','cologne':'cologne','科隆':'cologne',
  'mailand':'milan','milano':'milan','milan':'milan','米兰':'milan','rom':'rome','roma':'rome','rome':'rome','罗马':'rome',
  'zürich':'zurich','zurich':'zurich','苏黎世':'zurich','kopenhagen':'copenhagen','copenhagen':'copenhagen','哥本哈根':'copenhagen',
  'lissabon':'lisbon','lisboa':'lisbon','lisbon':'lisbon','里斯本':'lisbon','prag':'prague','praha':'prague','prague':'prague','布拉格':'prague'
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function stageRank(stage) {
  const normalized = clean(stage).toLowerCase();
  if (normalized === 'cooling') return -1;
  const index = STAGE_ORDER.indexOf(normalized);
  return index < 0 ? 0 : index;
}
function normalizeLocationToken(value) {
  const token = clean(value).toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
  return COUNTRY_ALIASES[token] || token;
}
function parseLocationText(value) {
  const text = clean(value);
  const lower = text.toLowerCase();
  const patterns = [/(?:live|living|based|from|wohne|lebe|komme)\s+(?:in|aus)\s+([^.;]+)/i,/(?:住在|来自|居住在)([^，。；]+)/];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = clean(match[1]);
    if (!raw) continue;
    const parts = raw.split(/\s*,\s*|\s+in\s+/i).map(clean).filter(Boolean);
    if (parts.length >= 2) return { city: parts[0], country: parts.at(-1), region: '' };
    const token = normalizeLocationToken(raw);
    const countries = new Set(['austria','germany','switzerland','italy','france','spain','portugal','netherlands','united kingdom','denmark','norway','south korea','japan','czech republic','greece','croatia','slovenia']);
    return countries.has(token) ? { country: raw, city: '', region: '' } : { city: raw, country: '', region: '' };
  }
  if (lower.includes('berlin') || text.includes('柏林')) return { city: 'Berlin', country: 'Germany', region: '' };
  return { country: '', city: '', region: '' };
}
function applyStructuredLocationRow(location, row, source) {
  const key = row && typeof row === 'object' ? clean(row.key || row.type || row.field).toLowerCase() : '';
  const value = row && typeof row === 'object' ? clean(row.value || row.text || row.fact) : '';
  if (!key || !value) return false;
  let applied = false;
  if (['country','国家','land'].includes(key) && !location.country) { location.country = value; applied = true; }
  if (['city','城市','stadt','location','居住地'].includes(key) && !location.city) { location.city = value; applied = true; }
  if (['region','地区','bundesland'].includes(key) && !location.region) { location.region = value; applied = true; }
  if (['timezone','时区','zeitzone'].includes(key) && !location.timezone) { location.timezone = value; applied = true; }
  if (applied && !location.source) location.source = source;
  return applied;
}
function inferContactLocation(socialContext = {}) {
  const location = { country: '', city: '', region: '', timezone: '', source: '' };
  const customer = socialContext.customer || {};
  for (const key of ['country','city','region','timezone']) {
    if (clean(customer[key])) { location[key] = clean(customer[key]); location.source = 'customer'; }
  }

  // Confirmed facts may be structured or free text because they have already
  // passed the memory confirmation workflow.
  const confirmedFacts = Array.isArray(socialContext?.memory?.confirmedFacts) ? socialContext.memory.confirmedFacts : [];
  for (const row of confirmedFacts) {
    if (applyStructuredLocationRow(location, row, 'confirmed_memory')) continue;
    const value = row && typeof row === 'object' ? clean(row.value || row.text || row.fact) : clean(row);
    if (!value) continue;
    const parsed = parseLocationText(value);
    if (!location.country && parsed.country) location.country = parsed.country;
    if (!location.city && parsed.city) location.city = parsed.city;
    if (!location.region && parsed.region) location.region = parsed.region;
    if ((parsed.country || parsed.city || parsed.region) && !location.source) location.source = 'confirmed_memory';
  }

  // Free-form user notes are hypotheses, not confirmed facts. Only explicit
  // structured location fields are accepted from this channel.
  const userNotes = Array.isArray(socialContext?.memory?.userNotes) ? socialContext.memory.userNotes : [];
  for (const row of userNotes) applyStructuredLocationRow(location, row, 'structured_user_note');
  return location;
}
function truthSafe(value, { allowFictional = false, liveVerifiedOnly = true, maximumStageRank = Number.POSITIVE_INFINITY } = {}) {
  if (Array.isArray(value)) return value.map(item => truthSafe(item, { allowFictional, liveVerifiedOnly, maximumStageRank })).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const status = clean(value.truthStatus);
  const disclosure = clean(value.disclosure).toLowerCase();
  if (disclosure && maximumStageRank < stageRank(disclosure)) return undefined;
  if (liveVerifiedOnly && status && status !== 'user_verified_real') return undefined;
  if (!allowFictional && status === 'fictional_roleplay') return undefined;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    const selected = truthSafe(child, { allowFictional, liveVerifiedOnly, maximumStageRank });
    if (selected !== undefined) output[key] = selected;
  }
  return output;
}
function findTravelMatches(visits, location, options = {}) {
  const country = normalizeLocationToken(location?.country);
  const city = normalizeLocationToken(location?.city);
  if (!country && !city) return [];
  const matches = [];
  for (const row of Array.isArray(visits) ? visits : []) {
    const safeRow = truthSafe(row, {
      allowFictional: options.allowFictional === true,
      liveVerifiedOnly: options.liveVerifiedOnly !== false,
      maximumStageRank: Number.isFinite(options.maximumStageRank)
        ? options.maximumStageRank
        : Number.POSITIVE_INFINITY
    });
    if (!safeRow) continue;
    const rowCountry = normalizeLocationToken(safeRow.country);
    const cities = Array.isArray(safeRow.cities) ? safeRow.cities.map(normalizeLocationToken) : [];
    if ((country && rowCountry === country) || (city && cities.includes(city))) matches.push(safeRow);
  }
  return matches.slice(-3);
}
function compileTruthSafePersona(document, socialContext = {}, options = {}) {
  const authoritative = document?.authoritative || {};
  const core = authoritative.coreIdentity || {};
  const sourcePresentationProfile = authoritative.personaProfile && typeof authoritative.personaProfile === 'object'
    ? authoritative.personaProfile
    : {};
  const presentationProfile = clean(options.mode) === 'simulation'
    ? sourcePresentationProfile
    : sanitizeLivePresentationProfile(sourcePresentationProfile);
  const stylePolicy = describeStylePolicy(authoritative.replyStylePolicy || {}, sourcePresentationProfile);
  const mode = clean(options.mode) || 'live';
  const stage = clean(socialContext?.relationshipPotential?.relationshipStage || socialContext?.customer?.relationshipStage || 'new').toLowerCase() || 'new';
  const rank = stageRank(stage);
  const allowFictional = mode === 'simulation' && core.truthPolicy?.allowFictionalFactsInSimulation === true;
  const liveVerifiedOnly = mode !== 'simulation' && core.truthPolicy?.liveReplyMode !== 'allow_all';
  const fictionalLive = mode !== 'simulation' && core.mode === 'fictional_roleplay';
  const location = inferContactLocation(socialContext);
  const relevantTravel = fictionalLive ? [] : findTravelMatches(authoritative.travelMemories, location, { allowFictional, liveVerifiedOnly, maximumStageRank: rank });
  const expression = authoritative.expressionMatrix || {};
  const publicFacts = fictionalLive ? {
    voice: expression.voice || {},
    publicPersonality: expression.personality?.publicSide || [],
    boundaries: expression.personality?.boundaries || []
  } : truthSafe({
    names: core.names,
    residence: core.residence,
    occupation: core.occupation,
    languages: authoritative.languageCapabilities,
    voice: expression.voice,
    publicPersonality: expression.personality?.publicSide,
    boundaries: expression.personality?.boundaries,
    studio: rank >= stageRank('familiar') ? authoritative.educationAndCareer?.studio : { name: authoritative.educationAndCareer?.studio?.name, positioning: authoritative.educationAndCareer?.studio?.positioning }
  }, { allowFictional, liveVerifiedOnly, maximumStageRank: rank }) || {};
  const sensitiveFactsAllowedNow = {};
  if (!fictionalLive && rank >= stageRank('trust_building')) sensitiveFactsAllowedNow.family = truthSafe(authoritative.familyAndUpbringing, { allowFictional, liveVerifiedOnly, maximumStageRank: rank }) || {};
  if (!fictionalLive && rank >= stageRank('deep_trust')) {
    sensitiveFactsAllowedNow.relationshipHistory = truthSafe(authoritative.relationshipHistory, { allowFictional, liveVerifiedOnly, maximumStageRank: rank }) || {};
    sensitiveFactsAllowedNow.emotionalAndHealthBoundaries = truthSafe(authoritative.emotionalAndHealthBoundaries, { allowFictional, liveVerifiedOnly, maximumStageRank: rank }) || {};
    sensitiveFactsAllowedNow.investmentBackground = truthSafe(authoritative.investmentBackground, { allowFictional, liveVerifiedOnly, maximumStageRank: rank }) || {};
    sensitiveFactsAllowedNow.financialAndAssets = truthSafe(authoritative.financialAndAssets, { allowFictional, liveVerifiedOnly, maximumStageRank: rank }) || {};
  }
  return {
    generationMode: mode,
    profileMode: core.mode || 'verified_real',
    relationshipStage: stage,
    contactLocation: location,
    preferredLanguage: clean(socialContext?.customer?.preferredLanguage || socialContext?.customer?.languages),
    publicFacts,
    sensitiveFactsAllowedNow,
    relevantTravel,
    presentationProfile,
    style: {
      legacyVoice: expression.voice || {},
      policy: stylePolicy,
      prompt: stylePolicy.prompt
    },
    personality: {
      publicSide: expression.personality?.publicSide || [],
      privateSide: rank >= stageRank('warming') ? (expression.personality?.privateSide || []) : [],
      ordinaryFlaws: expression.personality?.ordinaryFlaws || [],
      boundaries: expression.personality?.boundaries || []
    },
    disclosurePolicy: {
      maximumStage: stage,
      cooling: stage === 'cooling',
      doNotLeadWithTrauma: true,
      doNotExposePrivateFinancialFields: true,
      forbiddenExpressions: Array.isArray(presentationProfile.forbiddenExpressions) ? presentationProfile.forbiddenExpressions : [],
      specialRelationshipSettings: presentationProfile.specialRelationshipSettings || {}
    },
    truthFirewall: {
      liveVerifiedOnly,
      fictionalFactsIncluded: allowFictional,
      generatedTextNeverBecomesFact: true,
      neverClaimUnconfirmedTravel: true,
      noFinancialSolicitation: true,
      noGuaranteedReturns: true,
      noLiveSignals: true,
      noThirdPartyAccountOperation: true
    }
  };
}

module.exports = { STAGE_ORDER, stageRank, normalizeLocationToken, parseLocationText, inferContactLocation, findTravelMatches, truthSafe, compileTruthSafePersona };
