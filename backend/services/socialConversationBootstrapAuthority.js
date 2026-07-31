'use strict';

const crypto = require('node:crypto');
const messageSpeakerAuthority = require('./messageSpeakerAuthority');
const aiAnalysisResultAuthority = require('./aiAnalysisResultAuthority');

const AUTHORITY = 'SocialConversationBootstrapAuthority';
const SCHEMA_VERSION = 1;
const GREETING_PATTERN = /^(?:hi+|hey+|hello+|hallo+|guten\s+(?:morgen|tag|abend)|moin+|servus|grüß(?:e| dich)?|你好|您好|嗨+|哈[喽啰罗]|早上好|早安|晚上好|晚安|在吗|salut|bonjour|bonsoir|hola|buenos\s+d[ií]as|buenas\s+(?:tardes|noches)|ciao|buongiorno|ol[aá]|bom\s+dia|boa\s+(?:tarde|noite)|привет|здравствуйте|merhaba|selam|مرحبا|أهلا)[\s\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu;
const ACK_PATTERN = /^(?:ok(?:ay)?|ja|yes|yeah|yep|好的?|好呀|嗯+|哦+|收到|明白|danke|thanks?|merci|gracias|vale|si|s[ií]|да)[\s\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu;
const EMOJI_ONLY_PATTERN = /^[\s\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u;

function clean(value) { return String(value == null ? '' : value).trim(); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function sha256(value) { return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex'); }
function messageText(message = {}) { return clean(message.sourceText || message.text || message.body || message.caption); }
function messageId(message = {}) { return clean(message.platformMessageId || message.externalMessageId || message.messageId || message.id); }
function translatedZh(message = {}) { return clean(message.translatedZh || message.textZh || message.translation?.translatedZh); }

function latestPeerInbound(messages = []) {
  return [...array(messages)].reverse().find(message => messageSpeakerAuthority.isPeerInbound(message) && messageText(message)) || null;
}

function classifyText(value = '') {
  const text = clean(value).normalize('NFKC');
  if (!text) return { eligible: false, act: 'empty', confidence: 0 };
  if (text.length <= 48 && GREETING_PATTERN.test(text)) return { eligible: true, act: 'greeting', confidence: 0.99 };
  if (text.length <= 24 && ACK_PATTERN.test(text)) return { eligible: true, act: 'acknowledgement', confidence: 0.96 };
  if (text.length <= 18 && EMOJI_ONLY_PATTERN.test(text)) return { eligible: true, act: 'emoji_opener', confidence: 0.92 };
  if (text.length <= 64 && /^(?:how are you|how's it going|wie geht(?:'s| es dir)?|was machst du|你好吗|最近怎么样|在干嘛|ça va|como estas|come stai|como vai|как дела)[\s\p{P}\p{S}\p{Emoji_Presentation}\p{Extended_Pictographic}]*$/iu.test(text)) {
    return { eligible: true, act: 'light_check_in', confidence: 0.97 };
  }
  return { eligible: false, act: 'substantive', confidence: 0 };
}

function defaultsForAct(act) {
  if (act === 'acknowledgement') {
    return {
      summary: '对方给出简短确认，当前信息量有限，但互动仍然开放。',
      intent: '简短确认或承接上一轮对话',
      hiddenNeed: '没有足够证据支持更深层需求；当前可确认的是维持自然、低压力的互动。',
      opportunityText: '可以轻松承接并给出一个容易继续的话题。',
      strategyTitle: '自然承接，轻量推进'
    };
  }
  if (act === 'emoji_opener') {
    return {
      summary: '对方用表情发起轻量互动，尚未提供可写入档案的事实。',
      intent: '以低成本方式试探互动意愿',
      hiddenNeed: '没有足够证据支持更深层需求；当前可确认的是希望获得自然回应并观察互动氛围。',
      opportunityText: '适合用简短、有温度的回复建立第一轮节奏。',
      strategyTitle: '回应表情，建立轻松节奏'
    };
  }
  if (act === 'light_check_in') {
    return {
      summary: '对方以轻量问候或近况问题开启互动，当前重点是自然回应并形成对话来回。',
      intent: '了解近况并开启日常交流',
      hiddenNeed: '没有足够证据支持更深层需求；当前可确认的是希望获得回应并继续交流。',
      opportunityText: '可以先自然回应，再加入一个轻松、易回答的话题钩子。',
      strategyTitle: '先回应，再轻松抛回话题'
    };
  }
  return {
    summary: '对方发来简短问候，尚未提供可写入档案的个人事实。',
    intent: '开启对话并确认对方是否愿意互动',
    hiddenNeed: '没有足够证据支持更深层需求；当前可确认的是希望得到自然回应并建立第一轮互动。',
    opportunityText: '这是新客户冷启动机会，适合简短回应并加入一个轻松、低压力的话题钩子。',
    strategyTitle: '自然回应，建立第一轮互动'
  };
}

function bootstrapFromMessages(messages = []) {
  const message = latestPeerInbound(messages);
  if (!message) return null;
  const sourceText = messageText(message);
  const classification = classifyText(sourceText);
  if (!classification.eligible) return null;
  const messageIdentifier = messageId(message);
  if (!messageIdentifier) return null;
  const defaults = defaultsForAct(classification.act);
  const zh = translatedZh(message) || sourceText;
  const evidence = [{
    messageId: messageIdentifier,
    sourceMessageId: messageIdentifier,
    label: classification.act === 'greeting' ? '对方主动问候' : '对方当前消息',
    quote: sourceText,
    sourceText,
    translatedZh: zh,
    source: '真实入站消息',
    confidence: classification.confidence,
    sentAt: clean(message.sentAt || message.timestamp || message.createdAt)
  }];
  const analysis = {
    summary: defaults.summary,
    confidence: Math.round(classification.confidence * 100),
    intent: defaults.intent,
    intentLabel: defaults.intent,
    intentConfidence: Math.round(classification.confidence * 100),
    hiddenNeed: defaults.hiddenNeed,
    needConfidence: 62,
    dimensions: { emotion: 55, initiative: 62, openness: 45, pressure: 12, flirtation: /[🌹❤️😘😍]/u.test(sourceText) ? 38 : 12 },
    memories: [],
    evidence,
    mustRespond: [{ text: '回应对方当前消息', reason: '这是本轮唯一且最新的真实入站消息。' }],
    ignore: [],
    risk: { score: 8, level: '低', text: '当前信息很少，避免过度解读、查户口式连续提问或直接写入客户事实。' },
    opportunity: { score: 72, level: '中高', text: defaults.opportunityText },
    personaConsistency: 100,
    constraints: [
      { text: '不把问候推断成年龄、职业、城市、婚姻等客户事实', pass: true },
      { text: '回复保持简短、自然、低压力', pass: true }
    ],
    strategy: {
      title: defaults.strategyTitle,
      reason: '以真实入站消息为证据，在信息不足时使用保守的社交开场策略，而不是阻断候选生成。',
      match: 92,
      progress: 58,
      risk: 8,
      replyChance: 76
    },
    simulation: {
      likely: { text: '对方继续进行轻量日常交流。', probability: 64 },
      positive: { text: '对方回应话题钩子并开始分享。', probability: 28 },
      negative: { text: '对方暂时不继续回复。', probability: 8 }
    },
    conversationAct: classification.act,
    bootstrapAuthority: AUTHORITY,
    bootstrapSchemaVersion: SCHEMA_VERSION,
    deterministicBootstrap: true,
    sourceLastMessageId: messageIdentifier
  };
  const envelope = { analysis, profile: {}, insights: {} };
  return {
    ...envelope,
    completeness: aiAnalysisResultAuthority.productCompleteness(analysis),
    envelopeSha256: sha256(envelope),
    bootstrap: { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, act: classification.act, messageId: messageIdentifier, deterministic: true }
  };
}

function enrichEnvelope(envelope = {}, messages = []) {
  const bootstrap = bootstrapFromMessages(messages);
  if (!bootstrap) return envelope;
  const current = object(envelope);
  const analysis = object(current.analysis);
  const fallback = bootstrap.analysis;
  const merged = {
    ...fallback,
    ...analysis,
    summary: clean(analysis.summary) || fallback.summary,
    intent: clean(analysis.intent || analysis.intentLabel) ? analysis.intent : fallback.intent,
    intentLabel: clean(analysis.intentLabel || analysis.intent) ? analysis.intentLabel || analysis.intent : fallback.intentLabel,
    hiddenNeed: clean(analysis.hiddenNeed) || fallback.hiddenNeed,
    dimensions: Object.keys(object(analysis.dimensions)).length ? analysis.dimensions : fallback.dimensions,
    risk: typeof analysis.risk === 'number' || Object.keys(object(analysis.risk)).length ? analysis.risk : fallback.risk,
    opportunity: typeof analysis.opportunity === 'number' || Object.keys(object(analysis.opportunity)).length ? analysis.opportunity : fallback.opportunity,
    strategy: typeof analysis.strategy === 'string' ? (clean(analysis.strategy) || fallback.strategy) : (Object.keys(object(analysis.strategy)).length ? analysis.strategy : fallback.strategy),
    evidence: array(analysis.evidence).length ? analysis.evidence : fallback.evidence,
    mustRespond: array(analysis.mustRespond).length ? analysis.mustRespond : fallback.mustRespond,
    constraints: array(analysis.constraints).length ? analysis.constraints : fallback.constraints,
    conversationAct: clean(analysis.conversationAct) || fallback.conversationAct,
    bootstrapAuthority: AUTHORITY,
    bootstrapSchemaVersion: SCHEMA_VERSION,
    deterministicBootstrap: true,
    sourceLastMessageId: fallback.sourceLastMessageId
  };
  const result = {
    ...current,
    analysis: merged,
    profile: object(current.profile),
    insights: object(current.insights),
    bootstrap: bootstrap.bootstrap
  };
  result.completeness = aiAnalysisResultAuthority.productCompleteness(merged);
  result.envelopeSha256 = sha256({ analysis: result.analysis, profile: result.profile, insights: result.insights });
  return result;
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  classifyText,
  latestPeerInbound,
  bootstrapFromMessages,
  enrichEnvelope
};
