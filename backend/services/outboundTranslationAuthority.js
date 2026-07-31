'use strict';

const crypto = require('crypto');
const aiGateway = require('./aiGateway');
const contactLanguageAuthority = require('./contactLanguageAuthority');
const messageStore = require('./messageStore');
const bilingualUnderstandingService = require('./bilingualUnderstandingService');
const replyLanguageAuthority = require('./replyLanguageAuthority');
const terminology = require('./translationTerminologyService');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');

const OUTBOUND_TRANSLATION_TIMEOUT_MS = 180000;

function clean(value) { return String(value == null ? '' : value).trim(); }

function conversationFor(input = {}, dependencies = {}) {
  if (input.conversation && typeof input.conversation === 'object') return input.conversation;
  const repository = dependencies.messageStore || messageStore;
  const key = clean(input.sessionKey || input.conversationId);
  return key && typeof repository?.getConversation === 'function' ? repository.getConversation(key) : null;
}

function targetAuthority(input = {}, dependencies = {}) {
  const explicit = replyLanguageAuthority.normalizeLanguageCode(input.targetLanguageCode || input.targetLanguage);
  if (explicit !== 'unknown') return replyLanguageAuthority.authorityRecord(explicit, 'explicit_outbound_target', 1);
  const conversation = conversationFor(input, dependencies) || {};
  const authority = dependencies.contactLanguageAuthority || contactLanguageAuthority;
  const target = authority.targetLanguage({
    contactId: clean(input.contactId || conversation.contactId),
    canonicalContactId: clean(input.canonicalContactId || conversation.canonicalContactId || conversation.contactId),
    conversationId: clean(input.sessionKey || input.conversationId || conversation.sessionKey || conversation.conversationId),
    platform: clean(input.platform || conversation.platform),
    sourceAccountId: clean(input.sourceAccountId || input.accountId || conversation.sourceAccountId || conversation.accountId),
    platformContactIdentity: clean(input.platformContactIdentity || input.chatJid || conversation.platformContactIdentity || conversation.chatJid || conversation.externalId)
  }, dependencies.languageOptions || {});
  return replyLanguageAuthority.authorityRecord(target, 'conversation_language_authority', target ? 0.95 : 0);
}

function normalizedOutput(value) {
  let output = clean(value)
    .replace(/^```(?:text|markdown)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/^(?:translation|translated text|译文|翻译)\s*[:：]\s*/iu, '')
    .trim();
  if ((output.startsWith('“') && output.endsWith('”')) || (output.startsWith('"') && output.endsWith('"'))) {
    output = output.slice(1, -1).trim();
  }
  return output;
}

function missingValues(sourceValues = [], outputValues = []) {
  return sourceValues.filter(value => !outputValues.includes(value));
}

function integrityResult(sourceText, translatedText, mappings = []) {
  const missingNumbers = missingValues(terminology.extractNumbers(sourceText), terminology.extractNumbers(translatedText));
  const missingUrls = missingValues(terminology.extractUrls(sourceText), terminology.extractUrls(translatedText));
  const missingTerms = mappings.filter(row => {
    const expected = clean(row.restoreValue || row.source);
    return expected && !translatedText.includes(expected);
  });
  return {
    pass: !missingNumbers.length && !missingUrls.length && !missingTerms.length && !terminology.hasResidualProtectedTerms(translatedText),
    missingNumbers,
    missingUrls,
    missingTerms: missingTerms.map(row => row.source),
    residualPlaceholder: terminology.hasResidualProtectedTerms(translatedText)
  };
}

function translationError(code, message, details = {}, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.status = 503;
  error.details = details;
  if (cause) error.cause = cause;
  return error;
}

function targetPrompt(authority) {
  return [
    `把用户输入准确翻译成自然、简洁、适合私人聊天的${authority.labelZh || authority.name || authority.code}。`,
    '只输出可直接发送给联系人的译文正文，不输出标题、解释、原文或代码块。',
    '不要补充、推断或删减内容；保持否定、语气、人称、姓名、时间、数字、电话号码、金额、URL和Emoji。',
    '形如 ⟦YANCE_TERM_0⟧ 的占位符必须逐字原样保留。',
    authority.code === 'de' ? '德语使用自然口语和du，不要写成正式公函。' : '',
    `<target_language>${authority.name || authority.code}</target_language>`
  ].filter(Boolean).join('\n');
}

async function prepare(input = {}, dependencies = {}) {
  const sourceText = clean(input.text || input.caption);
  if (!sourceText) return { text: '', translationApplied: false, translationStatus: 'empty' };
  if (!bilingualUnderstandingService.isChineseDominant(sourceText)) {
    return { text: sourceText, sourceText, sourceLanguage: bilingualUnderstandingService.inferLanguage(sourceText), translationApplied: false, translationStatus: 'not-required' };
  }

  const authority = targetAuthority(input, dependencies);
  if (!authority.verifiable || authority.code === 'unknown') {
    throw translationError(
      'OUTBOUND_TARGET_LANGUAGE_UNRESOLVED',
      '当前会话的客户语言尚未确认，已阻止把中文直接发送。请先在会话语言设置中选择目标语言。',
      { conversationId: clean(input.sessionKey || input.conversationId), accountId: clean(input.accountId), platform: clean(input.platform) }
    );
  }
  if (authority.code === 'zh') {
    return { text: sourceText, sourceText, sourceLanguage: 'zh', targetLanguage: authority.name, targetLanguageCode: authority.code, translationApplied: false, translationStatus: 'identity' };
  }

  const gateway = dependencies.aiGateway || aiGateway;
  if (!gateway?.execute) {
    throw translationError('OUTBOUND_TRANSLATION_MODEL_UNAVAILABLE', '当前没有可用的外发翻译模型，已阻止发送中文。', { targetLanguageCode: authority.code });
  }
  const termPack = terminology.maskProtectedTerms(sourceText, input.glossary || input.terminology || []);
  const idempotencyKey = clean(input.idempotencyKey) || crypto.createHash('sha256').update([
    clean(input.platform), clean(input.accountId), clean(input.sessionKey || input.conversationId), sourceText, authority.code
  ].join('|')).digest('hex');
  const generation = crypto.createHash('sha256').update(`${sourceText}|${authority.code}|${idempotencyKey}`).digest('hex');
  try {
    const result = await gateway.execute({
      task: 'translation',
      modelId: clean(input.modelId),
      messages: [
        { role: 'system', content: targetPrompt(authority) },
        { role: 'user', content: `<source_text>\n${termPack.maskedText}\n</source_text>` }
      ],
      options: {
        temperature: 0.05,
        maxTokens: Math.max(128, Math.min(1200, Number(input.maxTokens || 500))),
        timeoutMs: taskRuntimePolicy.normalizeTimeoutMs('translation', input.timeoutMs || OUTBOUND_TRANSLATION_TIMEOUT_MS),
        keepAlive: input.keepAlive || '10m',
        translationProfile: 'outbound'
      },
      dedupeKey: `outbound-translation:${idempotencyKey}`,
      fingerprint: generation,
      context: {
        platform: clean(input.platform),
        sourceAccountId: clean(input.sourceAccountId || input.accountId),
        sessionKey: clean(input.sessionKey || input.conversationId),
        conversationId: clean(input.sessionKey || input.conversationId),
        contactId: clean(input.contactId || conversationFor(input, dependencies)?.contactId),
        requestId: idempotencyKey,
        generation,
        scopeKey: [clean(input.platform), clean(input.accountId), clean(input.sessionKey || input.conversationId), 'outbound_translation'].filter(Boolean).join('|')
      },
      priority: 100,
      background: false,
      queueTimeoutMs: Math.max(OUTBOUND_TRANSLATION_TIMEOUT_MS, Number(input.queueTimeoutMs || 0))
    });
    const translatedText = terminology.restoreProtectedTerms(normalizedOutput(result?.text), termPack.mappings);
    if (!translatedText) throw translationError('OUTBOUND_TRANSLATION_EMPTY', '外发翻译没有返回可发送正文，已阻止发送中文。', { targetLanguageCode: authority.code });
    if (bilingualUnderstandingService.isChineseDominant(translatedText)) {
      throw translationError('OUTBOUND_TRANSLATION_STILL_CHINESE', '外发翻译结果仍然是中文，已阻止发送。', { targetLanguageCode: authority.code });
    }
    const languageValidation = replyLanguageAuthority.validateCandidate(translatedText, authority);
    if (!languageValidation.pass) {
      throw translationError('OUTBOUND_TRANSLATION_LANGUAGE_MISMATCH', languageValidation.message || '外发译文语言不符合当前会话，已阻止发送。', languageValidation);
    }
    const integrity = integrityResult(sourceText, translatedText, termPack.mappings);
    if (!integrity.pass) {
      throw translationError('OUTBOUND_TRANSLATION_INTEGRITY_FAILED', '外发译文没有完整保留数字、链接或受保护内容，已阻止发送。', integrity);
    }
    return {
      text: translatedText,
      sourceText: translatedText,
      originalComposerText: sourceText,
      sourceLanguage: authority.code,
      translatedZh: sourceText,
      translationApplied: true,
      translationStatus: 'success',
      translationModel: clean(result?.model || result?.modelId),
      targetLanguage: authority.name,
      targetLanguageCode: authority.code,
      languageAuthority: authority,
      languageValidation,
      protectedTerms: termPack.mappings.map(row => ({ source: row.source, kind: row.kind })),
      translationSourceHash: crypto.createHash('sha256').update(translatedText).digest('hex'),
      translationTargetLanguage: authority.code,
      translatedAt: new Date().toISOString()
    };
  } catch (error) {
    if (String(error.code || '').startsWith('OUTBOUND_')) throw error;
    throw translationError(
      'OUTBOUND_TRANSLATION_FAILED',
      `外发翻译失败，已阻止发送中文：${clean(error.message) || '模型调用失败'}`,
      { targetLanguageCode: authority.code, modelErrorCode: clean(error.code) },
      error
    );
  }
}

module.exports = {
  prepare,
  targetAuthority,
  integrityResult,
  normalizedOutput,
  OUTBOUND_TRANSLATION_TIMEOUT_MS
};
