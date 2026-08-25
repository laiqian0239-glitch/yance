'use strict';

const accountStore = require('./accountStore');
const domainEventLog = require('./domainEventLogService').singleton;
const queueRepository = require('../repositories/sendQueueRepository');
const sendPolicyAuthority = require('./sendPolicyAuthority').singleton;
const platformDeliveryAuthority = require('./platformDeliveryAuthority').singleton;
const { currentRuntimeInternalOperationAuthority } = require('./durableInternalOperationAuthority');
const { TERMINAL_STATES } = require('./durableExecutionLifecycle');
const platformAuthWorkflowAuthority = require('./platformAuthWorkflowAuthority').singleton;
const outboxRouteAuthority = require('./outboxRouteAuthority').singleton;
const { sha256 } = require('./domainEventLogService');
const { executeWithDeadline } = require('./executionDeadline');
const eventBus = require('./eventBus');

const ADAPTER_SCHEMA_VERSION = 1;
const PORTS = Object.freeze(['auth', 'ingress', 'egress', 'reconcile']);
const PLATFORMS = Object.freeze(['facebook', 'whatsapp', 'telegram']);
const FORBIDDEN_DTO_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const INTERNAL_OPERATION_TERMINAL_STATES = new Set([...TERMINAL_STATES, 'SUPERSEDED']);
const EGRESS_DEADLINES_MS = Object.freeze({
  text: 45_000,
  media: 120_000,
  native_expression: 120_000,
  reaction: 30_000,
  revoke: 30_000
});
const AUTH_DEADLINES_MS = Object.freeze({
  connect: 120_000,
  reconnect: 150_000,
  pause: 30_000,
  resume: 120_000,
  disconnect: 30_000,
  logout: 45_000,
  cancel: 20_000,
  'telegram.qr.start': 45_000,
  'telegram.phone.start': 45_000,
  'telegram.code': 45_000,
  'telegram.password': 45_000,
  'telegram.cancel': 20_000,
  'facebook.oauth.start': 30_000,
  'facebook.oauth.status': 30_000,
  'facebook.oauth.selectpage': 120_000,
  'facebook.oauth.cancel': 20_000,
  'facebook.messenger.start': 120_000,
  'facebook.messenger.input': 120_000,
  'facebook.messenger.wait': 120_000,
  'facebook.messenger.cancel': 20_000
});
const RECONCILE_DEADLINES_MS = Object.freeze({
  sync: 300_000,
  'media-transfer': 120_000,
  'facebook.avatar-import.start': 60_000,
  'facebook.avatar-import.status': 20_000,
  'facebook.avatar-import.stop': 30_000,
  'facebook.avatar-closure.diagnose': 300_000
});

function egressDeadlineMs(command = {}) {
  const operation = clean(command.operation).toLowerCase();
  const override = Number(process.env[`YANCE_${clean(command.platform).toUpperCase()}_${operation.toUpperCase()}_EGRESS_TIMEOUT_MS`] || process.env.YANCE_PLATFORM_EGRESS_TIMEOUT_MS || 0);
  return Math.max(1_000, override > 0 ? override : Number(EGRESS_DEADLINES_MS[operation] || 60_000));
}
function executeEgressWithDeadline(executor, command = {}) {
  return executeWithDeadline(executor, {
    deadlineAt: clean(command.deadlineAt),
    timeoutMs: egressDeadlineMs(command),
    code: 'PLATFORM_EGRESS_DEADLINE_EXCEEDED',
    message: '平台发送执行超过期限；远端结果不确定，已禁止自动重发。',
    outcomeUnknown: true,
    automaticRetryBlocked: true,
    operation: clean(command.operation),
    platform: clean(command.platform).toLowerCase(),
    accountId: clean(command.accountId),
    commandId: clean(command.commandId),
    onLateResult(error, result, context) {
      const platformMessageId = clean(
        result?.platformMessageId || result?.messageId || result?.id || result?.key?.id
        || error?.platformMessageId || error?.messageId || error?.id || error?.key?.id
      );
      const platformAccepted = Boolean(platformMessageId) && (error?.platformAccepted === true || !error);
      eventBus.publish('platform-egress:late-result-quarantined', {
        platform: clean(command.platform).toLowerCase(), accountId: clean(command.accountId),
        commandId: clean(command.commandId), operation: clean(command.operation), sessionKey: clean(command.sessionKey),
        outboxRouteId: clean(command.outboxRouteId), outboxRouteVersionId: clean(command.outboxRouteVersionId),
        conversationTarget: clean(command.conversationTarget),
        executionGeneration: context.generation, quarantineReason: clean(context.reason), ok: !error, platformAccepted,
        platformMessageId, automaticRetryBlocked: true,
        errorCode: clean(error?.code || error?.message), at: new Date().toISOString()
      });
    }
  });
}

function portDeadlineMs(kind, platform, operation, requested = 0) {
  const prefix = clean(kind).toUpperCase();
  const normalizedPlatform = clean(platform).toUpperCase();
  const normalizedOperation = clean(operation).toLowerCase();
  const operationKey = normalizedOperation.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const override = Number(
    requested
    || process.env[`YANCE_${normalizedPlatform}_${operationKey}_${prefix}_TIMEOUT_MS`]
    || process.env[`YANCE_PLATFORM_${prefix}_TIMEOUT_MS`]
    || 0
  );
  const defaults = prefix === 'AUTH' ? AUTH_DEADLINES_MS : RECONCILE_DEADLINES_MS;
  return Math.max(1_000, override > 0 ? override : Number(defaults[normalizedOperation] || 60_000));
}

function persistedAuthorityDeadlineAt(lifecycle, kind, platform, operation, requested = 0) {
  if (!lifecycle || typeof lifecycle.timestamp !== 'function') {
    throw error('PLATFORM_AUTHORITY_CLOCK_REQUIRED', 'Persisted platform deadline requires the durable operation authority clock.', 503);
  }
  const authorityNow = lifecycle.timestamp();
  const nowMs = Date.parse(authorityNow);
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== authorityNow) {
    throw error('PLATFORM_AUTHORITY_CLOCK_INVALID', 'Durable operation authority returned an invalid timestamp.', 503);
  }
  return new Date(nowMs + portDeadlineMs(kind, platform, operation, requested)).toISOString();
}

function executePortWithDeadline(executor, context = {}) {
  const kind = clean(context.kind).toLowerCase();
  const platform = clean(context.platform).toLowerCase();
  const accountId = clean(context.accountId);
  const operation = clean(context.operation).toLowerCase();
  const operationId = clean(context.operationId);
  return executeWithDeadline(executor, {
    deadlineAt: clean(context.deadlineAt),
    timeoutMs: portDeadlineMs(kind, platform, operation, context.timeoutMs),
    signal: context.signal || null,
    generation: clean(context.generation),
    code: `PLATFORM_${kind.toUpperCase()}_DEADLINE_EXCEEDED`,
    message: `${platform || 'platform'} ${kind} operation exceeded its authoritative deadline`,
    operation: `${kind}:${operation}`,
    platform,
    accountId,
    commandId: operationId,
    onLateResult(error, result, deadline) {
      eventBus.publish(`platform-${kind}:late-result-quarantined`, {
        platform, accountId, operation, operationId,
        operationGeneration: deadline.generation,
        quarantineReason: clean(deadline.reason), ok: !error,
        resultState: clean(result?.state || result?.status),
        errorCode: clean(error?.code || error?.message),
        at: new Date().toISOString()
      });
    }
  });
}

function clean(value) { return String(value == null ? '' : value).trim(); }
function error(code, message, status = 400, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }

function facebookMediaTransferCommand(payload = {}) {
  const accountId = clean(payload.accountId);
  const conversationId = clean(payload.conversationId);
  const messageId = clean(payload.messageId);
  if (!accountId || !conversationId || !messageId) {
    throw error('FACEBOOK_MEDIA_DELEGATION_REFERENCE_REQUIRED', 'Facebook delegated media requires persisted account, conversation, and message references.', 409);
  }
  return Object.freeze({
    transferKind: 'FETCH',
    mediaReference: messageId,
    sourceScopeReference: `facebook:${accountId}:webhook:${messageId}`,
    destinationScopeReference: `conversation:${conversationId}:message:${messageId}`,
    metadataSha256: sha256({ platform: 'facebook', accountId, conversationId, messageId }),
    custodyReference: `facebook:${accountId}`
  });
}

function scheduleFacebookWebhookMediaTransfer(event = {}) {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  try {
    const command = facebookMediaTransferCommand(payload);
    const mediaPipeline = require('./mediaPipeline');
    const scheduled = mediaPipeline.prepareMediaTransfer({
      idempotencyKey: `facebook:webhook-media:${clean(payload.accountId)}:${clean(payload.messageId)}`,
      traceId: clean(event.id) || `facebook-webhook-media:${clean(payload.messageId)}`,
      command,
      maxAttempts: 3
    });
    eventBus.publish('facebook:webhook-media-scheduled', {
      accountId: clean(payload.accountId),
      conversationId: clean(payload.conversationId),
      messageId: clean(payload.messageId),
      operationKind: 'MEDIA_TRANSFER',
      executionId: clean(scheduled.executionId),
      intentId: clean(scheduled.intentId),
      idempotencyKey: clean(scheduled.idempotencyKey)
    });
    return scheduled;
  } catch (cause) {
    eventBus.publish('facebook:webhook-media-schedule-failed', {
      accountId: clean(payload.accountId),
      conversationId: clean(payload.conversationId),
      messageId: clean(payload.messageId),
      operationKind: 'MEDIA_TRANSFER',
      reasonCode: clean(cause?.code) || 'FACEBOOK_MEDIA_TRANSFER_SCHEDULE_FAILED'
    });
    return null;
  }
}

eventBus.on('facebook:webhook-media-delegated', scheduleFacebookWebhookMediaTransfer);

async function materializeFacebookMediaTransfer(input = {}) {
  const accountId = clean(input.accountId);
  const account = accountStore.get(accountId);
  if (!account || clean(account.platform).toLowerCase() !== 'facebook') {
    throw error('FACEBOOK_MEDIA_ACCOUNT_NOT_FOUND', 'Facebook media transfer account is unavailable.', 404, { accountId });
  }
  if (clean(input.transferKind).toUpperCase() !== 'FETCH') {
    throw error('FACEBOOK_MEDIA_TRANSFER_KIND_UNSUPPORTED', 'Facebook Worker media materialization only accepts FETCH.', 409);
  }
  const messageId = clean(input.mediaReference);
  const messageStore = require('./messageStore');
  const persisted = messageStore.getExternalMessage({ accountId, targetId: messageId });
  if (!persisted) {
    throw error('FACEBOOK_MEDIA_MESSAGE_NOT_FOUND', 'Facebook media reference did not resolve to a persisted message.', 404, { accountId, messageId });
  }
  const allAttachments = Array.isArray(persisted.attachments) ? persisted.attachments : [];
  const workerAttachments = allAttachments.filter(attachment => {
    const worker = attachment?.workerMedia || attachment?.payload?.worker_media || null;
    return Boolean(clean(worker?.eventId || worker?.event_id));
  });
  if (!workerAttachments.length) {
    throw error('FACEBOOK_WORKER_MEDIA_REFERENCE_NOT_FOUND', 'Persisted Facebook message has no Worker media reference; direct Meta CDN fetch remains retired.', 409, { accountId, messageId });
  }
  const physicalAttachments = workerAttachments.map((attachment, index) => {
    const worker = attachment?.workerMedia || attachment?.payload?.worker_media || {};
    const workerEventId = clean(worker.eventId || worker.event_id);
    const workerIndex = Number.isSafeInteger(Number(worker.index)) && Number(worker.index) >= 0 ? Number(worker.index) : index;
    return {
      ...attachment,
      payload: {
        ...(attachment?.payload || {}),
        worker_media: Object.freeze({ event_id: workerEventId, index: workerIndex })
      }
    };
  });
  const facebookAdapter = require('./facebookAdapter');
  const externalMessageId = clean(persisted.externalMessageId || messageId);
  const conversationId = clean(persisted.conversationId || persisted.sessionKey);
  await facebookAdapter.cacheWebhookAttachments(account, {
    ...persisted,
    accountId,
    platform: 'facebook',
    externalMessageId,
    conversationId
  }, physicalAttachments, {
    signal: input.signal || null,
    physicalOperationContext: input.physicalOperationContext
  });
  return {
    status: 'completed',
    remoteTransferId: '',
    providerRequestId: '',
    outputReference: `message:${accountId}:${externalMessageId}`,
    evidenceReference: `facebook-worker-media:${clean(input.operationId || input.mediaReference)}`,
    failureCode: '',
    uncertain: false
  };
}

function requirePlatform(value) {
  const platform = clean(value).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw error('PLATFORM_ADAPTER_UNSUPPORTED', `不支持的平台适配器：${platform || 'unknown'}`, 409);
  return platform;
}
function assertDomainDto(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('PLATFORM_PORT_DTO_REQUIRED', `${name} 必须使用领域 DTO。`);
  const seen = new WeakSet();
  let nodes = 0;
  const visit = (candidate, path = '$', depth = 0) => {
    if (candidate == null || typeof candidate !== 'object' || candidate instanceof Date) {
      if (typeof candidate === 'function' || typeof candidate === 'symbol' || typeof candidate === 'bigint') throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 不得携带非 JSON 值。`, 409, { path });
      if (typeof candidate === 'number' && !Number.isFinite(candidate)) throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 不得携带非有限数字。`, 409, { path });
      return;
    }
    if (Buffer.isBuffer(candidate) || candidate instanceof Uint8Array) {
      throw error('PLATFORM_PORT_BINARY_FORBIDDEN', `${name} 不得跨端口携带原始二进制；必须使用经过校验的媒体引用。`, 409, { path, bytes: Number(candidate.byteLength || candidate.length || 0) });
    }
    if (depth > 24 || ++nodes > 10000) throw error('PLATFORM_PORT_DTO_TOO_COMPLEX', `${name} 超出领域 DTO 复杂度限制。`, 409, { path });
    if (seen.has(candidate)) throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 不得携带循环对象。`, 409, { path });
    seen.add(candidate);
    const prototype = Object.getPrototypeOf(candidate);
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
      throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 只能携带普通领域对象。`, 409, { path, prototype: prototype?.constructor?.name || 'unknown' });
    }
    if (!Array.isArray(candidate)) {
      const looksHttp = typeof candidate.pipe === 'function' || (candidate.headers && candidate.socket && (candidate.method || candidate.url));
      const looksDom = Number.isInteger(candidate.nodeType) && (candidate.nodeName || candidate.ownerDocument);
      if (looksHttp || looksDom) throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 不得携带 HTTP/Express 或 DOM 对象。`, 409, { path });
    }
    for (const key of Object.getOwnPropertyNames(candidate)) {
      if (FORBIDDEN_DTO_KEYS.has(key)) throw error('PLATFORM_PORT_DTO_KEY_FORBIDDEN', `${name} 包含危险对象键。`, 409, { path: `${path}.${key}`, key });
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (descriptor?.get || descriptor?.set) throw error('PLATFORM_PORT_DTO_ACCESSOR_FORBIDDEN', `${name} 不得携带 getter/setter。`, 409, { path: `${path}.${key}` });
      const child = descriptor?.value;
      if (depth === 0 && ['req','res','response','request','dom','element','sqliteRow'].includes(key)) {
        throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 不得携带 ${key}。`, 409, { path: `${path}.${key}` });
      }
      if (typeof child === 'function') throw error('PLATFORM_PORT_BOUNDARY_VIOLATION', `${name} 不得携带函数。`, 409, { path: `${path}.${key}` });
      visit(child, `${path}.${key}`, depth + 1);
    }
    seen.delete(candidate);
  };
  visit(value);
  return value;
}

function sanitizePortValue(value, key = '', state = null, depth = 0) {
  const context = state || { seen: new WeakSet(), nodes: 0 };
  if (value == null || ['string','number','boolean'].includes(typeof value)) return value;
  if (typeof value === 'bigint') return String(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { redacted: true, bytes: Number(value.byteLength || value.length || 0) };
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return undefined;
  if (depth > 20 || ++context.nodes > 5000 || context.seen.has(value)) return '[REDACTED_COMPLEX_VALUE]';
  context.seen.add(value);
  if (Array.isArray(value)) {
    const output = value.slice(0, 1000).map(item => sanitizePortValue(item, '', context, depth + 1));
    context.seen.delete(value);
    return output;
  }
  const output = {};
  for (const childKey of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_DTO_KEYS.has(childKey) || /(^raw$|rawmessage|token|secret|password|cookie|authorization|credential|qrcode)/i.test(childKey)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, childKey);
    if (descriptor?.get || descriptor?.set) continue;
    const sanitized = sanitizePortValue(descriptor?.value, childKey, context, depth + 1);
    if (sanitized !== undefined) output[childKey] = sanitized;
  }
  context.seen.delete(value);
  return output;
}

function recordOperationalDomainEvent(input = {}, eventLog = domainEventLog) {
  const platform = requirePlatform(input.platform);
  const sourceAccountId = clean(input.sourceAccountId || input.accountId);
  if (!sourceAccountId) return null;
  const eventType = clean(input.eventType);
  const externalEventId = clean(input.externalEventId);
  const idempotencyKey = clean(input.idempotencyKey) || [platform, sourceAccountId, eventType, externalEventId || sha256(input.projection || {})].join(':');
  const created = eventLog.append({
    platform, sourceAccountId, eventType, externalEventId, idempotencyKey,
    correlationId: clean(input.correlationId), causationId: clean(input.causationId),
    occurredAt: clean(input.occurredAt) || new Date().toISOString(),
    payload: { projection: sanitizePortValue(input.projection || {}), meta: sanitizePortValue(input.meta || {}) },
    retentionDays: 30
  });
  return created;
}

function normalizeSendResult(platform, command, result) {
  if (!result || typeof result !== 'object') throw error('PLATFORM_SEND_RESULT_INVALID', '平台发送端口没有返回结构化结果。', 502);
  if (result.success === false) throw error(clean(result.reasonCode || result.code) || 'PLATFORM_SEND_REJECTED', clean(result.error || result.message) || '平台拒绝发送。', 502);
  const platformMessageId = clean(result.platformMessageId || result.messageId || result.message_id || result.id || result.key?.id);
  if (['text', 'media', 'native_expression'].includes(clean(command.operation)) && !platformMessageId) {
    throw error('PLATFORM_SEND_RESULT_ID_REQUIRED', '平台声称发送成功但没有返回可对账的消息标识，已阻止把结果记为成功。', 502, {
      platform, commandId: clean(command.commandId), operation: clean(command.operation)
    });
  }
  const localPersistenceRepair = result.localPersistenceRepair
    ? sanitizePortValue(result.localPersistenceRepair)
    : null;
  const normalized = {
    schemaVersion: ADAPTER_SCHEMA_VERSION,
    resultType: 'PlatformSendResult',
    platform,
    accountId: clean(command.accountId),
    commandId: clean(command.commandId),
    outboxId: clean(command.outboxId),
    operation: clean(command.operation),
    success: true,
    platformMessageId,
    messageId: platformMessageId,
    ackType: clean(result.ackType) || 'provider-message-id',
    ackStatus: clean(result.ackStatus) || 'accepted',
    providerRequestId: clean(result.providerRequestId || result.requestId),
    providerAcceptedAt: clean(result.providerAcceptedAt || result.completedAt || result.sentAt) || new Date().toISOString(),
    localPersistencePending: result.localPersistencePending === true,
    localPersistenceErrorCode: clean(result.localPersistenceErrorCode),
    localPersistenceRepair
  };
  return assertDomainDto(normalized, 'PlatformSendResult');
}

function persistDeliverySuccess(command, normalized, authority = platformDeliveryAuthority) {
  try {
    const observation = authority.recordSuccess(command, normalized);
    return { ...normalized, deliveryAckObservationId: observation.observationId, deliveryCapabilityId: observation.capabilityId };
  } catch (cause) {
    cause.platformAccepted = true;
    cause.platformMessageId = clean(normalized.platformMessageId);
    cause.code = clean(cause.code) || 'PLATFORM_ACK_EVIDENCE_PERSIST_FAILED';
    throw cause;
  }
}
function persistDeliveryFailure(command, cause, authority = platformDeliveryAuthority) {
  if (cause?.platformAccepted === true || cause?.outcomeUnknown === true) return cause;
  try {
    const observation = authority.recordFailure(command, cause || {});
    if (cause && typeof cause === 'object') cause.deliveryAckObservationId = observation.observationId;
  } catch (evidenceError) {
    if (cause && typeof cause === 'object') {
      cause.deliveryAckPersistenceCode = clean(evidenceError.code) || 'PLATFORM_ACK_FAILURE_EVIDENCE_PERSIST_FAILED';
      cause.deliveryAckPersistenceError = clean(evidenceError.message);
    }
  }
  return cause;
}

function authorizePersistedOutbox(command = {}) {
  sendPolicyAuthority.verifyFrozenCommand(command);
  const queueId = clean(command.commandId);
  const row = queueId ? queueRepository.get(queueId) : null;
  if (!row) throw error('EGRESS_PERSISTED_OUTBOX_REQUIRED', 'Egress 只能执行已经持久化到发送队列的 OutboxCommand。', 409, { queueId });
  if (clean(row.state) !== 'sending') throw error('EGRESS_OUTBOX_NOT_CLAIMED', 'OutboxCommand 尚未被发送队列领取。', 409, { queueId, state: clean(row.state) });
  const persisted = row.payload?.outboxCommand || null;
  if (!persisted || clean(persisted.commandSha256) !== clean(command.commandSha256)) {
    throw error('EGRESS_OUTBOX_PERSISTENCE_MISMATCH', '发送队列中的 OutboxCommand 与待执行命令不一致。', 409, { queueId });
  }
  if (clean(row.idempotency_key) !== clean(command.idempotencyKey) || clean(row.account_id) !== clean(command.accountId) || clean(row.session_key) !== clean(command.sessionKey)
    || clean(row.outbox_id) !== clean(command.outboxId) || clean(row.capability_snapshot_id) !== clean(command.capabilitySnapshotId)
    || clean(row.quality_tier) !== clean(command.qualityTier) || (Number(row.emergency_mode || 0) === 1) !== (command.emergencyMode === true)) {
    throw error('EGRESS_OUTBOX_SCOPE_MISMATCH', '持久化发送任务与 OutboxCommand 的账号、会话、策略或质量作用域不一致。', 409, { queueId });
  }
  const persistedPolicy = row.sendPolicy || row.send_policy || (() => { try { return JSON.parse(row.send_policy_json || '{}'); } catch (_) { return {}; } })();
  if (!clean(command.sendPolicySha256) || sha256(persistedPolicy) !== clean(command.sendPolicySha256)) {
    throw error('EGRESS_SEND_POLICY_PERSISTENCE_MISMATCH', '持久化的逐命令发送策略与 OutboxCommand 哈希绑定不一致。', 409, { queueId });
  }
  const routeVersionId = clean(row.outbox_route_version_id);
  if (!routeVersionId) {
    const error = new Error('Frozen send queue command is missing immutable OutboxRouteVersion');
    error.code = 'EGRESS_ROUTE_VERSION_REQUIRED';
    error.status = 409;
    throw error;
  }
  const route = outboxRouteAuthority.assertCommand(command, null, routeVersionId);
  if (clean(row.outbox_route_id) !== clean(route.outboxRouteId) || clean(row.payload?.outboxRouteId) !== clean(route.outboxRouteId)
    || clean(row.outbox_route_version_id) !== clean(route.routeVersionId || row.outbox_route_version_id)
    || clean(row.payload?.outboxRouteVersionId) !== clean(route.routeVersionId || row.payload?.outboxRouteVersionId)) {
    throw error('EGRESS_OUTBOX_ROUTE_PERSISTENCE_MISMATCH', '发送队列、OutboxRoute 与冻结命令的路由绑定不一致。', 409, { queueId, persistedRouteId: clean(row.outbox_route_id), payloadRouteId: clean(row.payload?.outboxRouteId), routeId: clean(route.outboxRouteId) });
  }
  const executionReceipt = sendPolicyAuthority.authorizeExecution(command);
  return {
    authorized: true,
    queueId,
    state: row.state,
    commandSha256: clean(command.commandSha256),
    capabilitySnapshotId: clean(row.capability_snapshot_id),
    outboxRouteId: route.outboxRouteId,
    executionReceipt
  };
}

function defaultNormalizer(platform, input = {}) {
  const raw = input.rawEvent || input.payload || input;
  const externalEventId = clean(input.externalEventId || raw.externalEventId || raw.eventId || raw.id || raw.messageId);
  const eventType = clean(input.eventType || raw.eventType || raw.type) || 'platform.event.received';
  return {
    schemaVersion: 1,
    platform,
    sourceAccountId: clean(input.sourceAccountId || input.accountId || raw.sourceAccountId || raw.accountId),
    externalEventId,
    eventType,
    idempotencyKey: clean(input.idempotencyKey) || (externalEventId ? [platform, clean(input.sourceAccountId || input.accountId || raw.sourceAccountId || raw.accountId), eventType, externalEventId].join(':') : ''),
    correlationId: clean(input.correlationId || raw.correlationId),
    causationId: clean(input.causationId || raw.causationId),
    occurredAt: clean(input.occurredAt || raw.occurredAt || raw.timestamp),
    receivedAt: clean(input.receivedAt),
    payload: raw
  };
}

function projectPhysicalOperationContext(operation = {}, platform = '', accountId = '') {
  if (!operation || typeof operation !== 'object' || clean(operation.state).toUpperCase() !== 'RUNNING') {
    throw error('PLATFORM_PERSISTED_OPERATION_REQUIRED', 'Physical platform operation requires one RUNNING persisted Schema 23 operation.', 409);
  }
  const requiredStrings = [
    'operationId', 'executionId', 'operationType', 'operationKind', 'scopeKey',
    'objectFingerprint', 'ownerId', 'claimId'
  ];
  for (const field of requiredStrings) {
    if (!clean(operation[field])) {
      throw error('PLATFORM_PERSISTED_OPERATION_REQUIRED', 'Persisted physical operation identity is incomplete.', 409, { field });
    }
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const value = Number(operation[field]);
    if (!Number.isSafeInteger(value) || value < 1) {
      throw error('PLATFORM_PERSISTED_OPERATION_REQUIRED', 'Persisted physical operation fencing identity is invalid.', 409, { field });
    }
  }
  return Object.freeze({
    operationId: clean(operation.operationId),
    executionId: clean(operation.executionId),
    operationType: clean(operation.operationType),
    operationKind: clean(operation.operationKind),
    scopeKey: clean(operation.scopeKey),
    objectFingerprint: clean(operation.objectFingerprint),
    state: 'RUNNING',
    generation: Number(operation.generation),
    ownerId: clean(operation.ownerId),
    claimId: clean(operation.claimId),
    hostGeneration: Number(operation.hostGeneration),
    fencingToken: Number(operation.fencingToken),
    deadlineAt: clean(operation.deadlineAt),
    platform: clean(platform).toLowerCase(),
    accountId: clean(accountId)
  });
}

function defaultAccountManager() { return require('./accountManager'); }
function createAccountManagerAuthHandler(managerProvider = defaultAccountManager) {
  return {
    async execute(input = {}) {
      const manager = managerProvider();
      const operation = clean(input.operation);
      const accountId = clean(input.accountId);
      switch (operation) {
        case 'connect': return manager.connect(accountId, { signal: input.signal, attemptId: input.operationGeneration, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
        case 'reconnect': return manager.reconnect(accountId, { signal: input.signal, attemptId: input.operationGeneration, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
        case 'pause': return manager.disconnect(accountId, { logout: false, signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
        case 'resume': return manager.resume(accountId, { signal: input.signal, attemptId: input.operationGeneration, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
        case 'logout': return manager.disconnect(accountId, { logout: true, signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
        case 'telegram.qr.start': return { account: await manager.startTelegramQr(accountId, { signal: input.signal, attemptId: input.operationGeneration, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'telegram.phone.start': return { account: await manager.startTelegramPhone(accountId, input.phoneNumber, { signal: input.signal, attemptId: input.operationGeneration, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'telegram.code': return { account: await manager.submitTelegramCode(accountId, input.code, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'telegram.password': return { account: await manager.submitTelegramPassword(accountId, input.password, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'telegram.cancel': return { account: await manager.cancelTelegramLogin(accountId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'facebook.oauth.start': return { flow: await manager.beginFacebookOAuth(accountId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'facebook.oauth.status': return { flow: await manager.pollFacebookOAuth(accountId, input.flowId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        case 'facebook.oauth.selectPage': return manager.selectFacebookPage(accountId, input.flowId, input.pageId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
        case 'facebook.oauth.cancel': return { flow: await manager.cancelFacebookOAuth(accountId, input.flowId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
        default: throw error('PLATFORM_AUTH_OPERATION_UNSUPPORTED', `AuthPort 不支持操作：${operation || 'unknown'}`, 404);
      }
    }
  };
}
function createAccountManagerReconcileHandler(managerProvider = defaultAccountManager) {
  return async input => {
    const manager = managerProvider();
    const operation = clean(input.operation) || 'sync';
    const accountId = clean(input.accountId);
    switch (operation) {
      case 'sync': return manager.sync(accountId, { signal: input.signal, executionGeneration: input.operationGeneration, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext });
      case 'media-transfer': return materializeFacebookMediaTransfer(input);
      case 'facebook.avatar-import.start': return { session: manager.startFacebookBusinessSuiteAvatarImport(accountId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
      case 'facebook.avatar-import.status': return { session: manager.getFacebookBusinessSuiteAvatarImportStatus(accountId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
      case 'facebook.avatar-import.stop': return { session: manager.stopFacebookBusinessSuiteAvatarImport(accountId, { signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
      case 'facebook.avatar-closure.diagnose': return { report: await manager.diagnoseFacebookAvatarClosure(accountId, { limit: input.limit, signal: input.signal, operationGeneration: input.operationGeneration, physicalOperationContext: input.physicalOperationContext }) };
      default: throw error('PLATFORM_RECONCILE_OPERATION_UNSUPPORTED', `ReconcilePort 不支持操作：${operation}`, 404);
    }
  };
}

function validatePersistedEgressContext(value, command, platform) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw error('EGRESS_PERSISTED_ATTEMPT_REQUIRED', 'Physical Egress requires one frozen persisted WP-B attempt context before any platform call.', 409);
  }
  assertDomainDto(value, 'PersistedEgressAttemptContext');
  const requiredStrings = [
    'executionId', 'intentId', 'attemptId', 'claimId', 'ownerId',
    'idempotencyKey', 'requestContentSha256'
  ];
  for (const field of requiredStrings) {
    if (!clean(value[field])) {
      throw error('EGRESS_PERSISTED_ATTEMPT_REQUIRED', 'Persisted Egress attempt field is required.', 409, { field });
    }
  }
  if (!/^[a-f0-9]{64}$/u.test(clean(value.requestContentSha256))) {
    throw error('EGRESS_PERSISTED_ATTEMPT_REQUIRED', 'Persisted Egress requestContentSha256 is invalid.', 409, { field: 'requestContentSha256' });
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const number = Number(value[field]);
    if (!Number.isSafeInteger(number) || number < 1) {
      throw error('EGRESS_PERSISTED_ATTEMPT_REQUIRED', 'Persisted Egress attempt integer field is invalid.', 409, { field });
    }
  }
  const normalizedPlatform = clean(platform).toLowerCase();
  if (clean(value.platform) && clean(value.platform).toLowerCase() !== normalizedPlatform) {
    throw error('EGRESS_PERSISTED_ATTEMPT_SCOPE_MISMATCH', 'Persisted Egress platform scope mismatch.', 409);
  }
  if (clean(value.accountReference) && clean(value.accountReference) !== clean(command.accountId)) {
    throw error('EGRESS_PERSISTED_ATTEMPT_SCOPE_MISMATCH', 'Persisted Egress account scope mismatch.', 409);
  }
  if (clean(value.idempotencyKey) !== clean(command.idempotencyKey)) {
    throw error('EGRESS_PERSISTED_ATTEMPT_SCOPE_MISMATCH', 'Persisted Egress idempotency scope mismatch.', 409);
  }
  return value;
}

class PlatformAdapterFacade {
  constructor(platform, options = {}) {
    this.platform = requirePlatform(platform);
    this.eventLog = options.eventLog || domainEventLog;
    this.normalizer = typeof options.normalizer === 'function' ? options.normalizer : input => defaultNormalizer(this.platform, input);
    this.authHandler = options.authHandler || null;
    this.egressHandler = options.egressHandler || null;
    this.egressAuthorizer = typeof options.egressAuthorizer === 'function' ? options.egressAuthorizer : authorizePersistedOutbox;
    this.reconcileHandler = options.reconcileHandler || null;
    this.deliveryAuthority = options.deliveryAuthority || platformDeliveryAuthority;
    this.operationLifecycle = options.operationLifecycle || null;

    this.auth = Object.freeze({
      status: input => this.authStatus(input),
      start: input => this.authStart(input),
      cancel: input => this.authCancel(input),
      execute: input => this.executeAuth(input)
    });
    this.ingress = Object.freeze({
      normalize: input => this.normalizeIngress(input),
      ingest: input => this.ingest(input)
    });
    this.egress = Object.freeze({ execute: (command, persistedContext) => this.executeEgress(command, persistedContext) });
    this.reconcile = Object.freeze({ execute: request => this.executeReconcile(request) });
  }

  authStatus(input = {}) {
    assertDomainDto(input, 'AuthStatusRequest');
    const accountId = clean(input.accountId);
    const account = accountStore.get(accountId);
    return {
      schemaVersion: ADAPTER_SCHEMA_VERSION,
      platform: this.platform,
      accountId,
      state: clean(account?.state || account?.lifecycleState || 'not-configured'),
      configured: Boolean(account),
      evidence: account ? { accountId: account.id, lifecycleState: account.lifecycleState, updatedAt: account.updatedAt } : {}
    };
  }
  async executeAuth(input = {}) {
    assertDomainDto(input, 'AuthCommand');
    const lifecycle = this.operationLifecycle || currentRuntimeInternalOperationAuthority();
    const operation = clean(input.operation);
    if (!operation) throw error('PLATFORM_AUTH_OPERATION_REQUIRED', 'AuthPort 必须声明认证操作。');
    const accountId = clean(input.accountId);
    const requestedDeadlineAt = clean(input.deadlineAt);
    const deadlineAt = requestedDeadlineAt || persistedAuthorityDeadlineAt(lifecycle, 'auth', this.platform, operation, input.timeoutMs);
    const workflow = platformAuthWorkflowAuthority.begin(lifecycle, {
      ...input, platform: this.platform, accountId, operation, deadlineAt
    });
    const created = workflow.operation;
    const physicalOperationContext = projectPhysicalOperationContext(created, this.platform, accountId);
    try {
      let result;
      if (this.authHandler?.execute) result = await executePortWithDeadline(
        ({ signal, generation }) => this.authHandler.execute({ ...input, platform: this.platform, operationId: created.operationId, operationGeneration: generation, physicalOperationContext, signal }),
        { kind: 'auth', platform: this.platform, accountId, operation, operationId: created.operationId, generation: created.generation, deadlineAt: created.deadlineAt, timeoutMs: input.timeoutMs, signal: input.signal }
      );
      else {
        const direct = this.authHandler?.[operation];
        if (typeof direct !== 'function') throw error('PLATFORM_AUTH_OPERATION_NOT_BOUND', `${this.platform} AuthPort 尚未绑定操作：${operation}`, 501);
        result = await executePortWithDeadline(
          ({ signal, generation }) => direct({ ...input, platform: this.platform, operationId: created.operationId, operationGeneration: generation, physicalOperationContext, signal }),
          { kind: 'auth', platform: this.platform, accountId, operation, operationId: created.operationId, generation: created.generation, deadlineAt: created.deadlineAt, timeoutMs: input.timeoutMs, signal: input.signal }
        );
      }
      const normalized = assertDomainDto(result, 'AuthCommandResult');
      const completion = platformAuthWorkflowAuthority.afterCommand(lifecycle, {
        platform: this.platform, accountId, operation, operationId: created.operationId
      }, normalized);
      return assertDomainDto({
        ...normalized,
        operationId: created.operationId,
        operationGeneration: created.generation,
        operationState: completion.operation?.state || 'RUNNING',
        workflowPending: completion.pending === true
      }, 'AuthCommandResult');
    } catch (cause) {
      const current = lifecycle.read(created.operationId);
      if (current && !INTERNAL_OPERATION_TERMINAL_STATES.has(current.state)) {
        lifecycle.fail(created.operationId, cause, { generation: created.generation, objectFingerprint: created.objectFingerprint });
      }
      cause.operationId = created.operationId;
      cause.operationGeneration = created.generation;
      throw cause;
    }
  }
  async authStart(input = {}) {
    assertDomainDto(input, 'AuthStartRequest');
    return this.executeAuth({ ...input, operation: clean(input.operation) || 'connect' });
  }
  async authCancel(input = {}) {
    assertDomainDto(input, 'AuthCancelRequest');
    try { return await this.executeAuth({ ...input, operation: clean(input.operation) || 'cancel' }); }
    catch (cause) {
      if (clean(cause.code) !== 'PLATFORM_AUTH_OPERATION_NOT_BOUND') throw cause;
      return { schemaVersion: ADAPTER_SCHEMA_VERSION, platform: this.platform, accountId: clean(input.accountId), cancelled: false, reasonCode: 'PLATFORM_AUTH_CANCEL_NOT_BOUND' };
    }
  }

  normalizeIngress(input = {}) {
    assertDomainDto(input, 'IngressRequest');
    const normalized = assertDomainDto(this.normalizer(input), 'NormalizedIngressEvent');
    if (clean(normalized.platform).toLowerCase() !== this.platform) throw error('INGRESS_PLATFORM_MISMATCH', '归一化事件的平台与适配器不一致。', 409);
    if (!clean(normalized.sourceAccountId) || !clean(normalized.eventType)) throw error('INGRESS_EVENT_INCOMPLETE', '归一化事件缺少来源账号或事件类型。');
    return normalized;
  }
  ingest(input = {}) {
    const normalized = this.normalizeIngress(input);
    return this.eventLog.append(normalized);
  }

  async executeEgress(command = {}, persistedContext = null) {
    assertDomainDto(command, 'OutboxCommand');
    if (clean(command.platform).toLowerCase() !== this.platform) throw error('EGRESS_PLATFORM_MISMATCH', 'OutboxCommand 与平台适配器不一致。', 409);
    if (clean(command.commandType) !== 'OutboxCommand') throw error('EGRESS_OUTBOX_COMMAND_REQUIRED', 'Egress 只能消费已持久化的 OutboxCommand。', 409);
    if (!clean(command.idempotencyKey) || command.contentFrozen !== true) throw error('EGRESS_OUTBOX_COMMAND_UNFROZEN', 'Egress 拒绝未冻结或缺少幂等键的命令。', 409);
    const durableAttempt = validatePersistedEgressContext(persistedContext, command, this.platform);
    const persistenceReceipt = await this.egressAuthorizer(command);
    if (!persistenceReceipt || persistenceReceipt.authorized !== true) throw error('EGRESS_PERSISTED_OUTBOX_REQUIRED', 'Egress 未获得持久化 Outbox 授权。', 409);
    let result;
    if (this.egressHandler) {
      try {
        result = await executeEgressWithDeadline(({ signal, generation }) => this.egressHandler(
          command,
          Object.freeze({
            ...persistenceReceipt,
            ...durableAttempt,
            signal,
            executionGeneration: generation
          })
        ), command);
        let normalized;
        try { normalized = normalizeSendResult(this.platform, command, result); }
        catch (cause) {
          if (result && result.success !== false) {
            cause.platformAccepted = true;
            cause.platformMessageId = clean(result.platformMessageId || result.messageId || result.message_id || result.id || result.key?.id);
          }
          throw cause;
        }
        normalized = persistDeliverySuccess(command, normalized, this.deliveryAuthority);
        recordOperationalDomainEvent({ platform: this.platform, accountId: command.accountId, eventType: 'message.sent', externalEventId: normalized.platformMessageId || command.commandId, idempotencyKey: ['message-sent', this.platform, command.accountId, command.commandId].join(':'), correlationId: command.correlationId, causationId: command.commandId, projection: normalized, targetRefs: [{ table: 'send_queue', id: command.commandId }] }, this.eventLog);
        return normalized;
      } catch (cause) {
        throw persistDeliveryFailure(command, cause, this.deliveryAuthority);
      }
    }
    const sendMessageService = require('./sendMessageService');
    try {
      if (command.operation === 'text') {
        result = await executeEgressWithDeadline(({ signal, generation }) => sendMessageService.sendText({
          platform: this.platform, accountId: command.accountId, chatJid: command.conversationTarget,
          text: command.finalText, quoted: command.replyReference || null,
          localMessageId: command.commandId, sessionKey: command.sessionKey, localProjectionOwnedByQueue: true,
          physicalAttemptContext: durableAttempt, signal, executionGeneration: generation, deadlineOwnedByCaller: true
        }), command);
      } else if (command.operation === 'media') {
        const media = Array.isArray(command.mediaReferences) ? command.mediaReferences[0] : null;
        if (!media) throw error('EGRESS_MEDIA_REFERENCE_REQUIRED', '媒体 OutboxCommand 缺少媒体引用。', 409);
        result = await executeEgressWithDeadline(({ signal, generation }) => sendMessageService.sendMedia({
          platform: this.platform, accountId: command.accountId, chatJid: command.conversationTarget,
          kind: media.kind || command.messageType, filePath: media.path, mimeType: media.mimeType,
          filename: media.filename, caption: command.finalText, quoted: command.replyReference || null,
          localMessageId: command.commandId, sessionKey: command.sessionKey, expectedSha256: media.sha256, localProjectionOwnedByQueue: true,
          physicalAttemptContext: durableAttempt, signal, executionGeneration: generation, deadlineOwnedByCaller: true
        }), command);
      } else if (command.operation === 'reaction') {
        result = await executeEgressWithDeadline(({ signal, generation }) => sendMessageService.sendReaction({
          platform: this.platform, accountId: command.accountId, chatJid: command.conversationTarget,
          targetId: command.actionPayload?.targetId, emoji: command.actionPayload?.emoji,
          targetFromMe: command.actionPayload?.targetFromMe === true, participant: command.actionPayload?.participant || '',
          physicalAttemptContext: durableAttempt, signal, executionGeneration: generation, deadlineOwnedByCaller: true
        }), command);
      } else if (command.operation === 'revoke') {
        result = await executeEgressWithDeadline(({ signal, generation }) => sendMessageService.revokeMessage({
          platform: this.platform, accountId: command.accountId, chatJid: command.conversationTarget,
          targetId: command.actionPayload?.targetId, targetFromMe: command.actionPayload?.targetFromMe !== false,
          participant: command.actionPayload?.participant || '', physicalAttemptContext: durableAttempt,
          signal, executionGeneration: generation, deadlineOwnedByCaller: true
        }), command);
      } else if (command.operation === 'native_expression') {
        result = await executeEgressWithDeadline(({ signal, generation }) => sendMessageService.sendNativeExpression({
          platform: this.platform, accountId: command.accountId, chatJid: command.conversationTarget,
          reference: command.actionPayload?.reference, kind: command.actionPayload?.kind || command.messageType,
          caption: command.finalText, quoted: command.replyReference || null,
          localMessageId: command.commandId, sessionKey: command.sessionKey, localProjectionOwnedByQueue: true,
          physicalAttemptContext: durableAttempt, signal, executionGeneration: generation, deadlineOwnedByCaller: true
        }), command);
      } else {
        throw error('EGRESS_OPERATION_UNSUPPORTED', `Egress 不支持操作：${command.operation}`, 409);
      }
    } catch (cause) {
      throw persistDeliveryFailure(command, cause, this.deliveryAuthority);
    }
    let normalized;
    try {
      try { normalized = normalizeSendResult(this.platform, command, result); }
      catch (cause) {
        if (result && result.success !== false) {
          cause.platformAccepted = true;
          cause.platformMessageId = clean(result.platformMessageId || result.messageId || result.message_id || result.id || result.key?.id);
        }
        throw cause;
      }
      normalized = persistDeliverySuccess(command, normalized, this.deliveryAuthority);
      recordOperationalDomainEvent({ platform: this.platform, accountId: command.accountId, eventType: 'message.sent', externalEventId: normalized.platformMessageId || command.commandId, idempotencyKey: ['message-sent', this.platform, command.accountId, command.commandId].join(':'), correlationId: command.correlationId, causationId: command.commandId, projection: normalized, targetRefs: [{ table: 'send_queue', id: command.commandId }] }, this.eventLog);
      return normalized;
    } catch (cause) {
      throw persistDeliveryFailure(command, cause, this.deliveryAuthority);
    }
  }

  async executeReconcile(request = {}) {
    assertDomainDto(request, 'ReconcileRequest');
    const lifecycle = this.operationLifecycle || currentRuntimeInternalOperationAuthority();
    const accountId = clean(request.accountId);
    const operation = clean(request.operation) || 'sync';
    const requestId = clean(request.requestId || request.correlationId) || sha256({ platform: this.platform, accountId, operation, requestedAt: request.requestedAt || new Date().toISOString() });
    const reconcileOperationType = /sync|history/iu.test(operation) ? 'history.sync' : `media.${operation}`;
    const requestedDeadlineAt = clean(request.deadlineAt);
    const deadlineAt = requestedDeadlineAt || persistedAuthorityDeadlineAt(lifecycle, 'reconcile', this.platform, operation, request.timeoutMs);
    const scheduled = lifecycle.create({
      operationId: clean(request.operationId), operationType: reconcileOperationType, scopeKey: `${this.platform}:${accountId}:${operation}`,
      objectFingerprint: requestId, metadata: { accountId, providerRequestId: requestId }, deadlineAt
    }).operation;
    const created = lifecycle.start(scheduled.operationId, { progress: 5 }).operation;
    const physicalOperationContext = projectPhysicalOperationContext(created, this.platform, accountId);
    if (this.reconcileHandler) {
      try {
        const result = assertDomainDto(await executePortWithDeadline(
          ({ signal, generation }) => this.reconcileHandler({ ...request, platform: this.platform, operationId: created.operationId, operationGeneration: generation, physicalOperationContext, signal }),
          { kind: 'reconcile', platform: this.platform, accountId, operation, operationId: created.operationId, generation: created.generation, deadlineAt: created.deadlineAt, timeoutMs: request.timeoutMs, signal: request.signal }
        ), 'ReconcileResult');
        const normalized = {
          ...result,
          schemaVersion: ADAPTER_SCHEMA_VERSION,
          platform: this.platform,
          accountId,
          operationId: created.operationId,
          operationGeneration: created.generation,
          operationState: 'SUCCEEDED',
          status: clean(result.status) || (result.ok === false ? 'degraded' : 'ready'),
          realtimeBlocked: false,
          reasonCode: clean(result.reasonCode),
          completedAt: clean(result.completedAt) || new Date().toISOString()
        };
        lifecycle.succeed(created.operationId, {
          status: normalized.status, accountId
        }, { generation: created.generation, objectFingerprint: created.objectFingerprint });
        recordOperationalDomainEvent({ platform: this.platform, accountId, eventType: 'reconcile.completed', externalEventId: requestId, idempotencyKey: ['reconcile-completed', this.platform, accountId, requestId].join(':'), correlationId: requestId, projection: normalized, targetRefs: [{ table: 'r32_accounts', id: accountId }] }, this.eventLog);
        if (/sync|history/i.test(operation)) recordOperationalDomainEvent({ platform: this.platform, accountId, eventType: 'history.sync.completed', externalEventId: requestId, idempotencyKey: ['history-sync-completed', this.platform, accountId, requestId].join(':'), correlationId: requestId, projection: normalized, targetRefs: [{ table: 'r32_accounts', id: accountId }] }, this.eventLog);
        return normalized;
      } catch (cause) {
        lifecycle.fail(created.operationId, cause, { generation: created.generation, objectFingerprint: created.objectFingerprint });
        const normalized = {
          schemaVersion: ADAPTER_SCHEMA_VERSION,
          platform: this.platform,
          accountId,
          operationId: created.operationId,
          operationGeneration: created.generation,
          operationState: 'FAILED',
          status: 'degraded',
          realtimeBlocked: false,
          reasonCode: clean(cause.code) || 'RECONCILE_FAILED',
          error: clean(cause.message),
          completedAt: new Date().toISOString()
        };
        recordOperationalDomainEvent({ platform: this.platform, accountId, eventType: 'reconcile.failed', externalEventId: requestId, idempotencyKey: ['reconcile-failed', this.platform, accountId, requestId].join(':'), correlationId: requestId, projection: normalized, targetRefs: [{ table: 'r32_accounts', id: accountId }] }, this.eventLog);
        if (/sync|history/i.test(operation)) recordOperationalDomainEvent({ platform: this.platform, accountId, eventType: 'history.sync.failed', externalEventId: requestId, idempotencyKey: ['history-sync-failed', this.platform, accountId, requestId].join(':'), correlationId: requestId, projection: normalized, targetRefs: [{ table: 'r32_accounts', id: accountId }] }, this.eventLog);
        return normalized;
      }
    }
    const notBound = error('RECONCILE_PORT_NOT_BOUND', 'ReconcilePort 尚未绑定。', 501);
    lifecycle.fail(created.operationId, notBound, { generation: created.generation, objectFingerprint: created.objectFingerprint });
    const normalized = {
      schemaVersion: ADAPTER_SCHEMA_VERSION,
      platform: this.platform,
      accountId,
      operationId: created.operationId,
      operationGeneration: created.generation,
      operationState: 'FAILED',
      status: 'not-configured',
      realtimeBlocked: false,
      reasonCode: 'RECONCILE_PORT_NOT_BOUND',
      completedAt: new Date().toISOString()
    };
    recordOperationalDomainEvent({ platform: this.platform, accountId, eventType: 'reconcile.failed', externalEventId: requestId, idempotencyKey: ['reconcile-failed', this.platform, accountId, requestId].join(':'), correlationId: requestId, projection: normalized, targetRefs: [{ table: 'r32_accounts', id: accountId }] }, this.eventLog);
    return normalized;
  }

  bind(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'authHandler')) this.authHandler = options.authHandler || null;
    if (Object.prototype.hasOwnProperty.call(options, 'egressHandler')) this.egressHandler = options.egressHandler || null;
    if (Object.prototype.hasOwnProperty.call(options, 'egressAuthorizer')) this.egressAuthorizer = options.egressAuthorizer || authorizePersistedOutbox;
    if (Object.prototype.hasOwnProperty.call(options, 'reconcileHandler')) this.reconcileHandler = options.reconcileHandler || null;
    if (Object.prototype.hasOwnProperty.call(options, 'normalizer') && typeof options.normalizer === 'function') this.normalizer = options.normalizer;
    return this.contract();
  }

  contract() {
    return {
      schemaVersion: ADAPTER_SCHEMA_VERSION,
      platform: this.platform,
      ports: [...PORTS],
      bindings: {
        auth: Boolean(this.authHandler),
        ingress: Boolean(this.normalizer && this.eventLog),
        egress: Boolean(this.egressHandler || this.egressAuthorizer),
        reconcile: Boolean(this.reconcileHandler)
      },
      boundaries: {
        ingressProducesDomainEventsOnly: true,
        egressConsumesOutboxOnly: true,
        egressRequiresPersistedAttempt: true,
        reconcileDoesNotBlockRealtime: true,
        uiObjectsForbidden: true,
        expressObjectsForbidden: true,
        sqliteRowsForbidden: true
      }
    };
  }
}

class PlatformAdapterRegistryV2 {
  constructor(options = {}) {
    this.adapters = new Map();
    for (const platform of PLATFORMS) this.register(new PlatformAdapterFacade(platform, options[platform] || {}));
  }
  register(adapter) {
    if (!(adapter instanceof PlatformAdapterFacade)) throw error('PLATFORM_ADAPTER_INVALID', '只能注册四端口平台适配器。');
    this.adapters.set(adapter.platform, adapter);
    return adapter.contract();
  }
  bind(platform, options = {}) { return this.get(platform).bind(options); }
  get(platform) {
    const id = requirePlatform(platform);
    const adapter = this.adapters.get(id);
    if (!adapter) throw error('PLATFORM_ADAPTER_NOT_REGISTERED', `平台适配器未注册：${id}`, 500);
    return adapter;
  }
  contracts() { return Object.fromEntries([...this.adapters].map(([id, adapter]) => [id, adapter.contract()])); }
  executeAuth(input) { return this.get(input?.platform).auth.execute(input); }
  executeEgress(command, persistedContext) { return this.get(command?.platform).egress.execute(command, persistedContext); }
  ingest(input) { return this.get(input?.platform).ingress.ingest(input); }
  reconcile(input) { return this.get(input?.platform).reconcile.execute(input); }
}

const defaultAuthHandler = createAccountManagerAuthHandler();
const defaultReconcileHandler = createAccountManagerReconcileHandler();
const singleton = new PlatformAdapterRegistryV2(Object.fromEntries(PLATFORMS.map(platform => [platform, {
  authHandler: defaultAuthHandler,
  reconcileHandler: defaultReconcileHandler
}])));
module.exports = {
  ADAPTER_SCHEMA_VERSION, PORTS, PLATFORMS, PlatformAdapterFacade, PlatformAdapterRegistryV2,
  singleton, defaultNormalizer, assertDomainDto, authorizePersistedOutbox, normalizeSendResult, sanitizePortValue,
  createAccountManagerAuthHandler, createAccountManagerReconcileHandler, executeEgressWithDeadline,
  executePortWithDeadline, portDeadlineMs, persistedAuthorityDeadlineAt, projectPhysicalOperationContext, validatePersistedEgressContext
};
