'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(clean(value));
}

function mergeLocalized(base, overlay) {
  if (overlay == null) return base;
  if (Array.isArray(base) || Array.isArray(overlay)) {
    const left = Array.isArray(base) ? base : [];
    const right = Array.isArray(overlay) ? overlay : [];
    return Array.from(
      { length: Math.max(left.length, right.length) },
      (_, index) => mergeLocalized(left[index], right[index])
    );
  }
  if ((base && typeof base === 'object') || (overlay && typeof overlay === 'object')) {
    const left = object(base);
    const right = object(overlay);
    const output = { ...left };
    for (const [key, value] of Object.entries(right)) {
      output[key] = mergeLocalized(left[key], value);
    }
    return output;
  }
  return overlay === '' ? base : overlay;
}

function chineseOverlay(document = {}) {
  const source = object(document);
  return object(source.chineseUnderstanding || source.payload?.chineseUnderstanding);
}

function chineseFirst(document = {}) {
  const source = object(document);
  return mergeLocalized(source, chineseOverlay(source));
}

function pathValue(document, path) {
  const parts = Array.isArray(path) ? path : clean(path).split('.').filter(Boolean);
  let current = document;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function localizedPair(document = {}, path, fallback = '') {
  const source = object(document);
  const overlay = chineseOverlay(source);
  const originalValue = pathValue(source, path);
  const translatedValue = pathValue(overlay, path);
  const original = clean(originalValue ?? fallback);
  const translatedZh = clean(translatedValue);
  const primaryZh = translatedZh || (containsChinese(original) ? original : '');
  const translationStatus = clean(
    pathValue(overlay, 'translationStatus') || source.translationStatus || source.payload?.translationStatus
  );
  const pending = Boolean(original && !primaryZh);
  return {
    path: Array.isArray(path) ? path.join('.') : clean(path),
    primaryZh: primaryZh || (original ? '中文理解待生成' : clean(fallback)),
    translatedZh,
    original,
    hasTranslation: Boolean(translatedZh),
    pending,
    translationStatus: pending ? (translationStatus || 'pending') : (translationStatus || (translatedZh ? 'success' : 'source-zh')),
    displayOriginal: Boolean(original && original !== primaryZh)
  };
}

function localizedScalar(sourceValue, translatedValue, fallback = '') {
  const original = clean(sourceValue ?? fallback);
  const translatedZh = clean(translatedValue);
  const primaryZh = translatedZh || (containsChinese(original) ? original : '');
  return {
    primaryZh: primaryZh || (original ? '中文理解待生成' : clean(fallback)),
    translatedZh,
    original,
    hasTranslation: Boolean(translatedZh),
    pending: Boolean(original && !primaryZh),
    displayOriginal: Boolean(original && original !== primaryZh)
  };
}

function bilingualRows(sourceRows, translatedRows, mapper = value => value) {
  const left = array(sourceRows);
  const right = array(translatedRows);
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const source = mapper(left[index], index) || {};
    const translated = mapper(right[index], index) || {};
    return { source, translated, index };
  });
}

module.exports = {
  mergeLocalized,
  chineseFirst,
  chineseOverlay,
  localizedPair,
  localizedScalar,
  bilingualRows,
  containsChinese,
  pathValue
};
