'use strict';

const platformAdapters = require('./platformAdapterPorts');
const accountStore = require('./accountStore');
const communicationAuthority = require('./communicationAuthority');
const channelAdapterContract = require('./channelAdapterContract');
const { deepFreeze } = require('../lib/deepFreeze');

const PLATFORMS = Object.freeze(['whatsapp', 'telegram', 'facebook']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function clean(value) { return String(value == null ? '' : value).trim(); }
function fail(code, message, status = 400, details = {}) { return Object.assign(new Error(message), { code, status, ...details }); }
function requirePlatform(value) {
  const platform = clean(value).toLowerCase();
  if (!PLATFORMS.includes(platform)) throw fail('CHANNEL_ADAPTER_PLATFORM_UNSUPPORTED', `Unsupported channel adapter: ${platform || 'unknown'}`, 404);
  return platform;
}
function plain(input, name) {
  channelAdapterContract.assertPlainData(input || {});
  return input || {};
}
function requiredPhysicalString(value, field, maximum = 2048) {
  const result = clean(value);
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw fail('WP_B_CHANNEL_PHYSICAL_IDENTITY_REQUIRED', `Physical channel field ${field} is required`, 409, { field });
  }
  return result;
}
function requiredPhysicalInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw fail('WP_B_CHANNEL_PHYSICAL_IDENTITY_REQUIRED', `Physical channel field ${field} is required`, 409, { field });
  }
  return result;
}
function validatePhysicalEnvelope(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Object.isFrozen(input)) {
    throw fail('WP_B_CHANNEL_PHYSICAL_IDENTITY_REQUIRED', 'Physical channel attempt envelope must be frozen', 409);
  }
  const requestContentSha256 = requiredPhysicalString(input.requestContentSha256, 'requestContentSha256', 64);
  if (!SHA256_PATTERN.test(requestContentSha256)) {
    throw fail('WP_B_CHANNEL_PHYSICAL_IDENTITY_REQUIRED', 'Physical channel requestContentSha256 is invalid', 409, { field: 'requestContentSha256' });
  }
  if (!input.command || typeof input.command !== 'object' || !Object.isFrozen(input.command)
      || !input.credential || typeof input.credential !== 'object' || !Object.isFrozen(input.credential)) {
    throw fail('WP_B_CHANNEL_PHYSICAL_IDENTITY_REQUIRED', 'Physical channel custody capabilities must be frozen', 409);
  }
  return Object.freeze({
    executionId: requiredPhysicalString(input.executionId, 'executionId'),
    intentId: requiredPhysicalString(input.intentId, 'intentId'),
    attemptId: requiredPhysicalString(input.attemptId, 'attemptId'),
    claimId: requiredPhysicalString(input.claimId, 'claimId'),
    ownerId: requiredPhysicalString(input.ownerId, 'ownerId'),
    generation: requiredPhysicalInteger(input.generation, 'generation'),
    hostGeneration: requiredPhysicalInteger(input.hostGeneration, 'hostGeneration'),
    fencingToken: requiredPhysicalInteger(input.fencingToken, 'fencingToken'),
    idempotencyKey: requiredPhysicalString(input.idempotencyKey, 'idempotencyKey'),
    requestContentSha256,
    platform: clean(input.platform).toLowerCase(),
    accountReference: clean(input.accountReference),
    providerRequestId: clean(input.providerRequestId),
    platformMessageId: clean(input.platformMessageId),
    command: input.command,
    credential: input.credential
  });
}
function persistedAttemptContext(attempt, platform) {
  return Object.freeze({
    executionId: attempt.executionId,
    intentId: attempt.intentId,
    attemptId: attempt.attemptId,
    claimId: attempt.claimId,
    ownerId: attempt.ownerId,
    generation: attempt.generation,
    hostGeneration: attempt.hostGeneration,
    fencingToken: attempt.fencingToken,
    idempotencyKey: attempt.idempotencyKey,
    requestContentSha256: attempt.requestContentSha256,
    platform,
    accountReference: attempt.accountReference
  });
}
function accountProjection(platform, accountId, row = {}) {
  if (!row) return null;
  return {
    platform,
    accountId: clean(row.id || accountId),
    displayName: clean(row.displayName || row.display_name || row.identityLabel || row.identity_label),
    state: clean(row.state || row.lifecycleState || row.lifecycle_state || 'not-configured')
  };
}

function createChannelPhysicalClient({ platform, facade } = {}) {
  const normalizedPlatform = requirePlatform(platform);
  if (!facade || facade.platform !== normalizedPlatform
      || typeof facade.egress?.execute !== 'function'
      || typeof facade.reconcile?.execute !== 'function') {
    throw fail('WP_B_CHANNEL_PHYSICAL_CLIENT_INVALID', 'Physical channel client requires exact egress and reconciliation ports', 500, { platform: normalizedPlatform });
  }
  return Object.freeze({
    async perform(input = {}) {
      const attempt = validatePhysicalEnvelope(input);
      if (attempt.platform && attempt.platform !== normalizedPlatform) {
        throw fail('WP_B_CHANNEL_PHYSICAL_SCOPE_MISMATCH', 'Physical channel platform scope mismatch', 409, { platform: normalizedPlatform, receivedPlatform: attempt.platform });
      }
      return facade.egress.execute(
        attempt.command,
        persistedAttemptContext(attempt, normalizedPlatform)
      );
    },
    async lookup(input = {}) {
      const attempt = validatePhysicalEnvelope(input);
      if (attempt.platform && attempt.platform !== normalizedPlatform) {
        throw fail('WP_B_CHANNEL_PHYSICAL_SCOPE_MISMATCH', 'Physical channel platform scope mismatch', 409, { platform: normalizedPlatform, receivedPlatform: attempt.platform });
      }
      return facade.reconcile.execute(Object.freeze({
        executionId: attempt.executionId,
        intentId: attempt.intentId,
        attemptId: attempt.attemptId,
        claimId: attempt.claimId,
        ownerId: attempt.ownerId,
        generation: attempt.generation,
        hostGeneration: attempt.hostGeneration,
        fencingToken: attempt.fencingToken,
        idempotencyKey: attempt.idempotencyKey,
        requestContentSha256: attempt.requestContentSha256,
        platform: normalizedPlatform,
        accountReference: attempt.accountReference,
        providerRequestId: attempt.providerRequestId,
        platformMessageId: attempt.platformMessageId
      }));
    }
  });
}

class ChannelAdapterRuntime {
  constructor({ platform, facade, communicationAuthority: communication = communicationAuthority, accountReader = accountStore.get.bind(accountStore) } = {}) {
    this.platform = requirePlatform(platform);
    this.facade = facade || platformAdapters.singleton.get(this.platform);
    this.communication = communication;
    this.accountReader = accountReader;
    if (!this.facade || this.facade.platform !== this.platform) throw fail('CHANNEL_ADAPTER_FACADE_SCOPE_MISMATCH', 'Channel adapter facade scope mismatch', 500, { platform: this.platform });
  }

  describe() {
    const contract = this.facade.contract();
    return {
      schemaVersion: 1,
      authority: 'ChannelAdapterRuntime',
      platform: this.platform,
      methods: [...channelAdapterContract.REQUIRED_METHODS],
      legacyFourPortBindings: { ...contract.bindings },
      boundaries: { ...contract.boundaries },
      migrationMode: 'durable-outbox-only'
    };
  }

  async authenticate(input = {}) {
    plain(input, 'AuthenticateRequest');
    return this.facade.auth.execute({ ...input, platform: this.platform, operation: clean(input.operation) || 'connect' });
  }

  async restoreSession(input = {}) {
    plain(input, 'RestoreSessionRequest');
    return this.facade.auth.execute({ ...input, platform: this.platform, operation: clean(input.operation) || 'reconnect' });
  }

  async readAccountIdentity(input = {}) {
    plain(input, 'ReadAccountIdentityRequest');
    const accountId = clean(input.accountId);
    const row = this.accountReader(accountId);
    if (!row) throw fail('CHANNEL_ACCOUNT_NOT_FOUND', 'Channel account is not persisted', 404, { platform: this.platform, accountId });
    const projected = accountProjection(this.platform, accountId, row);
    if (projected.platform !== clean(row.platform).toLowerCase()) throw fail('CHANNEL_ACCOUNT_SCOPE_MISMATCH', 'Channel account platform mismatch', 409, { platform: this.platform, accountId });
    return projected;
  }

  async backfillContacts(input = {}) { return this.#backfill('contacts', input); }
  async backfillConversations(input = {}) { return this.#backfill('conversations', input); }
  async backfillMessages(input = {}) { return this.#backfill('messages', input); }

  async #backfill(streamKind, input = {}) {
    plain(input, `Backfill${streamKind}Request`);
    return this.facade.reconcile.execute({ ...input, platform: this.platform, operation: 'sync', streamKind });
  }

  async subscribeEvents(input = {}) {
    plain(input, 'SubscribeEventsRequest');
    const contract = this.facade.contract();
    return {
      schemaVersion: 1,
      platform: this.platform,
      accountId: clean(input.accountId),
      subscriptionMode: 'managed-by-platform-adapter',
      status: contract.bindings?.ingress ? 'active-on-connect' : 'not-bound',
      ingressBound: contract.bindings?.ingress === true
    };
  }

  async normalizeEvent(input = {}) {
    plain(input, 'NormalizeEventRequest');
    return this.facade.ingress.normalize({ ...input, platform: this.platform, sourceAccountId: clean(input.sourceAccountId || input.accountId) });
  }

  async fetchAvatar(input = {}) { return this.fetchMedia({ ...input, mediaKind: 'avatar' }); }

  async fetchMedia(input = {}) {
    plain(input, 'FetchMediaRequest');
    const sourceAccountId = clean(input.sourceAccountId || input.accountId);
    const registered = this.communication.registerMedia({
      traceId: clean(input.traceId), platform: this.platform, sourceAccountId,
      externalReference: clean(input.externalReference), mediaKind: clean(input.mediaKind || 'file'),
      mimeType: clean(input.mimeType), animated: input.animated === true, metadata: input.metadata || {}
    });
    if (registered.state === 'REMOTE_DISCOVERED') {
      return this.communication.transitionMedia({ mediaId: registered.mediaId, expectedVersion: registered.version, state: 'FETCH_SCHEDULED', nextRetryAt: clean(input.nextRetryAt) });
    }
    return registered;
  }

  async sendMessage(input = {}) {
    plain(input, 'ChannelSendRequest');
    const command = plain(input.command || {}, 'ChannelSendCommand');
    const accountId = clean(input.accountId || command.accountId || command.accountReference);
    if (clean(command.platform).toLowerCase() !== this.platform
        || clean(command.accountId || command.accountReference) !== accountId) {
      throw fail('CHANNEL_SEND_SCOPE_MISMATCH', 'Send command platform/account scope mismatch', 409, { platform: this.platform, accountId });
    }
    if (!this.communication || typeof this.communication.prepareOutboundMessageSend !== 'function') {
      throw fail('WP_B_OUTBOUND_MESSAGE_AUTHORITY_REQUIRED', 'Channel send requires CommunicationAuthority durable preparation', 503);
    }
    const durableCommand = deepFreeze({
      schemaVersion: 1,
      platform: this.platform,
      accountReference: accountId,
      commandReference: clean(command.commandReference),
      credentialReference: clean(command.credentialReference),
      requestContentSha256: clean(command.requestContentSha256)
    });
    return this.communication.prepareOutboundMessageSend({
      traceId: clean(input.traceId),
      idempotencyKey: clean(input.idempotencyKey || command.idempotencyKey || command.commandId),
      deadlineAt: clean(input.deadlineAt),
      maxAttempts: Number(input.maxAttempts || 3),
      command: durableCommand
    });
  }

  async queryDelivery(input = {}) {
    plain(input, 'QueryDeliveryRequest');
    if (!this.communication || typeof this.communication.prepareDeliveryReceiptReconciliation !== 'function') {
      throw fail('WP_B_DELIVERY_RECEIPT_AUTHORITY_REQUIRED', 'Delivery query requires durable reconciliation preparation', 503);
    }
    const accountReference = clean(input.accountId || input.accountReference);
    const durableCommand = deepFreeze({
      schemaVersion: 1,
      platform: this.platform,
      accountReference,
      deliveryAttemptReference: clean(input.deliveryAttemptReference || input.targetAttemptId),
      credentialReference: clean(input.credentialReference),
      requestContentSha256: clean(input.requestContentSha256),
      targetExecutionId: clean(input.targetExecutionId),
      targetIntentId: clean(input.targetIntentId),
      targetAttemptId: clean(input.targetAttemptId),
      providerRequestId: clean(input.providerRequestId),
      platformMessageId: clean(input.platformMessageId)
    });
    return this.communication.prepareDeliveryReceiptReconciliation({
      traceId: clean(input.traceId),
      idempotencyKey: clean(input.idempotencyKey),
      deadlineAt: clean(input.deadlineAt),
      maxAttempts: Number(input.maxAttempts || 3),
      command: durableCommand
    });
  }

  async readDeliveryState(input = {}) {
    plain(input, 'ReadDeliveryStateRequest');
    if (!this.communication || typeof this.communication.readOutboundMessageState !== 'function') {
      throw fail('WP_B_OUTBOUND_MESSAGE_AUTHORITY_REQUIRED', 'Delivery state requires CommunicationAuthority outbox projection', 503);
    }
    return this.communication.readOutboundMessageState({
      intentId: clean(input.intentId),
      attemptId: clean(input.attemptId)
    });
  }

  async disconnect(input = {}) {
    plain(input, 'DisconnectRequest');
    return this.facade.auth.execute({ ...input, platform: this.platform, operation: input.logout === true ? 'logout' : 'pause' });
  }
}

class ChannelAdapterRuntimeRegistry {
  constructor({ facadeRegistry = platformAdapters.singleton, communication = communicationAuthority, accountReader = accountStore.get.bind(accountStore) } = {}) {
    this.facadeRegistry = facadeRegistry;
    this.adapters = new Map(PLATFORMS.map(platform => [platform, new ChannelAdapterRuntime({
      platform, facade: facadeRegistry.get(platform), communicationAuthority: communication, accountReader
    })]));
    this.physicalClients = new Map(PLATFORMS.map(platform => [platform, createChannelPhysicalClient({
      platform, facade: facadeRegistry.get(platform)
    })]));
  }
  get(platform) {
    const id = requirePlatform(platform);
    const adapter = this.adapters.get(id);
    if (!adapter) throw fail('CHANNEL_ADAPTER_NOT_REGISTERED', `Channel adapter not registered: ${id}`, 500);
    return adapter;
  }
  physicalClient(platform) {
    const id = requirePlatform(platform);
    const client = this.physicalClients.get(id);
    if (!client) throw fail('WP_B_CHANNEL_PHYSICAL_CLIENT_INVALID', `Physical channel client not registered: ${id}`, 500);
    return client;
  }
  describe() { return Object.fromEntries([...this.adapters].map(([platform, adapter]) => [platform, adapter.describe()])); }
}

const singleton = new ChannelAdapterRuntimeRegistry();

module.exports = singleton;
module.exports.ChannelAdapterRuntime = ChannelAdapterRuntime;
module.exports.ChannelAdapterRuntimeRegistry = ChannelAdapterRuntimeRegistry;
module.exports.PLATFORMS = PLATFORMS;
module.exports.createChannelPhysicalClient = createChannelPhysicalClient;
module.exports.persistedAttemptContext = persistedAttemptContext;
module.exports.validatePhysicalEnvelope = validatePhysicalEnvelope;
