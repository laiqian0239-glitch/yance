'use strict';

const { SqliteDocumentStore } = require('../lib/sqliteDocumentStore');

const MAX_ROWS = 288;
const store = new SqliteDocumentStore('system-health-history', { schemaVersion: 2, rows: [] });

function read() {
  const data = store.read();
  return { schemaVersion: 2, rows: Array.isArray(data.rows) ? data.rows.slice(0, MAX_ROWS) : [] };
}

function write(value) {
  const next = { schemaVersion: 2, rows: Array.isArray(value?.rows) ? value.rows.slice(0, MAX_ROWS) : [] };
  store.write(next);
  return next;
}

function record(input = {}) {
  const data = read();
  const now = new Date();
  const row = {
    at: now.toISOString(),
    score: Math.max(0, Math.min(100, Number(input.score || 0))),
    level: String(input.level || 'unknown'),
    pass: Number(input.pass || 0),
    fail: Number(input.fail || 0),
    accountsConnected: Number(input.accountsConnected || 0),
    accountsAbnormal: Number(input.accountsAbnormal || 0),
    backupValid: input.backupValid !== false,
    aiOnline: input.aiOnline === true
  };
  const previous = data.rows[0];
  const previousAt = previous ? new Date(previous.at).getTime() : 0;
  const changed = !previous
    || previous.score !== row.score
    || previous.level !== row.level
    || previous.fail !== row.fail
    || previous.accountsAbnormal !== row.accountsAbnormal
    || previous.backupValid !== row.backupValid
    || previous.aiOnline !== row.aiOnline;
  if (!changed && now.getTime() - previousAt < 5 * 60 * 1000) return data.rows;
  data.rows.unshift(row);
  data.rows = data.rows.slice(0, MAX_ROWS);
  write(data);
  return data.rows;
}

module.exports = { read, record, write, MAX_ROWS };
