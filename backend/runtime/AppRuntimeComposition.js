'use strict';

const { randomUUID } = require('node:crypto');
const eventBus = require('../services/eventBus');
const logger = require('../services/logger');
const accountManager = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const accountMigration = require('../services/accountMigrationService');
const messageStore = require('../services/messageStore');
const sendQueue = require('../services/sendQueueService');
const platformMessaging = require('../services/platformMessagingService');
const platformCapabilities = require('../services/platformCapabilities');
const platformDrivers = require('../services/platformDriverRegistry');
const platformAdapterPorts = require('../services/platformAdapterPorts');
const canonicalIdentity = require('../services/canonicalIdentityService');
const updatePreflight = require('../services/updatePreflightService');
const workspaceData = require('../services/workspaceDataService');
const modelRegistry = require('../services/modelRegistry');
const aiTaskRuntimeRegistry = require('../services/aiTaskRuntimeRegistry');
const aiGateway = require('../services/aiGateway');
const { configureWorkspaceIdentityCommandFacade } = require('../services/workspaceIdentityCommandFacade');
const backupService = require('../services/backupService');
const diagnosticsService = require('../services/diagnosticsService');
const productionDiagnostics = require('../services/productionDiagnosticsService');
const safeModeService = require('../services/safeModeService');
const systemPolicy = require('../services/systemPolicy');
const migrationService = require('../services/migrationService');
const { createMigrationAuthority, configureMigrationAuthority } = require('../services/migrationAuthority');
const syncCheckpointService = require('../services/syncCheckpointService');
const backgroundJobAuthority = require('../services/backgroundJobAuthority');
const cacheGcService = require('../services/cacheGcService');
const workspaceService = require('../services/workspaceService');
const { runProductionDataGuard } = require('../migrations/legacyDemoCleanup');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const { AccountContext } = require('../core/accountContext');
const { UpdateManager } = require('../core/updateManager');
const { StoreProjectionCoordinator } = require('../core/projections/storeProjectionCoordinator');
const { RecoveryManager } = require('../core/recoveryManager');
const { getRuntimeArtifactRegistryService } = require('../services/runtimeArtifactRegistryService');
const { RuntimeArtifactBootstrapService } = require('../services/runtimeArtifactBootstrapService');
const domainOperationalEventBridge = require('../services/domainOperationalEventBridge').singleton;
const domainEventProjectionAuthority = require('../services/domainEventProjectionAuthority').singleton;
const accountLifecycleSaga = require('../services/accountLifecycleSagaService').singleton;
const learningSynthesisScheduler = require('../services/learningSynthesisScheduler').singleton;
const { getRuntimeSafetySupervisor } = require('../services/runtimeSafetySupervisor');
const { getScopedSafetyAuthority } = require('../services/scopedSafetyAuthority');
const { AuthorityTransactionCoordinator } = require('../services/authorityTransactionCoordinator');
const canonicalEventLedgerModule = require('../services/canonicalEventLedgerAuthority');
const { CanonicalEventLedgerAuthority } = canonicalEventLedgerModule;
const { IdentityAuthority } = require('../services/identityAuthority');
const { DurableExecutionRecoveryAuthority } = require('../services/durableExecutionRecoveryAuthority');
const {
  isAuthorityWriteHostCapability,
  assertCurrentAuthorityWriteHostToken
} = require('../services/authorityWriteHost');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { canonicalHash } = require('../services/canonicalSerialization');
const {
  createDurableOperationRegistry,
  OPERATION_KINDS
} = require('../services/durableOperationRegistry');
const { deepFreeze } = require('../lib/deepFreeze');
const {
  createAiProviderExecutionOperation
} = require('../services/durableOperations/aiProviderExecutionOperation');
const {
  createOutboundMessageSendOperation
} = require('../services/durableOperations/outboundMessageSendOperation');
const {
  createDeliveryReceiptReconciliationOperation
} = require('../services/durableOperations/deliveryReceiptReconciliationOperation');
const {
  createMediaTransferOperation
} = require('../services/durableOperations/mediaTransferOperation');
const {
  createHistorySynchronizationOperation
} = require('../services/durableOperations/historySynchronizationOperation');
const {
  createSessionRestoreOperation
} = require('../services/durableOperations/sessionRestoreOperation');
const { AppRuntimeError } = require('./errors');

const STARTUP_COMMAND_FIELDS = new Set(['contractVersion', 'commandId', 'commandType', 'expectedStateVersion', 'issuedAtUtc', 'payload']);
const FORBIDDEN_STARTUP_PAYLOAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STARTUP_HANDLER_AUTHORITIES = new WeakMap();
const STARTUP_GATEWAY_STATES = new WeakMap();

function gatewayError(code, message, status = 400, details = {}) {
  return new AppRuntimeError(code, message, { status, details });
}

function createStartupCommandHandlers(options = {}) {
  const identityAuthority = options.identityAuthority;
  if (!identityAuthority || typeof identityAuthority.canonicalizeWhatsAppAccounts !== 'function') {
    throw gatewayError(
      'STARTUP_COMMAND_IDENTITY_AUTHORITY_REQUIRED',
      'Startup command handlers require the composition IdentityAuthority',
      503
    );
  }
  const handlerEntries = Object.assign(Object.create(null), {
    'startup.migrate': () => migrationService.migrateAtStartup(),
    'startup.recoverSync': () => syncCheckpointService.recoverInterrupted(),
    'startup.recoverBackgroundJobs': payload => backgroundJobAuthority.recoverInterrupted({
      retryDelayMs: Math.max(0, Number(payload?.retryDelayMs || 30_000))
    }),
    'startup.requestSessionRestores': payload => accountManager.requestPersistedSessionRestores(payload || {}),
    'startup.canonicalizeIdentity': payload => identityAuthority.canonicalizeWhatsAppAccounts({
      dryRun: payload?.dryRun === true
    }),
    'startup.purgeCache': () => cacheGcService.purge(),
    'startup.productionDataGuard': () => runProductionDataGuard(),
    'startup.initializeWorkspacePipelines': () => workspaceService.initializeDataPipelines()
  });
  const durableExecutionRecoveryAuthority = options.durableExecutionRecoveryAuthority;
  if (durableExecutionRecoveryAuthority != null) {
    if (typeof durableExecutionRecoveryAuthority.recoverNonterminalExecutions !== 'function') {
      throw gatewayError(
        'STARTUP_DURABLE_RECOVERY_AUTHORITY_REQUIRED',
        'Startup durable recovery requires DurableExecutionRecoveryAuthority',
        503
      );
    }
    handlerEntries['startup.recoverDurableExecutions'] = payload =>
      durableExecutionRecoveryAuthority.recoverNonterminalExecutions(payload || {});
  }
  const handlers = Object.freeze(handlerEntries);
  STARTUP_HANDLER_AUTHORITIES.set(handlers, identityAuthority);
  return handlers;
}

function assertStartupCommandHandlers(value) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== null || !Object.isFrozen(value)) {
    throw gatewayError(
      'STARTUP_COMMAND_HANDLERS_INVALID',
      'Startup command handlers must be a frozen null-prototype map',
      503
    );
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw gatewayError('STARTUP_COMMAND_HANDLERS_INVALID', 'Startup command handlers cannot contain symbol keys', 503);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = descriptors[key];
    if (descriptor?.get || descriptor?.set || typeof descriptor?.value !== 'function') {
      throw gatewayError('STARTUP_COMMAND_HANDLERS_INVALID', `Startup command handler ${key} is invalid`, 503);
    }
  }
  if (!Object.keys(descriptors).length) {
    throw gatewayError('STARTUP_COMMAND_HANDLERS_INVALID', 'Startup command handlers cannot be empty', 503);
  }
  return value;
}

function startupGatewayState(gateway) {
  const state = STARTUP_GATEWAY_STATES.get(gateway);
  if (!state) {
    throw gatewayError('STARTUP_COMMAND_GATEWAY_INVALID', 'Startup command gateway private state is unavailable', 503);
  }
  return state;
}

function hasStartupCommandHandler(commandHandlers, commandType) {
  return Object.prototype.hasOwnProperty.call(commandHandlers, commandType)
    && typeof commandHandlers[commandType] === 'function';
}

function lockAuthorityBinding(target, key, expected) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== expected) {
    throw gatewayError(
      'APP_RUNTIME_CANONICAL_AUTHORITY_BINDING_INVALID',
      `Canonical authority binding ${key} is missing or inconsistent`,
      503,
      { key }
    );
  }
  Object.defineProperty(target, key, {
    value: expected,
    enumerable: descriptor.enumerable === true,
    writable: false,
    configurable: false
  });
  return expected;
}

function snapshotStartupPayload(value) {
  if (value == null) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw gatewayError('STARTUP_COMMAND_PAYLOAD_INVALID', 'Startup command payload must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw gatewayError('STARTUP_COMMAND_PAYLOAD_INVALID', 'Startup command payload must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length) {
    throw gatewayError('STARTUP_COMMAND_PAYLOAD_SYMBOL_KEY_FORBIDDEN', 'Startup command payload cannot contain symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_STARTUP_PAYLOAD_KEYS.has(key)) {
      throw gatewayError('STARTUP_COMMAND_PAYLOAD_KEY_FORBIDDEN', `Startup command payload field ${key} is forbidden`);
    }
    const descriptor = descriptors[key];
    if (typeof descriptor?.get === 'function' || typeof descriptor?.set === 'function') {
      throw gatewayError('STARTUP_COMMAND_PAYLOAD_ACCESSOR_FORBIDDEN', `Startup command payload field ${key} cannot be an accessor`);
    }
    output[key] = descriptor?.value;
  }
  return Object.freeze(output);
}

function assertStartupEnvelope(input, commandHandlers) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw gatewayError('STARTUP_COMMAND_ENVELOPE_INVALID', 'Startup command envelope must be a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw gatewayError('STARTUP_COMMAND_ENVELOPE_INVALID', 'Startup command envelope must be a plain object');
  }
  if (Object.getOwnPropertySymbols(input).length) {
    throw gatewayError('STARTUP_COMMAND_ENVELOPE_INVALID', 'Startup command envelope cannot contain symbol keys');
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  for (const key of Object.getOwnPropertyNames(input)) {
    const descriptor = descriptors[key];
    if (descriptor?.get || descriptor?.set || !STARTUP_COMMAND_FIELDS.has(key)) {
      throw gatewayError('STARTUP_COMMAND_ENVELOPE_INVALID', `Startup command field ${key} is not allowed`);
    }
  }
  const envelope = Object.freeze({
    contractVersion: Number(descriptors.contractVersion?.value),
    commandId: String(descriptors.commandId?.value || '').trim(),
    commandType: String(descriptors.commandType?.value || '').trim(),
    expectedStateVersion: Number(descriptors.expectedStateVersion?.value),
    issuedAtUtc: String(descriptors.issuedAtUtc?.value || '').trim(),
    payload: snapshotStartupPayload(descriptors.payload?.value)
  });
  if (envelope.contractVersion !== 2
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(envelope.commandId)
    || !hasStartupCommandHandler(commandHandlers, envelope.commandType)
    || !Number.isInteger(envelope.expectedStateVersion)
    || !Number.isFinite(Date.parse(envelope.issuedAtUtc))) {
    throw gatewayError('STARTUP_COMMAND_ENVELOPE_INVALID', 'Startup command envelope is malformed');
  }
  return envelope;
}

class RuntimeAuthorityCommandGateway {
  constructor(options = {}) {
    const runtime = options.runtime;
    const authorityWriteHostCapability = options.authorityWriteHostCapability;
    const authorityStore = options.authorityStore;
    const commandHandlers = assertStartupCommandHandlers(options.commandHandlers);
    if (!runtime
      || !isAuthorityWriteHostCapability(authorityWriteHostCapability)
      || !authorityStore?.db
      || typeof authorityStore.transaction !== 'function') {
      throw gatewayError(
        'STARTUP_COMMAND_GATEWAY_WRITE_HOST_REQUIRED',
        'Startup command gateway requires the current broker-owned write-host capability and authority store',
        503
      );
    }
    if (authorityStore.authorityWriteHostCapability !== authorityWriteHostCapability) {
      throw gatewayError(
        'STARTUP_COMMAND_GATEWAY_STORE_MISMATCH',
        'Startup command gateway authority store is not bound to the supplied write-host capability',
        409
      );
    }
    STARTUP_GATEWAY_STATES.set(this, {
      runtime,
      authorityWriteHostCapability,
      authorityStore,
      commandHandlers,
      receipts: new Map(),
      sealed: false
    });
    this.assertAuthorityCurrent();
    Object.freeze(this);
  }

  assertAuthorityCurrent() {
    const state = startupGatewayState(this);
    assertCurrentAuthorityWriteHostToken(state.authorityWriteHostCapability, state.authorityStore.db);
    return true;
  }

  assertCanonicalBinding(expected = {}) {
    const state = startupGatewayState(this);
    const checks = Object.freeze({
      runtimeMatches: state.runtime === expected.runtime,
      capabilityMatches: state.authorityWriteHostCapability === expected.authorityWriteHostCapability,
      storeMatches: state.authorityStore === expected.authorityStore,
      identityAuthorityMatches: STARTUP_HANDLER_AUTHORITIES.get(state.commandHandlers) === expected.identityAuthority
    });
    return Object.freeze({ bound: Object.values(checks).every(Boolean), checks });
  }

  execute(input) {
    const state = startupGatewayState(this);
    if (state.sealed) {
      throw gatewayError('STARTUP_COMMAND_GATEWAY_SEALED', 'Startup command gateway is sealed after boot', 409);
    }
    this.assertAuthorityCurrent();
    const envelope = assertStartupEnvelope(input, state.commandHandlers);
    const contentSha256 = canonicalHash(envelope);
    const existing = state.receipts.get(envelope.commandId);
    if (existing) {
      if (existing.contentSha256 !== contentSha256) {
        throw gatewayError('STARTUP_COMMAND_IDEMPOTENCY_CONFLICT', 'Startup commandId was reused with different content', 409);
      }
      return Object.freeze({ ...existing.receipt, duplicate: true });
    }
    const snapshot = state.runtime.snapshot();
    if (Number(snapshot.stateVersion) !== envelope.expectedStateVersion) {
      throw gatewayError('STARTUP_COMMAND_STATE_VERSION_CONFLICT', 'Startup command expectedStateVersion is stale', 409, {
        expectedStateVersion: envelope.expectedStateVersion,
        actualStateVersion: Number(snapshot.stateVersion)
      });
    }
    this.assertAuthorityCurrent();
    const handler = state.commandHandlers[envelope.commandType];
    const result = handler(envelope.payload);
    if (result && typeof result.then === 'function') {
      throw gatewayError('STARTUP_COMMAND_ASYNC_HANDLER_FORBIDDEN', 'Startup authority handlers must complete synchronously before readiness', 500);
    }
    const receipt = Object.freeze({
      contractVersion: 2,
      commandId: envelope.commandId,
      commandType: envelope.commandType,
      accepted: true,
      duplicate: false,
      stateVersion: Number(snapshot.stateVersion),
      completedAtUtc: new Date().toISOString(),
      result: result == null ? null : result
    });
    state.receipts.set(envelope.commandId, Object.freeze({ contentSha256, receipt }));
    return receipt;
  }

  submit(commandType, payload = {}) {
    const state = startupGatewayState(this);
    const snapshot = state.runtime.snapshot();
    return this.execute({
      contractVersion: 2,
      commandId: randomUUID(),
      commandType,
      expectedStateVersion: Number(snapshot.stateVersion),
      issuedAtUtc: new Date().toISOString(),
      payload
    });
  }

  seal() {
    const state = startupGatewayState(this);
    state.sealed = true;
    return this.snapshot();
  }

  snapshot() {
    const state = startupGatewayState(this);
    return Object.freeze({
      authority: 'RuntimeAuthorityCommandGateway',
      state: state.sealed ? 'sealed' : 'open',
      receiptCount: state.receipts.size
    });
  }
}

Object.freeze(RuntimeAuthorityCommandGateway.prototype);

function frozenCapabilityCopy(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw gatewayError(code, message, 409);
  }
  let copy;
  try {
    copy = typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch (cause) {
    throw gatewayError(code, message, 409, { cause: cause?.message || String(cause) });
  }
  return deepFreeze(copy);
}

function resolveCredentialCapability(securityGuard, reference, code) {
  if (!securityGuard?.credentials || typeof securityGuard.credentials.get !== 'function') {
    throw gatewayError(
      'WP_B_RUNTIME_CREDENTIAL_CUSTODY_REQUIRED',
      'Durable operation runtime requires the SecurityGuard credential custody authority',
      503
    );
  }
  const normalized = String(reference || '').trim();
  const capability = securityGuard.credentials.get(normalized);
  return frozenCapabilityCopy(
    capability,
    code,
    'Durable operation credential reference could not be resolved'
  );
}

function queueCommandCapability(reference) {
  const queueRepository = require('../repositories/sendQueueRepository');
  const normalized = String(reference || '').trim();
  const row = queueRepository.get(normalized);
  let payload = row?.payload || null;
  if (!payload && row?.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch (_) { payload = null; }
  }
  const command = payload?.outboxCommand || row?.outboxCommand || null;
  return frozenCapabilityCopy(
    command,
    'WP_B_OUTBOUND_COMMAND_REFERENCE_NOT_FOUND',
    'Outbound command reference could not be resolved from the authoritative send queue'
  );
}

function promptCapability(reference) {
  const normalized = String(reference || '').trim();
  const snapshot = messageStore.read();
  const messages = snapshot?.messages && typeof snapshot.messages === 'object'
    ? snapshot.messages
    : {};
  const row = messages[normalized]
    || Object.values(messages).find(candidate => [
      candidate?.id,
      candidate?.dedupeKey,
      candidate?.externalMessageId
    ].some(value => String(value || '').trim() === normalized));
  const content = String(
    row?.text
    || row?.content
    || row?.translatedZh
    || row?.translationZh
    || ''
  ).trim();
  if (!content) {
    throw gatewayError(
      'WP_B_AI_PROMPT_REFERENCE_NOT_FOUND',
      'AI prompt reference could not be resolved from the authoritative message store',
      409,
      { promptReference: normalized }
    );
  }
  return content;
}

function reconciliationOutcome(value = {}) {
  const explicit = String(value.outcome || '').trim();
  if (['REMOTE_SUCCESS_PROVEN', 'REMOTE_ABSENCE_PROVEN', 'REMOTE_RESULT_UNKNOWN'].includes(explicit)) {
    return explicit;
  }
  if (value.accepted === true || value.completed === true || value.success === true) {
    return 'REMOTE_SUCCESS_PROVEN';
  }
  if (value.absent === true || value.notFound === true) return 'REMOTE_ABSENCE_PROVEN';
  return 'REMOTE_RESULT_UNKNOWN';
}

function createAiProviderClient() {
  return Object.freeze({
    async perform(input) {
      const prompt = promptCapability(input.promptReference);
      const result = await aiGateway.execute({
        task: 'reply',
        modelId: input.modelReference,
        messages: [{ role: 'user', content: prompt }],
        options: {
          correlationId: input.executionId,
          persistedAttemptId: input.attemptId
        },
        context: {
          scopeKey: input.executionId,
          generation: String(input.generation)
        }
      });
      return Object.freeze({
        accepted: true,
        providerRequestId: String(result?.providerRequestId || result?.requestId || '').trim(),
        providerReceiptId: String(result?.providerReceiptId || '').trim(),
        evidenceReference: 'model-execution:' + input.executionId
      });
    },
    async lookup(input) {
      return Object.freeze({
        outcome: 'REMOTE_RESULT_UNKNOWN',
        providerRequestId: String(input.providerRequestId || '').trim(),
        evidenceReference: 'model-execution-reconciliation:' + input.executionId
      });
    }
  });
}

function createMultiplexChannelClient() {
  return Object.freeze({
    perform(input) {
      const runtime = require('../services/channelAdapterRuntime');
      return runtime.physicalClient(input.platform).perform(input);
    },
    lookup(input) {
      const runtime = require('../services/channelAdapterRuntime');
      return runtime.physicalClient(input.platform).lookup(input);
    }
  });
}

function deliveryPhysicalEnvelope(input) {
  return Object.freeze({
    ...input,
    command: Object.freeze({ lookupOnly: true }),
    credential: input.credential
  });
}

function createDeliveryClient() {
  const channels = createMultiplexChannelClient();
  const query = async input => {
    const result = await channels.lookup(deliveryPhysicalEnvelope(input));
    return Object.freeze({
      deliveryStatus: String(result?.deliveryStatus || result?.status || 'UNKNOWN').trim(),
      platformMessageId: String(result?.platformMessageId || input.platformMessageId || '').trim(),
      providerRequestId: String(result?.providerRequestId || input.providerRequestId || '').trim(),
      evidenceReference: String(result?.evidenceReference || ('delivery:' + input.attemptId)).trim(),
      failureCode: String(result?.failureCode || '').trim(),
      outcome: reconciliationOutcome(result)
    });
  };
  return Object.freeze({
    query,
    lookup: query
  });
}

function platformReconciliationPort(platform) {
  return platformAdapterPorts.singleton.get(String(platform || '').trim().toLowerCase()).reconcile;
}

function createHistoryClient() {
  return Object.freeze({
    async fetchPage(input) {
      const result = await platformReconciliationPort(input.platform).execute(Object.freeze({
        ...input,
        operation: 'sync',
        accountId: input.accountReference
      }));
      return Object.freeze({
        status: String(result?.status || 'completed').trim(),
        segmentReference: String(result?.segmentReference || '').trim(),
        nextCursorReference: String(result?.nextCursorReference || result?.cursorReference || '').trim(),
        remoteHighWatermark: String(result?.remoteHighWatermark || '').trim(),
        gapClosed: result?.gapClosed === true,
        providerRequestId: String(result?.providerRequestId || '').trim(),
        evidenceReference: String(result?.evidenceReference || ('history:' + input.attemptId)).trim(),
        failureCode: String(result?.failureCode || '').trim(),
        uncertain: result?.uncertain === true
      });
    },
    async compareCursor(input) {
      return Object.freeze({
        outcome: 'REMOTE_RESULT_UNKNOWN',
        remoteCursorReference: '',
        remoteHighWatermark: '',
        evidenceReference: 'history-reconciliation:' + input.attemptId,
        failureCode: ''
      });
    }
  });
}

function persistedMediaAttempt(input) {
  return deepFreeze({
    executionId: input.executionId,
    intentId: input.intentId,
    attemptId: input.attemptId,
    claimId: input.claimId,
    ownerId: input.ownerId,
    generation: input.generation,
    hostGeneration: input.hostGeneration,
    fencingToken: input.fencingToken,
    idempotencyKey: input.idempotencyKey,
    request: {
      transferKind: input.transferKind,
      mediaReference: input.mediaReference,
      sourceScopeReference: input.sourceScopeReference,
      destinationScopeReference: input.destinationScopeReference,
      metadataSha256: input.metadataSha256
    }
  });
}

function createMediaClient() {
  return Object.freeze({
    async transfer(input) {
      const platform = String(input.custody?.platform || '').trim().toLowerCase();
      if (!platform) {
        throw gatewayError(
          'WP_B_MEDIA_PLATFORM_CAPABILITY_REQUIRED',
          'Media transfer custody must identify one registered platform capability',
          409
        );
      }
      const result = await platformReconciliationPort(platform).execute(Object.freeze({
        ...input,
        operation: 'media-transfer'
      }));
      return Object.freeze({
        status: String(result?.status || '').trim(),
        remoteTransferId: String(result?.remoteTransferId || '').trim(),
        providerRequestId: String(result?.providerRequestId || '').trim(),
        outputReference: String(result?.outputReference || '').trim(),
        evidenceReference: String(result?.evidenceReference || ('media:' + input.attemptId)).trim(),
        failureCode: String(result?.failureCode || '').trim(),
        uncertain: result?.uncertain === true
      });
    },
    async transcribe(input) {
      const transcriptionService = require('../services/transcriptionService');
      const result = await transcriptionService.executePersistedTranscription({
        persistedAttempt: persistedMediaAttempt(input),
        filePath: input.mediaReference
      });
      return Object.freeze({
        status: result?.ok === true ? 'completed' : 'failed',
        outputReference: 'transcription:' + input.attemptId,
        evidenceReference: 'transcription:' + input.executionId,
        failureCode: result?.ok === true ? '' : 'TRANSCRIPTION_FAILED',
        uncertain: false
      });
    },
    async lookup(input) {
      return Object.freeze({
        outcome: 'REMOTE_RESULT_UNKNOWN',
        remoteTransferId: '',
        providerRequestId: '',
        outputReference: '',
        evidenceReference: 'media-reconciliation:' + input.attemptId,
        failureCode: ''
      });
    }
  });
}

function createSessionRestoreAdapter({ securityGuard, facadeRegistry = platformAdapterPorts.singleton } = {}) {
  const resolveSessionCapability = reference => resolveCredentialCapability(
    securityGuard,
    reference,
    'SESSION_RESTORE_CAPABILITY_NOT_FOUND'
  );
  const sessionClient = Object.freeze({
    async restore(input) {
      const facade = facadeRegistry.get(input.platform);
      return facade.auth.execute(Object.freeze({
        ...input,
        operation: 'reconnect',
        accountId: input.accountReference
      }));
    },
    async probe(input) {
      const facade = facadeRegistry.get(input.platform);
      return facade.auth.execute(Object.freeze({
        ...input,
        operation: 'status',
        accountId: input.accountReference
      }));
    }
  });
  return createSessionRestoreOperation({ resolveSessionCapability, sessionClient });
}

function createDurableOperationRuntimeRegistry({ adapters } = {}) {
  if (!adapters || typeof adapters !== 'object' || Array.isArray(adapters)) {
    throw gatewayError(
      'WP_B_OPERATION_ADAPTER_SET_REQUIRED',
      'Durable operation runtime requires one exact Adapter set',
      503
    );
  }
  const operationKinds = Object.values(OPERATION_KINDS);
  const keys = Object.keys(adapters);
  if (JSON.stringify(keys) !== JSON.stringify(operationKinds)) {
    throw gatewayError(
      'WP_B_OPERATION_ADAPTER_SET_INVALID',
      'Durable operation Adapter set must contain the exact six kinds in canonical order',
      503,
      { expected: operationKinds, actual: keys }
    );
  }
  const registry = createDurableOperationRegistry();
  for (const operationKind of operationKinds) registry.register(operationKind, adapters[operationKind]);
  registry.seal();
  return Object.freeze({
    registry,
    adapters: Object.freeze({ ...adapters })
  });
}

function createProductionDurableOperationRuntime({
  securityGuard,
  facadeRegistry = platformAdapterPorts.singleton
} = {}) {
  const resolveCredentialReference = (reference, context = {}) => resolveCredentialCapability(
    securityGuard,
    reference,
    'WP_B_' + String(context.operationKind || 'OPERATION') + '_CREDENTIAL_NOT_FOUND'
  );
  const channelClient = createMultiplexChannelClient();
  const adapters = Object.freeze({
    [OPERATION_KINDS.AI_PROVIDER_EXECUTION]: createAiProviderExecutionOperation({
      resolveCredentialReference,
      providerClient: createAiProviderClient()
    }),
    [OPERATION_KINDS.OUTBOUND_MESSAGE_SEND]: createOutboundMessageSendOperation({
      resolveCommandReference: queueCommandCapability,
      resolveCredentialReference,
      channelClient
    }),
    [OPERATION_KINDS.DELIVERY_RECEIPT_RECONCILIATION]: createDeliveryReceiptReconciliationOperation({
      resolveCredentialReference,
      deliveryClient: createDeliveryClient()
    }),
    [OPERATION_KINDS.MEDIA_TRANSFER]: createMediaTransferOperation({
      resolveCustodyReference(reference) {
        const credential = securityGuard?.credentials?.get?.(String(reference || '').trim());
        if (credential && typeof credential === 'object') return frozenCapabilityCopy(
          credential,
          'WP_B_MEDIA_CUSTODY_NOT_FOUND',
          'Media custody reference could not be resolved'
        );
        const parts = String(reference || '').trim().split(':');
        const platform = parts.length > 1 ? String(parts[0] || '').trim().toLowerCase() : '';
        return Object.freeze({ reference: String(reference || '').trim(), platform });
      },
      mediaClient: createMediaClient()
    }),
    [OPERATION_KINDS.HISTORY_SYNCHRONIZATION]: createHistorySynchronizationOperation({
      resolveCredentialReference,
      historyClient: createHistoryClient()
    }),
    [OPERATION_KINDS.SESSION_RESTORE]: createSessionRestoreAdapter({
      securityGuard,
      facadeRegistry
    })
  });
  return createDurableOperationRuntimeRegistry({ adapters });
}

function createSessionRestoreOperationRegistry({ securityGuard, facadeRegistry = platformAdapterPorts.singleton } = {}) {
  const sessionRestoreOperation = createSessionRestoreAdapter({ securityGuard, facadeRegistry });
  const durableOperationRegistry = createDurableOperationRegistry();
  durableOperationRegistry.register(OPERATION_KINDS.SESSION_RESTORE, sessionRestoreOperation);
  durableOperationRegistry.seal();
  return Object.freeze({ durableOperationRegistry, sessionRestoreOperation });
}

function createAppRuntimeComposition(runtime) {
  const authorityWriteHostCapability = runtime.authorityWriteHostCapability;
  const authorityStore = runtime.primaryAuthorityStore;
  if (!authorityWriteHostCapability || !authorityStore?.db || typeof authorityStore.transaction !== 'function') {
    throw gatewayError('APP_RUNTIME_CANONICAL_AUTHORITY_STORE_REQUIRED', 'Production composition requires the current broker-owned authority store', 503);
  }

  const workspaceIdentityCommandFacade = configureWorkspaceIdentityCommandFacade({ db: authorityStore.db });
  const migrationAuthority = configureMigrationAuthority(createMigrationAuthority({ store: authorityStore, authorityWriteHostCapability }));

  const authorityTransactionCoordinator = new AuthorityTransactionCoordinator({ store: authorityStore, eventBus });
  lockAuthorityBinding(authorityTransactionCoordinator, 'store', authorityStore);
  lockAuthorityBinding(authorityTransactionCoordinator, 'db', authorityStore.db);

  const coordinatorCapability = authorityTransactionCoordinator.repositoryCapability();
  const platformCoreStoreProvider = () => authorityStore;
  const platformCoreRepository = createPlatformCoreRepository({ storeProvider: platformCoreStoreProvider, coordinatorCapability });
  lockAuthorityBinding(platformCoreRepository, 'storeProvider', platformCoreStoreProvider);
  lockAuthorityBinding(platformCoreRepository, 'coordinatorCapability', coordinatorCapability);

  const canonicalEventLedgerAuthority = new CanonicalEventLedgerAuthority({ coordinator: authorityTransactionCoordinator, store: authorityStore, compatibilityRepository: platformCoreRepository });
  lockAuthorityBinding(canonicalEventLedgerAuthority, 'coordinator', authorityTransactionCoordinator);
  lockAuthorityBinding(canonicalEventLedgerAuthority, 'store', authorityStore);
  lockAuthorityBinding(canonicalEventLedgerAuthority, 'db', authorityStore.db);
  lockAuthorityBinding(canonicalEventLedgerAuthority, 'compatibilityRepository', platformCoreRepository);
  canonicalEventLedgerModule.configureSingleton(canonicalEventLedgerAuthority);

  const identityAuthority = new IdentityAuthority({ repository: platformCoreRepository });
  lockAuthorityBinding(identityAuthority, 'repository', platformCoreRepository);
  lockAuthorityBinding(identityAuthority, 'eventRecorder', identityAuthority.eventRecorder);
  lockAuthorityBinding(identityAuthority, 'legacyCanonicalIdentity', identityAuthority.legacyCanonicalIdentity);

  const recoveryStoreProvider = () => authorityStore;
  const durableExecutionRecoveryAuthority = new DurableExecutionRecoveryAuthority({
    storeProvider: recoveryStoreProvider,
    authorityWriteHostCapability
  });
  lockAuthorityBinding(durableExecutionRecoveryAuthority, 'storeProvider', recoveryStoreProvider);
  lockAuthorityBinding(
    durableExecutionRecoveryAuthority,
    'authorityWriteHostCapability',
    authorityWriteHostCapability
  );

  const startupCommandHandlers = createStartupCommandHandlers({
    identityAuthority,
    durableExecutionRecoveryAuthority
  });
  const authorityCommandGateway = new RuntimeAuthorityCommandGateway({ runtime, authorityWriteHostCapability, authorityStore, commandHandlers: startupCommandHandlers });
  const commandSubmitter = envelope => authorityCommandGateway.execute(envelope);
  const sessionRestoreStartupReceipt = authorityCommandGateway.submit(
    'startup.requestSessionRestores',
    { traceId: 'runtime-composition-startup' }
  );

  const securityGuard = getSecurityGuard();
  const durableOperationRuntime = createProductionDurableOperationRuntime({ securityGuard });
  const requestSessionRestore = input => accountManager.requestSessionRestore(input);
  const accountContext = new AccountContext({ securityGuard, accountManager, accountStore, accountMigration, messageStore, sendQueue, platformMessaging, platformCapabilities, platformDrivers, canonicalIdentity, eventBus });
  const updateManager = new UpdateManager({ securityGuard, lifecycleManager: runtime, updatePreflight, eventBus });
  const artifactRegistry = getRuntimeArtifactRegistryService();
  const artifactBootstrap = new RuntimeArtifactBootstrapService({ artifactRegistry, registry: artifactRegistry, modelRegistry, logger });
  const recoveryManager = new RecoveryManager({ safeModeService, backupService, diagnosticsService, productionDiagnostics, systemPolicy, lifecycleManager: runtime, securityGuard, eventBus, logger, artifactRegistry, artifactBootstrap, scopedSafety: getScopedSafetyAuthority() });
  const storeProjectionCoordinator = new StoreProjectionCoordinator({ eventBus, logger, workspaceData, modelRegistry, aiTaskRuntimeRegistry });
  const runtimeSafetySupervisor = getRuntimeSafetySupervisor().bindRuntime(runtime);
  safeModeService.bindAuthority(() => {
    const snapshot = runtime.store.snapshot();
    let authority = {};
    try { authority = runtime.store.getOperatingModeAuthority?.() || {}; } catch (_) {}
    return { operatingMode: snapshot.runtime.operatingMode, updatedAtUtc: snapshot.runtime.updatedAtUtc || '', reasonCode: authority.reasonCode || '', reason: authority.reason || authority.reasonCode || '', reasons: authority.reasons || [], enteredAt: authority.enteredAt || '', updatedBy: authority.updatedBy || 'runtime-authority', trigger: authority.trigger || '', evidenceSha256: authority.evidenceSha256 || '' };
  });
  securityGuard.setPolicyProviders({ safeModeProvider: () => runtime.operatingMode === 'safeMode', lifecycleStateProvider: () => runtime.state, productionDiagnostics });
  return Object.freeze({
    authorities: Object.freeze({ authorityWriteHostCapability, authorityTransactionCoordinator, canonicalEventLedgerAuthority, identityAuthority, durableExecutionRecoveryAuthority, platformCoreRepository, workspaceIdentityCommandFacade, migrationAuthority }),
    authorityCommandGateway,
    commandSubmitter,
    durableOperationRuntime,
    durableOperationRegistry: durableOperationRuntime.registry,
    sessionRestoreOperation: durableOperationRuntime.adapters[OPERATION_KINDS.SESSION_RESTORE],
    requestSessionRestore,
    sessionRestoreStartupReceipt,
    accountContext,
    updateManager,
    recoveryManager,
    securityGuard,
    storeProjectionCoordinator,
    runtimeSafetySupervisor,
    participants: Object.freeze([
      { name: 'security-guard', service: securityGuard, critical: true },
      { name: 'ai-gateway', service: aiGateway, critical: true },
      { name: 'recovery-manager', service: recoveryManager, critical: true },
      { name: 'account-lifecycle-saga', service: accountLifecycleSaga, critical: true },
      { name: 'account-context', service: accountContext, critical: true },
      { name: 'runtime-safety-supervisor', service: runtimeSafetySupervisor, critical: false },
      { name: 'domain-operational-event-bridge', service: domainOperationalEventBridge, critical: false },
      { name: 'domain-event-projection-authority', service: domainEventProjectionAuthority, critical: false },
      { name: 'learning-synthesis-scheduler', service: learningSynthesisScheduler, critical: false },
      { name: 'store-projection-coordinator', service: storeProjectionCoordinator, critical: true },
      { name: 'update-manager', service: updateManager, critical: false }
    ]),
    eventBus,
    logger,
    productionDiagnostics
  });
}

module.exports = {
  RuntimeAuthorityCommandGateway,
  createStartupCommandHandlers,
  createDurableOperationRuntimeRegistry,
  createProductionDurableOperationRuntime,
  createSessionRestoreOperationRegistry,
  createAppRuntimeComposition
};
