'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_KEYS = new Set([
  'apihash', 'api_hash', 'appsecret', 'accesstoken', 'refreshtoken', 'pagetoken',
  'verifytoken', 'session', 'cookie', 'encryptionkey', 'privatekey', 'masterkey'
]);
const FORBIDDEN_FILE_NAMES = new Set([
  'platform-auth.json', 'yance-r32.db', 'yance-r32.db-wal', 'yance-r32.db-shm',
  'desktop-credential-vault.json', 'desktop-credentials.json'
]);

function clean(value, max = 4000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeIso(value) {
  const text = clean(value, 80);
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sourceIdentity(resourcesRoot) {
  const manifest = readJson(path.join(resourcesRoot, 'release-manifest.json'), {}) || {};
  const preparation = readJson(path.join(resourcesRoot, 'source-uat-preparation.json'), {}) || {};
  const identity = preparation.sourceIdentity || {};
  return {
    schemaVersion: 1,
    documentType: 'YANCE_SAFE_EVIDENCE_SOURCE_IDENTITY',
    branch: clean(identity.branch || manifest.sourceUat?.branch, 240),
    commit: clean(identity.commit || manifest.sourceCommit || manifest.gitCommit, 64),
    tree: clean(identity.tree || manifest.sourceTree, 64),
    tag: clean(identity.tag || manifest.sourceUat?.tag, 240),
    buildId: clean(manifest.buildId, 240),
    artifactClass: clean(manifest.artifactClass, 120),
    formalPublicReleaseAuthorized: manifest.formalPublicReleaseAuthorized === true,
    fullPipelineExecuted: manifest.sourceUat?.fullPipelineExecuted === true,
    wp7Executed: manifest.sourceUat?.wp7Executed === true,
    strictExecuted: manifest.sourceUat?.strictExecuted === true,
    builderExecuted: manifest.sourceUat?.builderExecuted === true
  };
}

function runtimeSummary(resourcesRoot) {
  const launch = readJson(path.join(resourcesRoot, 'source-uat-launch.json'), {}) || {};
  const selected = launch.selectedDataRootEvidence || {};
  return {
    schemaVersion: 1,
    documentType: 'YANCE_SAFE_EVIDENCE_RUNTIME_SUMMARY',
    sourceCommit: clean(launch.sourceCommit, 64),
    sourceTree: clean(launch.sourceTree, 64),
    dataMode: clean(launch.dataMode, 80),
    databaseExists: selected.databaseExists === true,
    databaseSizeBytes: safeNumber(selected.databaseSizeBytes),
    walSizeBytes: safeNumber(selected.walSizeBytes),
    candidateCount: Array.isArray(launch.dataRootCandidates) ? launch.dataRootCandidates.length : 0,
    port: safeNumber(launch.port),
    status: clean(launch.status, 80),
    startedAtUtc: safeIso(launch.startedAtUtc),
    exitedAtUtc: safeIso(launch.exitedAtUtc),
    exitCode: Number.isInteger(Number(launch.exitCode)) ? Number(launch.exitCode) : null,
    signal: clean(launch.signal, 80) || null,
    softwareRendering: launch.softwareRendering === true,
    warningCode: clean(launch.dataRootWarning, 240)
  };
}

function platformAuthSummary(resourcesRoot) {
  const manifest = readJson(path.join(resourcesRoot, 'release-manifest.json'), {}) || {};
  const preparation = readJson(path.join(resourcesRoot, 'source-uat-preparation.json'), {}) || {};
  return {
    schemaVersion: 1,
    documentType: 'YANCE_SAFE_EVIDENCE_PLATFORM_AUTH_SUMMARY',
    configured: manifest.platformAuthConfigured === true || preparation.platformAuth?.configured === true,
    releaseManaged: manifest.platformAuthReleaseManaged === true,
    configSha256: clean(manifest.platformAuthConfigSha256 || preparation.platformAuth?.configSha256, 64),
    rawConfigExported: false,
    secretFieldsReadForEvidence: false,
    secretFieldsWrittenToEvidence: false
  };
}

function scanJson(value, file, pointer = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJson(item, file, `${pointer}[${index}]`, findings));
    return findings;
  }
  if (!value || typeof value !== 'object') return findings;
  for (const [key, item] of Object.entries(value)) {
    const normalized = clean(key).toLowerCase().replace(/[^a-z0-9_]/gu, '');
    if (SECRET_KEYS.has(normalized)) findings.push({ file, pointer: `${pointer}.${key}`, key });
    scanJson(item, file, `${pointer}.${key}`, findings);
  }
  return findings;
}

function scanOutput(outputRoot) {
  const findings = [];
  for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (FORBIDDEN_FILE_NAMES.has(name)) findings.push({ file: entry.name, reason: 'forbidden-file-name' });
    if (name.endsWith('.json')) scanJson(readJson(path.join(outputRoot, entry.name), {}), entry.name, '$', findings);
  }
  return findings;
}

function exportSafeEvidence(options = {}) {
  const resourcesRoot = path.resolve(options.resourcesRoot || '');
  const outputRoot = path.resolve(options.outputRoot || '');
  if (!resourcesRoot || !fs.existsSync(resourcesRoot)) throw Object.assign(new Error('源码 UAT 运行资源目录不存在'), { code: 'SAFE_EVIDENCE_RESOURCES_MISSING' });
  if (!outputRoot) throw Object.assign(new Error('缺少安全证据输出目录'), { code: 'SAFE_EVIDENCE_OUTPUT_MISSING' });
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });

  writeJson(path.join(outputRoot, 'source-identity.json'), sourceIdentity(resourcesRoot));
  writeJson(path.join(outputRoot, 'runtime-summary.json'), runtimeSummary(resourcesRoot));
  writeJson(path.join(outputRoot, 'platform-auth-summary.json'), platformAuthSummary(resourcesRoot));

  const findings = scanOutput(outputRoot);
  if (findings.length) {
    fs.rmSync(outputRoot, { recursive: true, force: true });
    const error = Object.assign(new Error('安全证据导出检测到禁止的秘密字段或文件'), { code: 'SAFE_EVIDENCE_SECRET_SCAN_FAILED', findings });
    throw error;
  }

  const files = fs.readdirSync(outputRoot).filter(name => fs.statSync(path.join(outputRoot, name)).isFile()).sort();
  const manifest = {
    schemaVersion: 1,
    documentType: 'YANCE_SAFE_EVIDENCE_EXPORT_MANIFEST',
    generatedAtUtc: new Date().toISOString(),
    sourceResourcesRootIncluded: false,
    recursiveCopyUsed: false,
    forbiddenRawFilesExcluded: [...FORBIDDEN_FILE_NAMES].sort(),
    files: files.map(name => ({ name, sizeBytes: fs.statSync(path.join(outputRoot, name)).size, sha256: sha256File(path.join(outputRoot, name)) }))
  };
  writeJson(path.join(outputRoot, 'evidence-export-manifest.json'), manifest);
  return { outputRoot, manifest, findings: [] };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--resources-root') options.resourcesRoot = argv[++index];
    else if (item === '--output') options.outputRoot = argv[++index];
  }
  return options;
}

function main() {
  try {
    const result = exportSafeEvidence(parseArgs());
    process.stdout.write(`${JSON.stringify({ ok: true, outputRoot: result.outputRoot, files: result.manifest.files.map(row => row.name) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || 'SAFE_EVIDENCE_EXPORT_FAILED', message: error.message, findings: error.findings || [] }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();
module.exports = { exportSafeEvidence, scanOutput, sourceIdentity, runtimeSummary, platformAuthSummary };
