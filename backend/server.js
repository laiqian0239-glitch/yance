'use strict';

const { randomUUID } = require('node:crypto');
const { getBackendReleaseIdentity } = require('./releaseIdentity');
const { identityTuple } = require('../shared/release/identityObservation');
const { WP7_RENDERER_STORAGE_PROBE_PATH, rendererStorageProbeResponse } = require('../shared/wp7/rendererStorageProbeDocument');
const { getDesktopStartupContext } = require('./bootstrap/desktopStartupContext');
const {
  buildServerStartupFailureLifecycleMessage,
  sendParentLifecycleMessage
} = require('./bootstrap/parentLifecycleChannel');
const BACKEND_RELEASE_IDENTITY = getBackendReleaseIdentity();
const DESKTOP_STARTUP_CONTEXT = getDesktopStartupContext();
const { getAppRuntime, getRuntimeCoordinator } = require('./runtime/runtimeSingleton');
const { AppRuntimeFactory } = require('./runtime/AppRuntimeFactory');
const { shutdownAppRuntime } = require('./runtime');
const APP_RUNTIME = getAppRuntime();

const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const { CONFIG, PATHS, ensureDirectories } = require('./config');
const { evaluateSourceUatCloneReset } = require('./runtime/sourceUatClonePolicy');
const runtimeMode = require('./services/runtimeMode');
const aiTaskStageAuthority = require('./services/aiTaskStageAuthority');
const modelExecutionEvidenceStore = require('./services/modelExecutionEvidenceStore');

const STARTUP_CLOCK = process.hrtime.bigint();
const startupTimings = {};
function markStartupPhase(name) {
  startupTimings[name] = Number(process.hrtime.bigint() - STARTUP_CLOCK) / 1e6;
  return startupTimings[name];
}

ensureDirectories();
markStartupPhase('directoriesReadyMs');

const RUNTIME_COMPOSITION = APP_RUNTIME.configureProductionServices();
const STARTUP_AUTHORITY_READINESS = AppRuntimeFactory.assertAuthorityReady();

function executeStartupAuthorityCommand(commandType, payload = {}) {
  const snapshot = APP_RUNTIME.snapshot();
  return RUNTIME_COMPOSITION.commandSubmitter({
    contractVersion: 2,
    commandId: randomUUID(),
    commandType,
    expectedStateVersion: Number(snapshot.stateVersion),
    issuedAtUtc: new Date().toISOString(),
    payload
  });
}

const safeModeService = require('./services/safeModeService');
const productionDiagnostics = require('./services/productionDiagnosticsService');
const {
  executeProductionRuntimePathProbe,
  getProductionRuntimePathProbeSnapshot,
  closeProductionRuntimePathProbe
} = require('./services/productionRuntimePathProbe');
const startupBoot = safeModeService.beginBoot({
  version: CONFIG.product.version,
  build: CONFIG.product.build
});
productionDiagnostics.recordEvent('backend-boot-started', {
  severity: startupBoot.state.active ? 'warning' : 'info',
  metadata: { attemptId: startupBoot.attempt.id, safeMode: startupBoot.state.active, previousIncomplete: startupBoot.previousIncomplete }
});

const startupRestore = globalThis.__YANCE_STARTUP_RESTORE__ || {
  ok: true,
  executed: false,
  source: 'boot-phase-0-not-required'
};

let startupMigration;
try {
  startupMigration = executeStartupAuthorityCommand('startup.migrate').result;
} catch (error) {
  startupMigration = { ok: false, executed: false, error: error.message, code: error.code || 'STARTUP_MIGRATION_FAILED' };
}
markStartupPhase('legacyMigrationReadyMs');
if (!startupMigration?.ok) {
  const error = new Error(`启动迁移未完成：${startupMigration?.error || startupMigration?.code || 'unknown failure'}`);
  error.code = startupMigration?.code || 'STARTUP_MIGRATION_FAILED';
  throw error;
}

let startupArchitectureClosure = { ok: true, executed: false, identity: null, cache: null, interruptedSyncs: [], interruptedBackgroundJobs: [] };
try {
  const interruptedSyncs = executeStartupAuthorityCommand('startup.recoverSync').result || [];
  const interruptedBackgroundJobs = executeStartupAuthorityCommand('startup.recoverBackgroundJobs', { retryDelayMs: 30_000 }).result || [];
  const identity = executeStartupAuthorityCommand('startup.canonicalizeIdentity', { dryRun: false }).result;
  const cache = executeStartupAuthorityCommand('startup.purgeCache').result;
  startupArchitectureClosure = {
    ok: true,
    executed: Boolean(identity?.executed || cache?.removed?.length || interruptedSyncs.length || interruptedBackgroundJobs.length),
    identity,
    cache,
    interruptedSyncs,
    interruptedBackgroundJobs,
    at: new Date().toISOString()
  };
} catch (error) {
  startupArchitectureClosure = { ok: false, executed: true, error: error.message, code: error.code || 'ARCHITECTURE_CLOSURE_STARTUP_FAILED', at: new Date().toISOString() };
  throw Object.assign(error, { code: startupArchitectureClosure.code });
}
markStartupPhase('architectureClosureReadyMs');

const startupProductionGuard = executeStartupAuthorityCommand('startup.productionDataGuard').result;
const startupStage6Data = executeStartupAuthorityCommand('startup.initializeWorkspacePipelines').result;
markStartupPhase('dataPipelinesReadyMs');

// Stateful services are loaded only after write-host authority, canonical composition,
// versioned startup recovery, SQLite migration and production cleanup complete.
const modelsRouter = require('./routes/models');
const messagesRouter = require('./routes/messages');
const systemRouter = require('./routes/system');
const accountsRouter = require('./routes/accounts');
const facebookAvatarImportBridge = require('./routes/facebookAvatarImportBridge');
const ollama = require('./services/ollamaClient');
const modelRegistry = require('./services/modelRegistry');
const modelAutoActivation = require('./services/modelAutoActivationService');
const { getSecurityGuard } = require('./core/securityGuardSingleton');
let startupModelRouteRepair = { ok: true, executed: false, quarantined: 0 };
modelRegistry.repairRoutes({ autoSelectVerified: true }).then(registry => {
  startupModelRouteRepair = { ok: true, executed: true, quarantined: Array.isArray(registry.routeQuarantine) ? registry.routeQuarantine.length : 0, at: new Date().toISOString() };
}).catch(error => {
  startupModelRouteRepair = { ok: false, executed: true, error: error.message, code: error.code || 'MODEL_ROUTE_REPAIR_FAILED', at: new Date().toISOString() };
});
const cloudModelCredentialRecovery = require('./services/cloudModelCredentialRecovery');
cloudModelCredentialRecovery.install();
const accountManager = require('./services/accountManager');
const eventBus = require('./services/eventBus');
const logger = require('./services/logger');
for (const [streamName, stream] of [['stdout', process.stdout], ['stderr', process.stderr]]) {
  stream?.on?.('error', error => {
    logger.warn('server', `${streamName}-pipe-error`, { code: error.code || '', error: error.message });
  });
}
const backupScheduler = require('./services/backupScheduler');
const sendQueueService = require('./services/sendQueueService');
const localPersistenceRepairService = require('./services/localPersistenceRepairService');
const runtimeRecovery = require('./services/runtimeRecoveryService');
const runtimeSettings = require('./services/runtimeSettings');
const aiAutomation = require('./services/aiBrainOrchestrator');
const storeManagerService = require('./services/storeManagerService');
const aiReplyOutboxService = require('./services/aiReplyOutboxService');
const messageTranslationService = require('./services/messageTranslationService');
const { closeStore } = require('./repositories/storeProvider');
const { createR32LocalApiSecurity } = require('./middleware/r32LocalApiSecurity');
const { authorizeWebSocketRequest, getApiSessionAuthStats } = require('./security/apiSessionAuth');
const { createR32LegacyRouteBlocker } = require('./middleware/r32LegacyRouteBlocker');
const { createR32ConversationRouter } = require('./routes/r32Conversations');
const workspaceRouter = require('./routes/workspace');
const conversationCapabilitiesRouter = require('./routes/conversationCapabilities');
const storeRouter = require('./routes/store');
const coreRouter = require('./routes/core');
const { createApiV2Router } = require('./routes/apiV2');
const { createPersonaBrainRouter } = require('./routes/personaBrain');

let startupStoreManager = { ok: true, executed: false, mode: 'pending' };
const storeReadyPromise = storeManagerService.initialize()
  .then(storeManager => {
    startupStoreManager = { ok: true, executed: true, stateVersion: storeManager.stateVersion, at: new Date().toISOString() };
    messageTranslationService.install();
    setTimeout(() => {
      try {
        const queued = messageTranslationService.enqueueRecent({ limit: 160 });
        logger.info('translation', 'message-translation-backfill-queued', { queued });
      } catch (error) {
        logger.warn('translation', 'message-translation-backfill-failed', { code: error.code || '', error: error.message });
      }
    }, 2500).unref?.();
    return storeManager;
  })
  .catch(error => {
    startupStoreManager = { ok: false, executed: true, code: error.code || 'STORE_MANAGER_STARTUP_FAILED', error: error.message, at: new Date().toISOString() };
    logger?.error?.('store', 'store-manager-startup-failed', { code: error.code || 'STORE_MANAGER_STARTUP_FAILED' });
    return null;
  });

let startupCredentialRecovery = { ok: true, executed: Boolean(APP_RUNTIME.credentialMetadata()?.entryCount), mode: 'credential-ipc-hydrated', completedBeforeReady: true, metadata: APP_RUNTIME.credentialMetadata() };
let startupModelScan = { ok: true, executed: false, mode: 'pending' };

const STARTUP_PROTOCOL_VERSION = 1;
const READY_PROTOCOL_VERSION = Number(DESKTOP_STARTUP_CONTEXT.readyProtocolVersion || 1);
const STARTUP_NONCE = DESKTOP_STARTUP_CONTEXT.startupNonce;
const STARTUP_ATTEMPT_ID = DESKTOP_STARTUP_CONTEXT.startupAttemptId || '';
const BACKEND_SESSION_ID = DESKTOP_STARTUP_CONTEXT.backendSessionId || '';
let backendReadiness = {
  ready: false,
  phase: 'initializing',
  pid: process.pid,
  startupNonce: STARTUP_NONCE,
  protocolVersion: STARTUP_PROTOCOL_VERSION,
  startedAt: new Date().toISOString(),
  readyAt: '',
  failure: null
};

function readinessPayload(options = {}) {
  const includeNonce = options.includeNonce === true;
  return {
    ready: backendReadiness.ready,
    phase: backendReadiness.phase,
    pid: backendReadiness.pid,
    protocolVersion: backendReadiness.protocolVersion,
    startedAt: backendReadiness.startedAt,
    readyAt: backendReadiness.readyAt,
    failure: backendReadiness.failure,
    buildId: BACKEND_RELEASE_IDENTITY.buildId,
    manifestSha256: BACKEND_RELEASE_IDENTITY.manifestSha256,
    startupTimings: { ...startupTimings },
    productionRuntimeProbe: getProductionRuntimePathProbeSnapshot(),
    credentialMetadata: APP_RUNTIME.credentialMetadata(),
    probeObservations: getRuntimeCoordinator().snapshot()?.probeObservations || {},
    releaseIdentityObservation: {
      schemaVersion: 1,
      documentType: 'YANCE_BACKEND_RELEASE_IDENTITY',
      consumer: 'backend',
      producerType: 'backend-ready-endpoint',
      producerProcess: 'backend/server.js',
      producerPid: process.pid,
      observedAtUtc: new Date().toISOString(),
      ...identityTuple(BACKEND_RELEASE_IDENTITY)
    },
    runtimeContract: {
      startupAttemptId: STARTUP_ATTEMPT_ID,
      m1StartupContractVersion: DESKTOP_STARTUP_CONTEXT.m1StartupContractVersion || null,
      startupFrameProtocolVersion: DESKTOP_STARTUP_CONTEXT.startupFrameProtocolVersion || null,
      readyProtocolVersion: READY_PROTOCOL_VERSION,
      runtimeMode: DESKTOP_STARTUP_CONTEXT.runtimeMode || 'desktop-hosted',
      appRoot: DESKTOP_STARTUP_CONTEXT.appRoot || '',
      backendEntryPath: DESKTOP_STARTUP_CONTEXT.backendEntryPath || '',
      nodeRuntimeExecutablePath: DESKTOP_STARTUP_CONTEXT.nodeRuntimeExecutablePath || '',
      nodeModulesPath: DESKTOP_STARTUP_CONTEXT.nodeModulesPath || '',
      backendPort: DESKTOP_STARTUP_CONTEXT.backendPort || 0,
      apiBaseUrl: DESKTOP_STARTUP_CONTEXT.apiBaseUrl || '',
      backendSessionId: BACKEND_SESSION_ID,
      fd6PipeInstanceId: DESKTOP_STARTUP_CONTEXT.fd6PipeInstanceId || '',
      releaseManifestPath: DESKTOP_STARTUP_CONTEXT.releaseManifestPath || '',
      releaseManifestSha256Path: DESKTOP_STARTUP_CONTEXT.releaseManifestSha256Path || '',
      logRoot: DESKTOP_STARTUP_CONTEXT.logRoot || '',
      backendLogPath: DESKTOP_STARTUP_CONTEXT.backendLogPath || ''
    },
    ...(includeNonce ? { startupNonce: backendReadiness.startupNonce } : {})
  };
}

function sendParentMessage(payload) {
  if (typeof process.send !== 'function' || !process.connected) return false;
  try {
    process.send(payload, error => {
      if (error) logger.warn('server', 'parent-ipc-send-failed', { code: error.code || '', error: error.message });
    });
    return true;
  } catch (error) {
    logger.warn('server', 'parent-ipc-send-failed', { code: error.code || '', error: error.message });
    return false;
  }
}

function announceStartupFailure(error, code = 'BACKEND_STARTUP_FAILED') {
  const payload = buildServerStartupFailureLifecycleMessage(error, {
    pid: process.pid,
    reasonCode: code
  });
  const failure = {
    reasonCode: payload.reasonCode,
    code: payload.code,
    message: payload.message,
    stackHash: payload.stackHash,
    at: new Date().toISOString()
  };
  safeModeService.markBootFailed(startupBoot.attempt.id, failure);
  productionDiagnostics.recordEvent('backend-boot-failed', {
    severity: 'critical',
    metadata: failure
  });
  backendReadiness = { ...backendReadiness, ready: false, phase: 'failed', failure };
  sendParentLifecycleMessage(payload);
  try {
    process.stderr.write(`YANCE_R32_SERVER_STARTUP_FAILED ${JSON.stringify(payload)}\n`);
  } catch (_) {}
  return failure;
}

function boundServerPort() {
  const address = server?.address?.();
  return address && typeof address === 'object' ? Number(address.port) : Number(CONFIG.port);
}

function announceReady() {
  const authorityState = AppRuntimeFactory.assertAuthorityReady();
  const canonicalLedgerReady = authorityState.canonicalLedgerReady === true;
  const identityAuthorityReady = authorityState.identityAuthorityReady === true;
  if (!authorityState.authorityWriteHostBound || !canonicalLedgerReady || !identityAuthorityReady) {
    const error = new Error('Backend authority readiness could not be proven');
    error.code = 'BACKEND_AUTHORITY_READINESS_FAILED';
    throw error;
  }
  backendReadiness = {
    ...backendReadiness,
    ready: true,
    phase: 'ready',
    readyAt: new Date().toISOString(),
    failure: null
  };
  const payload = {
    type: 'backend:ready',
    ...readinessPayload({ includeNonce: true }),
    host: CONFIG.host,
    port: boundServerPort(),
    url: `http://${CONFIG.host}:${boundServerPort()}`,
    authorityReadiness: { ...authorityState, canonicalLedgerReady, identityAuthorityReady }
  };
  sendParentMessage(payload);
  try {
    process.stdout.write(`YANCE_R32_SERVER_READY ${JSON.stringify(payload)}\n`, error => {
      if (error) logger.warn('server', 'stdout-ready-write-failed', { code: error.code || '', error: error.message });
    });
  } catch (error) {
    logger.warn('server', 'stdout-ready-write-failed', { code: error.code || '', error: error.message });
  }
  return payload;
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data:",
    "connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

// User-enabled, time-limited bridge for the official Business Suite avatar importer.
// It has its own loopback/origin/rate/size gate and exposes no application session token.
app.use('/api/bridge/facebook-avatar-import', facebookAvatarImportBridge);

app.use(createR32LocalApiSecurity({
  maxJsonBytes: 2 * 1024 * 1024,
  maxRequests: 900,
  readMaxRequests: 3600
}));
app.use(createR32LegacyRouteBlocker());
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buffer) => {
    if (req.path === '/api/r32/accounts/facebook/webhook') req.rawBody = Buffer.from(buffer);
  }
}));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', req.path.endsWith('.html') || req.path.startsWith('/api/') ? 'no-store' : 'public, max-age=300');
  next();
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  product: CONFIG.product,
  pid: process.pid,
  uptimeSeconds: Math.round(process.uptime()),
  storage: 'node:sqlite',
  runtimeMode: runtimeMode.mode,
  readiness: readinessPayload(),
  productionCleanroom: startupProductionGuard,
  startupRestore,
  startupMigration,
  startupArchitectureClosure,
  startupModelRouteRepair,
  startupCredentialRecovery,
  startupModelScan,
  startupStoreManager,
  startupTimings,
  startupStage6Data,
  startupAuthorityReadiness: STARTUP_AUTHORITY_READINESS,
  runtimeComposition: RUNTIME_COMPOSITION.authorityCommandGateway.snapshot(),
  storeManager: storeManagerService.status(),
  aiReplyOutbox: aiReplyOutboxService.status(),
  runtimeRecovery: runtimeRecovery.status(),
  localPersistenceRepair: localPersistenceRepairService.status(),
  appRuntime: APP_RUNTIME.snapshot(),
  productionServices: APP_RUNTIME.productionServicesSnapshot(),
  runtimeAuthorityDiagnostics: { factory: AppRuntimeFactory.diagnostics(), currentMatchesServerRuntime: AppRuntimeFactory.current() === APP_RUNTIME },
  runtimeOwnership: getRuntimeCoordinator().snapshot(),
  at: new Date().toISOString()
}));

app.get(WP7_RENDERER_STORAGE_PROBE_PATH, (_req, res) => {
  const response = rendererStorageProbeResponse(process.env);
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.status(response.statusCode).send(response.body);
});

app.get('/api/ready', (_req, res) => {
  const payload = {
    ok: backendReadiness.ready,
    product: CONFIG.product,
    ...readinessPayload({ includeNonce: true }),
    at: new Date().toISOString(),
    ...(getProductionRuntimePathProbeSnapshot().enabled ? { apiSessionAuth: getApiSessionAuthStats() } : {})
  };
  res.status(backendReadiness.ready ? 200 : 503).json(payload);
});

app.use('/api/app/v2', createApiV2Router({ runtimeProvider: () => APP_RUNTIME }));
app.use('/api/v2/persona', createPersonaBrainRouter({ initializeOwnerBaseline: true }));
app.use('/api/core', coreRouter);
const credentialAuthorityProjection = () => {
  const securityGuard = getSecurityGuard();
  return {
    ok: true,
    credentialMetadata: APP_RUNTIME.credentialMetadata(),
    sqliteCredentialMetadata: getRuntimeCoordinator().ownership.store.getCredentialHydrationState(),
    security: securityGuard.snapshot(),
    secureBridge: securityGuard.secureBridge.snapshot()
  };
};
app.get('/api/desktop/credential-authority-state', (_req, res) => res.json(credentialAuthorityProjection()));
// M4: owner re-attach handshake. The relaunched DesktopHost calls this over the
// loopback control channel to resume credential custody after it restarted while
// the backend kept running. Same trust boundary as the WebSocket control socket
// (loopback + session token), so a remote caller cannot hijack ownership.
app.post('/api/desktop/owner-recover', (req, res) => {
  const remote = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!(remote === '127.0.0.1' || remote === '::1')) {
    return res.status(401).json({ ok: false, code: 'OWNER_RECOVERY_REMOTE_DENIED' });
  }
  const body = req.body || {};
  if (!body.apiSessionToken || body.apiSessionToken !== String(DESKTOP_STARTUP_CONTEXT.apiSessionToken || '')) {
    return res.status(401).json({ ok: false, code: 'OWNER_RECOVERY_TOKEN_REJECTED' });
  }
  const bridge = getSecurityGuard().secureBridge;
  Promise.resolve(bridge.recoverOwner(body))
    .then((snap) => res.json(Object.assign({ ok: true }, snap)))
    .catch((error) => res.status(400).json({ ok: false, code: error.reasonCode || error.code || 'OWNER_RECOVERY_FAILED', message: error.message }));
});
if (process.env.YANCE_WP4_CREDENTIAL_CUSTODY_PROBE === '1') {
  app.get('/api/wp4/credential-state', (_req, res) => res.json({
    ...credentialAuthorityProjection(),
    modelCount: (modelRegistry.read().models || []).length
  }));
  app.post('/api/wp4/credential-persist-probe', async (req, res, next) => {
    try {
      const ref = String(req.body?.ref || '').trim();
      const persisted = await getSecurityGuard().credentials.persist(ref, req.body?.value || {}, { actor: 'backend-core' });
      res.json({ ok: true, persisted: persisted === true, ref, credentialMetadata: APP_RUNTIME.credentialMetadata() });
    } catch (error) { next(error); }
  });
}
app.use(createR32ConversationRouter());
app.use('/api/r32/workspace', workspaceRouter);
app.use('/api/r32/conversation', conversationCapabilitiesRouter);
app.use('/api/r32/models', modelsRouter);
app.use('/api/r32/messages', messagesRouter);
app.use('/api/r32/system', systemRouter);
app.use('/api/r32/accounts', accountsRouter);
app.use('/api/r32/store', storeRouter);

// API requests must never fall through to the SPA index.html. Returning HTML to a
// JSON/NDJSON caller hides the real route error behind "Unexpected token '<'".
app.use('/api', (req, res) => {
  res.status(404).json({
    ok: false,
    error: 'API_NOT_FOUND',
    code: 'API_NOT_FOUND',
    message: '请求的 API 路径不存在',
    path: req.originalUrl
  });
});

const frontendRoot = path.join(process.env.YANCE_APP_ROOT || path.join(__dirname, '..'), 'frontend');
app.use(express.static(frontendRoot, { index: false, fallthrough: true, etag: true, maxAge: '5m' }));
app.get('*', (_req, res) => res.sendFile(path.join(frontendRoot, 'index.html')));

app.use((error, req, res, _next) => {
  const reasonCode = error.reasonCode || error.code || 'INTERNAL_ERROR';
  const status = Number(error.status || 500);
  const detail = { method: req.method, path: req.path, code: reasonCode, error: error.message };
  const expectedMissingResource = status === 404 && ['PERSONA_PROFILE_NOT_FOUND', 'CUSTOMER_NOT_FOUND', 'FACEBOOK_OAUTH_FLOW_NOT_FOUND'].includes(reasonCode);
  if (expectedMissingResource) {
    logger.rateLimited('server', 'info', 'request-missing-resource', detail, {
      key: `request-missing-resource:${req.method}:${req.path}:${reasonCode}`,
      intervalMs: 60000
    });
  } else if (status < 500) logger.warn('server', 'request-rejected', detail);
  else logger.error('server', 'request-failed', detail);
  const candidateGenerationRequest = /\/api\/r32\/store\/replies\/generate(?:[/?]|$)/u.test(String(req.originalUrl || ''));
  const aiFailure = error.aiStageFailure || (candidateGenerationRequest && /MODEL|AI_REPLY|ALL_MODELS|UNKNOWN_TASK|QUALITY|LANGUAGE_MISMATCH/u.test(reasonCode)
    ? aiTaskStageAuthority.projectFailure(error, { stage: error.stage || 'candidate_generation', task: error.task })
    : null);
  const executionEvidence = modelExecutionEvidenceStore.projectError(error);
  res.status(status).json({
    ok: false,
    error: reasonCode,
    code: reasonCode,
    reasonCode,
    retryable: error.retryable === true || aiFailure?.retryable === true,
    message: aiFailure?.messageZh || error.message || '请求失败',
    ...(error.routeTestId ? { routeTestId: String(error.routeTestId) } : {}),
    ...(aiFailure ? { aiFailure } : {}),
    ...(executionEvidence ? { modelExecutionEvidence: executionEvidence } : {})
  });
});

const server = http.createServer(app);
let serverCloseIntent = '';
let startupExitScheduled = false;

function markServerCloseIntent(reason) {
  serverCloseIntent = String(reason || 'intentional-close');
}

function forceExitAfterStartupFailure(reasonCode, delayMs = 2000) {
  if (startupExitScheduled) return;
  startupExitScheduled = true;
  const forceExit = setTimeout(() => process.exit(1), Math.max(25, Number(delayMs || 2000)));
  forceExit.unref?.();
  markServerCloseIntent(reasonCode || 'startup-failure');
  try {
    if (server.listening) {
      server.close(() => { clearTimeout(forceExit); process.exit(1); });
    } else {
      clearTimeout(forceExit);
      process.exit(1);
    }
  } catch (_) {
    clearTimeout(forceExit);
    process.exit(1);
  }
}

function assertServerListening(phase) {
  const address = server.address?.();
  if (!server.listening || !address || typeof address !== 'object' || !Number.isInteger(Number(address.port))) {
    const error = new Error(`Backend HTTP server is not listening during ${phase}`);
    error.code = 'BACKEND_HTTP_SERVER_NOT_LISTENING';
    error.phase = phase;
    throw error;
  }
  return Number(address.port);
}

async function assertServerStableBeforeReady(phase, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 3));
  const delayMs = Math.max(0, Number(options.delayMs || 75));
  let port = assertServerListening(phase);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    port = assertServerListening(`${phase}:${attempt}`);
  }
  return port;
}

server.on('error', error => {
  logger.error('server', 'server-listen-failed', { code: error.code || 'SERVER_LISTEN_FAILED' });
  announceStartupFailure(error, 'SERVER_LISTEN_FAILED');
  forceExitAfterStartupFailure(error.code || 'SERVER_LISTEN_FAILED', 25);
});

server.on('close', () => {
  const intentional = Boolean(serverCloseIntent);
  logger.warn('server', 'server-closed', { intentional, reason: serverCloseIntent || '', readiness: backendReadiness.phase });
  if (!intentional && backendReadiness.ready === true) {
    const error = new Error('Backend HTTP server closed after ready was announced');
    error.code = 'BACKEND_HTTP_SERVER_CLOSED_AFTER_READY';
    announceStartupFailure(error, 'BACKEND_HTTP_SERVER_CLOSED_AFTER_READY');
    setTimeout(() => process.exit(1), 25).unref?.();
  }
});

const wss = new WebSocketServer({
  server,
  path: '/events',
  verifyClient(info, done) {
    const remote = String(info.req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const local = remote === '127.0.0.1' || remote === '::1';
    const allowed = local && authorizeWebSocketRequest(info.req);
    done(allowed, allowed ? 200 : 401, allowed ? 'OK' : 'Unauthorized', allowed ? { 'X-Yance-Api-Session-Auth': 'apiSessionAuth' } : {});
  }
});
const clients = new Set();

wss.on('connection', socket => {
  clients.add(socket);
  socket.send(JSON.stringify({ type: 'system:connected', at: new Date().toISOString(), payload: { product: CONFIG.product } }));
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

eventBus.on('event', event => {
  const encoded = JSON.stringify(event);
  for (const socket of clients) if (socket.readyState === socket.OPEN) socket.send(encoded);
});

server.listen(CONFIG.port, CONFIG.host, async () => {
  let storeManager;
  try {
    storeManager = await storeReadyPromise;
    if (!storeManager) {
      throw Object.assign(
        new Error(startupStoreManager.error || 'StoreManager startup failed'),
        { code: startupStoreManager.code || 'STORE_MANAGER_STARTUP_FAILED' }
      );
    }
  } catch (error) {
    logger.error('store', 'authoritative-store-startup-failed', {
      code: error.code || 'STORE_MANAGER_STARTUP_FAILED'
    });
    announceStartupFailure(error, 'STORE_MANAGER_STARTUP_FAILED');
    forceExitAfterStartupFailure(error.code || 'STORE_MANAGER_STARTUP_FAILED');
    return;
  }

  markStartupPhase('authoritativeStoreReadyMs');

  try {
    const sourceUatCloneReset = evaluateSourceUatCloneReset({ dataRoot: PATHS.root });
    if (APP_RUNTIME.operatingMode === 'safeMode' && sourceUatCloneReset.allowed) {
      await APP_RUNTIME.exitSafeMode('source-uat-isolated-data-clone-reset');
      logger.warn('recovery', 'source-uat-clone-safe-mode-reset', {
        reasonCode: sourceUatCloneReset.reasonCode,
        markerPath: sourceUatCloneReset.markerPath,
        targetDataRoot: sourceUatCloneReset.targetDataRoot
      });
      productionDiagnostics.recordEvent('source-uat-clone-safe-mode-reset', {
        severity: 'warning',
        metadata: { reasonCode: sourceUatCloneReset.reasonCode, markerPath: sourceUatCloneReset.markerPath }
      });
    }
    const operatingMode = APP_RUNTIME.operatingMode;
    await APP_RUNTIME.startProductionServices({ safeMode: operatingMode === 'safeMode', reason: 'runtime-authority-startup', metadata: { authority: 'runtime_state.operating_mode' } });
    await APP_RUNTIME.reconcileRuntimeControlCommands();
    markStartupPhase('globalFrameworkReadyMs');
  } catch (error) {
    logger.error('core', 'global-framework-startup-failed', { code: error.code || 'GLOBAL_FRAMEWORK_STARTUP_FAILED' });
    announceStartupFailure(error, 'GLOBAL_FRAMEWORK_STARTUP_FAILED');
    forceExitAfterStartupFailure(error.code || 'GLOBAL_FRAMEWORK_STARTUP_FAILED');
    return;
  }

  try {
    executeProductionRuntimePathProbe({
      dataRoot: PATHS.root,
      sqlitePath: PATHS.sqlite,
      diagnosticsPath: productionDiagnostics.TRACE_FILE,
      loggingPath: path.join(PATHS.logs, 'server.jsonl'),
      logger,
      diagnostics: productionDiagnostics
    });
  } catch (error) {
    logger.error('server', 'production-runtime-path-probe-failed', { code: error.reasonCode || error.code || 'WP2_PRODUCTION_PATH_PROBE_FAILED' });
    announceStartupFailure(error, 'WP2_PRODUCTION_PATH_PROBE_FAILED');
    forceExitAfterStartupFailure(error.reasonCode || error.code || 'WP2_PRODUCTION_PATH_PROBE_FAILED');
    return;
  }

  const safeModeActive = APP_RUNTIME.operatingMode === 'safeMode';
  backupScheduler.start({ intervalHours: Number(process.env.YANCE_BACKUP_INTERVAL_HOURS || 24), maxBackups: Number(process.env.YANCE_MAX_BACKUPS || 14) });
  if (!safeModeActive) {
    sendQueueService.start();
    localPersistenceRepairService.start();
    runtimeRecovery.start();
    if (runtimeSettings.read().autoConnectAccounts) {
      runtimeRecovery.scheduleRecovery('startup-auto-connect', 250);
    }
  } else {
    sendQueueService.pause?.('safe-mode');
    logger.warn('recovery', 'safe-mode-runtime-restrictions-active', { reason: safeModeService.read().reason });
    eventBus.publish('recovery:safe-mode-active', safeModeService.snapshot());
  }
  accountManager.publishSummary();
  if (startupRestore?.executed) eventBus.publish('system:restore-completed', startupRestore.result || startupRestore);
  if (startupMigration?.executed) eventBus.publish('system:migration-completed', startupMigration.report || startupMigration);

  markStartupPhase('coreServicesReadyMs');
  try {
    await assertServerStableBeforeReady('before-backend-ready', { attempts: Number(process.env.YANCE_READY_STABILITY_PROBES || 3), delayMs: Number(process.env.YANCE_READY_STABILITY_DELAY_MS || 75) });
  } catch (error) {
    logger.error('server', 'server-readiness-stability-failed', { code: error.code || 'BACKEND_HTTP_SERVER_NOT_LISTENING' });
    announceStartupFailure(error, 'BACKEND_HTTP_SERVER_NOT_LISTENING');
    forceExitAfterStartupFailure(error.code || 'BACKEND_HTTP_SERVER_NOT_LISTENING');
    return;
  }
  const readySignal = announceReady();
  safeModeService.markBootReady(startupBoot.attempt.id, { safeMode: safeModeActive, startupTimings });
  productionDiagnostics.recordEvent('backend-boot-ready', { severity: safeModeActive ? 'warning' : 'info', metadata: { safeMode: safeModeActive, startupTimings } });
  markStartupPhase('readyAnnouncedMs');
  logger.info('server', 'server-started', {
    host: CONFIG.host,
    port: CONFIG.port,
    dataRoot: PATHS.root,
    startupRestore,
    startupMigration,
    startupArchitectureClosure,
    startupModelRouteRepair,
    startupCredentialRecovery,
    startupTimings,
    readiness: readySignal
  });

  // WP4: credentials are hydrated before local_ready. Post-ready credential discovery/recovery is forbidden.
  accountManager.publishSummary();

  // AI is an enhancement layer. It must never prevent the messaging backend
  // from announcing readiness or serving Facebook/WhatsApp/Telegram traffic.
  if (!safeModeActive) setImmediate(() => {
    for (const [name, service] of [
      ['ai-reply-outbox', aiReplyOutboxService],
      ['ai-automation', aiAutomation]
    ]) {
      try {
        service.start();
        eventBus.publish('ai:service-started', { service: name, afterBackendReady: true });
      } catch (error) {
        logger.warn('ai', 'post-ready-service-start-failed', { service: name, code: error.code || 'AI_SERVICE_START_FAILED', error: error.message });
        productionDiagnostics.recordEvent('ai-service-degraded', { severity: 'warning', metadata: { service: name, code: error.code || 'AI_SERVICE_START_FAILED', error: error.message } });
        eventBus.publish('ai:degraded', { service: name, code: error.code || 'AI_SERVICE_START_FAILED', message: error.message, coreMessagingAvailable: true });
      }
    }
  });

  if (!safeModeActive) setTimeout(async () => {
    try {
      const discovery = await ollama.discover();
      const registry = await modelRegistry.mergeDiscovered(discovery);
      startupModelScan = { ok: true, executed: true, discovery, modelCount: registry.models?.length || 0, at: new Date().toISOString() };
      eventBus.publish('models:scanned', { automatic: true, discovery, registry });
      const activation = modelAutoActivation.schedule({ force: false });
      logger.info('models', 'startup-ollama-scan-completed', { online: discovery.online, count: discovery.models?.length || 0, activationScheduled: activation.scheduled });
    } catch (error) {
      startupModelScan = { ok: false, executed: true, error: error.message, code: error.code || 'MODEL_SCAN_FAILED', at: new Date().toISOString() };
      logger.warn('models', 'startup-ollama-scan-failed', { error: error.message });
    }
  }, 500);

});

process.on('message', message => {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'desktop:backend-ping' && backendReadiness.ready) {
    sendParentMessage({ type: 'backend:ready', ...readinessPayload({ includeNonce: true }), host: CONFIG.host, port: boundServerPort() });
  }
});

async function shutdown(signal) {
  backendReadiness = { ...backendReadiness, ready: false, phase: 'shutting-down' };
  logger.warn('server', 'shutdown', { signal });
  backupScheduler.stop();
  runtimeRecovery.stop();
  localPersistenceRepairService.stop();
  aiAutomation.stop();
  aiReplyOutboxService.stop();
  messageTranslationService.close();
  storeManagerService.stop();
  sendQueueService.stop();
  for (const socket of clients) { try { socket.close(1001, 'server-shutdown'); } catch (_) {} }
  closeProductionRuntimePathProbe();
  await APP_RUNTIME.shutdownProductionServices(signal).catch(() => {});
  markServerCloseIntent(`shutdown:${signal || 'unknown'}`);
  await new Promise(resolve => server.close(resolve));
  await shutdownAppRuntime(signal).catch(error => logger.error('runtime', 'app-runtime-shutdown-failed', { code: error.code || '', error: error.message }));
  closeStore();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', error => {
  productionDiagnostics.recordEvent('uncaught-exception', { severity: 'critical', metadata: { error: error.stack || error.message } });
  logger.error('server', 'uncaught-exception', { error: error.stack || error.message });
});
process.on('unhandledRejection', error => {
  productionDiagnostics.recordEvent('unhandled-rejection', { severity: 'critical', metadata: { error: error?.stack || error?.message || String(error) } });
  logger.error('server', 'unhandled-rejection', { error: error?.stack || error?.message || String(error) });
});

module.exports = { app, server };
