'use strict';

const { createStateSignal } = require('./socialSignalSchema');
const messageSpeakerAuthority = require('../../services/messageSpeakerAuthority');

const PARSER_VERSION = '1.0.0';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLocaleLowerCase('de-DE');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function words(text) {
  return clean(text).split(/\s+/u).filter(Boolean);
}

function includesAny(text, patterns) {
  return patterns.some(pattern => pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern));
}

function timestamp(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function average(values) {
  const rows = values.filter(value => Number.isFinite(value));
  return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
}

const LEXICON = Object.freeze({
  fatigue: [
    /\bmüde\b/u, /\berschöpft\b/u, /\bkaputt\b/u, /\banstrengend\b/u,
    /\btired\b/u, /\bexhausted\b/u, /\bdrained\b/u, /\bworn out\b/u,
    '累', '疲惫', '没精神', '好困'
  ],
  negativeMood: [
    /\bschlecht drauf\b/u, /\btraurig\b/u, /\bgenervt\b/u, /\bgestresst\b/u,
    /\bdown\b/u, /\bsad\b/u, /\bupset\b/u, /\bstressed\b/u,
    '心情不好', '难过', '烦', '压力大'
  ],
  recovery: [
    /\bgeht mir besser\b/u, /\bwieder besser\b/u, /\bentspannter\b/u, /\balles gut\b/u,
    /\bfeeling better\b/u, /\bmuch better\b/u, /\bmore relaxed\b/u,
    '好多了', '没事了', '心情好些了', '轻松多了'
  ],
  defensive: [
    /\bwill nicht darüber reden\b/u, /\blass das\b/u, /\bgeht dich nichts an\b/u,
    /\bdon't want to talk about it\b/u, /\bleave it\b/u, /\bnone of your business\b/u,
    '不想说', '别问了', '不关你的事', '不想聊这个'
  ],
  boundary: [
    /\bbitte nicht\b/u, /\bich möchte nicht\b/u, /\bkein thema für mich\b/u,
    /\bplease don't\b/u, /\bi'd rather not\b/u, /\bnot comfortable\b/u,
    '请不要', '我不喜欢', '不方便', '别再'
  ],
  trust: [
    /\bich vertraue dir\b/u, /\bkann ich dir erzählen\b/u, /\bnur dir\b/u,
    /\bi trust you\b/u, /\bcan tell you\b/u, /\bonly you\b/u,
    '我信任你', '只跟你说', '可以告诉你'
  ],
  privateSharing: [
    /\bmeine familie\b/u, /\bmeine ehe\b/u, /\bmeine scheidung\b/u, /\bmein ex\b/u,
    /\bmy family\b/u, /\bmy marriage\b/u, /\bmy divorce\b/u, /\bmy ex\b/u,
    '我的家人', '我的婚姻', '我离婚', '我的前任', '小时候'
  ],
  warmth: [
    /\bdanke dir\b/u, /\blieb von dir\b/u, /\bfreut mich\b/u, /\bschön von dir\b/u,
    /\bthank you\b/u, /\bthat's kind\b/u, /\bglad to hear\b/u,
    '谢谢你', '你真好', '很开心', '暖心'
  ],
  avoidance: [
    /\banderes thema\b/u, /\breden wir über etwas anderes\b/u,
    /\blet's talk about something else\b/u, /\bchange the subject\b/u,
    '换个话题', '不说这个', '聊点别的'
  ]
});

function signal(input, type, strength, confidence, summary, options = {}) {
  return createStateSignal({
    contactId: input.contactId,
    conversationId: input.conversationId,
    platform: input.platform || input.message.platform,
    sourceAccountId: input.sourceAccountId || input.message.sourceAccountId || input.message.accountId,
    platformMessageId: input.message.platformMessageId || input.message.id,
    projectionVersion: PARSER_VERSION,
    messageId: input.message.id,
    signalType: type,
    strength: clamp01(strength, 0.5),
    confidence: clamp01(confidence, 0.5),
    observedAt: input.message.sentAt || input.message.timestamp,
    evidence: {
      messageIds: [input.message.id],
      summary
    },
    source: options.source || 'social_parser',
    parserVersion: PARSER_VERSION,
    status: options.status || (confidence >= 0.78 ? 'confirmed' : 'candidate')
  }, { idFactory: options.idFactory });
}

function previousInboundMessages(input) {
  return (input.recentMessages || [])
    .filter(row => row && row.id !== input.message.id)
    .filter(row => messageSpeakerAuthority.isPeerInbound(row));
}

function previousOutboundMessages(input) {
  return (input.recentMessages || [])
    .filter(row => row && row.id !== input.message.id)
    .filter(row => messageSpeakerAuthority.isSelfOutbound(row));
}

function parseSocialSignals(input = {}, options = {}) {
  const message = input.message || {};
  const contactId = clean(input.contactId);
  const conversationId = clean(input.conversationId || message.conversationId || message.sessionKey);
  const messageId = clean(message.id || message.messageId);
  if (!contactId || !conversationId || !messageId) {
    const error = new Error('Social parser requires contactId, conversationId and message.id');
    error.code = 'INVALID_SOCIAL_PARSE_INPUT';
    throw error;
  }

  const normalized = {
    ...input,
    contactId,
    conversationId,
    platform: clean(input.platform || message.platform),
    sourceAccountId: clean(input.sourceAccountId || message.sourceAccountId || message.accountId),
    message: {
      ...message,
      id: messageId,
      sentAt: clean(message.sentAt || message.timestamp) || new Date().toISOString()
    }
  };
  const text = lower(message.text || message.transcript || message.translation);
  const results = [];
  if (!messageSpeakerAuthority.isSocialMessage(message)) return results;
  const inbound = messageSpeakerAuthority.isPeerInbound(message);

  if (!inbound) {
    const ordered = [...(normalized.recentMessages || [])]
      .filter(Boolean)
      .sort((a, b) => timestamp(a.sentAt || a.timestamp) - timestamp(b.sentAt || b.timestamp));
    let trailingOutbound = 0;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const row = ordered[index];
      const rowInbound = messageSpeakerAuthority.isPeerInbound(row);
      if (rowInbound) break;
      const rowOutbound = messageSpeakerAuthority.isSelfOutbound(row);
      if (rowOutbound) trailingOutbound += 1;
    }
    if (trailingOutbound >= 2) {
      results.push(signal(
        normalized,
        'consecutive_no_reply',
        Math.min(1, 0.55 + (trailingOutbound - 2) * 0.15),
        0.96,
        `连续发送 ${trailingOutbound} 条消息仍未收到对方回复`,
        { ...options, status: 'confirmed' }
      ));
    }
    return results;
  }

  if (!text) return results;

  if (includesAny(text, LEXICON.fatigue)) {
    results.push(signal(normalized, 'fatigue_expressed', 0.72, 0.86, '对方明确表达疲惫或精力不足', options));
  }
  if (includesAny(text, LEXICON.negativeMood)) {
    results.push(signal(normalized, 'emotion_declining', 0.67, 0.79, '对方表达负面情绪或压力', options));
  }
  if (includesAny(text, LEXICON.recovery)) {
    results.push(signal(normalized, 'emotion_recovering', 0.76, 0.88, '对方明确表达状态正在恢复', options));
  }
  if (includesAny(text, LEXICON.defensive)) {
    results.push(signal(normalized, 'defensiveness_increasing', 0.84, 0.91, '对方明确拒绝继续当前话题', options));
  }
  if (includesAny(text, LEXICON.boundary)) {
    results.push(signal(normalized, 'boundary_expressed', 0.88, 0.92, '对方表达明确边界或不适', options));
  }
  if (includesAny(text, LEXICON.trust)) {
    results.push(signal(normalized, 'trust_expressed', 0.81, 0.9, '对方明确表达信任', options));
  }
  if (includesAny(text, LEXICON.privateSharing)) {
    results.push(signal(normalized, 'private_sharing', 0.66, 0.72, '对方主动分享私人经历或家庭信息', options));
  }
  if (includesAny(text, LEXICON.warmth)) {
    results.push(signal(normalized, 'warmth_increasing', 0.55, 0.68, '对方表达感谢、认可或温暖回应', options));
  }
  if (includesAny(text, LEXICON.avoidance)) {
    results.push(signal(normalized, 'topic_avoidance', 0.78, 0.87, '对方主动回避或切换当前话题', options));
  }

  const priorInbound = previousInboundMessages(normalized).slice(-8);
  const currentLength = words(text).length || text.length;
  const averageLength = average(priorInbound.map(row => words(row.text).length || clean(row.text).length));
  if (priorInbound.length >= 3 && averageLength >= 6) {
    if (currentLength <= Math.max(2, averageLength * 0.45)) {
      results.push(signal(normalized, 'reply_length_shortening', Math.min(1, 1 - currentLength / averageLength), 0.72, '当前回复明显短于近期个人基线', options));
    } else if (currentLength >= averageLength * 1.7) {
      results.push(signal(normalized, 'reply_length_increasing', Math.min(1, currentLength / Math.max(1, averageLength * 2)), 0.68, '当前回复明显长于近期个人基线', options));
    }
  }

  const outbound = previousOutboundMessages(normalized);
  const lastOutbound = outbound.sort((a, b) => timestamp(a.sentAt) - timestamp(b.sentAt)).at(-1);
  const currentAt = timestamp(normalized.message.sentAt);
  const lastOutboundAt = timestamp(lastOutbound?.sentAt || lastOutbound?.timestamp);
  if (lastOutboundAt && currentAt > lastOutboundAt) {
    const delayMinutes = (currentAt - lastOutboundAt) / 60000;
    const baseline = number(input.relationship?.interaction?.averageReplyDelayMinutes, 0);
    if (baseline >= 20 && delayMinutes <= baseline * 0.55) {
      results.push(signal(normalized, 'reply_speed_increasing', Math.min(1, 1 - delayMinutes / baseline), 0.71, '当前回复速度明显快于个人历史基线', options));
    } else if (baseline >= 20 && delayMinutes >= baseline * 1.8) {
      results.push(signal(normalized, 'reply_speed_decreasing', Math.min(1, delayMinutes / (baseline * 3)), 0.65, '当前回复速度明显慢于个人历史基线', options));
    }
  }

  const questionCount = (text.match(/[?？]/g) || []).length;
  const personalMarkers = includesAny(text, LEXICON.privateSharing) || includesAny(text, LEXICON.trust);
  if (personalMarkers || currentLength >= Math.max(30, averageLength * 1.8)) {
    results.push(signal(normalized, 'topic_depth_increasing', personalMarkers ? 0.75 : 0.55, personalMarkers ? 0.78 : 0.6, '对方分享内容的私密度或话题深度提升', options));
  }
  if (questionCount >= 2 || /\b(wie geht es dir|und du|was meinst du)\b/u.test(text) || /(你呢|你觉得|你怎么样)/u.test(text)) {
    results.push(signal(normalized, 'initiative_recovering', 0.58, 0.66, '对方主动提出问题并延续互动', options));
  }

  const unique = new Map();
  for (const row of results) {
    const current = unique.get(row.signalType);
    if (!current || row.confidence > current.confidence) unique.set(row.signalType, row);
  }
  return [...unique.values()];
}

module.exports = {
  PARSER_VERSION,
  LEXICON,
  parseSocialSignals
};
