'use strict';

const terminology = require('./translationTerminologyService');
const taskRuntimePolicy = require('./modelTaskRuntimePolicy');

const TRANSLATION_MODEL_TIMEOUT_MS = 180000;
const TRANSLATION_QUEUE_TIMEOUT_INTERACTIVE_MS = 180000;
const TRANSLATION_QUEUE_TIMEOUT_BACKGROUND_MS = 300000;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function containsHan(text) {
  return /[\u3400-\u9fff]/u.test(clean(text));
}

function scriptCounts(text) {
  const value = clean(text)
    .replace(/https?:\/\/\S+|www\.\S+/giu, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, ' ');
  return {
    han: (value.match(/[\u3400-\u9fff]/gu) || []).length,
    latin: (value.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/gu) || []).length
  };
}

function isChineseDominant(text) {
  const counts = scriptCounts(text);
  if (!counts.han) return false;
  if (!counts.latin) return true;
  return counts.han >= 2 && counts.han * 2 >= counts.latin;
}

function inferLanguage(text, hint = '') {
  const explicit = clean(hint).toLowerCase();
  if (explicit && explicit !== 'auto' && explicit !== 'unknown') return explicit;
  const value = clean(text);
  if (!value) return 'unknown';
  if (isChineseDominant(value)) return 'zh';
  if (/[äöüß]/iu.test(value) || /\b(?:ich|du|wir|sie|nicht|und|aber|danke|gerne|heute|morgen|treffen)\b/iu.test(value)) return 'de';
  if (/\b(?:the|you|your|and|but|thanks|today|tomorrow|meet)\b/iu.test(value)) return 'en';
  return 'unknown';
}

function translationPrompt(text, sourceLanguage = 'auto', glossary = []) {
  return [
    '你是言策的中文理解翻译器。',
    '把下面内容准确、自然地翻译为简体中文，仅输出译文正文。',
    '正确区分我、你、他/她等人称，不要逐字硬译，不要补充原文没有的信息。',
    '保留占位符、姓名、昵称、品牌、城市、金额、日期、URL、电话号码和 Emoji，不要添加解释。',
    '形如 ⟦YANCE_TERM_0⟧ 的占位符必须逐字原样保留。',
    terminology.glossaryPrompt(glossary),
    `源语言：${clean(sourceLanguage) || 'auto'}`,
    '<source_text>',
    clean(text),
    '</source_text>'
  ].join('\n');
}

function normalizeTranslationOutput(value) {
  let output = clean(value)
    .replace(/^```(?:text|markdown)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .replace(/^(?:简体中文译文|中文译文|译文|翻译)\s*[:：]\s*/iu, '')
    .trim();
  if ((output.startsWith('“') && output.endsWith('”')) || (output.startsWith('"') && output.endsWith('"'))) {
    output = output.slice(1, -1).trim();
  }
  return output;
}

async function executeTranslationAttempt(aiGateway, input, termPack, sourceLanguage, options = {}) {
  const strictRepair = options.strictRepair === true;
  const previous = clean(options.previous);
  const userContent = strictRepair
    ? [
        '上一次翻译结果不合格。请重新翻译，仅输出自然、准确的简体中文正文。',
        '必须正确区分人称，必须保留所有 YANCE_TERM 占位符、数字、URL、电话号码和专有名词。',
        previous ? `<invalid_translation>${previous}</invalid_translation>` : '',
        translationPrompt(termPack.maskedText, sourceLanguage, input.glossary || input.terminology || [])
      ].filter(Boolean).join('\n')
    : translationPrompt(termPack.maskedText, sourceLanguage, input.glossary || input.terminology || []);
  return aiGateway.execute({
    task: 'translation',
    modelId: clean(options.modelId || input.modelId),
    messages: [
      { role: 'system', content: '只输出简体中文译文，不输出标题、解释、原文或代码块。' },
      { role: 'user', content: userContent }
    ],
    signal: input.signal,
    options: {
      temperature: strictRepair ? 0 : 0.05,
      maxTokens: Math.max(128, Math.min(1200, Number(input.maxTokens || 500))),
      timeoutMs: taskRuntimePolicy.normalizeTimeoutMs('translation', input.timeoutMs || TRANSLATION_MODEL_TIMEOUT_MS),
      keepAlive: input.keepAlive || '10m',
      translationProfile: clean(input.translationProfile || (input.background === true ? 'history' : 'realtime'))
    },
    dedupeKey: `${clean(input.dedupeKey) || `translate-zh:${sourceLanguage}:${clean(input.text).slice(0, 200)}`}:${strictRepair ? 'repair' : 'primary'}`,
    fingerprint: `${clean(input.fingerprint) || `${sourceLanguage}:${clean(input.text)}`}:${strictRepair ? 'repair' : 'primary'}`,
    context: input.taskContext || {},
    priority: input.background === true ? 30 : 70,
    background: input.background === true,
    queueTimeoutMs: Math.max(
      taskRuntimePolicy.normalizeTimeoutMs('translation', input.timeoutMs || TRANSLATION_MODEL_TIMEOUT_MS),
      Number(input.queueTimeoutMs || (input.background === true ? TRANSLATION_QUEUE_TIMEOUT_BACKGROUND_MS : TRANSLATION_QUEUE_TIMEOUT_INTERACTIVE_MS))
    )
  });
}

async function translateToChinese(input = {}, dependencies = {}) {
  const text = clean(input.text);
  const sourceLanguage = inferLanguage(text, input.sourceLanguage || input.language);
  if (!text) return { sourceText: '', sourceLanguage, translatedZh: '', translationStatus: 'empty', translatedAt: '' };
  if (sourceLanguage === 'zh') {
    return {
      sourceText: text,
      sourceLanguage: 'zh',
      translatedZh: text,
      translationStatus: 'success',
      translationModel: 'identity',
      translatedAt: new Date().toISOString()
    };
  }
  const termPack = terminology.maskProtectedTerms(text, input.glossary || input.terminology || []);
  const aiGateway = dependencies.aiGateway;
  if (!aiGateway?.execute) {
    return {
      sourceText: text,
      sourceLanguage,
      translatedZh: '',
      translationStatus: 'failed',
      translationErrorCode: 'TRANSLATION_MODEL_UNAVAILABLE',
      translationError: '当前没有可用的翻译模型，请检查本地或云端模型状态后重试。',
      translatedAt: ''
    };
  }
  try {
    const attempts = [];
    const first = await executeTranslationAttempt(aiGateway, input, termPack, sourceLanguage);
    attempts.push({ modelId: clean(first?.modelId), model: clean(first?.model), status: 'primary' });
    let translatedZh = terminology.restoreProtectedTerms(normalizeTranslationOutput(first?.text), termPack.mappings);
    let quality = terminology.assessChineseTranslation({ sourceText: text, translatedZh, mappings: termPack.mappings });
    const invalid = !translatedZh || terminology.hasResidualProtectedTerms(translatedZh) || !containsHan(translatedZh) || quality.status === 'blocking';
    let selected = first;
    if (invalid) {
      const route = typeof aiGateway.resolveRoute === 'function'
        ? aiGateway.resolveRoute('translation', clean(input.modelId), { translationProfile: clean(input.translationProfile || (input.background === true ? 'history' : 'realtime')), background: input.background === true })
        : null;
      const fallbackId = clean(route?.fallback?.id);
      const repaired = await executeTranslationAttempt(aiGateway, input, termPack, sourceLanguage, {
        strictRepair: true,
        previous: translatedZh || clean(first?.text),
        modelId: fallbackId && fallbackId !== clean(first?.modelId) ? fallbackId : clean(input.modelId)
      });
      attempts.push({ modelId: clean(repaired?.modelId), model: clean(repaired?.model), status: fallbackId ? 'fallback-repair' : 'repair' });
      const repairedText = terminology.restoreProtectedTerms(normalizeTranslationOutput(repaired?.text), termPack.mappings);
      const repairedQuality = terminology.assessChineseTranslation({ sourceText: text, translatedZh: repairedText, mappings: termPack.mappings });
      if (repairedText && !terminology.hasResidualProtectedTerms(repairedText) && containsHan(repairedText) && repairedQuality.status !== 'blocking') {
        translatedZh = repairedText;
        quality = repairedQuality;
        selected = repaired;
      }
    }
    if (!translatedZh || terminology.hasResidualProtectedTerms(translatedZh) || !containsHan(translatedZh) || quality.status === 'blocking') {
      const error = new Error(terminology.hasResidualProtectedTerms(translatedZh)
        ? '翻译模型残留了内部术语占位符'
        : !containsHan(translatedZh)
          ? '翻译模型没有返回有效中文正文'
          : '翻译结果未通过数字、链接或术语完整性检查');
      error.code = 'TRANSLATION_OUTPUT_INVALID';
      throw error;
    }
    return {
      sourceText: text,
      sourceLanguage,
      translatedZh,
      translationStatus: 'success',
      protectedTerms: termPack.mappings.map(row => ({ source: row.source, targetZh: row.restoreValue, kind: row.kind })),
      translationQuality: quality,
      translationModel: clean(selected?.model || selected?.modelId),
      translationAttempts: attempts,
      translatedAt: new Date().toISOString()
    };
  } catch (error) {
    const code = clean(error?.code || error?.name).toUpperCase();
    const cancellationCodes = new Set([
      'ABORTERROR', 'ABORT_ERR', 'ABORTED', 'MODEL_CANCELLED', 'JOB_CANCELLED',
      'AI_TASK_CANCELLED', 'EXTERNAL_ABORT', 'CALLER_ABORTED', 'NEW_INCOMING_MESSAGE',
      'SOCIAL_CONTEXT_CHANGED', 'PERSONA_PROFILE_CHANGED'
    ]);
    if (error?.name === 'AbortError' || cancellationCodes.has(code)) throw error;
    return {
      sourceText: text,
      sourceLanguage,
      translatedZh: '',
      translationStatus: 'failed',
      protectedTerms: termPack.mappings.map(row => ({ source: row.source, targetZh: row.restoreValue, kind: row.kind })),
      translationQuality: terminology.assessChineseTranslation({ sourceText: text, translatedZh: '', mappings: termPack.mappings }),
      translationErrorCode: clean(error.code || 'TRANSLATION_FAILED'),
      translationError: clean(error.message),
      translatedAt: ''
    };
  }
}

async function addChineseUnderstanding(value, dependencies = {}, options = {}) {
  const text = clean(value);
  const result = await translateToChinese({ text, ...options }, dependencies);
  return { original: text, ...result };
}

module.exports = {
  clean,
  containsHan,
  scriptCounts,
  isChineseDominant,
  inferLanguage,
  translationPrompt,
  normalizeTranslationOutput,
  translateToChinese,
  addChineseUnderstanding,
  TRANSLATION_MODEL_TIMEOUT_MS,
  TRANSLATION_QUEUE_TIMEOUT_INTERACTIVE_MS,
  TRANSLATION_QUEUE_TIMEOUT_BACKGROUND_MS
};
