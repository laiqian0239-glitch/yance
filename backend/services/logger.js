'use strict';

const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');
const { sanitizeObject } = require('./privacy');

const rateLimitState = new Map();

function write(channel, level, message, detail = {}) {
  try {
    fs.mkdirSync(PATHS.logs, { recursive: true });
    const file = path.join(PATHS.logs, `${channel}.jsonl`);
    const row = {
      at: new Date().toISOString(),
      channel: String(channel || 'system'),
      level,
      message: String(message || ''),
      detail: sanitizeObject(detail)
    };
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  } catch (_) {}
}

function rateLimited(channel, level, message, detail = {}, options = {}) {
  const key = String(options.key || `${channel}:${level}:${message}`);
  const intervalMs = Math.max(1000, Number(options.intervalMs || 15000));
  const now = Date.now();
  const previous = rateLimitState.get(key) || 0;
  if (now - previous < intervalMs) return false;
  rateLimitState.set(key, now);
  write(channel, level, message, detail);
  return true;
}

function readRecent({ level = '', channel = '', limit = 50 } = {}) {
  const rows = [];
  try {
    if (!fs.existsSync(PATHS.logs)) return rows;
    const files = fs.readdirSync(PATHS.logs).filter(name => name.endsWith('.jsonl'));
    for (const name of files) {
      const fileChannel = path.basename(name, '.jsonl');
      if (channel && fileChannel !== channel) continue;
      const lines = fs.readFileSync(path.join(PATHS.logs, name), 'utf8').split(/\r?\n/).filter(Boolean).slice(-Math.max(20, Number(limit || 50) * 3));
      for (const line of lines) {
        try {
          const row = JSON.parse(line);
          const normalized = { channel: row.channel || fileChannel, ...row };
          if (!level || normalized.level === level) rows.push(sanitizeObject(normalized));
        } catch (_) {}
      }
    }
  } catch (_) {}
  return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, Math.max(1, Math.min(200, Number(limit || 50))));
}

module.exports = {
  info: (channel, message, detail) => write(channel, 'info', message, detail),
  warn: (channel, message, detail) => write(channel, 'warn', message, detail),
  error: (channel, message, detail) => write(channel, 'error', message, detail),
  rateLimited,
  _resetRateLimitsForTests: () => rateLimitState.clear(),
  readRecent
};
