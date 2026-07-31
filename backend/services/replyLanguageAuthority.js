'use strict';

const { inferLanguage } = require('./bilingualUnderstandingService');

const LANGUAGE_NAMES = Object.freeze({
  de: 'German', en: 'English', zh: 'Chinese', fr: 'French', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic', tr: 'Turkish'
});
const LANGUAGE_LABELS_ZH = Object.freeze({
  de: '德语', en: '英语', zh: '中文', fr: '法语', es: '西班牙语',
  it: '意大利语', pt: '葡萄牙语', ru: '俄语', ar: '阿拉伯语', tr: '土耳其语', unknown: '未知语言'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeLanguageCode(value) {
  const raw = clean(value).toLowerCase().replace(/_/gu, '-');
  const aliases = {
    german: 'de', deutsch: 'de', deu: 'de', de: 'de',
    english: 'en', eng: 'en', en: 'en',
    chinese: 'zh', mandarin: 'zh', zho: 'zh', zh: 'zh',
    french: 'fr', français: 'fr', fra: 'fr', fr: 'fr',
    spanish: 'es', español: 'es', spa: 'es', es: 'es',
    italian: 'it', italiano: 'it', ita: 'it', it: 'it',
    portuguese: 'pt', português: 'pt', por: 'pt', pt: 'pt',
    russian: 'ru', rus: 'ru', ru: 'ru',
    arabic: 'ar', ara: 'ar', ar: 'ar',
    turkish: 'tr', tur: 'tr', tr: 'tr',
    中文: 'zh', 汉语: 'zh', 普通话: 'zh',
    德语: 'de', 德文: 'de', 英语: 'en', 英文: 'en', 法语: 'fr', 西班牙语: 'es',
    意大利语: 'it', 葡萄牙语: 'pt', 俄语: 'ru', 阿拉伯语: 'ar', 土耳其语: 'tr'
  };
  const direct = aliases[raw] || aliases[raw.split('-')[0]];
  return direct || 'unknown';
}

function languageName(codeValue) {
  return LANGUAGE_NAMES[normalizeLanguageCode(codeValue)] || '';
}

function languageLabelZh(codeValue) {
  return LANGUAGE_LABELS_ZH[normalizeLanguageCode(codeValue)] || LANGUAGE_LABELS_ZH.unknown;
}

function detectLanguageCode(text, hint = '') {
  const explicit = normalizeLanguageCode(hint);
  if (explicit !== 'unknown') return explicit;
  const value = clean(text);
  if (!value) return 'unknown';
  if (/[\u0400-\u04ff]/u.test(value)) return 'ru';
  if (/[\u0600-\u06ff]/u.test(value)) return 'ar';
  return normalizeLanguageCode(inferLanguage(value));
}

function authorityRecord(codeValue, source, confidence, extra = {}) {
  const code = normalizeLanguageCode(codeValue);
  return {
    code,
    name: languageName(code),
    labelZh: languageLabelZh(code),
    promptLabel: languageName(code) || 'the same natural language as the latest incoming message',
    source: clean(source) || 'unknown',
    confidence: Math.max(0, Math.min(1, Number(confidence || 0))),
    verifiable: code !== 'unknown',
    ...extra
  };
}

function resolve(packet = {}) {
  const contact = packet.contactLanguage && typeof packet.contactLanguage === 'object'
    ? packet.contactLanguage
    : { currentLanguage: packet.contactLanguage };
  const userOverride = normalizeLanguageCode(contact.userOverride);
  if (userOverride !== 'unknown') return authorityRecord(userOverride, 'user_override', 1);

  const incomingText = clean(packet.incomingMessage?.text);
  const incomingHint = normalizeLanguageCode(packet.incomingMessage?.sourceLanguage || packet.incomingMessage?.language);
  const incomingDetected = detectLanguageCode(incomingText, incomingHint);
  if (incomingDetected !== 'unknown') {
    return authorityRecord(incomingDetected, incomingHint !== 'unknown' ? 'latest_incoming_explicit' : 'latest_incoming_detected', incomingHint !== 'unknown' ? 1 : 0.95, {
      incomingLanguage: incomingDetected
    });
  }

  const current = normalizeLanguageCode(contact.currentLanguage || contact.primaryLanguage);
  if (current !== 'unknown') {
    return authorityRecord(current, 'conversation_observation', Number(contact.confidence || 0.75), {
      inheritedFromLegacy: contact.inheritedFromLegacy === true
    });
  }

  const preferred = normalizeLanguageCode(packet.persona?.truthSafePacket?.preferredLanguage);
  if (preferred !== 'unknown') return authorityRecord(preferred, 'persona_preference_fallback', 0.4);
  return authorityRecord('unknown', 'unresolved', 0);
}

function validateCandidate(text, authorityInput = {}) {
  const authority = authorityInput?.code ? authorityInput : authorityRecord(authorityInput, 'legacy_target_language', 0.5);
  const expectedCode = normalizeLanguageCode(authority.code || authority.name || authority.promptLabel);
  const actualCode = detectLanguageCode(text);
  if (expectedCode === 'unknown') {
    return { pass: true, status: 'unverified_target', expectedCode, actualCode, reasonCode: 'TARGET_LANGUAGE_UNRESOLVED' };
  }
  if (actualCode === 'unknown') {
    return { pass: true, status: 'unverified_output', expectedCode, actualCode, reasonCode: 'CANDIDATE_LANGUAGE_UNDETECTED' };
  }
  if (actualCode === expectedCode) {
    return { pass: true, status: 'pass', expectedCode, actualCode, reasonCode: '' };
  }
  return {
    pass: false,
    status: 'blocking',
    expectedCode,
    actualCode,
    reasonCode: 'AI_REPLY_LANGUAGE_MISMATCH',
    message: `候选回复检测为${languageLabelZh(actualCode)}，但当前会话要求使用${languageLabelZh(expectedCode)}。请重新生成或先明确修改客户语言。`
  };
}

module.exports = {
  LANGUAGE_NAMES,
  normalizeLanguageCode,
  languageName,
  languageLabelZh,
  detectLanguageCode,
  authorityRecord,
  resolve,
  validateCandidate
};
