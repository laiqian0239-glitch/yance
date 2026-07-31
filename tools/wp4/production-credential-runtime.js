'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { isolatedBackendEnvironment } = require('./isolated-backend-environment');
const { BackendProcessHost } = require('../../electron/desktopHost/BackendProcessHost');
const { CredentialVaultHost } = require('../../electron/desktopHost/CredentialVaultHost');
const { CredentialVault } = require('../../electron/credentialVault');
const { createInstalledResources } = require('../../tests/wp2/helpers');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isTransientCredentialHttpError(error) {
  const code = String(error?.code || '');
  const reasonCode = String(error?.reasonCode || '');
  return ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT'].includes(code)
    || ['WP4_PRODUCTION_CREDENTIAL_REQUEST_TIMEOUT', 'WP4_PRODUCTION_CREDENTIAL_REQUEST_TRANSPORT_RESET'].includes(reasonCode);
}

async function request(port, token, requestPath = '/api/app/v2/snapshot', options = {}) {
  const body = options.body == null ? null : JSON.stringify(options.body);
  const timeoutMs = Math.max(100, Number(options.timeoutMs || 10000));
  const retryCount = Math.max(0, Number(options.retryTransientCount || 0));
  const retryDelayMs = Math.max(25, Number(options.retryTransientDelayMs || 150));
  let lastError = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const req = http.request({
          host: '127.0.0.1', port, path: requestPath, method: options.method || (body ? 'POST' : 'GET'),
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Yance-Contract-Version': '2',
            ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {})
          }, timeout: timeoutMs
        }, res => {
          let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
          res.on('end', () => { let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch (_) {} resolve({ statusCode: res.statusCode, body: parsed, text }); });
        });
        req.once('timeout', () => {
          const error = new Error('request timeout');
          error.reasonCode = 'WP4_PRODUCTION_CREDENTIAL_REQUEST_TIMEOUT';
          error.requestPath = requestPath;
          error.timeoutMs = timeoutMs;
          error.attempt = attempt + 1;
          req.destroy(error);
        });
        req.once('error', reject); if (body) req.write(body); req.end();
      });
    } catch (error) {
      lastError = error;
      if (attempt >= retryCount || !isTransientCredentialHttpError(error)) break;
      await delay(retryDelayMs * (attempt + 1));
    }
  }
  if (lastError) {
    lastError.reasonCode = lastError.reasonCode || 'WP4_PRODUCTION_CREDENTIAL_REQUEST_TRANSPORT_RESET';
    lastError.requestPath = lastError.requestPath || requestPath;
    lastError.retryTransientCount = retryCount;
  }
  throw lastError;
}

function collectFiles(root) {
  const files = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  };
  walk(root);
  return files;
}

function createMemoryVault(dataRoot) {
  const failingRefs = new Set();
  const key = crypto.createHash('sha256').update('wp4-production-test-vault-key').digest();
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(value) {
      const bytes = Buffer.from(value); const iv = bytes.subarray(0, 12); const tag = bytes.subarray(12, 28); const encrypted = bytes.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }
  };
  const vault = new CredentialVault(path.join(dataRoot, 'secure', 'credentials.safe.json'), { safeStorage });
  const prepare = vault.prepareMutation.bind(vault);
  vault.prepareMutation = (operation, ref, value) => {
    if (failingRefs.has(ref)) throw Object.assign(new Error('simulated vault failure'), { reasonCode: 'CREDENTIAL_VAULT_PERSIST_FAILED' });
    return prepare(operation, ref, value);
  };
  return { failingRefs, vault };
}

async function state(port, token) { return (await request(port, token, '/api/wp4/credential-state')).body; }

async function runProductionCredentialScenario(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, '../..'));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp4-production-'));
  const release = createInstalledResources({ gitCommit: '4'.repeat(40), sourceTree: '5'.repeat(40) });
  const secret = options.secret || 'wp4-production-secret-refresh-token';
  const generatedSecret = options.generatedSecret || 'wp4-backend-generated-telegram-session';
  const memory = createMemoryVault(dataRoot);
  const vaultHost = new CredentialVaultHost({ vault: memory.vault, metadataPath: path.join(dataRoot, 'secure', 'vault-meta.json') });
  const vaultEpoch = vaultHost.snapshotMetadata().vaultEpoch;
  const host = new BackendProcessHost();
  const startOptions = {
    entry: path.join(repoRoot, 'backend', 'desktopHostedEntry.js'), cwd: repoRoot, execPath: process.execPath,
    env: isolatedBackendEnvironment({ YANCE_DATA_DIR: dataRoot, YANCE_PORT: '0', YANCE_HOST: '127.0.0.1', YANCE_MODEL_TIMEOUT_MS: '5000', YANCE_APP_ROOT: repoRoot, YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1', YANCE_WP4_CREDENTIAL_CUSTODY_PROBE: '1' }),
    releaseStartupConfig: { resourcesPath: release.resourcesPath, expectedBuildId: release.manifest.buildId, manifestSha256: release.manifestSha256 },
    credentialHandshakeRequired: true,
    credentialVaultHost: vaultHost,
    credentialTimeoutMs: 15000,
    readyTimeoutMs: 45000,
    readyHealthCheckPath: '/api/health',
    readyHealthCheckTimeoutMs: 5000,
    readyHealthCheckRetries: 40,
    readyHealthCheckRetryDelayMs: 150,
    createCredentialSnapshot: context => vaultHost.createHydrationFrame(context),
  };
  try {
    const started = await host.start(startOptions);
    const firstSnapshot = (await request(started.readiness.port, started.apiSessionToken)).body;
    const beforeInjection = await state(started.readiness.port, started.apiSessionToken);
    const oldMessages = [
      { type: ['secure', 'credential', 'set'].join('-'), ref: 'cloud/injected', value: { provider: 'openai', apiKey: secret, model: 'forbidden-model' } },
      { type: ['secure', 'credential', 'hydrate'].join('-'), ref: 'cloud/injected', value: { provider: 'openai', apiKey: secret, model: 'forbidden-model' } },
      { type: ['secure', 'credential', 'delete'].join('-'), ref: 'cloud/injected' }
    ];
    for (const message of oldMessages) started.child.send(message);
    await new Promise(resolve => setTimeout(resolve, 250));
    const afterInjection = await state(started.readiness.port, started.apiSessionToken);

    await vaultHost.persistFromDesktop('provider/test', { refreshToken: secret });
    const firstToken = started.apiSessionToken;
    const restarted = await host.restart({ ...startOptions, gracefulMs: 8000, forceMs: 8000 });
    const secondSnapshot = (await request(restarted.readiness.port, restarted.apiSessionToken)).body;
    const afterRestart = await state(restarted.readiness.port, restarted.apiSessionToken);

    const persistResponse = await request(restarted.readiness.port, restarted.apiSessionToken, '/api/wp4/credential-persist-probe', {
      method: 'POST', body: { ref: 'telegram/generated-session', value: { session: generatedSecret } }
    });
    const afterPersist = await state(restarted.readiness.port, restarted.apiSessionToken);

    memory.failingRefs.add('telegram/failing-session');
    const failureResponse = await request(restarted.readiness.port, restarted.apiSessionToken, '/api/wp4/credential-persist-probe', {
      method: 'POST', body: { ref: 'telegram/failing-session', value: { session: 'must-not-persist' } }
    });
    const afterFailure = await state(restarted.readiness.port, restarted.apiSessionToken);

    const finalRestart = await host.restart({ ...startOptions, gracefulMs: 8000, forceMs: 8000 });
    const afterFinalRestart = await state(finalRestart.readiness.port, finalRestart.apiSessionToken);

    const forms = [secret, generatedSecret, 'must-not-persist'].flatMap(value => [
      value,
      crypto.createHash('sha256').update(value).digest('hex'),
      crypto.createHash('sha256').update(value).digest('hex').toUpperCase(),
      crypto.createHash('sha256').update(value).digest('base64'),
      crypto.createHash('sha256').update(value).digest('base64url'),
      Buffer.from(value).toString('base64'),
      Buffer.from(value).toString('base64url')
    ]);
    const fileRows = collectFiles(dataRoot).map(file => ({ file: path.relative(dataRoot, file).replaceAll(path.sep, '/'), bytes: fs.readFileSync(file) }));
    const corpus = Buffer.concat(fileRows.map(row => row.bytes)).toString('latin1');
    const leaks = forms.filter(value => corpus.includes(value));
    const order = host.snapshot().stateHistory.map(row => row.reason);
    const checks = {
      dedicatedProductionEntryExecuted: path.resolve(startOptions.entry) === path.join(repoRoot, 'backend', 'desktopHostedEntry.js'),
      emptySnapshotReachedReady: started.hydration?.entryCount === 0 && firstSnapshot?.runtime?.localReady === true,
      postReadyGenericIpcIgnored: beforeInjection.security.credentialRefs === 0 && afterInjection.security.credentialRefs === 0,
      appRuntimeMetadataUnaffectedByGenericIpc: beforeInjection.credentialMetadata.entryCount === 0 && afterInjection.credentialMetadata.entryCount === 0 && afterInjection.credentialMetadata.generation === 1,
      modelRegistryUnaffectedByGenericIpc: afterInjection.modelCount === beforeInjection.modelCount,
      genericIpcDidNotUseCustodyPipe: afterInjection.secureBridge.custody.requestCount === 0,
      controlledRestartAppliedVaultMutation: restarted.hydration?.entryCount === 1 && restarted.hydration?.generation === 3 && secondSnapshot?.credentialHydration?.entryCount === 1,
      apiSessionRotatedOnRestart: firstToken !== restarted.apiSessionToken,
      backendGeneratedSecretAcked: persistResponse.statusCode === 200 && persistResponse.body?.persisted === true,
      authorityMetadataConsistentAfterAck: afterPersist.credentialMetadata.generation === 4 && afterPersist.sqliteCredentialMetadata.generation === 4 && afterPersist.security.credentialRefs === 2 && afterPersist.secureBridge.credentialRefs === 2 && vaultHost.snapshotMetadata().generation >= 4,
      vaultFailureReturnedFailure: failureResponse.statusCode >= 400 && failureResponse.body?.reasonCode === 'CREDENTIAL_VAULT_PERSIST_FAILED',
      vaultFailureDidNotMutateRuntime: afterFailure.credentialMetadata.generation === 4 && afterFailure.security.credentialRefs === 2 && memory.vault.get('telegram/failing-session') === null,
      onlyAcknowledgedCredentialsRecoveredAfterRestart: afterFinalRestart.credentialMetadata.entryCount === 2 && afterFinalRestart.security.credentialRefs === 2 && afterFinalRestart.credentialMetadata.generation === 5,
      secretsAndHashesAbsentFromProductionFiles: leaks.length === 0,
      runningTransitionRequiresHandshake: order.includes('credential-hydrated-and-backend-ready'),
      dedicatedCustodyPipeUsed: afterPersist.secureBridge.approvedTransport === 'DEDICATED_INHERITED_PIPE_FD6_TRANSACTIONAL_CUSTODY' && afterPersist.secureBridge.custody.acknowledgedCount >= 1
    };
    const failed = Object.entries(checks).filter(([, pass]) => pass !== true).map(([name]) => name);
    if (failed.length) {
      const reasonCode = failed.some(name => /GenericIpc|genericIpc|modelRegistry|MetadataUnaffected/.test(name)) ? 'WP4_GENERIC_IPC_CREDENTIAL_BYPASS'
        : failed.some(name => /authorityMetadata/.test(name)) ? 'WP4_CREDENTIAL_STATE_AUTHORITY_SPLIT'
          : failed.some(name => /Acked|Failure|Recovered|Custody/.test(name)) ? 'WP4_CREDENTIAL_PERSISTENCE_UNACKNOWLEDGED'
            : failed.includes('secretsAndHashesAbsentFromProductionFiles') ? 'WP4_CREDENTIAL_SECRET_LEAK_DETECTED' : 'WP4_CREDENTIAL_READY_GATE_FAILED';
      throw Object.assign(new Error(`WP4 production credential scenario failed: ${failed.join(', ')}`), { reasonCode, checks, leaks, persistResponse, failureResponse, afterPersist, afterFailure, afterFinalRestart, hostSnapshot: host.snapshot(), vaultMetadata: vaultHost.snapshotMetadata() });
    }
    return {
      status: 'PASS', checks, buildId: firstSnapshot.buildId, vaultEpoch,
      firstGeneration: 1, desktopGeneration: 2, restartGeneration: 3, custodyGeneration: 4, finalGeneration: 5,
      scannedFileCount: fileRows.length, leakCount: leaks.length,
      approvedSecretTransports: ['DEDICATED_INHERITED_PIPE_FD5_STARTUP_SNAPSHOT', 'DEDICATED_INHERITED_PIPE_FD6_CUSTODY'],
      genericNodeIpcSecretTransportCount: 0, dedicatedCredentialPipeCount: 2,
      postReadyMutationAttemptCount: oldMessages.length,
      vaultAcknowledgement: { success: true, failureReasonCode: failureResponse.body?.reasonCode || '' },
      generationChanges: [1, 2, 3, 4, 5], secretValueRecorded: false, secretHashRecorded: false
    };
  } finally {
    await host.stop({ gracefulMs: 8000, forceMs: 8000 }).catch(() => {});
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(release.resourcesPath, { recursive: true, force: true });
  }
}

module.exports = { request, runProductionCredentialScenario };
if (require.main === module) runProductionCredentialScenario().then(value => process.stdout.write(`${JSON.stringify(value)}\n`)).catch(error => { process.stderr.write(`${error.reasonCode || error.code || 'WP4_PRODUCTION_SCENARIO_FAILED'} ${error.stack || error.message}\n`); if (error.checks) process.stderr.write(`${JSON.stringify({checks:error.checks,persistResponse:error.persistResponse,failureResponse:error.failureResponse,afterPersist:error.afterPersist,afterFailure:error.afterFailure,afterFinalRestart:error.afterFinalRestart,hostSnapshot:error.hostSnapshot,vaultMetadata:error.vaultMetadata})}\n`); process.exit(1); });
