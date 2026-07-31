'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const sendPolicyAuthority = require('./sendPolicyAuthority').singleton;
const aiQualityRouteAuthority = require('./aiQualityRouteAuthority');
const { sha256 } = require('./domainEventLogService');

const AUTHORITY = 'ArchitectureRuntimeEvidenceAuthority';
function clean(value) { return String(value == null ? '' : value).trim(); }
function parse(value, fallback) { try { return value == null || value === '' ? fallback : JSON.parse(value); } catch (_) { return fallback; } }
function hash(value) { return crypto.createHash('sha256').update(clean(value)).digest('hex'); }
function hashId(value) { return clean(value) ? hash(value) : ''; }
function bounded(value, fallback = 100, max = 1000) { const n = Number(value); return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.floor(n))) : fallback; }
function offset(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function safeRoute(receipt = {}) {
  const reasonCodes = Array.isArray(receipt.reasonCodes) ? receipt.reasonCodes.map(clean).filter(Boolean) : [];
  const attempts = Array.isArray(receipt.attempts) ? receipt.attempts.slice(0, 50).map(item => ({
    modelId: clean(item?.modelId), status: clean(item?.status), code: clean(item?.code), qualityTier: clean(item?.qualityTier),
    reasonCode: clean(item?.reasonCode), recoveryAction: clean(item?.recoveryAction), recoveryPhase: clean(item?.recoveryPhase),
    contextReduced: item?.contextReduced === true, originalContextChars: Number(item?.originalContextChars || 0), reducedContextChars: Number(item?.reducedContextChars || 0)
  })) : [];
  return {
    task: clean(receipt.task), modelId: clean(receipt.selectedModelId || receipt.modelId), modelName: clean(receipt.selectedModelName || receipt.modelName),
    provider: clean(receipt.selectedProvider || receipt.provider), qualityTier: clean(receipt.qualityTier), routeState: clean(receipt.routeState),
    highCapabilityPath: receipt.highCapabilityPath === true, fallbackUsed: receipt.fallbackUsed === true,
    emergencyMode: receipt.emergencyMode === true, qualityDegraded: receipt.qualityDegraded === true, learningEligible: receipt.learningEligible !== false,
    reasonCode: clean(receipt.reasonCode || reasonCodes[0]), reasonCodes, attempts,
    receiptHash: clean(receipt.receiptHash), receiptSignature: clean(receipt.receiptSignature), createdAt: clean(receipt.observedAt || receipt.createdAt)
  };
}

function routeIntegrity(receipt = {}) {
  if (!receipt || typeof receipt !== 'object' || !clean(receipt.selectedModelId || receipt.modelId)) return { present: false, verified: null, reasonCode: '' };
  try {
    aiQualityRouteAuthority.verifyRouteReceipt(receipt, { task: clean(receipt.task) || 'quick_reply', allowEmergency: true, requireLearningEligible: false, enforceMinimumTier: false });
    return { present: true, verified: true, reasonCode: '' };
  } catch (error) { return { present: true, verified: false, reasonCode: clean(error.code || 'AI_QUALITY_ROUTE_RECEIPT_INVALID') }; }
}
function commandIntegrity(command = {}, policy = {}) {
  if (!command || typeof command !== 'object' || clean(command.commandType) !== 'OutboxCommand') return { present: false, verified: false, policyHashVerified: false, reasonCode: 'OUTBOX_COMMAND_MISSING' };
  try {
    sendPolicyAuthority.verifyFrozenCommand(command);
    const policyHashVerified = clean(command.sendPolicySha256) === sha256(policy || {});
    return { present: true, verified: policyHashVerified, policyHashVerified, reasonCode: policyHashVerified ? '' : 'EGRESS_SEND_POLICY_PERSISTENCE_MISMATCH' };
  } catch (error) { return { present: true, verified: false, policyHashVerified: false, reasonCode: clean(error.code || 'OUTBOX_COMMAND_INVALID') }; }
}

function summarizeRoutes(queue = [], outbox = []) {
  const rows = [...queue.map(row => row.route), ...outbox.map(row => row.route)].filter(row => row.receiptHash || row.modelId || row.task);
  return {
    routeReceipts: rows.length,
    highCapability: rows.filter(row => row.highCapabilityPath && !row.emergencyMode).length,
    fallback: rows.filter(row => row.fallbackUsed && !row.emergencyMode).length,
    emergency: rows.filter(row => row.emergencyMode).length,
    learningIneligible: rows.filter(row => row.learningEligible === false).length
  };
}

function integrityStatus(input = {}) {
  const store = input.store || getStore();
  const db = store.db;
  const activeStates = ['pending','queued','retry','sending','platform_accepted_local_pending','send_outcome_unknown'];
  const marks = activeStates.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id,state,payload_json,send_policy_json
    FROM r32_send_queue
    WHERE state IN (${marks})
    ORDER BY created_at ASC
  `).all(...activeStates);
  let commandFailures = 0; let routeFailures = 0; let releaseBlocking = 0;
  const reasons = [];
  for (const row of rows) {
    const payload = parse(row.payload_json, {}) || {};
    const command = payload.outboxCommand || {};
    const policy = parse(row.send_policy_json, {}) || {};
    const route = command.qualityRouteReceipt || payload.qualityRouteReceipt || {};
    const commandCheck = commandIntegrity(command, policy);
    const routeCheck = routeIntegrity(route);
    if (commandCheck.verified === false) commandFailures += 1;
    if (routeCheck.present === true && routeCheck.verified === false) routeFailures += 1;
    if (commandCheck.verified === false || (routeCheck.present === true && routeCheck.verified === false)) {
      releaseBlocking += 1;
      if (reasons.length < 100) reasons.push({ queueId: clean(row.id), state: clean(row.state), commandReasonCode: clean(commandCheck.reasonCode), routeReasonCode: clean(routeCheck.reasonCode) });
    }
  }
  return { authority: AUTHORITY, checkedActiveQueue: rows.length, commandFailures, routeFailures, releaseBlocking, reasons, complete: true };
}

function snapshot(input = {}) {
  const store = input.store || getStore();
  const db = store.db;
  const limit = bounded(input.limit, 200, 1000);
  const pageOffset = offset(input.offset);
  const queueTotal = Number(db.prepare('SELECT COUNT(*) AS n FROM r32_send_queue').get()?.n || 0);
  const outboxTotal = Number(db.prepare('SELECT COUNT(*) AS n FROM ai_reply_outbox').get()?.n || 0);
  const queue = db.prepare(`
    SELECT id,idempotency_key,account_id,session_key,message_type,state,attempts,last_error,platform_message_id,
           outbox_id,send_policy_json,capability_snapshot_id,quality_tier,emergency_mode,payload_json,created_at,updated_at
    FROM r32_send_queue ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, pageOffset).map(row => {
    const payload = parse(row.payload_json, {}) || {};
    const command = payload.outboxCommand || {};
    const policy = parse(row.send_policy_json, {}) || {};
    const route = command.qualityRouteReceipt || payload.qualityRouteReceipt || {};
    return {
      queueId: clean(row.id), idempotencyKeyHashSha256: hashId(row.idempotency_key), accountIdHashSha256: hashId(row.account_id), conversationIdHashSha256: hashId(row.session_key),
      messageType: clean(row.message_type), state: clean(row.state), attempts: Number(row.attempts || 0), reasonCode: clean(row.last_error).split(':')[0],
      platformMessageIdHashSha256: hashId(row.platform_message_id), outboxId: clean(row.outbox_id), capabilitySnapshotId: clean(row.capability_snapshot_id),
      qualityTier: clean(row.quality_tier), emergencyMode: Number(row.emergency_mode || 0) === 1,
      commandSha256: clean(command.commandSha256), sendPolicySha256: clean(command.sendPolicySha256), sendPolicyVersion: clean(command.sendPolicyVersion || parse(row.send_policy_json, {})?.version),
      contentFrozen: command.contentFrozen === true, approvalReceiptId: clean(command.approvalReceiptId), integrity: { command: commandIntegrity(command, policy), route: routeIntegrity(route) }, route: safeRoute(route), createdAt: clean(row.created_at), updatedAt: clean(row.updated_at)
    };
  });
  const outbox = db.prepare(`
    SELECT id,candidate_id,contact_id,conversation_id,account_id,platform,state,user_approved,approved_at,send_queue_id,
           target_language,final_text_sha256,idempotency_key,send_policy_version,capability_snapshot_id,approval_receipt_id,
           quality_route_receipt_json,learning_eligible,created_at,updated_at
    FROM ai_reply_outbox ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, pageOffset).map(row => ({
    outboxId: clean(row.id), candidateId: clean(row.candidate_id), contactIdHashSha256: hashId(row.contact_id), conversationIdHashSha256: hashId(row.conversation_id),
    accountIdHashSha256: hashId(row.account_id), platform: clean(row.platform), state: clean(row.state), userApproved: Number(row.user_approved || 0) === 1,
    approvedAt: clean(row.approved_at), sendQueueId: clean(row.send_queue_id), targetLanguage: clean(row.target_language), finalTextSha256: clean(row.final_text_sha256),
    idempotencyKeyHashSha256: hashId(row.idempotency_key), sendPolicyVersion: clean(row.send_policy_version), capabilitySnapshotId: clean(row.capability_snapshot_id),
    approvalReceiptId: clean(row.approval_receipt_id), learningEligible: Number(row.learning_eligible || 0) === 1,
    integrity: { route: routeIntegrity(parse(row.quality_route_receipt_json, {}) || {}) }, route: safeRoute(parse(row.quality_route_receipt_json, {}) || {}), createdAt: clean(row.created_at), updatedAt: clean(row.updated_at)
  }));
  const routeSummary = summarizeRoutes(queue, outbox);
  const activeStates = new Set(['pending','queued','retry','sending','platform_accepted_local_pending','send_outcome_unknown']);
  const commandFailures = queue.filter(row => row.integrity?.command?.verified === false).length;
  const routeFailures = [...queue, ...outbox].filter(row => row.integrity?.route?.present === true && row.integrity?.route?.verified === false).length;
  const releaseBlocking = queue.filter(row => activeStates.has(clean(row.state)) && (row.integrity?.command?.verified === false || (row.integrity?.route?.present === true && row.integrity?.route?.verified === false))).length;
  return {
    authority: AUTHORITY, schemaVersion: 2, generatedAt: new Date().toISOString(),
    counts: { queue: queue.length, outbox: outbox.length, routeReceipts: routeSummary.routeReceipts, queueTotal, outboxTotal },
    qualityRouteSummary: {
      highCapability: routeSummary.highCapability,
      fallback: routeSummary.fallback,
      emergency: routeSummary.emergency,
      learningIneligible: routeSummary.learningIneligible
    },
    integritySummary: { commandFailures, routeFailures, releaseBlocking },
    pagination: {
      limit, offset: pageOffset,
      queueTotal, outboxTotal,
      queueHasMore: pageOffset + queue.length < queueTotal,
      outboxHasMore: pageOffset + outbox.length < outboxTotal
    },
    queue, outbox
  };
}
module.exports = { AUTHORITY, snapshot, integrityStatus, safeRoute, summarizeRoutes, routeIntegrity, commandIntegrity };
