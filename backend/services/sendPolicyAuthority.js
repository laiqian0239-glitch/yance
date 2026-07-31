'use strict';

const crypto = require('crypto');
const accountStore = require('./accountStore');
const capabilityAuthority = require('./platformCapabilityAuthority');
const { stableId } = require('../lib/r32SqliteStore');
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');
const { canonical, sha256 } = require('./domainEventLogService');
const aiQualityRouteAuthority = require('./aiQualityRouteAuthority');
const { capabilityIdForCommand } = require('./platformDeliveryAuthority');

const AUTHORITY = 'SendPolicyAuthority';
const SCHEMA_VERSION = 1;
const POLICY_VERSION = 'round12-send-policy-v1';

const PLATFORM_POLICY = Object.freeze({
  whatsapp: Object.freeze({ typing: 'when-supported', segmentationLimit: 1200, minDelayMs: 450, maxDelayMs: 1200, retryBudget: 6, retryable: ['429','NETWORK','TIMEOUT','NOT_CONNECTED'] }),
  telegram: Object.freeze({ typing: 'when-supported', segmentationLimit: 3500, minDelayMs: 100, maxDelayMs: 350, retryBudget: 5, retryable: ['429','NETWORK','TIMEOUT','FLOOD_WAIT','NOT_CONNECTED'] }),
  facebook: Object.freeze({ typing: 'when-supported', segmentationLimit: 1800, minDelayMs: 250, maxDelayMs: 700, retryBudget: 4, retryable: ['429','NETWORK','TIMEOUT','TOKEN_REFRESH','NOT_CONNECTED'] })
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }
function error(code, message, status = 409, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }
function capabilityIdFor(input = {}) {
  return capabilityIdForCommand(input);
}

function policyDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    policyVersion: POLICY_VERSION,
    contentMutationAfterApproval: false,
    translationRetryAfterApproval: false,
    idempotencyRequired: true,
    outboxRequired: true,
    platforms: PLATFORM_POLICY
  };
}
function defaultAccountStateProvider() {
  try {
    const manager = require('./accountManager');
    const state = manager.list();
    if (Array.isArray(state?.accounts)) return state.accounts;
  } catch (_) {}
  return accountStore.list();
}
function accountProjection(platform, accountId, _input = {}, accountStateProvider = defaultAccountStateProvider) {
  const rows = accountStateProvider();
  const found = (Array.isArray(rows) ? rows : []).find(row => clean(row.id) === accountId || clean(row.adapterAccountId) === accountId);
  if (found) {
    if (clean(found.platform).toLowerCase() !== platform) {
      throw error('ACCOUNT_PLATFORM_MISMATCH', '发送账号与请求平台不一致。', 409, { accountId, expectedPlatform: platform, actualPlatform: clean(found.platform).toLowerCase() });
    }
    return found;
  }
  throw error('ACCOUNT_NOT_CONFIGURED', '发送账号尚未配置或无法读取实时状态。', 404, { accountId, platform });
}
function publicObservation(observation = {}) {
  return {
    schemaVersion: Number(observation.schemaVersion || 1), authority: observation.authority || capabilityAuthority.AUTHORITY,
    scopeType: observation.scopeType, scopeId: observation.scopeId, platform: observation.platform, accountId: observation.accountId,
    capabilityId: observation.capabilityId, legacyId: observation.legacyId, support: observation.support,
    availability: observation.availability, enabled: observation.enabled === true, degraded: observation.degraded === true,
    reasonCode: observation.reasonCode || '', reason: observation.reason || '', constraints: observation.constraints || [],
    evidence: observation.evidence || {}
  };
}

class SendPolicyAuthority {
  constructor(options = {}) {
    this.repository = options.repository || defaultRepository;
    this.accountStateProvider = options.accountStateProvider || defaultAccountStateProvider;
  }

  ensureActivePolicy() {
    const active = this.repository.getActiveSendPolicy();
    if (active?.policy_version === POLICY_VERSION) return active;
    const timestamp = now();
    const policy = policyDocument();
    const policySha256 = sha256(policy);
    this.repository.upsertSendPolicy({
      policyVersion: POLICY_VERSION, policy, policySha256, state: 'candidate', createdBy: 'system', createdAt: timestamp, activatedAt: ''
    });
    return this.repository.activateSendPolicy(POLICY_VERSION, timestamp);
  }

  capabilitySnapshot(input = {}) {
    const platform = clean(input.platform).toLowerCase();
    const accountId = clean(input.accountId);
    if (!platform || !accountId) throw error('SEND_POLICY_SCOPE_INCOMPLETE', '发送策略缺少平台或账号。', 400);
    const account = accountProjection(platform, accountId, input, this.accountStateProvider);
    const capabilityId = capabilityIdFor(input);
    const observation = publicObservation(capabilityAuthority.decision({ accounts: [account] }, { platform, accountId, capabilityId }));
    observation.evidence = { ...(observation.evidence || {}), compatibilityProjection: account.compatibilityProjection === true };
    const observedAt = now();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const snapshotId = stableId('capability-snapshot', [platform, accountId, capabilityId, observation.support, observation.availability, observedAt]);
    this.repository.insertCapabilityObservation({
      observationId: snapshotId, authority: observation.authority, scopeType: observation.scopeType, scopeId: observation.scopeId,
      platform, accountId, capabilityId, support: observation.support, availability: observation.availability,
      reasonCode: observation.reasonCode, constraints: observation.constraints, evidence: observation.evidence, observedAt, expiresAt
    });
    const health = observation.availability === capabilityAuthority.AVAILABILITY.READY ? 'ready'
      : observation.availability === capabilityAuthority.AVAILABILITY.DEGRADED ? 'degraded'
        : observation.availability === capabilityAuthority.AVAILABILITY.ONBOARDING ? 'onboarding' : 'blocked';
    this.repository.insertHealthState({
      healthStateId: stableId('platform-health', [platform, accountId, observedAt]), scopeType: 'account', scopeId: `${platform}:${accountId}`,
      platform, accountId, health, reasonCode: observation.reasonCode,
      nextAction: health === 'onboarding' ? 'COMPLETE_AUTHENTICATION' : health === 'blocked' ? 'REPAIR_ACCOUNT_CAPABILITY' : '',
      capabilitySnapshotId: snapshotId, evidence: { capabilityId, observation }, observedAt, expiresAt
    });
    return { snapshotId, observedAt, expiresAt, observation };
  }

  resolve(input = {}) {
    const active = this.ensureActivePolicy();
    const platform = clean(input.platform).toLowerCase();
    const platformPolicy = PLATFORM_POLICY[platform];
    if (!platformPolicy) throw error('SEND_POLICY_PLATFORM_UNSUPPORTED', `发送策略不支持平台：${platform || 'unknown'}`, 409);
    const capability = this.capabilitySnapshot(input);
    const unavailable = new Set([
      capabilityAuthority.AVAILABILITY.BLOCKED, capabilityAuthority.AVAILABILITY.ONBOARDING,
      capabilityAuthority.AVAILABILITY.NOT_CONFIGURED, capabilityAuthority.AVAILABILITY.UNSUPPORTED,
      capabilityAuthority.AVAILABILITY.UNKNOWN
    ]);
    if (unavailable.has(capability.observation.availability) || capability.observation.enabled !== true) {
      throw error(capability.observation.reasonCode || 'SEND_CAPABILITY_UNAVAILABLE', '当前账号不具备所需发送能力。', 409, { capabilitySnapshot: capability });
    }
    const requestedRetryBudget = input.retryBudget == null ? platformPolicy.retryBudget : Number(input.retryBudget);
    if (!Number.isInteger(requestedRetryBudget) || requestedRetryBudget < 0 || requestedRetryBudget > platformPolicy.retryBudget) {
      throw error('SEND_POLICY_RETRY_BUDGET_INVALID', `重试预算必须是 0 到 ${platformPolicy.retryBudget} 的整数。`, 400, { retryBudget: input.retryBudget, maximum: platformPolicy.retryBudget });
    }
    const policy = {
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      policyVersion: active.policy_version,
      platform,
      capabilityId: capability.observation.capabilityId,
      typing: platformPolicy.typing,
      segmentationLimit: platformPolicy.segmentationLimit,
      minDelayMs: platformPolicy.minDelayMs,
      maxDelayMs: platformPolicy.maxDelayMs,
      retryBudget: requestedRetryBudget,
      retryable: [...platformPolicy.retryable],
      contentFrozen: true,
      retranslateOnRetry: false,
      idempotencyRequired: true,
      capabilitySnapshotId: capability.snapshotId,
      degraded: capability.observation.degraded === true
    };
    return { policy, policySha256: sha256(policy), capabilitySnapshot: capability };
  }

  freezeOutboxCommand(input = {}) {
    const idempotencyKey = clean(input.idempotencyKey);
    const accountId = clean(input.accountId);
    const sessionKey = clean(input.sessionKey);
    const platform = clean(input.platform).toLowerCase();
    if (!idempotencyKey || !accountId || !sessionKey || !platform) throw error('OUTBOX_COMMAND_INCOMPLETE', 'OutboxCommand 缺少幂等键、平台、账号或会话。', 400);
    const operation = clean(input.operation || 'text').toLowerCase();
    const allowedOperations = new Set(['text', 'media', 'reaction', 'revoke', 'native_expression']);
    if (!allowedOperations.has(operation)) throw error('OUTBOX_COMMAND_OPERATION_UNSUPPORTED', `OutboxCommand 不支持操作：${operation || 'unknown'}`, 400);
    const finalText = clean(input.finalText);
    const chatJid = clean(input.chatJid);
    if (!chatJid) throw error('OUTBOX_COMMAND_TARGET_REQUIRED', 'OutboxCommand 缺少明确的平台会话目标。', 400);
    if (operation === 'text' && !finalText) throw error('OUTBOX_COMMAND_TEXT_EMPTY', '文本 OutboxCommand 不能冻结空内容。', 400);
    const mediaReferences = Array.isArray(input.mediaReferences) ? input.mediaReferences : [];
    const actionPayload = input.actionPayload && typeof input.actionPayload === 'object' && !Array.isArray(input.actionPayload) ? input.actionPayload : {};
    if (operation === 'media') {
      const media = mediaReferences[0];
      if (!media || !clean(media.path) || !clean(media.sha256)) throw error('OUTBOX_COMMAND_MEDIA_REFERENCE_INVALID', '媒体 OutboxCommand 必须绑定路径和内容哈希。', 400);
    }
    if (operation === 'reaction' && (!clean(actionPayload.targetId) || !clean(actionPayload.emoji))) {
      throw error('OUTBOX_COMMAND_REACTION_INVALID', 'Reaction OutboxCommand 必须绑定目标消息和表情。', 400);
    }
    if (operation === 'revoke' && !clean(actionPayload.targetId)) throw error('OUTBOX_COMMAND_REVOKE_INVALID', 'Revoke OutboxCommand 必须绑定目标消息。', 400);
    if (operation === 'native_expression' && (!clean(actionPayload.reference) || !clean(actionPayload.kind || input.kind))) {
      throw error('OUTBOX_COMMAND_NATIVE_EXPRESSION_INVALID', '原生表达 OutboxCommand 必须绑定引用和类型。', 400);
    }
    const resolved = this.resolve({ ...input, platform, accountId, operation, kind: input.kind });
    const finalTextSha256 = finalText ? sha256(finalText) : '';
    const approvalReceiptId = clean(input.approvalReceiptId) || stableId('send-approval', [idempotencyKey, finalTextSha256]);
    const suppliedRouteReceipt = input.qualityRouteReceipt && typeof input.qualityRouteReceipt === 'object' && !Array.isArray(input.qualityRouteReceipt)
      ? input.qualityRouteReceipt
      : {};
    let routeReceipt = suppliedRouteReceipt;
    let learningEligible = false;
    let emergencyMode = input.emergencyMode === true;
    let qualityTier = emergencyMode ? 'emergency' : 'manual';
    if (Object.keys(suppliedRouteReceipt).length) {
      try {
        const task = clean(suppliedRouteReceipt.task) || 'quick_reply';
        const verifiedRoute = aiQualityRouteAuthority.verifyRouteReceipt(suppliedRouteReceipt, {
          task, requireLearningEligible: false, allowEmergency: true, enforceMinimumTier: false
        });
        qualityTier = verifiedRoute.qualityTier;
        emergencyMode = verifiedRoute.emergencyMode === true;
        let routeLearningEligible = false;
        try {
          aiQualityRouteAuthority.verifyRouteReceipt(suppliedRouteReceipt, { task });
          routeLearningEligible = true;
        } catch (eligibilityError) {
          const allowed = new Set([
            'AI_QUALITY_ROUTE_RECEIPT_EMERGENCY_NOT_ALLOWED',
            'AI_QUALITY_ROUTE_RECEIPT_LEARNING_INELIGIBLE',
            'AI_QUALITY_ROUTE_RECEIPT_TIER_INSUFFICIENT'
          ]);
          if (!allowed.has(clean(eligibilityError.code))) throw eligibilityError;
        }
        learningEligible = input.learningEligible !== false && routeLearningEligible && !emergencyMode;
      } catch (cause) {
        throw error(clean(cause.code) || 'AI_QUALITY_ROUTE_RECEIPT_INVALID', '外发命令携带了无法验证的 AI 质量路由回执；任何兼容或强制标志都不能绕过。', 409, { cause: clean(cause.message) });
      }
    }
    if (emergencyMode) {
      qualityTier = 'emergency';
      learningEligible = false;
    }
    const approvedAt = clean(input.approvedAt) || now();
    const approvedAtMs = Date.parse(approvedAt);
    if (!Number.isFinite(approvedAtMs) || approvedAtMs > Date.now() + 5 * 60 * 1000) {
      throw error('OUTBOX_COMMAND_APPROVAL_TIMESTAMP_INVALID', 'OutboxCommand 批准时间无效或来自未来。', 400, { approvedAt });
    }
    const command = {
      schemaVersion: SCHEMA_VERSION,
      commandType: 'OutboxCommand',
      commandId: clean(input.commandId) || stableId('outbox-command', [idempotencyKey]),
      outboxId: clean(input.outboxId) || clean(input.commandId) || stableId('outbox-command', [idempotencyKey]),
      idempotencyKey,
      platform,
      accountId,
      sessionKey,
      conversationTarget: chatJid,
      operation,
      messageType: clean(input.messageType || input.kind || operation),
      finalText,
      finalTextSha256,
      targetLanguage: clean(input.targetLanguage),
      mediaReferences,
      replyReference: input.replyReference || null,
      actionPayload,
      approvalReceiptId,
      approvedAt,
      sendPolicyVersion: resolved.policy.policyVersion,
      sendPolicySha256: resolved.policySha256,
      capabilitySnapshotId: resolved.capabilitySnapshot.snapshotId,
      qualityTier,
      emergencyMode,
      learningEligible,
      qualityRouteReceipt: routeReceipt,
      contentFrozen: true,
      retranslateOnRetry: false
    };
    const commandSha256 = sha256(command);
    return {
      authority: AUTHORITY,
      command: { ...command, commandSha256 },
      queueMetadata: {
        outboxId: command.outboxId,
        sendPolicy: resolved.policy,
        sendPolicySha256: command.sendPolicySha256,
        capabilitySnapshotId: command.capabilitySnapshotId,
        qualityTier: command.qualityTier,
        emergencyMode: command.emergencyMode,
        approvalReceiptId,
        finalTextSha256,
        targetLanguage: command.targetLanguage,
        learningEligible: command.learningEligible,
        qualityRouteReceipt: command.qualityRouteReceipt
      },
      capabilitySnapshot: resolved.capabilitySnapshot
    };
  }

  authorizeExecution(command = {}) {
    const frozen = this.verifyFrozenCommand(command);
    const policyVersion = clean(command.sendPolicyVersion);
    const policy = policyVersion ? this.repository.getSendPolicyVersion?.(policyVersion) : null;
    if (!policy || clean(policy.policy_version) !== policyVersion || !clean(policy.policy_sha256)) {
      throw error('SEND_POLICY_VERSION_NOT_FOUND', 'OutboxCommand 绑定的发送策略版本不存在。', 409, { policyVersion });
    }
    const expectedPolicyHash = sha256(policy.policy || {});
    if (clean(policy.policy_sha256) !== expectedPolicyHash) {
      throw error('SEND_POLICY_VERSION_TAMPERED', '发送策略版本内容与登记哈希不一致。', 409, { policyVersion });
    }
    const snapshotId = clean(command.capabilitySnapshotId);
    const snapshot = snapshotId ? this.repository.getCapabilityObservation?.(snapshotId) : null;
    if (!snapshot) throw error('CAPABILITY_SNAPSHOT_NOT_FOUND', 'OutboxCommand 绑定的平台能力快照不存在。', 409, { snapshotId });
    const expectedCapabilityId = capabilityIdFor(command);
    if (clean(snapshot.platform).toLowerCase() !== clean(command.platform).toLowerCase()
      || clean(snapshot.account_id) !== clean(command.accountId)
      || clean(snapshot.capability_id) !== expectedCapabilityId) {
      throw error('CAPABILITY_SNAPSHOT_SCOPE_MISMATCH', '平台能力快照与 OutboxCommand 的平台、账号或操作不一致。', 409, {
        snapshotId, expectedCapabilityId, actualCapabilityId: clean(snapshot.capability_id)
      });
    }
    const approvedAvailability = clean(snapshot.availability);
    if (![capabilityAuthority.AVAILABILITY.READY, capabilityAuthority.AVAILABILITY.DEGRADED].includes(approvedAvailability)) {
      throw error(clean(snapshot.reason_code) || 'CAPABILITY_SNAPSHOT_NOT_SENDABLE', '批准时的平台能力快照不允许发送。', 409, { snapshotId, approvedAvailability });
    }
    const account = accountProjection(clean(command.platform).toLowerCase(), clean(command.accountId), {}, this.accountStateProvider);
    const liveObservation = publicObservation(capabilityAuthority.decision({ accounts: [account] }, {
      platform: clean(command.platform).toLowerCase(), accountId: clean(command.accountId), capabilityId: expectedCapabilityId
    }));
    const unavailable = new Set([
      capabilityAuthority.AVAILABILITY.BLOCKED, capabilityAuthority.AVAILABILITY.ONBOARDING,
      capabilityAuthority.AVAILABILITY.NOT_CONFIGURED, capabilityAuthority.AVAILABILITY.UNSUPPORTED,
      capabilityAuthority.AVAILABILITY.UNKNOWN
    ]);
    if (unavailable.has(liveObservation.availability) || liveObservation.enabled !== true) {
      throw error(liveObservation.reasonCode || 'SEND_CAPABILITY_UNAVAILABLE', '执行发送时账号能力已不可用，已阻止平台调用。', 409, {
        snapshotId, liveObservation
      });
    }
    const expiresAtMs = Date.parse(clean(snapshot.expires_at));
    if (!Number.isFinite(expiresAtMs)) throw error('CAPABILITY_SNAPSHOT_EXPIRY_INVALID', '平台能力快照缺少有效过期时间。', 409, { snapshotId, expiresAt: clean(snapshot.expires_at) });
    let executionSnapshotId = snapshotId;
    let capabilitySnapshotExpired = false;
    if (expiresAtMs <= Date.now()) {
      capabilitySnapshotExpired = true;
      const refreshed = this.capabilitySnapshot({
        platform: clean(command.platform).toLowerCase(), accountId: clean(command.accountId),
        operation: clean(command.operation), kind: clean(command.messageType)
      });
      const refreshedAvailability = clean(refreshed.observation?.availability);
      if (![capabilityAuthority.AVAILABILITY.READY, capabilityAuthority.AVAILABILITY.DEGRADED].includes(refreshedAvailability)
        || refreshed.observation?.enabled !== true) {
        throw error(clean(refreshed.observation?.reasonCode) || 'SEND_CAPABILITY_UNAVAILABLE', '批准快照已过期，实时能力复检仍不可发送。', 409, {
          snapshotId, refreshedSnapshotId: refreshed.snapshotId, refreshedObservation: refreshed.observation
        });
      }
      executionSnapshotId = refreshed.snapshotId;
    }
    return {
      ...frozen,
      authorized: true,
      policyVersion,
      capabilitySnapshotId: snapshotId,
      executionCapabilitySnapshotId: executionSnapshotId,
      capabilitySnapshotExpired,
      approvedAvailability,
      liveObservation
    };
  }

  verifyFrozenCommand(command = {}) {
    if (clean(command.commandType) !== 'OutboxCommand' || command.contentFrozen !== true) {
      throw error('OUTBOX_COMMAND_UNFROZEN', '外发命令未冻结，已阻止发送。', 409);
    }
    if (!clean(command.sendPolicyVersion) || !clean(command.sendPolicySha256) || !clean(command.capabilitySnapshotId)) {
      throw error('OUTBOX_COMMAND_POLICY_BINDING_MISSING', 'OutboxCommand 缺少发送策略或能力快照哈希绑定。', 409, { commandId: clean(command.commandId) });
    }
    const expected = clean(command.finalTextSha256);
    const actual = clean(command.finalText) ? sha256(clean(command.finalText)) : '';
    if (expected !== actual) throw error('OUTBOX_COMMAND_CONTENT_MUTATED', '用户确认后的外发内容发生变化，已阻止发送。', 409, { expected, actual, commandId: clean(command.commandId) });
    const { commandSha256, ...unsigned } = command;
    const actualCommandSha256 = sha256(unsigned);
    if (!clean(commandSha256) || clean(commandSha256) !== actualCommandSha256) {
      throw error('OUTBOX_COMMAND_ENVELOPE_MUTATED', 'OutboxCommand 结构或策略绑定发生变化，已阻止发送。', 409, { expected: clean(commandSha256), actual: actualCommandSha256, commandId: clean(command.commandId) });
    }
    return { ok: true, commandId: clean(command.commandId), finalTextSha256: actual, commandSha256: actualCommandSha256 };
  }
}

const singleton = new SendPolicyAuthority();
module.exports = { AUTHORITY, SCHEMA_VERSION, POLICY_VERSION, PLATFORM_POLICY, SendPolicyAuthority, singleton, capabilityIdFor, policyDocument };
