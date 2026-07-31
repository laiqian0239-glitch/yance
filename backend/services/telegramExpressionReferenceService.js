'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_MS = Math.max(60_000, Number(process.env.YANCE_TELEGRAM_EXPRESSION_REF_TTL_MS || 5 * 60_000));
const MAX_REFERENCES = Math.max(64, Number(process.env.YANCE_TELEGRAM_EXPRESSION_REF_MAX || 512));
const references = new Map();

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function now() {
  return Date.now();
}

function prune(at = now()) {
  for (const [token, row] of references) {
    if (row.expiresAtMs <= at) references.delete(token);
  }
  if (references.size <= MAX_REFERENCES) return;
  const rows = [...references.entries()].sort((a, b) => a[1].createdAtMs - b[1].createdAtMs);
  for (const [token] of rows.slice(0, references.size - MAX_REFERENCES)) references.delete(token);
}

function create(input = {}) {
  const accountId = clean(input.accountId);
  const kind = clean(input.kind).toLowerCase() === 'gif' ? 'gif' : 'sticker';
  if (!accountId || !input.document) {
    const error = new Error('Telegram 原生素材引用缺少账号或文档');
    error.code = 'TELEGRAM_EXPRESSION_REFERENCE_INVALID';
    throw error;
  }
  prune();
  const token = `tgx_${crypto.randomBytes(24).toString('base64url')}`;
  const createdAtMs = now();
  const ttlMs = Math.max(30_000, Math.min(15 * 60_000, Number(input.ttlMs || DEFAULT_TTL_MS)));
  references.set(token, {
    token,
    accountId,
    kind,
    document: input.document,
    metadata: input.metadata && typeof input.metadata === 'object' ? { ...input.metadata } : {},
    createdAtMs,
    expiresAtMs: createdAtMs + ttlMs,
    usedAtMs: 0
  });
  return {
    reference: token,
    kind,
    accountId,
    expiresAt: new Date(createdAtMs + ttlMs).toISOString()
  };
}

function resolve(reference, input = {}) {
  prune();
  const token = clean(reference);
  const row = references.get(token);
  if (!row) {
    const error = new Error('Telegram 素材引用已过期，请刷新贴纸或 GIF 列表后重试');
    error.code = 'TELEGRAM_EXPRESSION_REFERENCE_EXPIRED';
    error.status = 410;
    throw error;
  }
  const accountId = clean(input.accountId);
  if (accountId && accountId !== row.accountId) {
    const error = new Error('Telegram 素材引用不属于当前账号，请刷新当前账号的素材列表');
    error.code = 'TELEGRAM_EXPRESSION_REFERENCE_ACCOUNT_MISMATCH';
    error.status = 403;
    throw error;
  }
  const expectedKind = clean(input.kind).toLowerCase();
  if (expectedKind && expectedKind !== row.kind) {
    const error = new Error('Telegram 素材类型与引用不一致，请刷新素材列表');
    error.code = 'TELEGRAM_EXPRESSION_REFERENCE_KIND_MISMATCH';
    error.status = 409;
    throw error;
  }
  row.usedAtMs = now();
  return row;
}

function revoke(reference) {
  return references.delete(clean(reference));
}

function clearAccount(accountId) {
  const id = clean(accountId);
  let removed = 0;
  for (const [token, row] of references) {
    if (row.accountId === id) {
      references.delete(token);
      removed += 1;
    }
  }
  return removed;
}

function stats() {
  prune();
  return {
    count: references.size,
    ttlMs: DEFAULT_TTL_MS,
    maxReferences: MAX_REFERENCES,
    accounts: [...new Set([...references.values()].map(row => row.accountId))].length
  };
}

module.exports = {
  create,
  resolve,
  revoke,
  clearAccount,
  prune,
  stats,
  DEFAULT_TTL_MS,
  _references: references
};
