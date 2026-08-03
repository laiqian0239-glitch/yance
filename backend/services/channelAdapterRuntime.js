'use strict';

const core = require('./channelRuntimeEngine');
const platformAdapters = require('./platformAdapterPorts');
const accountStore = require('./accountStore');
const communicationAuthority = require('./communicationAuthority');
const channelAdapterContract = require('./channelAdapterContract');
const { canonicalHash } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');

function clean(value) { return String(value == null ? '' : value).trim(); }
function historyRuntimeError(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message), { code, status, ...details });
}
function positiveInteger(value, fallback) {
  const result = Number(value == null || value === '' ? fallback : value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw historyRuntimeError('WP_B_HISTORY_PAGE_SIZE_INVALID', 'History pageSize must be one positive integer', 400);
  }
  return result;
}

class ChannelAdapterRuntime extends core.ChannelAdapterRuntime {
  async backfillContacts(input = {}) { return this.prepareHistorySynchronization('contacts', input); }
  async backfillConversations(input = {}) { return this.prepareHistorySynchronization('conversations', input); }
  async backfillMessages(input = {}) { return this.prepareHistorySynchronization('messages', input); }

  async prepareHistorySynchronization(streamKind, input = {}) {
    channelAdapterContract.assertPlainData(input || {});
    if (!this.communication || typeof this.communication.prepareHistorySynchronization !== 'function') {
      throw historyRuntimeError(
        'WP_B_HISTORY_SYNCHRONIZATION_AUTHORITY_REQUIRED',
        'History backfill requires CommunicationAuthority durable preparation',
        503
      );
    }
    const accountReference = clean(input.accountId || input.accountReference);
    if (!accountReference) {
      throw historyRuntimeError('WP_B_HISTORY_ACCOUNT_REFERENCE_REQUIRED', 'History account reference is required');
    }
    const scopeReference = clean(
      input.scopeReference
      || input.externalConversationId
      || `${streamKind}:all`
    );
    const checkpointReference = clean(input.checkpointReference)
      || `checkpoint:${this.platform}:${accountReference}:${streamKind}:${scopeReference}`;
    const checkpointVersion = Number(input.checkpointVersion || 0);
    if (!Number.isSafeInteger(checkpointVersion) || checkpointVersion < 0) {
      throw historyRuntimeError('WP_B_HISTORY_CHECKPOINT_VERSION_INVALID', 'History checkpointVersion is invalid');
    }
    const account = typeof this.accountReader === 'function' ? this.accountReader(accountReference) : null;
    const credentialReference = clean(
      input.credentialReference
      || account?.credentialRef
      || account?.credential_ref
    );
    if (!credentialReference) {
      throw historyRuntimeError('WP_B_HISTORY_CREDENTIAL_REFERENCE_REQUIRED', 'History credential reference is required');
    }
    const referencePayload = Object.freeze({
      schemaVersion: 1,
      platform: this.platform,
      accountReference,
      streamKind,
      scopeReference,
      checkpointReference,
      checkpointVersion,
      cursorReference: clean(input.cursorReference),
      credentialReference,
      pageSize: positiveInteger(input.pageSize, 100)
    });
    const command = deepFreeze({
      ...referencePayload,
      requestContentSha256: clean(input.requestContentSha256) || canonicalHash(referencePayload)
    });
    const idempotencyKey = clean(input.idempotencyKey)
      || `history:${canonicalHash(command)}`;
    return this.communication.prepareHistorySynchronization({
      traceId: clean(input.traceId),
      idempotencyKey,
      deadlineAt: clean(input.deadlineAt),
      maxAttempts: positiveInteger(input.maxAttempts, 3),
      command
    });
  }
}

class ChannelAdapterRuntimeRegistry {
  constructor({
    facadeRegistry = platformAdapters.singleton,
    communication = communicationAuthority,
    accountReader = accountStore.get.bind(accountStore)
  } = {}) {
    this.facadeRegistry = facadeRegistry;
    this.adapters = new Map(core.PLATFORMS.map(platform => [platform, new ChannelAdapterRuntime({
      platform,
      facade: facadeRegistry.get(platform),
      communicationAuthority: communication,
      accountReader
    })]));
    this.physicalClients = new Map(core.PLATFORMS.map(platform => [platform, core.createChannelPhysicalClient({
      platform,
      facade: facadeRegistry.get(platform)
    })]));
  }

  get(platform) {
    const id = clean(platform).toLowerCase();
    if (!core.PLATFORMS.includes(id)) {
      throw historyRuntimeError('CHANNEL_ADAPTER_PLATFORM_UNSUPPORTED', `Unsupported channel adapter: ${id || 'unknown'}`, 404);
    }
    const adapter = this.adapters.get(id);
    if (!adapter) throw historyRuntimeError('CHANNEL_ADAPTER_NOT_REGISTERED', `Channel adapter not registered: ${id}`, 500);
    return adapter;
  }

  physicalClient(platform) {
    const id = clean(platform).toLowerCase();
    if (!core.PLATFORMS.includes(id)) {
      throw historyRuntimeError('CHANNEL_ADAPTER_PLATFORM_UNSUPPORTED', `Unsupported channel adapter: ${id || 'unknown'}`, 404);
    }
    const client = this.physicalClients.get(id);
    if (!client) throw historyRuntimeError('WP_B_CHANNEL_PHYSICAL_CLIENT_INVALID', `Physical channel client not registered: ${id}`, 500);
    return client;
  }

  describe() {
    return Object.fromEntries([...this.adapters].map(([platform, adapter]) => [platform, adapter.describe()]));
  }
}

const singleton = new ChannelAdapterRuntimeRegistry();
module.exports = singleton;
module.exports.ChannelAdapterRuntime = ChannelAdapterRuntime;
module.exports.ChannelAdapterRuntimeRegistry = ChannelAdapterRuntimeRegistry;
module.exports.PLATFORMS = core.PLATFORMS;
module.exports.createChannelPhysicalClient = core.createChannelPhysicalClient;
module.exports.validatePhysicalEnvelope = core.validatePhysicalEnvelope;
