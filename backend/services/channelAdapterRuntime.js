'use strict';

const platformAdapters = require('./platformAdapterPorts');
const accountStore = require('./accountStore');
const communicationAuthority = require('./communicationAuthority');
const channelAdapterContract = require('./channelAdapterContract');

const PLATFORMS = Object.freeze(['whatsapp', 'telegram', 'facebook']);

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
function accountProjection(platform, accountId, row = {}) {
  if (!row) return null;
  return {
    platform,
    accountId: clean(row.id || accountId),
    displayName: clean(row.displayName || row.display_name || row.identityLabel || row.identity_label),
    state: clean(row.state || row.lifecycleState || row.lifecycle_state || 'not-configured')
  };
}
function deliveryStatus(result = {}) {
  const raw = clean(result.ackStatus || result.deliveryStatus || result.status || 'ACCEPTED').toUpperCase();
  if (raw === 'SENT') return 'ACCEPTED';
  if (['ACCEPTED', 'DELIVERED', 'READ'].includes(raw)) return raw;
  return 'ACCEPTED';
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
      migrationMode: 'dual-write-shadow'
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

  async fetchAvatar(input = {}) {
    return this.fetchMedia({ ...input, mediaKind: 'avatar' });
  }

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
    const accountId = clean(input.accountId || command.accountId);
    if (clean(command.platform).toLowerCase() !== this.platform || clean(command.accountId) !== accountId) {
      throw fail('CHANNEL_SEND_SCOPE_MISMATCH', 'Send command platform/account scope mismatch', 409, { platform: this.platform, accountId });
    }
    const attempt = this.communication.createDeliveryAttempt({
      traceId: clean(input.traceId), messageId: clean(input.messageId), platform: this.platform,
      sourceAccountId: accountId, idempotencyKey: clean(input.idempotencyKey || command.idempotencyKey || command.commandId)
    });
    try {
      const result = await this.facade.egress.execute(command);
      const receipt = this.communication.recordDeliveryReceipt({
        attemptId: attempt.attemptId,
        status: deliveryStatus(result),
        platformMessageId: clean(result.platformMessageId || result.messageId || result.id || result.key?.id),
        providerRequestId: clean(result.providerRequestId || result.requestId),
        payload: { ackStatus: clean(result.ackStatus || result.deliveryStatus || result.status), source: 'ChannelAdapterRuntime.sendMessage' }
      });
      return { ...result, attempt: this.communication.getDeliveryAttempt(attempt.attemptId), deliveryReceipt: receipt };
    } catch (error) {
      const receipt = this.communication.recordDeliveryReceipt({
        attemptId: attempt.attemptId, status: 'FAILED', providerRequestId: clean(error.providerRequestId || error.requestId),
        failureCode: clean(error.code || 'CHANNEL_SEND_FAILED'), payload: { source: 'ChannelAdapterRuntime.sendMessage' }
      });
      error.attemptId = attempt.attemptId;
      error.deliveryReceipt = receipt;
      throw error;
    }
  }

  async queryDelivery(input = {}) {
    plain(input, 'QueryDeliveryRequest');
    const attempt = this.communication.getDeliveryAttempt(clean(input.attemptId));
    if (!attempt) throw fail('DELIVERY_ATTEMPT_NOT_FOUND', 'Delivery attempt not found', 404, { attemptId: clean(input.attemptId) });
    return attempt;
  }

  async disconnect(input = {}) {
    plain(input, 'DisconnectRequest');
    return this.facade.auth.execute({ ...input, platform: this.platform, operation: input.logout === true ? 'logout' : 'pause' });
  }
}

class ChannelAdapterRuntimeRegistry {
  constructor({ facadeRegistry = platformAdapters.singleton, communication = communicationAuthority, accountReader = accountStore.get.bind(accountStore) } = {}) {
    this.adapters = new Map(PLATFORMS.map(platform => [platform, new ChannelAdapterRuntime({
      platform, facade: facadeRegistry.get(platform), communicationAuthority: communication, accountReader
    })]));
  }
  get(platform) {
    const id = requirePlatform(platform);
    const adapter = this.adapters.get(id);
    if (!adapter) throw fail('CHANNEL_ADAPTER_NOT_REGISTERED', `Channel adapter not registered: ${id}`, 500);
    return adapter;
  }
  describe() { return Object.fromEntries([...this.adapters].map(([platform, adapter]) => [platform, adapter.describe()])); }
}

const singleton = new ChannelAdapterRuntimeRegistry();

module.exports = singleton;
module.exports.ChannelAdapterRuntime = ChannelAdapterRuntime;
module.exports.ChannelAdapterRuntimeRegistry = ChannelAdapterRuntimeRegistry;
module.exports.PLATFORMS = PLATFORMS;
