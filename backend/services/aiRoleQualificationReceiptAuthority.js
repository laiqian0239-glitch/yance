'use strict';

const crypto = require('node:crypto');

const AUTHORITY = 'AIRoleQualificationReceiptAuthority';
const SCHEMA_VERSION = 1;
const GOVERNED_TASKS = Object.freeze(['quick_reply', 'deep_reply', 'director', 'translation']);
const DEFAULT_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function clean(value) { return String(value == null ? '' : value).trim(); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function date(value, fallback = '') { const text = clean(value); return Number.isFinite(Date.parse(text)) ? text : fallback; }
function benchmarkFor(model = {}, task = '') {
  return clean(task) === 'translation'
    ? (model.lastCommercialBenchmark && typeof model.lastCommercialBenchmark === 'object' ? model.lastCommercialBenchmark : null)
    : (model.lastReplyBrainBenchmark && typeof model.lastReplyBrainBenchmark === 'object' ? model.lastReplyBrainBenchmark : null);
}
function evidenceDigest({ modelId, task, pass, score, evidence }) {
  return sha256({ modelId: clean(modelId), task: clean(task), pass: pass === true, score: Number(score || 0), evidence: evidence && typeof evidence === 'object' ? evidence : {} });
}
function receiptId({ modelId, task, issuedAt, evidenceSha256 }) {
  return `role-${sha256({ modelId: clean(modelId), task: clean(task), issuedAt: clean(issuedAt), evidenceSha256: clean(evidenceSha256) }).slice(0, 24)}`;
}

function evidenceAllowsIssuance(task = '', evidence = {}) {
  const target = clean(task);
  const authority = clean(evidence.authority);
  const status = clean(evidence.status);
  const qualifyingTasks = new Set(Array.isArray(evidence.qualifyingTasks) ? evidence.qualifyingTasks.map(clean) : []);
  let reason = '';
  if (!GOVERNED_TASKS.includes(target)) reason = 'ROLE_RECEIPT_TASK_UNSUPPORTED';
  else if (evidence.completed !== true) reason = 'ROLE_RECEIPT_BENCHMARK_INCOMPLETE';
  else if (evidence.pass !== true || !qualifyingTasks.has(target)) reason = 'ROLE_RECEIPT_BENCHMARK_NOT_QUALIFIED';
  else if (target === 'translation' && (authority !== 'YanceCommercialModelBenchmark' || status !== 'COMMERCIAL_MODEL_QUALIFIED')) reason = 'ROLE_RECEIPT_TRANSLATION_AUTHORITY_INVALID';
  else if (target !== 'translation' && (authority !== 'YanceReplyBrainBenchmark' || status !== 'REPLY_BRAIN_QUALIFIED')) reason = 'ROLE_RECEIPT_REPLY_AUTHORITY_INVALID';
  return { pass: !reason, reason, task: target, benchmarkAuthority: authority, benchmarkStatus: status };
}

function issueValidated(input = {}, evidence = {}, decision = {}) {
  const modelId = clean(input.modelId);
  const task = clean(input.task);
  if (!modelId) throw Object.assign(new Error('modelId is required'), { code: 'ROLE_RECEIPT_MODEL_REQUIRED' });
  const issuedAt = date(input.issuedAt || evidence.testedAt || evidence.completedAt, new Date().toISOString());
  const expiresAt = date(input.expiresAt, new Date(Date.parse(issuedAt) + DEFAULT_TTL_MS).toISOString());
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw Object.assign(new Error('expiresAt must be after issuedAt'), { code: 'ROLE_RECEIPT_EXPIRY_INVALID' });
  const score = Number(input.score ?? evidence.score ?? 0);
  const evidenceSha256 = evidenceDigest({ modelId, task, pass: true, score, evidence });
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    receiptId: receiptId({ modelId, task, issuedAt, evidenceSha256 }),
    modelId,
    task,
    pass: true,
    score,
    issuedAt,
    expiresAt,
    evidenceSha256,
    benchmarkAuthority: decision.benchmarkAuthority,
    benchmarkStatus: decision.benchmarkStatus,
    summary: clean(input.summary || evidence.summary)
  });
}

function issueFromEvidence(input = {}) {
  const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
  const decision = evidenceAllowsIssuance(input.task, evidence);
  if (!decision.pass) {
    const error = new Error(decision.reason);
    error.code = decision.reason;
    error.task = decision.task;
    error.benchmarkAuthority = decision.benchmarkAuthority;
    error.benchmarkStatus = decision.benchmarkStatus;
    throw error;
  }
  return issueValidated(input, evidence, decision);
}

function receiptFor(model = {}, task = '') {
  const receipts = model.roleQualificationReceipts && typeof model.roleQualificationReceipts === 'object'
    ? model.roleQualificationReceipts
    : {};
  return receipts[clean(task)] || null;
}

function validate(model = {}, task = '', options = {}) {
  const target = clean(task);
  const receipt = options.receipt || receiptFor(model, target);
  const now = date(options.now, new Date().toISOString());
  const nowMs = Date.parse(now);
  let reason = '';
  let benchmark = null;
  if (!GOVERNED_TASKS.includes(target)) reason = 'ROLE_RECEIPT_TASK_UNSUPPORTED';
  else if (!receipt || typeof receipt !== 'object') reason = 'ROLE_RECEIPT_MISSING';
  else if (clean(receipt.authority) !== AUTHORITY || Number(receipt.schemaVersion) !== SCHEMA_VERSION) reason = 'ROLE_RECEIPT_AUTHORITY_INVALID';
  else if (clean(receipt.modelId) !== clean(model.id)) reason = 'ROLE_RECEIPT_MODEL_MISMATCH';
  else if (clean(receipt.task) !== target) reason = 'ROLE_RECEIPT_TASK_MISMATCH';
  else if (receipt.pass !== true) reason = 'ROLE_RECEIPT_NOT_PASSED';
  else if (!date(receipt.issuedAt)) reason = 'ROLE_RECEIPT_ISSUED_AT_INVALID';
  else if (Date.parse(receipt.issuedAt) > nowMs + MAX_CLOCK_SKEW_MS) reason = 'ROLE_RECEIPT_ISSUED_IN_FUTURE';
  else if (!date(receipt.expiresAt) || Date.parse(receipt.expiresAt) <= Date.parse(receipt.issuedAt)) reason = 'ROLE_RECEIPT_EXPIRY_INVALID';
  else if (Date.parse(receipt.expiresAt) <= nowMs) reason = 'ROLE_RECEIPT_EXPIRED';
  else if (!/^[a-f0-9]{64}$/u.test(clean(receipt.evidenceSha256))) reason = 'ROLE_RECEIPT_EVIDENCE_INVALID';
  else if (clean(receipt.receiptId) !== receiptId(receipt)) reason = 'ROLE_RECEIPT_ID_INVALID';
  else {
    benchmark = benchmarkFor(model, target);
    const decision = evidenceAllowsIssuance(target, benchmark || {});
    if (!decision.pass) reason = decision.reason === 'ROLE_RECEIPT_BENCHMARK_INCOMPLETE' ? 'ROLE_RECEIPT_CURRENT_BENCHMARK_INCOMPLETE' : 'ROLE_RECEIPT_CURRENT_BENCHMARK_NOT_QUALIFIED';
    else if (clean(receipt.benchmarkAuthority) !== decision.benchmarkAuthority || clean(receipt.benchmarkStatus) !== decision.benchmarkStatus) reason = 'ROLE_RECEIPT_BENCHMARK_AUTHORITY_MISMATCH';
    else {
      const expected = evidenceDigest({ modelId: model.id, task: target, pass: true, score: receipt.score, evidence: benchmark });
      if (clean(receipt.evidenceSha256) !== expected) reason = 'ROLE_RECEIPT_EVIDENCE_MISMATCH';
    }
  }
  return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, pass: !reason, reason, task: target, modelId: clean(model.id), receipt: receipt || null, checkedAt: now };
}

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  GOVERNED_TASKS,
  DEFAULT_TTL_MS,
  MAX_CLOCK_SKEW_MS,
  evidenceAllowsIssuance,
  issueFromEvidence,
  receiptFor,
  validate
};
