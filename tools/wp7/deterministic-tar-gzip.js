'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const ARCHIVE_IMPLEMENTATION = 'NODE_TAR_PAX_GZIP_V1';
const ARCHIVE_TOOL_PACKAGE = 'tar';
const ARCHIVE_TOOL_VERSION = '7.5.22';

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function canonicalTarPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').normalize('NFC').replace(/^\.\//, '');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive entry path is not canonical and relative', { path: value });
  }
  const trimmed = raw.replace(/\/+$/, '');
  const parts = trimmed.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive entry path contains unsafe segments', { path: value });
  }
  return trimmed;
}

function archiveMode(stat, relativePath, targetPlatform) {
  if (stat.isDirectory()) return 0o755;
  if (targetPlatform === 'win32') {
    const extension = path.extname(relativePath).toLowerCase();
    return ['.exe', '.cmd', '.bat', '.ps1'].includes(extension) ? 0o755 : 0o644;
  }
  const raw = stat.mode & 0o777;
  return raw || 0o644;
}

function walkEntries(sourceRoot, entryRoot) {
  const root = fs.realpathSync(path.resolve(sourceRoot));
  const requestedEntry = canonicalTarPath(entryRoot);
  const top = path.join(root, ...requestedEntry.split('/'));
  if (!fs.existsSync(top)) fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive root entry is missing', { sourceRoot: root, entryRoot: requestedEntry });
  const entries = [];
  function visit(fullPath, relativePath) {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'symlinks are forbidden in trusted product archive', { path: relativePath });
    if (stat.isDirectory()) {
      entries.push({ fullPath, relativePath: canonicalTarPath(relativePath), stat });
      for (const name of fs.readdirSync(fullPath).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
        visit(path.join(fullPath, name), `${relativePath}/${name}`);
      }
      return;
    }
    if (stat.isFile()) {
      entries.push({ fullPath, relativePath: canonicalTarPath(relativePath), stat });
      return;
    }
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'unsupported filesystem object in trusted product archive', { path: relativePath });
  }
  visit(top, requestedEntry);
  return { root, entries };
}

function loadArchiveTool(nodeModulesPath) {
  const requested = String(nodeModulesPath || '');
  if (!requested || !path.isAbsolute(requested) || !fs.existsSync(requested)) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive-tool node_modules must be an existing absolute directory', { nodeModulesPath: requested });
  }
  const nodeModulesStat = fs.lstatSync(requested);
  if (!nodeModulesStat.isDirectory() || nodeModulesStat.isSymbolicLink()) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive-tool node_modules must be a real non-symlink directory', { nodeModulesPath: requested });
  }
  const nodeModules = fs.realpathSync(requested);
  const packageRoot = path.join(nodeModules, ARCHIVE_TOOL_PACKAGE);
  const packageJsonPath = path.join(packageRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar package metadata is missing', { packageJsonPath });
  }
  const packageRootStat = fs.lstatSync(packageRoot);
  if (!packageRootStat.isDirectory() || packageRootStat.isSymbolicLink()) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar package root must be a real non-symlink directory', { packageRoot });
  }
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.name !== ARCHIVE_TOOL_PACKAGE || packageJson.version !== ARCHIVE_TOOL_VERSION) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar package identity mismatch', {
      expected: `${ARCHIVE_TOOL_PACKAGE}@${ARCHIVE_TOOL_VERSION}`,
      actual: `${packageJson.name || ''}@${packageJson.version || ''}`
    });
  }
  let tar;
  try {
    tar = require(packageRoot);
  } catch (error) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar module could not be loaded', { packageRoot, message: error.message });
  }
  if (!tar || typeof tar.c !== 'function' || typeof tar.t !== 'function') {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar module does not expose the required create/list API', { packageRoot });
  }
  return Object.freeze({ tar, nodeModules, packageRoot, version: packageJson.version });
}

function normalizedAbsolute(filePath) {
  return path.resolve(filePath).replace(/\\/g, '/');
}

function deterministicStatCache(entries, targetPlatform) {
  const cache = new Map();
  for (const entry of entries) {
    const stat = Object.assign(Object.create(Object.getPrototypeOf(entry.stat)), entry.stat);
    stat.mode = (stat.mode & ~0o7777) | archiveMode(entry.stat, entry.relativePath, targetPlatform);
    // The previous archive writer always emitted regular file bytes rather than
    // translating repeated inodes into TAR hardlinks. Keep that semantic while
    // delegating only TAR/PAX encoding to node-tar.
    stat.nlink = 1;
    cache.set(normalizedAbsolute(entry.fullPath), stat);
  }
  return cache;
}

async function gzipFileDeterministically(inputPath, outputPath) {
  await pipeline(
    fs.createReadStream(inputPath),
    zlib.createGzip({ level: 9, mtime: 0 }),
    fs.createWriteStream(outputPath, { mode: 0o600 })
  );
  // RFC 1952 byte 9 is the originating OS. Normalize it so Windows and Linux
  // produce byte-identical archives from the same canonical TAR stream.
  const fd = fs.openSync(outputPath, 'r+');
  try { fs.writeSync(fd, Buffer.from([255]), 0, 1, 9); }
  finally { fs.closeSync(fd); }
}

function createDeterministicTarGzip(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot || '');
  const entryRoot = String(options.entryRoot || '');
  const outputPath = path.resolve(options.outputPath || '');
  const timestamp = new Date(String(options.timestamp || ''));
  const targetPlatform = options.targetPlatform || process.platform;
  if (!options.sourceRoot || !options.entryRoot || !options.outputPath || Number.isNaN(timestamp.getTime()) || !String(options.timestamp).endsWith('Z')) {
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'deterministic archive inputs are incomplete or invalid', { sourceRoot, entryRoot, outputPath, timestamp: options.timestamp });
  }

  const archiveTool = loadArchiveTool(options.archiveToolNodeModules);
  const walked = walkEntries(sourceRoot, entryRoot);
  const entries = walked.entries;
  const entryByPath = new Map(entries.map(entry => [entry.relativePath, entry]));
  const statCache = deterministicStatCache(entries, targetPlatform);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryTar = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tar.tmp`);

  try {
    try {
      archiveTool.tar.c({
        cwd: walked.root,
        file: temporaryTar,
        sync: true,
        strict: true,
        portable: true,
        noDirRecurse: true,
        mtime: timestamp,
        statCache,
        onWriteEntry(entry) {
          const relativePath = canonicalTarPath(String(entry.path || '').replace(/\/+$/, ''));
          if (!entryByPath.has(relativePath)) {
            fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'node-tar attempted to encode an entry outside the reviewed deterministic file set', { path: entry.path });
          }
        }
      }, entries.map(entry => entry.relativePath));
    } catch (error) {
      if (error && error.reasonCode) throw error;
      fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar PAX archive creation failed', { message: error && error.message ? error.message : String(error) });
    }

    if (!fs.existsSync(temporaryTar)) {
      fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'locked node-tar did not create the expected TAR stream', { temporaryTar });
    }
    const tarSizeBytes = fs.statSync(temporaryTar).size;
    const child = spawnSync(process.execPath, [__filename, '--gzip-only', temporaryTar, outputPath], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    if (child.status !== 0 || !fs.existsSync(outputPath)) {
      fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'deterministic Node gzip subprocess failed', { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr });
    }
    return Object.freeze({
      outputPath,
      entryCount: entries.length,
      tarSizeBytes,
      gzipSizeBytes: fs.statSync(outputPath).size,
      implementation: ARCHIVE_IMPLEMENTATION,
      archiveToolPackage: ARCHIVE_TOOL_PACKAGE,
      archiveToolVersion: archiveTool.version
    });
  } finally {
    fs.rmSync(temporaryTar, { force: true });
  }
}

async function gzipOnlyMain() {
  const inputPath = path.resolve(process.argv[3] || '');
  const outputPath = path.resolve(process.argv[4] || '');
  if (!process.argv[3] || !process.argv[4] || !fs.existsSync(inputPath)) throw new Error('gzip input/output arguments are invalid');
  await gzipFileDeterministically(inputPath, outputPath);
}

if (require.main === module && process.argv[2] === '--gzip-only') {
  gzipOnlyMain().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  ARCHIVE_IMPLEMENTATION,
  ARCHIVE_TOOL_PACKAGE,
  ARCHIVE_TOOL_VERSION,
  canonicalTarPath,
  createDeterministicTarGzip,
  gzipFileDeterministically
};
