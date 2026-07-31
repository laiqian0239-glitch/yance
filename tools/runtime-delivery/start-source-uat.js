'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  const dataRoot = resolveDataRoot(options);
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
      logRoot: dependencyInstallation.install?.logRoot || ''
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
  const env = {
    ...process.env,
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
  const child = spawn(electron, [repoRoot], { cwd: repoRoot, env, stdio: 'inherit', windowsHide: false });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code: Number.isInteger(code) ? code : 1, signal: signal || null }));
  });
  fs.writeFileSync(launchReportPath, canonicalJson({ ...launchBase, status: exitCode.code === 0 ? 'EXITED' : 'FAILED', startedAtUtc, exitedAtUtc: new Date().toISOString(), exitCode: exitCode.code, signal: exitCode.signal }), 'utf8');
  process.exitCode = exitCode.code;
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_START_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exitCode = 1;
});
