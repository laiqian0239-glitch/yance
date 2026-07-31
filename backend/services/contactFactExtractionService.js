'use strict';

const crypto = require('node:crypto');
const memoryGovernance = require('./memoryEvidenceGovernanceService');
const messageSpeakerAuthority = require('./messageSpeakerAuthority');

const SERVICE_VERSION = 'contact-fact-extraction-v2';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeWhitespace(value) {
  return clean(value).normalize('NFKC').replace(/\s+/gu, ' ');
}

function normalizeDirection(message = {}) {
  return messageSpeakerAuthority.classify(message).direction;
}

function isPeerInbound(message = {}) {
  return messageSpeakerAuthority.isPeerInbound(message);
}

function stableFactId(parts) {
  const digest = crypto.createHash('sha256').update(parts.map(clean).join('\u001f')).digest('hex').slice(0, 24);
  return `contact_fact_${digest}`;
}

const COUNTRY_ALIASES = Object.freeze([
  { pattern: /\b(?:aus|komme\s+aus)\s+österreich\b/iu, value: '奥地利', sourceValue: 'Österreich' },
  { pattern: /\b(?:from|come\s+from)\s+austria\b/iu, value: '奥地利', sourceValue: 'Austria' },
  { pattern: /(?:来自|我是).*?奥地利/u, value: '奥地利', sourceValue: '奥地利' },
  { pattern: /\b(?:aus|komme\s+aus)\s+deutschland\b/iu, value: '德国', sourceValue: 'Deutschland' },
  { pattern: /\b(?:from|come\s+from)\s+germany\b/iu, value: '德国', sourceValue: 'Germany' },
  { pattern: /(?:来自|我是).*?德国/u, value: '德国', sourceValue: '德国' },
  { pattern: /\b(?:aus|komme\s+aus)\s+der\s+schweiz\b/iu, value: '瑞士', sourceValue: 'Schweiz' },
  { pattern: /\b(?:from|come\s+from)\s+switzerland\b/iu, value: '瑞士', sourceValue: 'Switzerland' },
  { pattern: /(?:来自|我是).*?瑞士/u, value: '瑞士', sourceValue: '瑞士' }
]);

const INTEREST_DICTIONARY = Object.freeze([
  { canonical: '骑行', patterns: [/\bradfahren\b/iu, /\bfahrrad(?:fahren)?\b/iu, /\bcycling\b/iu, /\bbiking\b/iu, /骑(?:自行)?车|骑行/u] },
  { canonical: '游泳', patterns: [/\bschwimmen\b/iu, /\bswimming\b/iu, /游泳/u] },
  { canonical: '阅读', patterns: [/\blesen\b/iu, /\breading\b/iu, /阅读|看书/u] },
  { canonical: '音乐', patterns: [/\bmusik\b/iu, /\bmusic\b/iu, /音乐/u] },
  { canonical: '旅行', patterns: [/\breisen\b/iu, /\breise(?:n)?\b/iu, /\btravel(?:ling|ing)?\b/iu, /旅行|旅游/u] },
  { canonical: '徒步', patterns: [/\bwandern\b/iu, /\bhiking\b/iu, /徒步|远足/u] },
  { canonical: '健身', patterns: [/\bfitness\b/iu, /\bgym\b/iu, /健身/u] },
  { canonical: '烹饪', patterns: [/\bkochen\b/iu, /\bcooking\b/iu, /烹饪|做饭/u] },
  { canonical: '摄影', patterns: [/\bfotograf(?:ie|ieren)\b/iu, /\bphotograph(?:y|ing)\b/iu, /摄影|拍照/u] }
]);

function factEvidence(message = {}, context = {}) {
  const payload = message && typeof message.payload === 'object' && !Array.isArray(message.payload) ? message.payload : {};
  const sourceText = normalizeWhitespace(message.sourceText || message.text || payload.sourceText || payload.text);
  const translatedZh = normalizeWhitespace(message.translatedZh || message.translationZh || payload.translatedZh || payload.translationZh);
  const platformMessageId = clean(message.platformMessageId || message.externalMessageId || message.messageId || message.id || payload.platformMessageId || payload.externalMessageId || payload.messageId || payload.id);
  return {
    sourceMessageId: platformMessageId,
    messageId: platformMessageId,
    platformMessageId,
    sourceText,
    translatedZh,
    direction: 'inbound',
    speaker: 'peer',
    platform: clean(message.platform || payload.platform || context.platform).toLowerCase(),
    sourceAccountId: clean(message.sourceAccountId || message.accountId || payload.sourceAccountId || payload.accountId || context.sourceAccountId),
    conversationId: clean(message.conversationId || message.sessionKey || payload.conversationId || payload.sessionKey || context.conversationId),
    canonicalContactId: clean(message.canonicalContactId || payload.canonicalContactId || context.canonicalContactId),
    sentAt: clean(message.sentAt || message.timestamp || payload.sentAt || payload.timestamp),
    extractionMethod: 'deterministic-rule',
    extractionVersion: SERVICE_VERSION
  };
}

function createFact(key, value, title, message, context = {}, extra = {}) {
  const evidence = factEvidence(message, context);
  const normalizedValue = Array.isArray(value) ? value.map(clean).filter(Boolean).join('、') : clean(value);
  if (!key || !normalizedValue || !evidence.sourceMessageId || !evidence.sourceText) return null;
  return {
    id: stableFactId([evidence.canonicalContactId, evidence.conversationId, evidence.sourceMessageId, key, normalizedValue]),
    key,
    title,
    label: title,
    value: normalizedValue,
    text: `${title}：${normalizedValue}`,
    source: '对方明确消息',
    status: 'confirmed',
    factClass: 'explicit',
    confidence: 100,
    evidenceStatus: 'verified',
    allowInReply: true,
    firstSeenAt: evidence.sentAt || new Date().toISOString(),
    lastSeenAt: evidence.sentAt || new Date().toISOString(),
    lastVerifiedAt: evidence.sentAt || new Date().toISOString(),
    governanceVersion: 1,
    revision: 1,
    confirmedAt: evidence.sentAt || new Date().toISOString(),
    ...evidence,
    ...extra,
    evidence: [{
      messageId: evidence.messageId,
      platformMessageId: evidence.platformMessageId,
      sourceText: evidence.sourceText,
      translatedZh: evidence.translatedZh,
      direction: 'inbound',
      speaker: 'peer',
      platform: evidence.platform,
      sourceAccountId: evidence.sourceAccountId,
      conversationId: evidence.conversationId,
      canonicalContactId: evidence.canonicalContactId,
      sentAt: evidence.sentAt,
      source: '真实入站消息'
    }]
  };
}

function extractAge(text) {
  const patterns = [
    /\b(?:ich\s+bin|bin)\s+(\d{1,3})(?:\s+jahre?\s+alt)?\b/iu,
    /\bi\s*(?:am|'m)\s+(\d{1,3})(?:\s+years?\s+old)?\b/iu,
    /(?:我今年|我|本人)\s*(\d{1,3})\s*岁/u
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const age = Number(match[1]);
    if (age >= 18 && age <= 100) return String(age);
  }
  return '';
}

function extractCountry(text) {
  for (const row of COUNTRY_ALIASES) if (row.pattern.test(text)) return row.value;
  return '';
}

function extractRegion(text) {
  const patterns = [
    { pattern: /\bin\s+der\s+n(?:ä|ae)he\s+von\s+wien\b/iu, value: '维也纳附近' },
    { pattern: /\b(?:bei|nahe)\s+wien\b/iu, value: '维也纳附近' },
    { pattern: /\bnear\s+vienna\b/iu, value: '维也纳附近' },
    { pattern: /维也纳(?:的)?附近/u, value: '维也纳附近' }
  ];
  for (const row of patterns) if (row.pattern.test(text)) return row.value;
  return '';
}

function extractJob(text) {
  const patterns = [
    /\b(?:ich\s+arbeite\s+als|bin)\s+([\p{L}][\p{L}\p{M}\s-]{1,48}?)(?:[.,;!?]|\s+und\b|$)/iu,
    /\bich\s+arbeite\s+(?:im|in\s+der|in\s+dem)\s+([\p{L}][\p{L}\p{M}\s-]{1,48}?)(?:[.,;!?]|\s+und\b|$)/iu,
    /\bi\s+(?:work\s+as|am)\s+(?:an?\s+)?([\p{L}][\p{L}\p{M}\s-]{1,48}?)(?:[.,;!?]|\s+and\b|$)/iu,
    /\bi\s+work\s+in\s+(?:the\s+)?([\p{L}][\p{L}\p{M}\s-]{1,48}?)(?:[.,;!?]|\s+and\b|$)/iu,
    /(?:我的职业是|我是(?:一名)?)([^，。；！？]{2,30})/u
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = clean(match?.[1]);
    if (!value || /^\d+$/u.test(value)) continue;
    return value;
  }
  return '';
}

function explicitInterestContext(text) {
  return /\bhobb(?:y|ys|ies)\b|\binteressen?\b|\bgern(?:e)?\b|\bliebe\b|\blike\b|\blove\b|兴趣|爱好|喜欢/iu.test(text);
}

function extractInterests(text) {
  if (!explicitInterestContext(text)) return [];
  const result = [];
  for (const row of INTEREST_DICTIONARY) {
    if (row.patterns.some(pattern => pattern.test(text))) result.push(row.canonical);
  }
  return [...new Set(result)];
}

function extractSelfDescription(text) {
  const result = [];
  if (/\blustig(?:er|e|es|en)?\s+mann\b|\bhumorvoll\b|\bfunny\s+(?:man|person)\b|幽默|风趣/iu.test(text)) result.push('幽默风趣');
  if (/\bfröhlich\b|\bcheerful\b|开朗/u.test(text)) result.push('开朗');
  return [...new Set(result)];
}

function extractDeterministicFacts(message = {}, context = {}) {
  if (!isPeerInbound(message)) return { facts: [], profileFacts: {}, recurringInterests: [], skipped: true, reason: 'NOT_PEER_INBOUND', version: SERVICE_VERSION };
  const sourceText = normalizeWhitespace(message.sourceText || message.text || message.payload?.sourceText || message.payload?.text);
  const translatedZh = normalizeWhitespace(message.translatedZh || message.translationZh || message.payload?.translatedZh || message.payload?.translationZh);
  const text = `${sourceText}\n${translatedZh}`.trim();
  if (!sourceText) return { facts: [], profileFacts: {}, recurringInterests: [], skipped: true, reason: 'EMPTY_SOURCE_TEXT', version: SERVICE_VERSION };

  const facts = [];
  const profileFacts = {};
  const age = extractAge(text);
  if (age) {
    profileFacts.age = age;
    facts.push(createFact('age', age, '年龄', message, context));
  }
  const country = extractCountry(text);
  if (country) {
    profileFacts.country = country;
    facts.push(createFact('country', country, '国家/地区', message, context));
  }
  const region = extractRegion(text);
  if (region) {
    profileFacts.region = region;
    profileFacts.address = country ? `${country} · ${region}` : region;
    facts.push(createFact('region', region, '地区', message, context));
  }
  const job = extractJob(text);
  if (job) {
    profileFacts.job = job;
    facts.push(createFact('job', job, '职业', message, context));
  }
  const interests = extractInterests(text);
  if (interests.length) {
    profileFacts.interests = interests.join('、');
    facts.push(createFact('interests', interests, '兴趣', message, context, { values: interests }));
  }
  const traits = extractSelfDescription(text);
  if (traits.length) facts.push(createFact('self_description', traits, '自我描述', message, context, { values: traits }));

  return {
    facts: facts.filter(Boolean),
    profileFacts,
    recurringInterests: interests.map(value => ({
      value,
      text: value,
      source: '对方明确消息',
      status: 'confirmed',
      factClass: 'explicit',
      confidence: 100,
      evidenceStatus: 'verified',
      allowInReply: true,
      firstSeenAt: clean(message.sentAt || message.timestamp) || new Date().toISOString(),
      lastSeenAt: clean(message.sentAt || message.timestamp) || new Date().toISOString(),
      lastVerifiedAt: clean(message.sentAt || message.timestamp) || new Date().toISOString(),
      governanceVersion: 1,
      revision: 1,
      sourceMessageId: clean(message.platformMessageId || message.externalMessageId || message.messageId || message.id),
      conversationId: clean(context.conversationId || message.conversationId || message.sessionKey),
      platform: clean(context.platform || message.platform).toLowerCase(),
      sourceAccountId: clean(context.sourceAccountId || message.sourceAccountId || message.accountId)
    })),
    skipped: false,
    reason: '',
    version: SERVICE_VERSION
  };
}

function normalizeFactKey(row = {}) {
  return clean(row.key || row.factKey || row.field).toLowerCase();
}

function normalizeFactValue(row = {}) {
  return normalizeWhitespace(row.value || row.factValue || row.text).toLowerCase();
}

function mergeConfirmedFacts(existing = [], incoming = []) {
  return memoryGovernance.mergeFacts(existing, incoming);
}

function mergeInterestRows(existing = [], incoming = []) {
  const output = [];
  const seen = new Set();
  for (const row of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const value = normalizeWhitespace(typeof row === 'string' ? row : row?.value || row?.text);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(typeof row === 'string' ? { value, text: value, source: '历史记忆' } : { ...row, value, text: clean(row.text) || value });
  }
  return output.slice(-80);
}

module.exports = {
  SERVICE_VERSION,
  normalizeDirection,
  isPeerInbound,
  extractDeterministicFacts,
  mergeConfirmedFacts,
  mergeInterestRows,
  extractAge,
  extractCountry,
  extractRegion,
  extractInterests
};
