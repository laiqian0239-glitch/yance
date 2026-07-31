'use strict';

const crypto = require('crypto');
const { stableId } = require('../lib/r32SqliteStore');
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');

const AUTHORITY = 'PlatformDeliveryAckAuthority';
const SCHEMA_VERSION = 1;
const ACK_TTL_MS = 24 * 60 * 60 * 1000;

function clean(value) { return String(value == null ? '' : value).trim(); }
function now() { return new Date().toISOString(); }
function safeIso(value, fallback = now()) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}
function safeObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function isEmojiOnly(value) {
  const source = String(value == null ? '' : value).replace(/\s/gu, '');
  if (!source) return false;
  const residue = source
    .replace(/[0-9#*]\uFE0F?\u20E3/gu, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\p{Regional_Indicator}/gu, '')
    .replace(/[\u200D\uFE0E\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]/gu, '');
  return residue.length === 0;
}

function mediaKind(command = {}) {
  const first = Array.isArray(command.mediaReferences) ? command.mediaReferences[0] : null;
  return clean(first?.kind || command.messageType || command.actionPayload?.kind || 'file').toLowerCase();
}

function capabilityIdForCommand(command = {}) {
  const operation = clean(command.operation || command.messageType || 'text').toLowerCase();
  if (operation === 'text') return isEmojiOnly(command.finalText) ? 'message.emoji.send' : 'message.text.send';
  if (operation === 'reaction') return 'message.reaction.send';
  if (operation === 'revoke') return 'message.revoke';
  if (operation === 'native_expression') {
    const kind = mediaKind(command);
    return kind === 'sticker' ? 'message.media.sticker.send' : 'message.media.gif.send';
  }
  const kind = mediaKind(command);
  const mapping = {
    image: 'message.media.image.send',
    video: 'message.media.video.send',
    gif: 'message.media.gif.send',
    sticker: 'message.media.sticker.send',
    animated_sticker: 'message.media.animated_sticker.send',
    voice: 'message.media.voice.send',
    audio: 'message.media.voice.send',
    file: 'message.media.file.send',
    document: 'message.media.file.send'
  };
  return mapping[kind] || 'message.media.file.send';
}

function publicObservation(row) {
  if (!row) return null;
  return {
    observationId: clean(row.observation_id),
    authority: clean(row.authority),
    platform: clean(row.platform),
    accountId: clean(row.account_id),
    capabilityId: clean(row.capability_id),
    support: clean(row.support),
    availability: clean(row.availability),
    reasonCode: clean(row.reason_code),
    constraints: Array.isArray(row.constraints) ? row.constraints : [],
    evidence: safeObject(row.evidence),
    observedAt: clean(row.observed_at),
    expiresAt: clean(row.expires_at)
  };
}

class PlatformDeliveryAuthority {
  constructor(options = {}) {
    this.repository = options.repository || defaultRepository;
    this.clock = typeof options.clock === 'function' ? options.clock : () => new Date();
  }

  record(command = {}, outcome = {}) {
    const platform = clean(command.platform).toLowerCase();
    const accountId = clean(command.accountId);
    const commandId = clean(command.commandId || command.outboxId || command.idempotencyKey);
    if (!platform || !accountId || !commandId) {
      const error = new Error('平台 ACK 证据缺少平台、账号或命令标识。');
      error.code = 'PLATFORM_ACK_SCOPE_INCOMPLETE';
      throw error;
    }
    const capabilityId = capabilityIdForCommand(command);
    const success = outcome.success === true;
    const observedAt = safeIso(outcome.observedAt, this.clock().toISOString());
    const expiresAt = new Date(Date.parse(observedAt) + ACK_TTL_MS).toISOString();
    const platformMessageId = clean(outcome.platformMessageId || outcome.messageId);
    if (success && ['message.text.send', 'message.emoji.send'].includes(capabilityId) && !platformMessageId) {
      const error = new Error('平台 ACK 缺少可对账消息标识。');
      error.code = 'PLATFORM_ACK_MESSAGE_ID_REQUIRED';
      throw error;
    }
    const ackStatus = success ? clean(outcome.ackStatus) || 'accepted' : 'rejected';
    const reasonCode = success ? '' : clean(outcome.reasonCode || outcome.code) || 'PLATFORM_SEND_FAILED';
    const nonce = crypto.randomUUID();
    const observationId = stableId('delivery-ack', [platform, accountId, capabilityId, commandId, observedAt, ackStatus, nonce]);
    const scopeId = [platform, accountId, capabilityId].join(':');
    const evidence = {
      evidenceType: 'real-platform-ack',
      commandId,
      outboxId: clean(command.outboxId),
      idempotencyKey: clean(command.idempotencyKey),
      operation: clean(command.operation),
      payloadClass: capabilityId,
      ackType: clean(outcome.ackType) || (success ? 'provider-message-id' : 'provider-error'),
      ackStatus,
      platformMessageId,
      providerRequestId: clean(outcome.providerRequestId || outcome.requestId),
      providerAcceptedAt: safeIso(outcome.providerAcceptedAt || outcome.completedAt || observedAt, observedAt),
      errorMessage: success ? '' : clean(outcome.errorMessage || outcome.message).slice(0, 500),
      source: 'PlatformAdapterFacade.executeEgress',
      schemaVersion: SCHEMA_VERSION
    };
    const observation = this.repository.insertCapabilityObservation({
      observationId,
      authority: AUTHORITY,
      scopeType: 'capability',
      scopeId,
      platform,
      accountId,
      capabilityId,
      support: success ? 'supported' : 'constrained',
      availability: success ? 'ready' : 'blocked',
      reasonCode,
      constraints: [{ payloadClass: capabilityId, operation: clean(command.operation) }],
      evidence,
      observedAt,
      expiresAt
    });
    if (!observation) {
      const error = new Error('平台 ACK 证据未能写入能力权威。');
      error.code = 'PLATFORM_ACK_EVIDENCE_NOT_PERSISTED';
      throw error;
    }
    // Payload-class truth is authoritative at capability scope. An emoji-only
    // or media failure must never downgrade the whole account or overwrite a
    // verified text-send ACK. Account health is updated only by text delivery.
    this.repository.insertHealthState({
      healthStateId: stableId('delivery-capability-health', [platform, accountId, capabilityId, commandId, observedAt, nonce]),
      scopeType: 'capability',
      scopeId,
      platform,
      accountId,
      health: success ? 'ready' : 'blocked',
      reasonCode,
      nextAction: success ? '' : 'REPAIR_PAYLOAD_CAPABILITY',
      capabilitySnapshotId: observationId,
      evidence: { capabilityId, commandId, ackStatus, platformMessageId },
      observedAt,
      expiresAt
    });
    if (capabilityId === 'message.text.send') {
      this.repository.insertHealthState({
        healthStateId: stableId('delivery-account-health', [platform, accountId, commandId, observedAt, nonce]),
        scopeType: 'account',
        scopeId: `${platform}:${accountId}`,
        platform,
        accountId,
        health: success ? 'ready' : 'blocked',
        reasonCode,
        nextAction: success ? '' : 'REPAIR_TEXT_DELIVERY',
        capabilitySnapshotId: observationId,
        evidence: { capabilityId, commandId, ackStatus, platformMessageId },
        observedAt,
        expiresAt
      });
    }
    return publicObservation(observation);
  }

  recordSuccess(command = {}, result = {}) {
    return this.record(command, { ...result, success: true });
  }

  recordFailure(command = {}, cause = {}) {
    return this.record(command, {
      success: false,
      reasonCode: clean(cause.reasonCode || cause.code),
      errorMessage: clean(cause.message || cause.error),
      ackType: clean(cause.ackType) || 'provider-error',
      providerRequestId: clean(cause.providerRequestId || cause.requestId),
      observedAt: clean(cause.observedAt)
    });
  }

  latest(input = {}) {
    const row = this.repository.latestCapabilityObservation({
      authority: AUTHORITY,
      platform: clean(input.platform).toLowerCase(),
      accountId: clean(input.accountId),
      capabilityId: clean(input.capabilityId)
    });
    return publicObservation(row);
  }

  accountTruth(input = {}) {
    const platform = clean(input.platform).toLowerCase();
    const accountId = clean(input.accountId);
    if (!platform || !accountId) return { authority: AUTHORITY, platform, accountId, sendVerified: false, status: 'unknown', capabilities: {} };
    let rows = [];
    try {
      rows = this.repository.listCapabilityObservations({ authority: AUTHORITY, platform, accountId, limit: 200 });
    } catch (_) {
      return { authority: AUTHORITY, platform, accountId, sendVerified: false, status: 'unavailable', reasonCode: 'ACK_AUTHORITY_UNAVAILABLE', capabilities: {} };
    }
    const capabilities = {};
    for (const row of rows) {
      const id = clean(row.capability_id);
      if (!id || capabilities[id]) continue;
      capabilities[id] = publicObservation(row);
    }
    const text = capabilities['message.text.send'] || null;
    const textFresh = Boolean(text && (!text.expiresAt || Date.parse(text.expiresAt) > this.clock().getTime()));
    const sendVerified = Boolean(textFresh && text.availability === 'ready' && text.evidence?.ackStatus === 'accepted' && text.evidence?.platformMessageId);
    const latestRows = Object.values(capabilities).sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0));
    const latest = latestRows[0] || null;
    return {
      authority: AUTHORITY,
      schemaVersion: SCHEMA_VERSION,
      platform,
      accountId,
      sendVerified,
      status: sendVerified ? 'verified' : latest?.availability === 'blocked' ? 'failed' : 'unverified',
      reasonCode: latest?.reasonCode || (sendVerified ? '' : 'REAL_PLATFORM_ACK_REQUIRED'),
      lastAckAt: sendVerified ? text.observedAt : '',
      latest,
      capabilities
    };
  }
}

const singleton = new PlatformDeliveryAuthority();

module.exports = {
  AUTHORITY,
  SCHEMA_VERSION,
  ACK_TTL_MS,
  isEmojiOnly,
  capabilityIdForCommand,
  PlatformDeliveryAuthority,
  singleton
};
