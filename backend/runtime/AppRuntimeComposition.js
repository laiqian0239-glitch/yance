'use strict';

const { randomUUID } = require('node:crypto');
const eventBus = require('../services/eventBus');
const logger = require('../services/logger');
const accountManager = require('../services/accountManager');
const accountStore = require('../services/accountStore');
const accountMigration = require('../services/accountMigrationService');
const messageStore = require('../services/messageStore');
const whatsappAdapter = require('../services/whatsappAdapter');
const sendQueue = require('../services/sendQueueService');
const platformMessaging = require('../services/platformMessagingService');
const platformCapabilities = require('../services/platformCapabilities');
const platformDrivers = require('../services/platformDriverRegistry');
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
const { createWhatsAppAuthKeyAuthority } = require('../services/whatsappAuthKeyAuthority');
const { createWhatsAppAuthStateRepository } = require('../repositories/whatsappAuthStateRepository');
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
const {
  isAuthorityWriteHostCapability,
  assertCurrentAuthorityWriteHostToken
} = require('../services/authorityWriteHost');
const { createPlatformCoreRepository } = require('../repositories/platformCoreRepository');
const { canonicalHash } = require('../services/canonicalSerialization');
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
  const handlers = Object.freeze(Object.assign(Object.create(null), {
    'startup.migrate': () => migrationService.migrateAtStartup(),
    'startup.recoverSync': () => syncCheckpointService.recoverInterrupted(),
    'startup.recoverBackgroundJobs': payload => backgroundJobAuthority.recoverInterrupted({
      retryDelayMs: Math.max(0, Number(payload?.retryDelayMs || 30_000))
    }),
    'startup.canonicalizeIdentity': payload => identityAuthority.canonicalizeWhatsAppAccounts({
      dryRun: payload?.dryRun === true
    }),
    'startup.purgeCache': () => cacheGcService.purge(),
    'startup.productionDataGuard': () => runProductionDataGuard(),
    'startup.initializeWorkspacePipelines': () => workspaceService.initializeDataPipelines()
  }));
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

function createDeferredWhatsAppAuthCipher(keyAuthority) {
  if (!keyAuthority || typeof keyAuthority.getCipher !== 'function') {
    throw gatewayError(
      'WHATSAPP_AUTH_CIPHER_AUTHORITY_REQUIRED',
      'Deferred WhatsApp auth cipher requires the key authority',
      503
    );
  }
  const invoke = (method, args) => {
    const cipher = keyAuthority.getCipher();
    if (!cipher || typeof cipher[method] !== 'function') {
      throw gatewayError(
        'WHATSAPP_AUTH_CIPHER_CAPABILITY_INVALID',
        `WhatsApp auth cipher method ${method} is unavailable`,
        503,
        { method }
      );
    }
    return cipher[method](...args);
  };
  return Object.freeze({
    encrypt(...args) { return invoke('encrypt', args); },
    decrypt(...args) { return invoke('decrypt', args); },
    hmacIndex(...args) { return invoke('hmacIndex', args); }
  });
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

  const startupCommandHandlers = createStartupCommandHandlers({ identityAuthority });
  const authorityCommandGateway = new RuntimeAuthorityCommandGateway({ runtime, authorityWriteHostCapability, authorityStore, commandHandlers: startupCommandHandlers });
  const commandSubmitter = envelope => authorityCommandGateway.execute(envelope);

  const securityGuard = getSecurityGuard();
  const whatsappAuthKeyAuthority = createWhatsAppAuthKeyAuthority({
    securityGuard,
    credentials: securityGuard.credentials
  });
  const whatsappStoreProvider = () => authorityStore;
  const whatsappAuthRepository = createWhatsAppAuthStateRepository({
    cipher: createDeferredWhatsAppAuthCipher(whatsappAuthKeyAuthority),
    storeProvider: whatsappStoreProvider
  });
  messageStore.ensureCanonicalProjectionJobSchema(authorityStore);
  messageStore.configureWhatsAppMessageKeyIndex({
    cipherProvider: () => whatsappAuthKeyAuthority.getCipher(),
    storeProvider: whatsappStoreProvider
  });
  whatsappAdapter.configureRuntimeAuthorities({
    whatsappAuthKeyAuthority,
    storeProvider: whatsappStoreProvider,
    authRepository: whatsappAuthRepository
  });
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
    authorities: Object.freeze({ authorityWriteHostCapability, authorityTransactionCoordinator, canonicalEventLedgerAuthority, identityAuthority, platformCoreRepository, workspaceIdentityCommandFacade, migrationAuthority }),
    authorityCommandGateway,
    commandSubmitter,
    accountContext,
    updateManager,
    recoveryManager,
    securityGuard,
    whatsappAuthKeyAuthority,
    storeProjectionCoordinator,
    runtimeSafetySupervisor,
    participants: Object.freeze([
      { name: 'security-guard', service: securityGuard, critical: true },
      { name: 'whatsapp-auth-key-authority', service: whatsappAuthKeyAuthority, critical: true },
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

module.exports = { RuntimeAuthorityCommandGateway, createStartupCommandHandlers, createAppRuntimeComposition };