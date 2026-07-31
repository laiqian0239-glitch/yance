'use strict';

const whatsappReplyStyleAuthority = require('./whatsappReplyStyleAuthority');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
}

function stripWrapper(value) {
  let text = clean(value)
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const labelled = text.match(/^(?:候选回复|回复|answer|reply|antwort)\s*[:：]\s*([\s\S]+)$/i);
  if (labelled) text = labelled[1].trim();
  if ((text.startsWith('“') && text.endsWith('”')) || (text.startsWith('"') && text.endsWith('"'))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function countQuestions(text) {
  return (clean(text).match(/[?？]/g) || []).length;
}

function countSentences(text) {
  return clean(text).split(/[.!?。！？]+/u).map(part => part.trim()).filter(Boolean).length;
}

function normalizedComparable(value) {
  return clean(value)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function bigrams(value) {
  const normalized = normalizedComparable(value);
  const rows = [];
  for (let index = 0; index < normalized.length - 1; index += 1) rows.push(normalized.slice(index, index + 2));
  return rows;
}

function diceSimilarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.length || !b.length) return normalizedComparable(left) === normalizedComparable(right) ? 1 : 0;
  const counts = new Map();
  for (const gram of a) counts.set(gram, Number(counts.get(gram) || 0) + 1);
  let overlap = 0;
  for (const gram of b) {
    const available = Number(counts.get(gram) || 0);
    if (available > 0) {
      overlap += 1;
      counts.set(gram, available - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function maximumCandidateSimilarity(candidate, alternatives = []) {
  return (Array.isArray(alternatives) ? alternatives : [])
    .map(value => diceSimilarity(candidate, value))
    .reduce((maximum, value) => Math.max(maximum, value), 0);
}

function appearsToRepeatIncoming(candidate, incoming) {
  const output = normalizedComparable(candidate);
  const source = normalizedComparable(incoming);
  if (!source || source.length < 12 || !output) return false;
  if (output === source) return true;
  if (source.length >= 20 && output.includes(source)) return true;
  return false;
}

function recommendedHardLimit(packet = {}) {
  const recommendation = clean(packet.replyStrategy?.recommendedLength || packet.preferences?.preferredLength).toLowerCase();
  if (/short|brief|kurz|短/.test(recommendation)) return 520;
  if (/long|detailed|lang|长/.test(recommendation)) return 1800;
  return 1000;
}

function sentenceLimit(packet = {}) {
  const recommendation = clean(packet.replyStrategy?.recommendedLength || packet.preferences?.preferredLength).toLowerCase();
  if (/short|brief|kurz|短/.test(recommendation)) return 4;
  if (/long|detailed|lang|长/.test(recommendation)) return 12;
  return 7;
}

const TECHNICAL_LEAK_PATTERNS = [
  /社交决策包/u,
  /系统(?:检测|提示|指令)/u,
  /后台(?:分析|标签|评分)/u,
  /relationshipStage|personaVersionId|personaPolicyHash|policyHash|contextVersion|entityVersions/i,
  /as an ai|作为(?:一个)?ai(?:模型|助手)?/i
];

const STRUCTURED_OUTPUT_PATTERNS = [
  /^\s*[\[{][\s\S]*[\]}]\s*$/u,
  /(?:^|\n)\s*(?:选项|版本|候选)\s*[一二三123][:：.]/u,
  /(?:^|\n)\s*(?:1[.)、]|2[.)、])\s+/u,
  /^\s*#+\s+/u
];

const DIRECT_FINANCIAL_SOLICITATION_PATTERNS = [
  /(?:请|现在|马上|先).{0,10}(?:转账|汇款|打钱)(?:给我|给我们|到这个账户)/u,
  /(?:我来|让我|可以帮你|替你|代你).{0,12}(?:操作|操盘|控制)(?:账户|账号|钱包|银行卡)/u,
  /(?:跟着我|听我的|按我说的).{0,12}(?:买入|卖出|下单|入金).{0,20}(?:稳赚|保证|保本)/u,
  /überweis(?:e|en)\s+(?:mir|uns)|ich\s+handle\s+für\s+dich/iu,
  /send\s+(?:me|us)\s+(?:the\s+)?money|trade\s+(?:your|the)\s+account\s+for\s+you/iu
];

function containsFinancialSolicitation(value) {
  const text = clean(value);
  if (DIRECT_FINANCIAL_SOLICITATION_PATTERNS.some(pattern => pattern.test(text))) return true;

  const chineseGuarantee = /保证(?:收益|盈利)/u.test(text);
  const chineseDenial = /(?:不|不能|无法|不会|从不|不可能)[^。！？]{0,12}保证(?:收益|盈利)/u.test(text);
  if (chineseGuarantee && !chineseDenial) return true;

  const englishGuarantee = /guaranteed?\s+(?:return|profit)|guarantee\s+(?:a\s+)?(?:return|profit)/iu.test(text);
  const englishDenial = /(?:cannot|can't|do\s+not|don't|won't|unable\s+to|no\s+one\s+can)[^.!?]{0,32}guarantee(?:d)?\s+(?:a\s+)?(?:return|profit)/iu.test(text);
  if (englishGuarantee && !englishDenial) return true;

  const germanGuarantee = /garantierte?\s+(?:rendite|gewinne?)|garantiere[^.!?]{0,20}(?:rendite|gewinn)/iu.test(text);
  const germanDenial = /(?:nicht|keine|kann[^.!?]{0,16}nicht|niemand\s+kann)[^.!?]{0,32}(?:garantierte?\s+(?:rendite|gewinne?)|garantier[^.!?]{0,20}(?:rendite|gewinn))/iu.test(text);
  return germanGuarantee && !germanDenial;
}

function validateReplyCandidate(value, packet = {}) {
  const text = stripWrapper(value);
  const issues = [];
  const maxQuestions = clampInteger(packet.replyStrategy?.maxQuestions, 0, 3, 1);
  const questionCount = countQuestions(text);
  const sentences = countSentences(text);
  const alternativeSimilarity = maximumCandidateSimilarity(text, packet.director?.avoidCandidates);
  const whatsappStyle = whatsappReplyStyleAuthority.validate(text, packet);

  if (!text) issues.push({ code: 'EMPTY_REPLY', message: '候选回复为空' });
  if (text.length > recommendedHardLimit(packet)) {
    issues.push({ code: 'REPLY_TOO_LONG', message: '候选回复明显超过当前长度策略' });
  }
  if (sentences > sentenceLimit(packet)) {
    issues.push({ code: 'TOO_MANY_SENTENCES', message: '候选回复句子数量超过当前长度策略' });
  }
  if (questionCount > maxQuestions) {
    issues.push({ code: 'TOO_MANY_QUESTIONS', message: `候选包含 ${questionCount} 个问题，当前上限为 ${maxQuestions}` });
  }
  if (STRUCTURED_OUTPUT_PATTERNS.some(pattern => pattern.test(text))) {
    issues.push({ code: 'STRUCTURED_OR_MULTI_OPTION_OUTPUT', message: '候选包含JSON、标题、编号或多个选项' });
  }
  if (TECHNICAL_LEAK_PATTERNS.some(pattern => pattern.test(text))) {
    issues.push({ code: 'INTERNAL_ANALYSIS_LEAK', message: '候选暴露了后台分析或系统字段' });
  }
  if (containsFinancialSolicitation(text)) {
    issues.push({ code: 'FINANCIAL_SOLICITATION', message: '候选包含禁止的收益承诺、资金招揽或账户代操作表达' });
  }
  if (appearsToRepeatIncoming(text, packet.incomingMessage?.text)) {
    issues.push({ code: 'REPEATS_INCOMING_MESSAGE', message: '候选机械复述了对方原话' });
  }
  if (alternativeSimilarity >= 0.78) {
    issues.push({ code: 'DUPLICATES_EXISTING_CANDIDATE', message: '候选与已生成路线过于相似，没有形成真正不同的表达分支' });
  }
  for (const issue of whatsappStyle.issues) {
    if (!issues.some(row => row.code === issue.code)) issues.push(issue);
  }

  return {
    pass: issues.length === 0,
    text,
    issues,
    metrics: { length: text.length, sentences, questionCount, maxQuestions, alternativeSimilarity: Number(alternativeSimilarity.toFixed(3)), ...whatsappStyle.metrics }
  };
}



const OBVIOUS_SECRET_PATTERNS = [
  /(?:api[_ -]?key|api[_ -]?secret|access[_ -]?token|refresh[_ -]?token|bearer)\s*[:=]\s*[A-Za-z0-9_\-./+]{12,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:otp|verification code|验证码|动态码)\s*[:：]?\s*\d{4,8}\b/iu
];

function validateFastReplyCandidate(value, packet = {}) {
  const text = stripWrapper(value);
  const blockers = [];
  const advisories = [];
  if (!text) blockers.push({ code: 'EMPTY_REPLY', message: '候选回复为空' });
  if (STRUCTURED_OUTPUT_PATTERNS.some(pattern => pattern.test(text))) {
    advisories.push({ code: 'STRUCTURED_OR_MULTI_OPTION_OUTPUT', message: '候选可能包含标题、编号或结构化输出' });
  }
  if (TECHNICAL_LEAK_PATTERNS.some(pattern => pattern.test(text))) {
    blockers.push({ code: 'INTERNAL_ANALYSIS_LEAK', message: '候选暴露了后台分析或系统字段' });
  }
  if (OBVIOUS_SECRET_PATTERNS.some(pattern => pattern.test(text))) {
    blockers.push({ code: 'OBVIOUS_SECRET_LEAK', message: '候选疑似包含密钥、令牌或验证码' });
  }
  if (text.length > 4000) {
    advisories.push({ code: 'VERY_LONG_REPLY', message: '候选较长，可由用户决定是否拆分' });
  }
  if (appearsToRepeatIncoming(text, packet.incomingMessage?.text)) {
    advisories.push({ code: 'REPEATS_INCOMING_MESSAGE', message: '候选可能较多复述对方原话' });
  }
  return {
    pass: blockers.length === 0,
    text,
    blockers,
    advisories,
    issues: [...blockers, ...advisories],
    metrics: {
      length: text.length,
      sentences: countSentences(text),
      questionCount: countQuestions(text),
      blockerCount: blockers.length,
      advisoryCount: advisories.length
    }
  };
}

function buildRepairInstruction(validation = {}) {
  const reasons = (validation.issues || []).map(issue => `- ${issue.message}`).join('\n');
  return [
    '上一版候选没有通过发送前质量门禁。请重新写一条候选回复。',
    reasons || '- 未通过质量门禁',
    '只输出修正后的最终回复，不要解释修改过程，不要输出标题、编号、JSON或多个版本。'
  ].join('\n');
}

module.exports = {
  stripWrapper,
  countQuestions,
  countSentences,
  appearsToRepeatIncoming,
  diceSimilarity,
  maximumCandidateSimilarity,
  containsFinancialSolicitation,
  validateReplyCandidate,
  validateFastReplyCandidate,
  buildRepairInstruction
};
