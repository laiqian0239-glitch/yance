'use strict';

const crypto = require('crypto');
const { canonicalStringify } = require('./canonicalJson');

function clean(value) { return String(value == null ? '' : value).trim(); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

const LIVE_PRESENTATION_KEYS = Object.freeze([
  'personality',
  'relationshipViews',
  'expressionHabits',
  'replyStylePreferences',
  'forbiddenExpressions',
  'specialRelationshipSettings'
]);

function sanitizeLivePresentationProfile(profile) {
  const source = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  const output = {};
  for (const key of LIVE_PRESENTATION_KEYS) {
    if (source[key] !== undefined) output[key] = clone(source[key]);
  }
  return output;
}

function findFictionalMarkers(value, path = '$', found = [], depth = 0) {
  if (depth > 12 || value == null) return found;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findFictionalMarkers(entry, `${path}[${index}]`, found, depth + 1));
    return found;
  }
  if (typeof value !== 'object') return found;
  if (clean(value.truthStatus).toLowerCase() === 'fictional_roleplay') found.push(path);
  for (const [key, child] of Object.entries(value)) findFictionalMarkers(child, `${path}.${key}`, found, depth + 1);
  return found;
}

function hash(value) {
  return crypto.createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

function buildRuntimeTruthReceipt(packet, options = {}) {
  const live = clean(packet?.generationMode || 'live') !== 'simulation';
  const fictionalMarkers = findFictionalMarkers({
    publicFacts: packet?.publicFacts,
    sensitiveFactsAllowedNow: packet?.sensitiveFactsAllowedNow,
    relevantTravel: packet?.relevantTravel,
    presentationProfile: packet?.presentationProfile
  });
  const errors = [];
  if (live && packet?.truthFirewall?.fictionalFactsIncluded === true) errors.push('LIVE_FICTIONAL_FACTS_INCLUDED');
  if (live && fictionalMarkers.length) errors.push('LIVE_FICTIONAL_MARKERS_PRESENT');
  if (live && packet?.profileMode === 'fictional_roleplay') {
    const presentationKeys = Object.keys(packet?.presentationProfile || {});
    const unsafe = presentationKeys.filter(key => !LIVE_PRESENTATION_KEYS.includes(key));
    if (unsafe.length) errors.push('LIVE_PRESENTATION_PROFILE_CONTAINS_FACTUAL_FIELDS');
  }
  const composition = packet?.composition && typeof packet.composition === 'object' ? packet.composition : null;
  if (composition) {
    if (clean(composition.sourceAuthority) !== 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df') {
      errors.push('PERSONA_COMPOSITION_SOURCE_AUTHORITY_INVALID');
    }
    if (composition.contactFactsFromCharacterBook !== undefined) errors.push('CHARACTER_BOOK_CONTACT_FACT_AUTHORITY_FORBIDDEN');
    const relationshipCard = composition.relationshipCard && typeof composition.relationshipCard === 'object' ? composition.relationshipCard : {};
    if (relationshipCard.writeAuthority || relationshipCard.factStore || relationshipCard.persistence) {
      errors.push('RELATIONSHIP_CARD_WRITE_AUTHORITY_FORBIDDEN');
    }
    if (clean(packet?.style?.prompt)) errors.push('LEGACY_FLAT_STYLE_PROMPT_FORBIDDEN');
  }
  const base = {
    authority: 'YancePersonaRuntimeTruthAuthority',
    version: 1,
    profileId: clean(options.profileId),
    personaVersionId: Number(options.personaVersionId || 0),
    policyHash: clean(options.policyHash),
    generationMode: clean(packet?.generationMode || 'live'),
    profileMode: clean(packet?.profileMode || 'verified_real'),
    liveVerifiedOnly: packet?.truthFirewall?.liveVerifiedOnly === true,
    fictionalFactsIncluded: packet?.truthFirewall?.fictionalFactsIncluded === true,
    generatedTextNeverBecomesFact: packet?.truthFirewall?.generatedTextNeverBecomesFact === true,
    allowedPresentationKeys: [...LIVE_PRESENTATION_KEYS],
    compositionSourceAuthority: clean(composition?.sourceAuthority),
    relationshipCardReadOnly: composition ? true : null,
    fictionalMarkerPaths: fictionalMarkers.slice(0, 50),
    errors,
    pass: errors.length === 0,
    packetSha256: hash(packet || {}),
    checkedAt: new Date().toISOString()
  };
  return { ...base, receiptSha256: hash(base) };
}

function assertRuntimeTruthSafe(packet, options = {}) {
  const receipt = buildRuntimeTruthReceipt(packet, options);
  if (!receipt.pass) {
    const error = new Error('Persona 真相防火墙阻止了不安全的真实会话上下文');
    error.code = 'PERSONA_TRUTH_FIREWALL_BLOCKED';
    error.reasonCode = error.code;
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}

module.exports = {
  LIVE_PRESENTATION_KEYS,
  sanitizeLivePresentationProfile,
  findFictionalMarkers,
  buildRuntimeTruthReceipt,
  assertRuntimeTruthSafe
};
