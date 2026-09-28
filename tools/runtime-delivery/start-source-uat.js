'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  DEFAULT_PORT,
  assertSupportedNode,
  canonicalJson,
  discoverExistingDataRoots,
  electronExecutable,
  inspectDataRoot,
  installDependencies,
  normalizePort,
  portAvailable,
  prepareSourceUat,
  resolveDataRoot,
  verifyDependencyIntegrity
} = require('./source-uat-delivery');
const { startDetachedElectron, waitForRuntimeReady } = require('./source-uat-runtime-supervisor');

function parseArgs(argv) {
  const options = { install: false, prepareOnly: false, useExistingData: false, useLargestExistingData: false, allowNonWindows: false, allowDirty: false };
  for (const argument of argv) {
    if (argument === '--install') options.install = true;
    else if (argument === '--prepare-only') options.prepareOnly = true;
    else if (argument === '--existing-data') options.useExistingData = true;
    else if (argument === '--largest-existing-data') options.useLargestExistingData = true;
    else if (argument === '--allow-non-windows') options.allowNonWindows = true;
    else if (argument === '--allow-dirty') options.allowDirty = true;
    else if (argument.startsWith('--data-root=')) options.dataRoot = argument.slice('--data-root='.length);
    else if (argument.startsWith('--port=')) options.port = argument.slice('--port='.length);
    else if (argument.startsWith('--electron-zip=')) options.electronZip = argument.slice('--electron-zip='.length);
    else if (argument.startsWith('--electron-mirror=')) options.electronMirror = argument.slice('--electron-mirror='.length);
    else throw Object.assign(new Error(`不支持的参数：${argument}`), { reasonCode: 'SOURCE_UAT_ARGUMENT_INVALID' });
  }
  return options;
}

function dockerText(args) {
  return execFileSync('docker', args, { encoding: 'utf8', windowsHide: true }).trim();
}

function oneDockerContainer(filters, reasonCode) {
  const rows = dockerText(['ps', ...filters.flatMap((filter) => ['--filter', filter]), '--format', '{{.ID}}'])
    .split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  if (rows.length !== 1) {
    throw Object.assign(new Error('Source-UAT external Matrix owner must resolve to exactly one Docker container'), {
      reasonCode,
      details: { filters, matchCount: rows.length }
    });
  }
  return rows[0];
}

function publishedPort(containerId, containerPort) {
  const output = dockerText(['port', containerId, String(containerPort)]);
  const match = output.match(/:(\d+)\s*$/u);
  if (!match) {
    throw Object.assign(new Error('Source-UAT could not resolve a published Docker port'), {
      reasonCode: 'SOURCE_UAT_MATRIX_PUBLISHED_PORT_REQUIRED',
      details: { containerPort }
    });
  }
  return Number(match[1]);
}

function resolveExternalMatrixRuntimeProjection(sourceEnv = process.env) {
  const elementUrl = String(sourceEnv.YANCE_ELEMENT_URL || '').trim();
  if (!elementUrl || elementUrl === 'http://127.0.0.1:8080') return {};

  let parsed;
  try { parsed = new URL(elementUrl); }
  catch {
    throw Object.assign(new Error('Source-UAT external Element URL is invalid'), {
      reasonCode: 'SOURCE_UAT_ELEMENT_URL_INVALID'
    });
  }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.port) {
    throw Object.assign(new Error('Source-UAT external Element must be a local published Docker endpoint'), {
      reasonCode: 'SOURCE_UAT_EXTERNAL_ELEMENT_DOCKER_ENDPOINT_REQUIRED'
    });
  }

  const explicit = {
    YANCE_MATRIX_BASE_URL: String(sourceEnv.YANCE_MATRIX_BASE_URL || '').trim(),
    YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE: String(sourceEnv.YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE || '').trim(),
    YANCE_MAUTRIX_META_PROVISIONING_URL: String(sourceEnv.YANCE_MAUTRIX_META_PROVISIONING_URL || '').trim(),
    YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE: String(sourceEnv.YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE || '').trim(),
    YANCE_MAUTRIX_WHATSAPP_PROVISIONING_URL: String(sourceEnv.YANCE_MAUTRIX_WHATSAPP_PROVISIONING_URL || '').trim(),
    YANCE_MAUTRIX_WHATSAPP_PROVISIONING_SECRET_FILE: String(sourceEnv.YANCE_MAUTRIX_WHATSAPP_PROVISIONING_SECRET_FILE || '').trim(),
    YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL: String(sourceEnv.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL || '').trim(),
    YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE: String(sourceEnv.YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE || '').trim()
  };
  if (Object.values(explicit).every(Boolean)) return explicit;

  try {
    const elementContainer = oneDockerContainer([
      'publish=' + parsed.port,
      'label=com.docker.compose.service=element'
    ], 'SOURCE_UAT_ELEMENT_CONTAINER_AMBIGUOUS');
    const project = dockerText(['inspect', elementContainer, '--format', '{{ index .Config.Labels "com.docker.compose.project" }}']);
    const workingDir = dockerText(['inspect', elementContainer, '--format', '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}']);
    if (!project || !workingDir) {
      throw Object.assign(new Error('Source-UAT external Element container is missing Compose authority labels'), {
        reasonCode: 'SOURCE_UAT_COMPOSE_AUTHORITY_LABELS_REQUIRED'
      });
    }

    const service = (name) => oneDockerContainer([
      'label=com.docker.compose.project=' + project,
      'label=com.docker.compose.service=' + name
    ], 'SOURCE_UAT_MATRIX_SERVICE_CONTAINER_AMBIGUOUS');
    const synapsePort = publishedPort(service('synapse'), '8008/tcp');
    const metaPort = publishedPort(service('mautrix-meta'), '29319/tcp');
    const whatsappPort = publishedPort(service('mautrix-whatsapp'), '29318/tcp');
    const telegramPort = publishedPort(service('mautrix-telegram'), '29317/tcp');

    const secretDir = path.join(workingDir, 'secrets');
    const secrets = {
      YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE: path.join(secretDir, 'matrix-registration-secret'),
      YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE: path.join(secretDir, 'mautrix-meta-provisioning-secret'),
      YANCE_MAUTRIX_WHATSAPP_PROVISIONING_SECRET_FILE: path.join(secretDir, 'mautrix-whatsapp-provisioning-secret'),
      YANCE_MAUTRIX_TELEGRAM_PROVISIONING_SECRET_FILE: path.join(secretDir, 'mautrix-telegram-provisioning-secret')
    };
    for (const [key, filePath] of Object.entries(secrets)) {
      if (!fs.existsSync(filePath)) {
        throw Object.assign(new Error('Source-UAT Compose-owned Matrix secret projection is incomplete'), {
          reasonCode: 'SOURCE_UAT_MATRIX_SECRET_PROJECTION_INCOMPLETE',
          details: { missingKey: key }
        });
      }
    }

    return {
      YANCE_MATRIX_BASE_URL: 'http://127.0.0.1:' + synapsePort,
      YANCE_MAUTRIX_META_PROVISIONING_URL: 'http://127.0.0.1:' + metaPort + '/_matrix/provision',
      YANCE_MAUTRIX_WHATSAPP_PROVISIONING_URL: 'http://127.0.0.1:' + whatsappPort + '/_matrix/provision',
      YANCE_MAUTRIX_TELEGRAM_PROVISIONING_URL: 'http://127.0.0.1:' + telegramPort + '/_matrix/provision',
      ...secrets
    };
  } catch (error) {
    if (error?.reasonCode) throw error;
    throw Object.assign(new Error('Source-UAT failed to observe the external Docker Compose Matrix runtime'), {
      reasonCode: 'SOURCE_UAT_EXTERNAL_MATRIX_OBSERVATION_FAILED',
      cause: error
    });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedDataRoot = String(process.env.YANCE_UAT_SELECTED_DATA_ROOT || '').trim();
  if (!options.dataRoot && selectedDataRoot) options.dataRoot = selectedDataRoot;
  const repoRoot = path.resolve(__dirname, '..', '..');
  assertSupportedNode();
  if (process.platform !== 'win32' && !options.prepareOnly && !options.allowNonWindows) {
    throw Object.assign(new Error('此启动入口用于真实 Windows Electron 源码 UAT'), { reasonCode: 'SOURCE_UAT_WINDOWS_REQUIRED' });
  }
  const dependencyInstallation = options.install
    ? installDependencies(repoRoot, { electronZip: options.electronZip, electronMirror: options.electronMirror, maxAttempts: 3 })
    : null;
  const dependencyIntegrity = dependencyInstallation?.integrity || verifyDependencyIntegrity(repoRoot);
  const prepared = prepareSourceUat(repoRoot, { allowDirty: options.allowDirty });
  const port = normalizePort(options.port || process.env.YANCE_PORT || DEFAULT_PORT);
  const dataRootCandidates = discoverExistingDataRoots();
  const dataRoot = resolveDataRoot({ ...options, sourceIdentity: prepared.identity });
  fs.mkdirSync(dataRoot, { recursive: true });
  const selectedDataRootEvidence = inspectDataRoot(dataRoot);
  const largerDataRoot = dataRootCandidates.find(row => row.databaseSizeBytes > selectedDataRootEvidence.databaseSizeBytes);
  const softwareRendering = process.env.YANCE_DISABLE_GPU !== '0' && process.env.YANCE_ENABLE_HARDWARE_ACCELERATION !== '1';
  const launchReportPath = path.join(prepared.outputRoot, 'source-uat-launch.json');
  const launchBase = {
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_UAT_LAUNCH',
    sourceCommit: prepared.identity.commit,
    sourceTree: prepared.identity.tree,
    buildId: prepared.manifest.buildId,
    artifactClass: prepared.manifest.artifactClass,
    resourcesPath: prepared.outputRoot,
    dataRoot,
    dataMode: options.useLargestExistingData ? 'largest-existing-explicit' : options.useExistingData ? 'existing-explicit' : options.dataRoot ? 'custom-explicit' : 'isolated-default',
    selectedDataRootEvidence,
    dataRootCandidates,
    dataRootWarning: largerDataRoot ? `检测到更大的现有 SQLite 数据库：${largerDataRoot.dataRoot}（${largerDataRoot.databaseSizeBytes} 字节）；当前未自动切换。` : '',
    dataClone: {
      isolatedClone: process.env.YANCE_SOURCE_UAT_DATA_CLONE === '1',
      markerPath: String(process.env.YANCE_SOURCE_UAT_DATA_CLONE_MARKER || ''),
      safeModeResetRequested: process.env.YANCE_SOURCE_UAT_RESET_SAFE_MODE === '1',
      realDataMutationAllowed: false
    },
    port,
    fullPipelineExecuted: false,
    wp7Executed: false,
    strictExecuted: false,
    builderExecuted: false,
    softwareRendering,
    runtimeGovernanceBinding: {
      windowsUatAuthorized: process.env.YANCE_WINDOWS_UAT_AUTHORIZED === '1',
      authorizationId: String(process.env.YANCE_WINDOWS_UAT_AUTHORIZATION_ID || ''),
      authorizationRecordPath: String(process.env.YANCE_WINDOWS_UAT_AUTHORIZATION_RECORD || ''),
      prelaunchGateReceiptPath: String(process.env.YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT || ''),
      expectedCommit: String(process.env.YANCE_UAT_EXPECTED_COMMIT || prepared.identity.commit),
      expectedTree: String(process.env.YANCE_UAT_EXPECTED_TREE || prepared.identity.tree),
      formalRelease: false
    },
    dependencyIntegrity: {
      ok: dependencyIntegrity.ok,
      directDependencyCount: dependencyIntegrity.directDependencyCount,
      installedCount: dependencyIntegrity.installedCount,
      missingCount: dependencyIntegrity.missing.length,
      invalidCount: dependencyIntegrity.invalid.length,
      checkedAtUtc: dependencyIntegrity.checkedAtUtc
    },
    dependencyInstallation: dependencyInstallation ? {
      mode: dependencyInstallation.mode,
      attemptCount: dependencyInstallation.install?.attempts?.length || 0,
      logRoot: dependencyInstallation.install?.logRoot || '',
      cleanInstallReceipt: dependencyInstallation.cleanInstallReceipt || null
    } : null
  };
  if (options.prepareOnly) {
    fs.writeFileSync(launchReportPath, canonicalJson({ ...launchBase, status: 'PREPARED_ONLY', preparedAtUtc: new Date().toISOString() }), 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'PREPARED_ONLY', ...launchBase }, null, 2)}\n`);
    return;
  }
  if (!(await portAvailable(port))) {
    throw Object.assign(new Error(`端口 ${port} 已被占用。请完全退出已安装的言策或使用 --port=其他端口。`), { reasonCode: 'SOURCE_UAT_PORT_IN_USE', details: { port } });
  }
  const electron = electronExecutable(repoRoot);
  const externalMatrixRuntimeProjection = resolveExternalMatrixRuntimeProjection(process.env);
  const env = {
    ...process.env,
    ...externalMatrixRuntimeProjection,
    YANCE_RELEASE_RESOURCES_PATH: prepared.outputRoot,
    YANCE_DATA_DIR: dataRoot,
    YANCE_PORT: String(port),
    YANCE_RUNTIME_MODE: 'production',
    YANCE_ALLOW_DEMO_MODE: '0',
    YANCE_AUTO_START_WHATSAPP: '0',
    YANCE_SOURCE_UAT: '1',
    YANCE_BACKEND_STARTUP_TIMEOUT_MS: String(process.env.YANCE_BACKEND_STARTUP_TIMEOUT_MS || 180000),
    YANCE_DISABLE_GPU: softwareRendering ? '1' : '0',
    YANCE_PLATFORM_AUTH_CONFIG_PATH: prepared.platformAuth.configPath || '',
    YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH: prepared.platformAuth.hashPath || ''
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const startedAtUtc = new Date().toISOString();
  fs.writeFileSync(launchReportPath, canonicalJson({ ...launchBase, status: 'STARTING', startedAtUtc, electronExecutable: electron }), 'utf8');
  process.stdout.write('言策源码 UAT 启动信息：\n');
  process.stdout.write(`- Source: ${prepared.identity.commit}\n`);
  process.stdout.write(`- Tree: ${prepared.identity.tree}\n`);
  process.stdout.write(`- Data: ${dataRoot}\n`);
  process.stdout.write(`- Port: ${port}\n`);
  process.stdout.write(`- Mode: ${launchBase.dataMode}\n`);
  process.stdout.write(`- Dependencies: ${dependencyIntegrity.installedCount}/${dependencyIntegrity.directDependencyCount} verified\n`);
  if (launchBase.dataRootWarning) process.stdout.write(`[数据目录提醒] ${launchBase.dataRootWarning}\n`);
  const runtimeLogRoot = path.join(prepared.outputRoot, 'runtime-logs');
  const launched = startDetachedElectron({ electron, repoRoot, env, logRoot: runtimeLogRoot });
  launched.child.once('error', error => {
    try {
      fs.writeFileSync(launchReportPath, canonicalJson({ ...launchBase, platform: process.platform, status: 'FAILED', startedAtUtc, failedAtUtc: new Date().toISOString(), reasonCode: 'SOURCE_UAT_ELECTRON_SPAWN_FAILED', message: error.message }), 'utf8');
    } catch (_) {}
  });
  const runtimeReady = await waitForRuntimeReady({
    port,
    child: launched.child,
    timeoutMs: Number(env.YANCE_BACKEND_STARTUP_TIMEOUT_MS || 180000)
  });
  const electronExecutableSha256 = crypto.createHash('sha256').update(fs.readFileSync(electron)).digest('hex');
  const readyReceipt = {
    ...launchBase,
    platform: process.platform,
    arch: process.arch,
    status: 'RUNTIME_READY',
    startedAtUtc,
    readyAtUtc: runtimeReady.readyAtUtc,
    electronExecutable: electron,
    electronExecutableSha256,
    electronPid: runtimeReady.electronPid,
    backendPid: runtimeReady.backendPid,
    readiness: runtimeReady.readiness,
    electronLogs: {
      stdoutPath: launched.stdoutPath,
      stderrPath: launched.stderrPath
    }
  };
  fs.writeFileSync(launchReportPath, canonicalJson(readyReceipt), 'utf8');
  process.stdout.write(`${JSON.stringify({ status: 'RUNTIME_READY', launchReportPath, electronPid: runtimeReady.electronPid, backendPid: runtimeReady.backendPid, electronExecutableSha256 }, null, 2)}\n`);
  process.exitCode = 0;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_START_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exitCode = 1;
});
