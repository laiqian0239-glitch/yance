'use strict';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function contentPartsToText(value) {
  if (!Array.isArray(value)) return '';
  return value.map(part => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (typeof part.content === 'string') return part.content;
    if (typeof part.value === 'string') return part.value;
    if (typeof part.output_text === 'string') return part.output_text;
    return '';
  }).filter(Boolean).join('');
}

function stripFence(value) {
  return String(value || '')
    .trim()
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseStructuredText(value) {
  const raw = stripFence(value);
  if (!raw) return null;
  const candidates = [raw];
  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1));
  const arrayStart = raw.indexOf('[');
  const arrayEnd = raw.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(raw.slice(arrayStart, arrayEnd + 1));
  for (const candidate of [...new Set(candidates)]) {
    try { return JSON.parse(candidate); } catch (_) {}
  }
  return null;
}

function extractText(value, depth = 0) {
  if (depth > 10 || value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return contentPartsToText(value);
  if (!isObject(value)) return String(value);

  const choice = value.choices?.[0]?.message?.content ?? value.choices?.[0]?.text;
  if (choice != null) return extractText(choice, depth + 1);
  const message = value.message?.content ?? value.message?.text;
  if (message != null) return extractText(message, depth + 1);
  const outputText = contentPartsToText(value.output) || contentPartsToText(value.content);
  if (outputText) return outputText;

  for (const key of ['text', 'content', 'response', 'output_text']) {
    if (value[key] != null && value[key] !== value) {
      const text = extractText(value[key], depth + 1);
      if (text) return text;
    }
  }
  return '';
}

function normalizeModelResult(result = {}, options = {}) {
  const source = isObject(result) ? result : { text: extractText(result) };
  const text = extractText(source);
  const structured = options.json ? parseStructuredText(text) : null;
  return {
    ...source,
    text,
    ...(structured != null ? { structured } : {})
  };
}

module.exports = {
  contentPartsToText,
  extractText,
  parseStructuredText,
  normalizeModelResult
};
