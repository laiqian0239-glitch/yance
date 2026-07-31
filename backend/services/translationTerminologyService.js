'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

const ENTITY_PATTERNS = Object.freeze([
  /https?:\/\/[^\s<>()]+/giu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /(?:\+?\d[\d\s()./-]{5,}\d)/gu,
  /(?:[$€£¥]\s?\d[\d.,]*|\d[\d.,]*\s?(?:EUR|USD|GBP|CNY|RMB|CHF))/giu,
  /\b\d{4}-\d{1,2}-\d{1,2}\b/gu,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gu,
  /[@#][\p{L}\p{N}_-]+/gu,
  /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu
]);

function glossaryRows(glossary = []) {
  return array(glossary).map((row, index) => {
    if (typeof row === 'string') return { id: `glossary:${index}`, source: clean(row), targetZh: clean(row), kind: 'custom' };
    return {
      id: clean(row?.id) || `glossary:${index}`,
      source: clean(row?.source || row?.term || row?.text),
      targetZh: clean(row?.targetZh || row?.translationZh || row?.target || row?.source || row?.term),
      kind: clean(row?.kind || 'custom'),
      caseSensitive: row?.caseSensitive === true
    };
  }).filter(row => row.source);
}

function extractProtectedTerms(text, glossary = []) {
  const source = clean(text);
  const terms = [];
  for (const pattern of ENTITY_PATTERNS) {
    for (const match of source.matchAll(pattern)) terms.push({ source: clean(match[0]), targetZh: clean(match[0]), kind: 'entity' });
  }
  terms.push(...glossaryRows(glossary));
  const seen = new Set();
  return terms.filter(row => {
    const key = `${row.caseSensitive ? '1' : '0'}:${row.source.toLowerCase()}`;
    if (!row.source || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.source.length - a.source.length);
}

function replaceLiteral(text, search, replacement, caseSensitive = true) {
  if (!search) return text;
  if (caseSensitive) return String(text).split(search).join(replacement);
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).replace(new RegExp(escaped, 'giu'), replacement);
}

function maskProtectedTerms(text, glossary = []) {
  const terms = extractProtectedTerms(text, glossary);
  let maskedText = clean(text);
  const mappings = [];
  terms.forEach((term, index) => {
    const placeholder = `⟦YANCE_TERM_${index}⟧`;
    const next = replaceLiteral(maskedText, term.source, placeholder, term.caseSensitive !== false);
    if (next !== maskedText) {
      mappings.push({ ...term, placeholder, restoreValue: term.targetZh || term.source });
      maskedText = next;
    }
  });
  return { maskedText, mappings };
}

function placeholderVariants(row = {}, index = 0) {
  const token = `YANCE_TERM_${index}`;
  return unique([
    clean(row.placeholder),
    `⟦${token}⟧`, `[${token}]`, `【${token}】`, `[[${token}]]`,
    `(${token})`, `<${token}>`, `{${token}}`, `__${token}__`
  ]);
}

function restoreProtectedTerms(text, mappings = []) {
  let output = clean(text);
  array(mappings).forEach((row, index) => {
    const restoreValue = clean(row.restoreValue || row.source);
    for (const placeholder of placeholderVariants(row, index)) {
      output = replaceLiteral(output, placeholder, restoreValue, true);
      output = replaceLiteral(output, placeholder, restoreValue, false);
    }
    const token = `YANCE_TERM_${index}`;
    const flexible = new RegExp([
      String.raw`⟦\s*${token}\s*⟧`, String.raw`【\s*${token}\s*】`,
      String.raw`\[\s*\[?\s*${token}\s*\]?\s*\]`,
      String.raw`\(\s*${token}\s*\)`, String.raw`<\s*${token}\s*>`,
      String.raw`\{\s*${token}\s*\}`, String.raw`__\s*${token}\s*__`,
      String.raw`(?<![\p{L}\p{N}_])${token}(?![\p{L}\p{N}_])`
    ].join('|'), 'giu');
    output = output.replace(flexible, restoreValue);
  });
  return clean(output);
}

function hasResidualProtectedTerms(text) {
  return /YANCE[\s_-]*TERM[\s_-]*\d+/iu.test(clean(text));
}

function extractNumbers(text) {
  return unique((clean(text).match(/\d+(?:[.,]\d+)?/gu) || []).map(value => value.replace(',', '.'))).sort();
}

function extractUrls(text) {
  return unique(clean(text).match(/https?:\/\/[^\s<>()]+/giu) || []).sort();
}

function assessChineseTranslation(input = {}) {
  const sourceText = clean(input.sourceText);
  const translatedZh = clean(input.translatedZh);
  const mappings = array(input.mappings);
  const issues = [];
  if (!translatedZh) issues.push({ code: 'EMPTY_TRANSLATION', severity: 'blocking', message: '没有生成中文理解' });
  if (translatedZh && !/[\u3400-\u9fff]/u.test(translatedZh)) issues.push({ code: 'CHINESE_NOT_DETECTED', severity: 'warning', message: '中文理解中未检测到中文字符' });
  const sourceNumbers = extractNumbers(sourceText);
  const targetNumbers = extractNumbers(translatedZh);
  const missingNumbers = sourceNumbers.filter(value => !targetNumbers.includes(value));
  if (missingNumbers.length) issues.push({ code: 'NUMBER_MISMATCH', severity: 'blocking', message: `数字可能丢失：${missingNumbers.join('、')}`, values: missingNumbers });
  const sourceUrls = extractUrls(sourceText);
  const targetUrls = extractUrls(translatedZh);
  const missingUrls = sourceUrls.filter(value => !targetUrls.includes(value));
  if (missingUrls.length) issues.push({ code: 'URL_MISMATCH', severity: 'blocking', message: '链接未完整保留', values: missingUrls });
  const missingTerms = mappings.filter(row => {
    const expected = clean(row.restoreValue || row.targetZh || row.source);
    return expected && !translatedZh.includes(expected);
  });
  if (missingTerms.length) issues.push({
    code: 'PROTECTED_TERM_MISMATCH',
    severity: 'warning',
    message: `受保护词可能发生变化：${missingTerms.map(row => row.source).join('、')}`,
    values: missingTerms.map(row => row.source)
  });
  const blocking = issues.some(row => row.severity === 'blocking');
  const warning = issues.some(row => row.severity === 'warning');
  return {
    status: blocking ? 'blocking' : warning ? 'warning' : 'pass',
    issues,
    protectedTermCount: mappings.length,
    checkedNumbers: sourceNumbers.length,
    checkedUrls: sourceUrls.length
  };
}

function glossaryPrompt(glossary = []) {
  const rows = glossaryRows(glossary);
  if (!rows.length) return '';
  return ['用户术语表（必须按指定中文表达）：', ...rows.map(row => `- ${row.source} => ${row.targetZh || row.source}`)].join('\n');
}

module.exports = {
  extractProtectedTerms,
  maskProtectedTerms,
  restoreProtectedTerms,
  hasResidualProtectedTerms,
  assessChineseTranslation,
  glossaryPrompt,
  glossaryRows,
  extractNumbers,
  extractUrls
};
