'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REQUIRED_NODE_VERSION = '22.23.1';
const SHA256_RE = /^[0-9a-f]{64}$/;

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function canonicalBuffer(value) {
  const sort = input => Array.isArray(input) ? input.map(sort) : (!input || typeof input !== 'object') ? input : Object.fromEntries(Object.keys(input).sort().map(key => [key, sort(input[key])]));
  return Buffer.from(`${JSON.stringify(sort(value), null, 2)}\n`, 'utf8');
}
function runtimeExecutableName(platform = process.platform) { return platform === 'win32' ? 'node.exe' : 'node'; }
function verifyNodeExecutable(executablePath, options = {}) {
  const requiredVersion = options.requiredVersion || REQUIRED_NODE_VERSION;
  const requested = String(executablePath || '').trim();
  if (!requested || !path.isAbsolute(requested) || !fs.existsSync(requested)) fail('WP7_NODE_RUNTIME_EXECUTABLE_MISSING', 'trusted Node runtime executable is missing', { executablePath: requested });
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink() || !stat.isFile()) fail('WP7_NODE_RUNTIME_EXECUTABLE_INVALID', 'trusted Node runtime executable must be a regular non-symlink file', { executablePath: requested });
  const real = fs.realpathSync(requested);
  const result = spawnSync(real, ['--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  const version = String(result.stdout || result.stderr || '').trim().replace(/^v/, '');
  if (result.status !== 0 || version !== requiredVersion) fail('WP7_NODE_RUNTIME_VERSION_MISMATCH', 'trusted Node runtime version differs from the reviewed version', { executablePath: real, status: result.status, version, requiredVersion });
  return { executablePath: real, version, executableSha256: sha256File(real) };
}
function walkRuntimeFiles(runtimeRoot) {
  const root = fs.realpathSync(path.resolve(runtimeRoot));
  const records = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => Buffer.from(a.name).compare(Buffer.from(b.name)))) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(root, fullPath).split(path.sep).join('/').normalize('NFC');
      if (entry.isSymbolicLink()) fail('WP7_NODE_RUNTIME_TREE_INVALID', 'trusted Node runtime tree contains a symlink', { path: relativePath });
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        records.push({ path: relativePath, sizeBytes: stat.size, sha256: sha256File(fullPath), unixMode: stat.mode & 0o777 });
      } else fail('WP7_NODE_RUNTIME_TREE_INVALID', 'trusted Node runtime tree contains an unsupported filesystem object', { path: relativePath });
    }
  }
  visit(root);
  return records;
}
function runtimeTreeSha256(records) {
  if (!Array.isArray(records) || records.length < 1) fail('WP7_NODE_RUNTIME_TREE_INVALID', 'trusted Node runtime tree is empty');
  return crypto.createHash('sha256').update(canonicalBuffer({ schemaVersion: 1, identityClass: 'TRUSTED_NODE_RUNTIME_CONTENT_AND_MODE_TREE', records })).digest('hex');
}
function inspectTrustedNodeRuntime(options = {}) {
  const runtimeRoot = path.resolve(options.runtimeRoot || '');
  if (!options.runtimeRoot || !fs.existsSync(runtimeRoot) || !fs.statSync(runtimeRoot).isDirectory()) fail('WP7_NODE_RUNTIME_TREE_MISSING', 'trusted Node runtime root is missing', { runtimeRoot });
  const executableRelativePath = String(options.executableRelativePath || runtimeExecutableName(options.platform)).replace(/\\/g, '/');
  const executablePath = path.join(runtimeRoot, ...executableRelativePath.split('/'));
  const executable = verifyNodeExecutable(executablePath, options);
  const records = walkRuntimeFiles(runtimeRoot);
  const record = records.find(row => row.path === executableRelativePath);
  if (!record || record.sha256 !== executable.executableSha256) fail('WP7_NODE_RUNTIME_EXECUTABLE_IDENTITY_MISMATCH', 'trusted Node executable is not bound by the runtime tree', { executableRelativePath });
  return Object.freeze({
    version: executable.version,
    runtimeRoot,
    executablePath: executable.executablePath,
    executableRelativePath,
    executableSha256: executable.executableSha256,
    runtimeTreeSha256: runtimeTreeSha256(records),
    fileCount: records.length,
    modeBoundFileCount: records.length,
    records
  });
}
function copyTrustedNodeRuntime(options = {}) {
  const source = verifyNodeExecutable(path.resolve(options.sourceExecutable || ''), options);
  const destinationRoot = path.resolve(options.destinationRoot || '');
  if (!options.destinationRoot) fail('WP7_NODE_RUNTIME_TREE_MISSING', 'trusted Node runtime destination is required');
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  const executableRelativePath = runtimeExecutableName(options.platform);
  const destinationExecutable = path.join(destinationRoot, ...executableRelativePath.split('/'));
  fs.mkdirSync(path.dirname(destinationExecutable), { recursive: true });
  fs.copyFileSync(source.executablePath, destinationExecutable);
  if (process.platform !== 'win32') fs.chmodSync(destinationExecutable, fs.statSync(source.executablePath).mode & 0o777);
  const sourceRoot = path.dirname(source.executablePath);
  for (const name of ['LICENSE', 'README.md', 'CHANGELOG.md']) {
    const input = path.join(sourceRoot, name);
    if (!fs.existsSync(input) || !fs.statSync(input).isFile() || fs.lstatSync(input).isSymbolicLink()) continue;
    const output = path.join(destinationRoot, name);
    fs.copyFileSync(input, output);
    if (process.platform !== 'win32') fs.chmodSync(output, fs.statSync(input).mode & 0o777);
  }
  return inspectTrustedNodeRuntime({ runtimeRoot: destinationRoot, executableRelativePath, platform: options.platform, requiredVersion: options.requiredVersion });
}
function validateManifestRuntimeIdentity(identity, runtime) {
  const fields = {
    nodeRuntimeVersion: runtime.version,
    nodeRuntimeExecutablePath: `runtime/node22/${runtime.executableRelativePath}`,
    nodeRuntimeExecutableSha256: runtime.executableSha256,
    nodeRuntimeTreeSha256: runtime.runtimeTreeSha256,
    nodeRuntimeFileCount: runtime.fileCount,
    nodeRuntimeModeBoundFileCount: runtime.modeBoundFileCount
  };
  const mismatches = Object.entries(fields).filter(([field, value]) => identity[field] !== value).map(([field, value]) => ({ field, expected: identity[field], actual: value }));
  if (mismatches.length) fail('WP7_NODE_RUNTIME_IDENTITY_MISMATCH', 'trusted Node runtime identity differs from the release manifest', { mismatches });
  if (!SHA256_RE.test(fields.nodeRuntimeExecutableSha256) || !SHA256_RE.test(fields.nodeRuntimeTreeSha256)) fail('WP7_NODE_RUNTIME_IDENTITY_MISMATCH', 'trusted Node runtime SHA256 identity is malformed');
  return Object.freeze(fields);
}

module.exports = {
  REQUIRED_NODE_VERSION,
  runtimeExecutableName,
  verifyNodeExecutable,
  walkRuntimeFiles,
  runtimeTreeSha256,
  inspectTrustedNodeRuntime,
  copyTrustedNodeRuntime,
  validateManifestRuntimeIdentity
};
