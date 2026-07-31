'use strict';

const crypto = require('crypto');
const path = require('path');

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\(?:[^\r\n<>:"|?*]+\\)*[^\r\n<>:"|?*]*/g;
const UNIX_PATH_PATTERN = /(?:^|[\s"'=(])\/(?:home|Users|tmp|var|opt|mnt|private|Volumes)(?:\/[^\s"'<>]*)?/g;

function pathToken(value) {
  const raw = String(value || '').trim();
  const base = path.win32.basename(raw) || path.posix.basename(raw) || 'path';
  const digest = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 10);
  return `[REDACTED_PATH:${base}:${digest}]`;
}

function redactAbsolutePaths(value) {
  let text = String(value ?? '');
  text = text.replace(WINDOWS_PATH_PATTERN, match => pathToken(match));
  text = text.replace(UNIX_PATH_PATTERN, (match, offset) => {
    const prefix = /^[\s"'=(]/.test(match) ? match[0] : '';
    const actual = prefix ? match.slice(1) : match;
    return `${prefix}${pathToken(actual)}`;
  });
  return text;
}

function redact(value, max = 1200, options = {}) {
  const uuids = [];
  let text = String(value ?? '').replace(UUID_PATTERN, match => {
    const token = `__YANCE_UUID_${uuids.length}__`;
    uuids.push(match);
    return token;
  });
  text = text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_KEY]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\b[0-9]{7,18}@(s\.whatsapp\.net|c\.us|lid|g\.us)\b/gi, '[REDACTED_WA_ID]')
    .replace(/(?<![A-Za-z0-9_-])\+?[0-9][0-9 ()-]{6,20}[0-9](?![A-Za-z0-9_-])/g, '[REDACTED_PHONE]');
  if (options.redactPaths !== false) text = redactAbsolutePaths(text);
  for (let index = 0; index < uuids.length; index += 1) text = text.replace(`__YANCE_UUID_${index}__`, uuids[index]);
  return text.slice(0, max);
}

function sanitizeObject(value, options = {}) {
  if (Array.isArray(value)) return value.map(item => sanitizeObject(item, options));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? redact(value, 5000, options) : value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api.?key|authorization|token|secret|password|qrDataUrl|challengeData/i.test(key)) out[key] = '[REDACTED]';
    else if (options.redactPaths !== false && /(?:^|_)(?:path|dir|directory|root|file)$/i.test(key) && typeof item === 'string' && item) out[key] = pathToken(item);
    else out[key] = sanitizeObject(item, options);
  }
  return out;
}

module.exports = { redact, sanitizeObject, redactAbsolutePaths, pathToken };
