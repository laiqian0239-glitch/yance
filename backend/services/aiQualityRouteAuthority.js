'use strict';

// V21-MODEL-BRAIN-P0-V3 retired Yance-owned physical routing/scoring here.
// This module now exists only to verify already-issued signed historical execution
// receipts consumed by evidence/send/learning stores outside this work package.
// It does not choose, score, rank, retry, fail over, or classify providers/models.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config');

const AUTHORITY = 'AIQualityRouteAuthority';
const SCHEMA_VERSION = 2;
const RECEIPT_KEY_FILE = path.join(PATHS.secure, 'ai-quality-route-receipt.key');
let cachedReceiptKey = null;

const QUALITY_TIER = Object.freeze({
  HIGH: 'high',
  QUALIFIED: 'qualified',
  CONDITIONAL: 'conditional',
  EMERGENCY: 'emergency',
  BLOCKED: 'blocked'
});
const TIER_RANK = Object.freeze({ blocked: 0, emergency: 1, conditional: 2, qualified: 3, high: 4 });
const TASK_PROFILES = Object.freeze({
  director: Object.freeze({ minimumTier: QUALITY_TIER.HIGH }),
  quick_reply: Object.freeze({ minimumTier: QUALITY_TIER.HIGH }),
  deep_reply: Object.freeze({ minimumTier: QUALITY_TIER.HIGH }),
  understanding: Object.freeze({ minimumTier: QUALITY_TIER.QUALIFIED }),
  relationship: Object.freeze({ minimumTier: QUALITY_TIER.QUALIFIED }),
  fact_extraction: Object.freeze({ minimumTier: QUALITY_TIER.QUALIFIED }),
  memory_extraction: Object.freeze({ minimumTier: QUALITY_TIER.QUALIFIED }),
  learning_synthesis: Object.freeze({ minimumTier: QUALITY_TIER.HIGH }),
  translation: Object.freeze({ minimumTier: QUALITY_TIER.QUALIFIED })
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalizedTask(value) {
  const task = clean(value);
  if (task === 'reply' || task === 'standard_reply') return 'quick_reply';
  if (task === 'memories' || task === 'contact_memory') return 'memory_extraction';
  return task;
}
function taskProfile(task) { return TASK_PROFILES[normalizedTask(task)] || Object.freeze({ minimumTier: QUALITY_TIER.QUALIFIED }); }
function receiptSigningKey() {
  if (cachedReceiptKey) return cachedReceiptKey;
  const configured = clean(process.env.YANCE_AI_ROUTE_RECEIPT_SECRET);
  if (configured) { cachedReceiptKey = Buffer.from(configured, 'utf8'); return cachedReceiptKey; }
  fs.mkdirSync(PATHS.secure, { recursive: true });
  try {
    const decoded = Buffer.from(fs.readFileSync(RECEIPT_KEY_FILE, 'utf8').trim(), 'base64url');
    if (decoded.length >= 32) { cachedReceiptKey = decoded; return cachedReceiptKey; }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const generated = crypto.randomBytes(32);
  const temp = `${RECEIPT_KEY_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, generated.toString('base64url'), { mode: 0o600, flag: 'wx' });
  try { fs.renameSync(temp, RECEIPT_KEY_FILE); }
  catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    if (error?.code !== 'EEXIST') throw error;
  }
  try { fs.chmodSync(RECEIPT_KEY_FILE, 0o600); } catch (_) {}
  const persisted = Buffer.from(fs.readFileSync(RECEIPT_KEY_FILE, 'utf8').trim(), 'base64url');
  if (persisted.length < 32) throw Object.assign(new Error('历史 AI 执行回执签名密钥无效。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_KEY_INVALID' });
  cachedReceiptKey = persisted;
  return cachedReceiptKey;
}
function signReceiptHash(receiptHash) { return crypto.createHmac('sha256', receiptSigningKey()).update(clean(receiptHash), 'utf8').digest('base64url'); }
function timingSafeEqualText(left, right) {
  const a = Buffer.from(clean(left), 'utf8');
  const b = Buffer.from(clean(right), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function retiredPhysicalAuthority() {
  throw Object.assign(new Error('物理模型路由已由 LiteLLM Model Brain 管理；旧 Yance routing/scoring authority 已退役。'), {
    code: 'MODEL_ROUTING_MANAGED_BY_LITELLM',
    status: 410
  });
}
function verifyRouteReceipt(receipt = {}, options = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw Object.assign(new Error('历史 AI 执行回执缺失。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_REQUIRED', status: 409 });
  }
  const { receiptHash, receiptSignature, ...payload } = receipt;
  const actualHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  if (!clean(receiptHash) || clean(receiptHash) !== actualHash) {
    throw Object.assign(new Error('历史 AI 执行回执校验失败。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_INVALID', status: 409, expected: clean(receiptHash), actual: actualHash });
  }
  const actualSignature = signReceiptHash(actualHash);
  if (!clean(receiptSignature) || !timingSafeEqualText(receiptSignature, actualSignature)) {
    throw Object.assign(new Error('历史 AI 执行回执签名校验失败。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_SIGNATURE_INVALID', status: 409 });
  }
  if (clean(payload.authority) !== AUTHORITY || Number(payload.schemaVersion || 0) !== SCHEMA_VERSION) {
    throw Object.assign(new Error('历史 AI 执行回执来源不可信。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_AUTHORITY_INVALID', status: 409 });
  }
  const expectedTask = normalizedTask(options.task || payload.task);
  if (!expectedTask || normalizedTask(payload.task) !== expectedTask) {
    throw Object.assign(new Error('历史 AI 执行回执任务不匹配。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_TASK_MISMATCH', status: 409, expectedTask, actualTask: normalizedTask(payload.task) });
  }
  if (!clean(payload.selectedModelId)) {
    throw Object.assign(new Error('历史 AI 执行回执缺少实际模型。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_MODEL_REQUIRED', status: 409 });
  }
  if (payload.emergencyMode === true && options.allowEmergency !== true) {
    throw Object.assign(new Error('应急历史回执不能用于当前操作。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_EMERGENCY_NOT_ALLOWED', status: 409 });
  }
  if (payload.formalReceiptEligible === false && options.requireFormalReceiptEligible !== false) {
    throw Object.assign(new Error('候选试运行历史回执不能用于正式资格或生产操作。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_FORMAL_INELIGIBLE', status: 409 });
  }
  if (payload.learningEligible === false && options.requireLearningEligible !== false) {
    throw Object.assign(new Error('不可学习的历史回执不能用于学习晋升。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_LEARNING_INELIGIBLE', status: 409 });
  }
  const minimumTier = options.minimumTier || taskProfile(expectedTask).minimumTier;
  if (options.enforceMinimumTier !== false && (TIER_RANK[clean(payload.qualityTier)] || 0) < (TIER_RANK[minimumTier] || 0)) {
    throw Object.assign(new Error('历史 AI 执行回执未达到任务质量档位。'), { code: 'AI_QUALITY_ROUTE_RECEIPT_TIER_INSUFFICIENT', status: 409, minimumTier, actualTier: clean(payload.qualityTier) });
  }
  return { ok: true, historical: true, receiptHash: actualHash, receiptSignature: actualSignature, task: expectedTask, qualityTier: clean(payload.qualityTier), selectedModelId: clean(payload.selectedModelId), emergencyMode: payload.emergencyMode === true, learningEligible: payload.learningEligible !== false };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  QUALITY_TIER,
  TASK_PROFILES,
  taskProfile,
  verifyRouteReceipt,
  // Fail-closed sentinels prevent out-of-scope legacy callers from becoming a hidden
  // second production model router while preserving an explicit migration boundary.
  routeReceipt: retiredPhysicalAuthority
};
