'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

const LONG_DASH_PATTERN = /[\u2013\u2014]/u;
const REPORT_STYLE_PATTERNS = Object.freeze([
  /\b(?:zusammenfassend|abschließend|darüber hinaus|des weiteren|mit freundlichen grüßen|sehr geehrte[rs]?)\b/iu,
  /\b(?:in conclusion|to summarize|furthermore|moreover|dear sir|dear madam|kind regards)\b/iu,
  /(?:^|[。！？.!?]\s*)(?:首先|其次|再次|最后|总之|综上所述|此外)[，,:：]?/u
]);

const KNOWN_HABIT_LABELS = Object.freeze({
  'short natural messages': '短而自然，像真实 WhatsApp 聊天',
  'at most one question': '最多一个问题',
  'no repeated name': '不要反复称呼对方名字',
  'no em dash': '禁止使用长破折号（— 或 –）'
});

function normalizeList(value, limit = 32) {
  return (Array.isArray(value) ? value : [])
    .map(clean)
    .filter(Boolean)
    .slice(0, limit);
}

function platformChatLabel(value = '') {
  const platform = clean(value).toLowerCase();
  if (platform === 'telegram') return 'Telegram';
  if (platform === 'facebook') return 'Facebook Messenger';
  return 'WhatsApp';
}

function presentationRules(profile = {}) {
  const expressionHabits = normalizeList(profile.expressionHabits).map(row => KNOWN_HABIT_LABELS[row.toLowerCase()] || row);
  const replyStylePreferences = normalizeList(profile.replyStylePreferences);
  const forbiddenExpressions = normalizeList(profile.forbiddenExpressions);
  return { expressionHabits, replyStylePreferences, forbiddenExpressions };
}

function coreRuntimeRules(targetLanguage = '客户当前语言', platform = 'whatsapp') {
  const chatLabel = platformChatLabel(platform);
  return [
    `目标回复语言：${clean(targetLanguage) || '客户当前语言'}。`,
    `以当前 Persona 的成熟、独立、有生活感的女性口吻回复，像真实 ${chatLabel} 对话，不像邮件、报告、客服话术或 AI 作文。`,
    '默认使用 1 到 3 个短句，保持自然停顿和口语节奏；最多一个问题。',
    '禁止使用长破折号（— 或 –）；需要停顿时使用逗号、句号或拆成短句。',
    '不要使用标题、项目符号、编号、总结式结构、过度解释或正式书信结尾。',
    '不要机械复述对方原话，不要反复称呼对方名字，不要为了显得高级而使用书面化长句。'
  ];
}

function runtimePrompt(input = {}) {
  const profileRules = presentationRules(input.presentationProfile || {});
  const mergeCandidates = normalizeList(input.mergeCandidates, 5);
  const chatLabel = platformChatLabel(input.platform);
  const platformize = rows => rows.map(row => row.replace(/WhatsApp/gu, chatLabel));
  const lines = [
    ...coreRuntimeRules(input.targetLanguage, input.platform),
    clean(input.stylePrompt).replace(/WhatsApp/gu, chatLabel)
  ].filter(Boolean);

  if (profileRules.expressionHabits.length) lines.push(`当前 Persona 表达习惯：${platformize(profileRules.expressionHabits).join('；')}。`);
  if (profileRules.replyStylePreferences.length) lines.push(`当前 Persona 偏好：${platformize(profileRules.replyStylePreferences).join('；')}。`);
  if (profileRules.forbiddenExpressions.length) lines.push(`当前 Persona 禁止表达：${profileRules.forbiddenExpressions.join('；')}。`);
  if (mergeCandidates.length) {
    lines.push(`本次任务是综合候选：吸收用户选中的措辞与语气，去除重复，重写成一条全新的自然 ${chatLabel} 回复；不能简单拼接。`);
    lines.push(`用户选中的候选：${mergeCandidates.map((row, index) => `${index + 1}. ${row}`).join(' | ')}`);
  }
  return lines.join('\n');
}

function qualificationPrompt() {
  return [
    '为一位成熟、独立、事业型的德国女性写一条自然德语 WhatsApp 回复。',
    '对方说：Berlin fehlt mir manchmal.',
    ...coreRuntimeRules('德语', 'whatsapp').slice(1),
    '不要重复原句。只输出德语回复正文。'
  ].join('\n');
}

function validate(value, packet = {}) {
  const text = clean(value);
  const issues = [];
  if (!text) return { pass: false, issues: [{ code: 'EMPTY_REPLY', message: '候选回复为空' }], metrics: { longDashCount: 0, paragraphCount: 0 } };

  const longDashCount = (text.match(/[\u2013\u2014]/gu) || []).length;
  const paragraphCount = text.split(/\n\s*\n/u).map(row => row.trim()).filter(Boolean).length;
  if (LONG_DASH_PATTERN.test(text)) {
    issues.push({ code: 'WHATSAPP_LONG_DASH', message: '候选使用了长破折号，不符合真实 WhatsApp 短句表达习惯' });
  }
  if (REPORT_STYLE_PATTERNS.some(pattern => pattern.test(text))) {
    issues.push({ code: 'WHATSAPP_REPORT_STYLE', message: '候选带有报告、邮件或总结式书面表达，不像真实 WhatsApp 聊天' });
  }
  if (paragraphCount > 2) {
    issues.push({ code: 'WHATSAPP_TOO_MANY_PARAGRAPHS', message: '候选分段过多，不像即时聊天回复' });
  }

  const contactName = clean(packet.customer?.name || packet.customer?.displayName || packet.contactName);
  if (contactName && contactName.length >= 2) {
    const escaped = contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const repeatedName = new RegExp(escaped, 'giu');
    if ((text.match(repeatedName) || []).length > 1) {
      issues.push({ code: 'WHATSAPP_REPEATED_NAME', message: '候选反复称呼对方名字，显得机械和不自然' });
    }
  }

  return {
    pass: issues.length === 0,
    issues,
    metrics: { longDashCount, paragraphCount }
  };
}

module.exports = {
  LONG_DASH_PATTERN,
  REPORT_STYLE_PATTERNS,
  platformChatLabel,
  presentationRules,
  coreRuntimeRules,
  runtimePrompt,
  qualificationPrompt,
  validate
};
