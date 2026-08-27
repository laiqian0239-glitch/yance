#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const DOCUMENT_TYPE = 'YANCE_STARTUP_CAPSULE_MANIFEST';
const EXCLUDED_HEAVY_PREFIXES = Object.freeze([
  'resources/parlant-runtime/',
  'resources/learning-runtime/',
  'resources/models/',
  'resources/model-assets/',
  'resources/media/',
  'resources/training/',
  'resources/cache/'
]);
const REQUIRED_APPLICATION_PREFIXES = Object.freeze([
  'resources/app/',
  'resources/runtime/node22/'
]);
const STARTUP_PROOF_LABELS = Object.freeze([
  'server import',
  'startup.migrate',
  'backend ready',
  'Element ModuleLoader',
  'post-install'
]);
let failureDiagnosticsRoot = null;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function persistFailureDetail(detail) {
  if (!failureDiagnosticsRoot) return;
  fs.mkdirSync(failureDiagnosticsRoot, { recursive: true });
  fs.writeFileSync(
    path.join(failureDiagnosticsRoot, 'startup-capsule-failure.json'),
    `${JSON.stringify(detail, null, 2)}\n`,
    'utf8'
  );
}

function arg(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (required && (!value || value.startsWith('--'))) fail('STARTUP_CAPSULE_ARGUMENT_REQUIRED', `${name} requires a value`, { name });
  return value || null;
}

function canonicalRelative(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//u, '');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function assertDirectory(value, label) {
  const absolute = path.resolve(String(value || ''));
  if (!value || !fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
    fail('STARTUP_CAPSULE_DIRECTORY_MISSING', `${label} must be an existing directory`, { absolute });
  }
  return fs.realpathSync(absolute);
}

function assertEmptyOutput(value) {
  const absolute = path.resolve(String(value || ''));
  if (fs.existsSync(absolute)) {
    if (!fs.statSync(absolute).isDirectory() || fs.readdirSync(absolute).length) {
      fail('STARTUP_CAPSULE_OUTPUT_NOT_EMPTY', 'startup-capsule output must be absent or empty', { absolute });
    }
  } else {
    fs.mkdirSync(absolute, { recursive: true });
  }
  return fs.realpathSync(absolute);
}

function walkFiles(root) {
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) fail('STARTUP_CAPSULE_SYMLINK_FORBIDDEN', 'startup-capsule projection does not accept symlink origins', { absolute });
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  walk(root);
  return files;
}

function isExcludedApplicationPath(relative) {
  const normalized = canonicalRelative(relative).toLowerCase();
  return EXCLUDED_HEAVY_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function isStartupApplicationFile(relative) {
  const normalized = canonicalRelative(relative);
  const lower = normalized.toLowerCase();
  if (isExcludedApplicationPath(lower)) return false;
  if (lower === 'yance.exe') return true;
  if (REQUIRED_APPLICATION_PREFIXES.some(prefix => lower.startsWith(prefix))) return true;
  if (!lower.includes('/')) return true; // Electron DLLs, .pak files, snapshots and root runtime resources.
  if (lower.startsWith('locales/') || lower.startsWith('swiftshader/')) return true;
  if (lower.startsWith('resources/') && lower.split('/').length === 2) return true;
  return false;
}

function copyOriginFile({ sourceRoot, sourceFile, destinationRoot, originClass, records }) {
  const relative = canonicalRelative(path.relative(sourceRoot, sourceFile));
  const destination = path.join(destinationRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(sourceFile, destination);
  const sourceStat = fs.statSync(sourceFile);
  const destinationStat = fs.statSync(destination);
  const sourceHash = sha256File(sourceFile);
  const destinationHash = sha256File(destination);
  if (sourceStat.size !== destinationStat.size || sourceHash !== destinationHash) {
    fail('STARTUP_CAPSULE_BYTE_IDENTITY_MISMATCH', 'startup-capsule byte identity hash mismatch', {
      originClass,
      origin: relative,
      sourceSize: sourceStat.size,
      capsuleSize: destinationStat.size,
      sourceSha256: sourceHash,
      capsuleSha256: destinationHash
    });
  }
  records.push({
    path: canonicalRelative(path.relative(path.dirname(destinationRoot), destination)),
    originClass,
    origin: relative,
    size: destinationStat.size,
    sha256: destinationHash,
    byteIdentical: true
  });
}

function writeGeneratedFile(file, content, records, capsuleRoot, classification = 'generated-capsule-metadata') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  const stat = fs.statSync(file);
  records.push({
    path: canonicalRelative(path.relative(capsuleRoot, file)),
    originClass: classification,
    origin: null,
    size: stat.size,
    sha256: sha256File(file),
    byteIdentical: null
  });
}

function findApplicationPayload(applicationRoot) {
  const direct = path.join(applicationRoot, 'application-payload');
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return fs.realpathSync(direct);
  const yanceExe = walkFiles(applicationRoot).find(file => path.basename(file).toLowerCase() === 'yance.exe');
  if (!yanceExe) fail('STARTUP_CAPSULE_YANCE_EXE_MISSING', 'Yance.exe is missing from the extracted full application');
  return path.dirname(yanceExe);
}

function inspectPopulatedR32(dataRoot) {
  const databasePath = walkFiles(dataRoot).find(file => path.basename(file).toLowerCase() === 'yance-r32.db');
  if (!databasePath) fail('STARTUP_CAPSULE_R32_FIXTURE_MISSING', 'populated disposable R32 fixture is missing yance-r32.db');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name));
    let populatedTable = null;
    for (const table of tables) {
      if (!/^[A-Za-z0-9_]+$/u.test(table)) continue;
      try {
        const row = database.prepare(`SELECT COUNT(*) AS count FROM \"${table}\"`).get();
        if (Number(row?.count || 0) > 0) { populatedTable = { table, rows: Number(row.count) }; break; }
      } catch (_) {}
    }
    if (!tables.length || !populatedTable) {
      fail('STARTUP_CAPSULE_R32_FIXTURE_NOT_POPULATED', 'R32 fixture must contain schema and at least one stored row; clean empty profile substitution is forbidden', { databasePath, tableCount: tables.length });
    }
    return { databasePath, tableCount: tables.length, populatedTable };
  } finally {
    database.close();
  }
}

function copyFixture(sourceDataRoot, destinationDataRoot, records, capsuleRoot) {
  fs.mkdirSync(destinationDataRoot, { recursive: true });
  for (const sourceFile of walkFiles(sourceDataRoot)) {
    const relative = canonicalRelative(path.relative(sourceDataRoot, sourceFile));
    const destination = path.join(destinationDataRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(sourceFile, destination);
    const stat = fs.statSync(destination);
    records.push({
      path: canonicalRelative(path.relative(capsuleRoot, destination)),
      originClass: 'disposable-r32-fixture',
      origin: relative,
      size: stat.size,
      sha256: sha256File(destination),
      byteIdentical: sha256File(sourceFile) === sha256File(destination)
    });
  }
  return inspectPopulatedR32(destinationDataRoot);
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'application/javascript; charset=utf-8';
    case '.json':
    case '.map': return 'application/json; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

function startElementHost(root) {
  const server = http.createServer((request, response) => {
    const raw = decodeURIComponent(String(request.url || '/').split('?')[0]).replace(/\\/gu, '/');
    const relative = raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
    let candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      response.writeHead(400); response.end('bad request'); return;
    }
    try {
      if (fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, 'index.html');
    } catch (_) {
      if (!path.extname(candidate)) candidate = path.join(root, 'index.html');
    }
    fs.readFile(candidate, (error, body) => {
      if (error) { response.writeHead(404); response.end('not found'); return; }
      response.writeHead(200, { 'content-type': contentType(candidate), 'content-length': body.length, 'cache-control': 'no-cache' });
      response.end(body);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/u).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch (_) { return []; }
  });
}

function eventName(record) {
  return String(record?.event || record?.message || record?.name || record?.type || '');
}

function verifyStartupDiagnostics(dataRoot, startedAtMs) {
  const logsRoot = path.join(dataRoot, 'logs');
  const diagnostics = readJsonLines(path.join(logsRoot, 'desktop-bootstrap.jsonl'))
    .concat(readJsonLines(path.join(logsRoot, 'desktop.jsonl')))
    .concat(readJsonLines(path.join(logsRoot, 'server.jsonl')));
  const fresh = diagnostics.filter(record => {
    const raw = record?.at || record?.timestamp || record?.time || record?.createdAtUtc || record?.generatedAtUtc;
    const value = Date.parse(String(raw || ''));
    return Number.isFinite(value) ? value >= startedAtMs - 1000 : true;
  });
  const text = fresh.map(record => JSON.stringify(record)).join('\n');
  if (!/backend-boot-started/u.test(text)) fail('STARTUP_CAPSULE_SERVER_IMPORT_PROOF_MISSING', 'server import proof is missing backend-boot-started');
  if (!/backend-boot-ready/u.test(text) && !/server-started/u.test(text)) fail('STARTUP_CAPSULE_BACKEND_READY_PROOF_MISSING', 'backend ready proof is missing');
  if (!/startupMigration/u.test(text) && !/migration-completed/u.test(text) && !/legacyMigrationReadyMs/u.test(text)) {
    fail('STARTUP_CAPSULE_STARTUP_MIGRATE_PROOF_MISSING', 'startup.migrate proof is missing from fresh backend diagnostics');
  }
  return { recordCount: fresh.length };
}

async function waitForReceipt(receiptPath, child, startedAtMs, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail('STARTUP_CAPSULE_YANCE_EXITED', 'capsule Yance.exe exited before fresh post-install receipt', { exitCode: child.exitCode });
    if (fs.existsSync(receiptPath)) {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      const activated = Date.parse(String(receipt.activatedAtUtc || ''));
      if (receipt.documentType !== 'YANCE_POST_INSTALL_LAUNCH_RECEIPT' || receipt.status !== 'PASS' || !Number.isFinite(activated) || activated < startedAtMs) {
        fail('STARTUP_CAPSULE_POST_INSTALL_RECEIPT_INVALID', 'fresh post-install PASS receipt is invalid or stale', { receipt });
      }
      return receipt;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  fail('STARTUP_CAPSULE_POST_INSTALL_TIMEOUT', 'timed out waiting for fresh post-install PASS receipt', { receiptPath });
}

function killProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

async function validateCapsuleLaunch({ capsuleRoot, applicationDestination, elementDestination, fixtureDataRoot, records }) {
  const yanceExe = walkFiles(applicationDestination).find(file => path.basename(file).toLowerCase() === 'yance.exe');
  if (!yanceExe) fail('STARTUP_CAPSULE_YANCE_EXE_MISSING', 'capsule Yance.exe is missing');
  const configPath = path.join(elementDestination, 'config.json');
  if (!fs.existsSync(configPath)) fail('STARTUP_CAPSULE_ELEMENT_CONFIG_MISSING', 'Element ModuleLoader config.json is missing from exact same-job element-host projection');
  const moduleEntry = path.join(elementDestination, 'modules', 'yance', 'lib', 'index.js');
  if (!fs.existsSync(moduleEntry)) fail('STARTUP_CAPSULE_ELEMENT_MODULE_MISSING', 'Element ModuleLoader module output is missing');

  const host = await startElementHost(elementDestination);
  const receiptPath = path.join(fixtureDataRoot, 'logs', 'post-install-launch.json');
  fs.rmSync(receiptPath, { force: true });
  const startedAtMs = Date.now();
  const child = spawn(yanceExe, ['--post-install'], {
    cwd: path.dirname(yanceExe),
    env: {
      ...process.env,
      YANCE_DATA_DIR: fixtureDataRoot,
      YANCE_ELEMENT_URL: host.url,
      YANCE_ELEMENT_HEALTH_URL: `${host.url}/config.json`,
      YANCE_WP2_PRODUCTION_RUNTIME_PROBE: '1'
    },
    stdio: 'ignore',
    windowsHide: false
  });

  try {
    const receipt = await waitForReceipt(receiptPath, child, startedAtMs);
    const diagnostics = verifyStartupDiagnostics(fixtureDataRoot, startedAtMs);
    const proof = {
      schemaVersion: 1,
      documentType: 'YANCE_STARTUP_CAPSULE_PROOF',
      status: 'PASS',
      startedAtUtc: new Date(startedAtMs).toISOString(),
      completedAtUtc: new Date().toISOString(),
      checkpoints: {
        'server import': 'PASS',
        'startup.migrate': 'PASS',
        'backend ready': 'PASS',
        'Element ModuleLoader': 'PASS',
        'post-install': 'PASS'
      },
      receiptActivatedAtUtc: receipt.activatedAtUtc,
      freshDiagnosticRecordCount: diagnostics.recordCount
    };
    const proofPath = path.join(capsuleRoot, 'diagnostics', 'STARTUP_CAPSULE_PROOF.json');
    writeGeneratedFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, records, capsuleRoot, 'diagnostic-proof');
    return proof;
  } finally {
    killProcessTree(child);
    await new Promise(resolve => host.server.close(resolve));
  }
}

function generatedScripts() {
  const runner = `param([string]$DataRoot = (Join-Path $PSScriptRoot 'fixture\\data'))\n$ErrorActionPreference = 'Stop'\n$env:YANCE_DATA_DIR = (Resolve-Path $DataRoot).Path\n$env:YANCE_ELEMENT_URL = 'http://127.0.0.1:18080'\n$env:YANCE_ELEMENT_HEALTH_URL = 'http://127.0.0.1:18080/config.json'\n& (Join-Path $PSScriptRoot 'application-payload\\Yance.exe') --post-install\n`;
  const collector = `param([string]$DataRoot = (Join-Path $PSScriptRoot 'fixture\\data'))\n$ErrorActionPreference = 'Stop'\n$destination = Join-Path $PSScriptRoot 'diagnostics\\collected'\nNew-Item -ItemType Directory -Force -Path $destination | Out-Null\nGet-ChildItem -LiteralPath (Join-Path $DataRoot 'logs') -File -ErrorAction SilentlyContinue | Copy-Item -Destination $destination -Force\n`;
  return { runner, collector };
}

async function run() {
  failureDiagnosticsRoot = null;
  const applicationRoot = assertDirectory(arg('--application-root'), 'extracted full application root');
  const elementHostRoot = assertDirectory(arg('--element-host-root'), 'exact same-job Element host root');
  const sourceDataRoot = assertDirectory(arg('--data-root'), 'populated disposable R32 source data root');
  const outputRoot = assertEmptyOutput(arg('--output-root'));
  failureDiagnosticsRoot = path.join(outputRoot, 'startup-capsule', 'diagnostics');
  const candidateCommit = String(arg('--candidate-commit'));
  const candidateTree = String(arg('--candidate-tree'));
  if (!/^[0-9a-f]{40}$/u.test(candidateCommit) || !/^[0-9a-f]{40}$/u.test(candidateTree)) {
    fail('STARTUP_CAPSULE_IDENTITY_INVALID', 'candidate commit/tree must be exact 40-character Git object IDs');
  }

  const capsuleRoot = path.join(outputRoot, 'startup-capsule');
  const applicationSource = findApplicationPayload(applicationRoot);
  const applicationDestination = path.join(capsuleRoot, 'application-payload');
  const elementDestination = path.join(capsuleRoot, 'element-host');
  const fixtureDataRoot = path.join(capsuleRoot, 'fixture', 'data');
  fs.mkdirSync(applicationDestination, { recursive: true });
  fs.mkdirSync(elementDestination, { recursive: true });
  const records = [];

  const selectedApplicationFiles = walkFiles(applicationSource).filter(file => isStartupApplicationFile(path.relative(applicationSource, file)));
  if (!selectedApplicationFiles.some(file => path.basename(file).toLowerCase() === 'yance.exe')) fail('STARTUP_CAPSULE_YANCE_EXE_MISSING', 'Yance.exe was not selected from the full-application projection');
  for (const requiredPrefix of REQUIRED_APPLICATION_PREFIXES) {
    if (!selectedApplicationFiles.some(file => canonicalRelative(path.relative(applicationSource, file)).toLowerCase().startsWith(requiredPrefix))) {
      fail('STARTUP_CAPSULE_REQUIRED_APPLICATION_PREFIX_MISSING', `required full-application startup prefix is missing: ${requiredPrefix}`);
    }
  }
  for (const sourceFile of selectedApplicationFiles) {
    copyOriginFile({ sourceRoot: applicationSource, sourceFile, destinationRoot: applicationDestination, originClass: 'full-application', records });
  }

  for (const sourceFile of walkFiles(elementHostRoot)) {
    copyOriginFile({ sourceRoot: elementHostRoot, sourceFile, destinationRoot: elementDestination, originClass: 'element-host', records });
  }

  const fixtureInspection = inspectPopulatedR32(sourceDataRoot);
  const copiedFixtureInspection = copyFixture(sourceDataRoot, fixtureDataRoot, records, capsuleRoot);
  const scripts = generatedScripts();
  writeGeneratedFile(path.join(capsuleRoot, 'RUN_STARTUP_CAPSULE.ps1'), scripts.runner, records, capsuleRoot, 'startup-runner');
  writeGeneratedFile(path.join(capsuleRoot, 'COLLECT_STARTUP_DIAGNOSTICS.ps1'), scripts.collector, records, capsuleRoot, 'diagnostic-collector');

  const proof = await validateCapsuleLaunch({ capsuleRoot, applicationDestination, elementDestination, fixtureDataRoot, records });
  const byteIdentityFailures = records.filter(record => ['full-application', 'element-host'].includes(record.originClass) && record.byteIdentical !== true);
  if (byteIdentityFailures.length) fail('STARTUP_CAPSULE_BYTE_IDENTITY_MISMATCH', 'capsule contains a non-byte-identical mapped origin', { byteIdentityFailures });

  const manifest = {
    schemaVersion: 1,
    documentType: DOCUMENT_TYPE,
    status: 'PASS',
    generatedAtUtc: new Date().toISOString(),
    candidateCommit,
    candidateTree,
    projection: 'same-build full-application + exact same-job element-host',
    secondApplicationBuild: false,
    byteIdentity: 'VERIFIED',
    startupProof: proof.checkpoints,
    populatedDisposableR32: {
      sourceTableCount: fixtureInspection.tableCount,
      sourcePopulatedTable: fixtureInspection.populatedTable,
      capsuleTableCount: copiedFixtureInspection.tableCount,
      capsulePopulatedTable: copiedFixtureInspection.populatedTable
    },
    exclusions: EXCLUDED_HEAVY_PREFIXES.map(prefix => ({ prefix, reason: 'excluded heavy runtime/model/media/training/cache payload not required for startup boundary' })),
    startupProofLabels: STARTUP_PROOF_LABELS,
    files: records.sort((a, b) => a.path.localeCompare(b.path))
  };
  const manifestPath = path.join(capsuleRoot, 'STARTUP_CAPSULE_MANIFEST.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestSha256 = sha256File(manifestPath);
  fs.writeFileSync(`${manifestPath}.sha256`, `${manifestSha256}  STARTUP_CAPSULE_MANIFEST.json\n`, 'utf8');

  const totalBytes = walkFiles(capsuleRoot).reduce((sum, file) => sum + fs.statSync(file).size, 0);
  const summary = {
    status: 'PASS',
    capsuleRoot,
    fileCount: walkFiles(capsuleRoot).length,
    sizeBytes: totalBytes,
    sizeMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
    manifestSha256,
    fullApplicationByteIdenticalFileCount: records.filter(record => record.originClass === 'full-application').length,
    elementHostByteIdenticalFileCount: records.filter(record => record.originClass === 'element-host').length,
    startupProof: proof.checkpoints
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}

if (require.main === module) {
  run().catch(error => {
    const detail = {
      status: 'FAIL',
      code: error.code || 'STARTUP_CAPSULE_FAILED',
      message: error.message,
      details: error.details || {},
      generatedAtUtc: new Date().toISOString()
    };
    try {
      persistFailureDetail(detail);
    } catch (persistenceError) {
      detail.diagnosticsPersistence = {
        status: 'FAIL',
        code: 'STARTUP_CAPSULE_FAILURE_TELEMETRY_WRITE_FAILED',
        message: persistenceError?.message || String(persistenceError)
      };
    }
    process.stderr.write(`${JSON.stringify(detail)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  EXCLUDED_HEAVY_PREFIXES,
  REQUIRED_APPLICATION_PREFIXES,
  isStartupApplicationFile,
  inspectPopulatedR32,
  run
};