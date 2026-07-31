(function universalBilingualPresentation(root, factory) {
  const runtime = factory();
  if (typeof module === 'object' && module.exports) module.exports = runtime;
  if (root) root.YanceBilingualPresentationRuntime = runtime;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createBilingualPresentationRuntime() {
  'use strict';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function overlayFor(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
    if (record.chineseUnderstanding && typeof record.chineseUnderstanding === 'object') return record.chineseUnderstanding;
    if (record.payload?.chineseUnderstanding && typeof record.payload.chineseUnderstanding === 'object') return record.payload.chineseUnderstanding;
    return {};
  }

  function firstText(...values) {
    for (const value of values) {
      const text = clean(value);
      if (text) return text;
    }
    return '';
  }

  function localizedPair(record, key, fallback = '') {
    const source = record && typeof record === 'object' && !Array.isArray(record) ? record : {};
    const overlay = overlayFor(source);
    const translated = firstText(
      overlay[key],
      source[`${key}Zh`],
      source.translatedZh && key === 'text' ? source.translatedZh : '',
      source.translation?.translatedZh && key === 'text' ? source.translation.translatedZh : ''
    );
    const original = firstText(
      source[key],
      source.payload?.[key],
      key === 'text' ? source.sourceText : '',
      fallback
    );
    const primaryZh = translated || original || clean(fallback);
    const status = clean(
      source.translationStatus ||
      source.translation?.status ||
      source.payload?.translationStatus ||
      (translated ? 'success' : original ? 'untranslated' : 'empty')
    );
    const model = clean(source.translationModel || source.translation?.model || source.payload?.translationModel);
    return Object.freeze({
      key: clean(key),
      primaryZh,
      original,
      translatedZh: translated,
      hasTranslation: Boolean(translated && translated !== original),
      status,
      model
    });
  }

  function normalizeComparableText(value) {
    return clean(value)
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, '')
      .replace(/\d+/g, '#');
  }

  function ngrams(text, width = 2) {
    const value = normalizeComparableText(text);
    if (!value) return new Set();
    if (value.length <= width) return new Set([value]);
    const out = new Set();
    for (let index = 0; index <= value.length - width; index += 1) out.add(value.slice(index, index + width));
    return out;
  }

  function textSimilarity(left, right) {
    const aText = normalizeComparableText(left);
    const bText = normalizeComparableText(right);
    if (!aText && !bText) return 1;
    if (!aText || !bText) return 0;
    if (aText === bText) return 1;
    const a = ngrams(aText);
    const b = ngrams(bText);
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    const union = a.size + b.size - intersection;
    return union ? intersection / union : 0;
  }

  function isMeaningfullyDifferent(previous, next, threshold = 0.9) {
    const before = normalizeComparableText(previous);
    const after = normalizeComparableText(next);
    if (!after || before === after) return false;
    const lengthDelta = Math.abs(after.length - before.length) / Math.max(1, before.length, after.length);
    return textSimilarity(before, after) < Number(threshold) || lengthDelta >= 0.18;
  }

  return Object.freeze({
    clean,
    localizedPair,
    normalizeComparableText,
    textSimilarity,
    isMeaningfullyDifferent
  });
});
