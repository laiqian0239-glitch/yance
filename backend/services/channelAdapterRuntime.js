'use strict';

const core = require('./channelRuntimeEngine');
const platformAdapters = require('./platformAdapterPorts');
const accountStore = require('./accountStore');
const communicationAuthority = require('./communicationAuthority');
const channelAdapterContract = require('./channelAdapterContract');
const { canonicalHash } = require('./canonicalSerialization');
const { deepFreeze } = require('../lib/deepFreeze');

const RUNTIME_MIGRATION_CONTRACT = Object.freeze({
  migrationMode: 'durable-outbox-only',
  attemptId: 'required',
  fencingToken: 'required'
});
const MIGRATION_MODE = RUNTIME_MIGRATION_CONTRACT.migrationMode;
const PHYSICAL_ATTEMPT_FIELDS = Object.freeze(['attemptId', 'fencingToken']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function runtimeError(code, message, status = 400, details = {}) {
  return Object.assign(new Error(message), { code, status, ...details });
}
function positiveInteger(value, fallback) {
  const result = Number(value == null || value === '' ? fallback : value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw runtimeError('WP_B_DURABLE_OPERATION_INTEGER_INVALID', 'Durable operation integer must be positive');
  }
  return result;
}
function nonnegativeInteger(value, fallback = 0) {
  const result = Number(value == null || value === '' ? fallback : value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw runtimeError('WP_B_DURABLE_OPERATION_INTEGER_INVALID', 'Durable operation integer must be nonnegative');
  }
  return result;
}

class ChannelAdapterRuntime extends core.ChannelAdapterRuntime {
  describe() {
    const description = super.describe();
    if (description?.migrationMode !== RUNTIME_MIGRATION_CONTRACT.migrationMode) {
      throw runtimeError(
        'WP_B_CHANNEL_MIGRATION_MODE_INVALID',
        'Channel runtime must remain durable-outbox-only',
        500,
        { migrationMode: clean(description?.migrationMode) }
      );
    }
    return description;
  }

  async restoreSession(input = {}) {
    channelAdapterContract.assertPlainData(input || {});
    if (!this.communication || typeof this.communication.prepareSessionRestore !== 'function') {
      throw runtimeError(
        'WP_B_SESSION_RESTORE_AUTHORITY_REQUIRED',
        'Session restore requires durable preparation',
        503
      );
    }
    const accountReference = clean(input.accountId || input.accountReference);
    if (!accountReference) {
      throw runtimeError('WP_B_SESSION_ACCOUNT_REFERENCE_REQUIRED', 'Session account reference is required');
    }
    const account = typeof this.accountReader === 'function' ? this.accountReader(accountReference) : null;
    if (account && clean(account.platform).toLowerCase() !== this.platform) {
      throw runtimeError(
        'WP_B_SESSION_ACCOUNT_SCOPE_MISMATCH',
        'Session account platform does not match channel runtime',
        409,
        { platform: this.platform, accountReference }
      );
    }
    const requestedSessionGeneration = positiveInteger(input.requestedSessionGeneration, 1);
    const credentialReference = clean(
      input.credentialReference
      || account?.credentialRef
      || account?.credential_ref
    );
    if (!credentialReference) {
      throw runtimeError(
        'WP_B_SESSION_CREDENTIAL_REFERENCE_REQUIRED',
        'Session credential reference is required'
      );
    }
    const sessionReference = clean(
      input.sessionReference
      || account?.sessionReference
      || account?.metadata?.sessionReference
      || `session:${this.platform}:${accountReference}:${requestedSessionGeneration}`
    );
    const referencePayload = Object.freeze({
      schemaVersion: 1,
      platform: this.platform,
      accountReference,
      requestedSessionGeneration,
      sessionReference,
      credentialReference
    });
    const command = deepFreeze({
      ...referencePayload,
      commandContentSha256: clean(input.commandContentSha256) || canonicalHash(referencePayload)
    });
    return this.communication.prepareSessionRestore({
      traceId: clean(input.traceId),
      idempotencyKey: clean(input.idempotencyKey),
      deadlineAt: clean(input.deadlineAt),
      maxAttempts: positiveInteger(input.maxAttempts, 3),
      command
    });
  }

  async backfillContacts(input = {}) { return this.prepareHistorySynchronization('contacts', input); }
  async backfillConversations(input = {}) { return this.prepareHistorySynchronization('conversations', input); }
  async backfillMessages(input = {}) { return this.prepareHistorySynchronization('messages', input); }

  async prepareHistorySynchronization(streamKind, input = {}) {
    channelAdapterContract.assertPlainData(input || {});
    if (!this.communication || typeof this.communication.prepareHistorySynchronization !== 'function') {
      throw runtimeError(
        'WP_B_HISTORY_SYNCHRONIZATION_AUTHORITY_REQUIRED',
        'History backfill requires CommunicationAuthority durable preparation',
        503
      );
    }
    const accountReference = clean(input.accountId || input.accountReference);
    if (!accountReference) {
      throw runtimeError('WP_B_HISTORY_ACCOUNT_REFERENCE_REQUIRED', 'History account reference is required');
    }
    const scopeReference = clean(
      input.scopeReference
      || input.externalConversationId
      || `${streamKind}:all`
    );
    const checkpointReference = clean(input.checkpointReference)
      || `checkpoint:${this.platform}:${accountReference}:${streamKind}:${scopeReference}`;
    const checkpointVersion = nonnegativeInteger(input.checkpointVersion, 0);
    const account = typeof this.accountReader === 'function' ? this.accountReader(accountReference) : null;
    const credentialReference = clean(
      input.credentialReference
      || account?.credentialRef
      || account?.credential_ref
    );
    if (!credentialReference) {
      throw runtimeError('WP_B_HISTORY_CREDENTIAL_REFERENCE_REQUIRED', 'History credential reference is required');
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
      throw runtimeError('CHANNEL_ADAPTER_PLATFORM_UNSUPPORTED', `Unsupported channel adapter: ${id || 'unknown'}`, 404);
    }
    const adapter = this.adapters.get(id);
    if (!adapter) throw runtimeError('CHANNEL_ADAPTER_NOT_REGISTERED', `Channel adapter not registered: ${id}`, 500);
    return adapter;
  }

  physicalClient(platform) {
    const id = clean(platform).toLowerCase();
    if (!core.PLATFORMS.includes(id)) {
      throw runtimeError('CHANNEL_ADAPTER_PLATFORM_UNSUPPORTED', `Unsupported channel adapter: ${id || 'unknown'}`, 404);
    }
    const client = this.physicalClients.get(id);
    if (!client) throw runtimeError('WP_B_CHANNEL_PHYSICAL_CLIENT_INVALID', `Physical channel client not registered: ${id}`, 500);
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
module.exports.RUNTIME_MIGRATION_CONTRACT = RUNTIME_MIGRATION_CONTRACT;
module.exports.MIGRATION_MODE = MIGRATION_MODE;
module.exports.PHYSICAL_ATTEMPT_FIELDS = PHYSICAL_ATTEMPT_FIELDS;
module.exports.PLATFORMS = core.PLATFORMS;
module.exports.createChannelPhysicalClient = core.createChannelPhysicalClient;
module.exports.validatePhysicalEnvelope = core.validatePhysicalEnvelope;
