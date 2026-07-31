'use strict';

function clean(value) { return String(value == null ? '' : value).trim(); }

const NORMAL_FINANCIAL_TERMS = Object.freeze([
  '金钱', '投资', '股票', '财富', '借钱', '转账', '遗产', '商业', '融资', '收益', '亏损', '债务', '金融'
]);

const HIGH_RISK_PATTERNS = Object.freeze([
  { code: 'IMPERSONATION_FOR_MONEY', pattern: /(?:冒充|假扮|伪装成).{0,24}(?:骗|索要|收取|让.{0,8}转账|钱)/u },
  { code: 'ROMANCE_MANIPULATION_TRANSFER', pattern: /(?:利用|操纵|欺骗).{0,16}(?:感情|恋爱|爱上|信任).{0,28}(?:转账|汇款|打钱|付款)/u },
  { code: 'ILLEGAL_FUNDRAISING', pattern: /(?:非法集资|资金盘|庞氏|拉人头|传销).{0,40}(?:操作|实施|招募|收款|规避)/u },
  { code: 'PROPERTY_HARM', pattern: /(?:盗取|窃取|侵占|骗取).{0,20}(?:账户|银行卡|资金|财产|遗产|钱)/u },
  { code: 'THIRD_PARTY_ACCOUNT_OPERATION', pattern: /(?:代操作|替你操作|帮你操盘|控制).{0,16}(?:账户|账号|钱包|银行卡)/u },
  { code: 'GUARANTEED_RETURN_SOLICITATION', pattern: /(?:保证|承诺|稳赚|保本).{0,12}(?:收益|盈利|回报).{0,30}(?:转账|入金|投钱|融资|打款)/u },
  { code: 'ENGLISH_FINANCIAL_HARM', pattern: /(?:impersonat|romance scam|steal|defraud|ponzi|guaranteed return).{0,80}(?:transfer|send money|account|funds)/iu },
  { code: 'GERMAN_FINANCIAL_HARM', pattern: /(?:vortäusch|betrug|liebesbetrug|schneeballsystem|garantierte rendite).{0,80}(?:überweis|geld|konto|einzahl)/iu }
]);

function classifyFinancialContext(input = {}) {
  const text = clean(typeof input === 'string' ? input : [input.incomingMessage, input.instruction, input.candidate].filter(Boolean).join('\n'));
  const matchedRisk = HIGH_RISK_PATTERNS.find(row => row.pattern.test(text));
  const mentionedTerms = NORMAL_FINANCIAL_TERMS.filter(term => text.includes(term));
  if (matchedRisk) {
    return {
      category: 'harmful_real_world_financial_action',
      riskLevel: 'high',
      allowNormalGeneration: false,
      reasonCode: matchedRisk.code,
      mentionedTerms
    };
  }
  return {
    category: mentionedTerms.length ? 'normal_financial_context' : 'non_financial_context',
    riskLevel: 'none',
    allowNormalGeneration: true,
    reasonCode: '',
    mentionedTerms
  };
}

function financialPromptGuidance(classification = {}) {
  if (classification.allowNormalGeneration !== false) {
    return '金钱、投资、股票、财富、借贷、转账、遗产、商业、融资、收益、亏损、债务和金融等词语本身不是风险。正常聊天、人物经历、商业讨论及感情中的金钱问题应照常分析并生成，不要自动插入警告或安全教育。';
  }
  return `当前语境涉及明确的真实财产侵害风险（${classification.reasonCode}）。不要提供实施、规避追踪或操纵他人转账的操作指导；可以给出不伤害他人的边界表达或合法求助方向。`;
}

module.exports = { NORMAL_FINANCIAL_TERMS, HIGH_RISK_PATTERNS, classifyFinancialContext, financialPromptGuidance };
