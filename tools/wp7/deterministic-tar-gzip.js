'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const TAR_BLOCK_SIZE = 512;

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

function splitUstarPath(relativePath) {
  const canonical = canonicalTarPath(relativePath);
  if (Buffer.byteLength(canonical, 'utf8') <= 100) return { name: canonical, prefix: '' };
  const separators = [];
  for (let i = 0; i < canonical.length; i += 1) if (canonical[i] === '/') separators.push(i);
  for (let i = separators.length - 1; i >= 0; i -= 1) {
    const index = separators[i];
    const prefix = canonical.slice(0, index);
    const name = canonical.slice(index + 1);
    if (Buffer.byteLength(name, 'utf8') <= 100 && Buffer.byteLength(prefix, 'utf8') <= 155) return { name, prefix };
  }
  fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive entry path exceeds USTAR limits', { path: canonical });
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(String(value), 'utf8');
  if (bytes.length > length) fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive header field exceeds USTAR limit', { value, length });
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const octal = Math.trunc(Number(value)).toString(8);
  if (octal.length > length - 1) fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'archive numeric field exceeds USTAR limit', { value, length });
  writeString(buffer, offset, length, `${octal.padStart(length - 1, '0')}\0`);
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

function tarHeader({ relativePath, stat, timestampSeconds, type, targetPlatform }) {
  const { name, prefix } = splitUstarPath(relativePath);
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, archiveMode(stat, relativePath, targetPlatform));
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, type === '5' ? 0 : stat.size);
  writeOctal(header, 136, 12, timestampSeconds);
  header.fill(0x20, 148, 156);
  writeString(header, 156, 1, type);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 265, 32, 'root');
  writeString(header, 297, 32, 'root');
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, '0');
  writeString(header, 148, 8, `${checksumText}\0 `);
  return header;
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
      entries.push({ fullPath, relativePath, stat, type: '5' });
      for (const name of fs.readdirSync(fullPath).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
        visit(path.join(fullPath, name), `${relativePath}/${name}`);
      }
      return;
    }
    if (stat.isFile()) {
      entries.push({ fullPath, relativePath, stat, type: '0' });
      return;
    }
    fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'unsupported filesystem object in trusted product archive', { path: relativePath });
  }
  visit(top, requestedEntry);
  return entries;
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
}

function writeFileToTar(fd, filePath) {
  const input = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(input, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      writeAll(fd, bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(input);
  }
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
  const entries = walkEntries(sourceRoot, entryRoot);
  const timestampSeconds = Math.floor(timestamp.getTime() / 1000);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryTar = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tar.tmp`);
  let tarSizeBytes = 0;
  const fd = fs.openSync(temporaryTar, 'wx', 0o600);
  try {
    for (const entry of entries) {
      const header = tarHeader({ ...entry, timestampSeconds, targetPlatform });
      writeAll(fd, header);
      tarSizeBytes += header.length;
      if (entry.type === '0') {
        writeFileToTar(fd, entry.fullPath);
        tarSizeBytes += entry.stat.size;
        const padding = (TAR_BLOCK_SIZE - (entry.stat.size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
        if (padding) {
          writeAll(fd, Buffer.alloc(padding, 0));
          tarSizeBytes += padding;
        }
      }
    }
    const trailer = Buffer.alloc(TAR_BLOCK_SIZE * 2, 0);
    writeAll(fd, trailer);
    tarSizeBytes += trailer.length;
  } finally {
    fs.closeSync(fd);
  }
  try {
    const child = spawnSync(process.execPath, [__filename, '--gzip-only', temporaryTar, outputPath], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    });
    if (child.status !== 0 || !fs.existsSync(outputPath)) {
      fail('WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED', 'deterministic Node gzip subprocess failed', { status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr });
    }
  } finally {
    fs.rmSync(temporaryTar, { force: true });
  }
  return Object.freeze({ outputPath, entryCount: entries.length, tarSizeBytes, gzipSizeBytes: fs.statSync(outputPath).size, implementation: 'NODE_USTAR_STREAM_GZIP_V2' });
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
  TAR_BLOCK_SIZE,
  canonicalTarPath,
  createDeterministicTarGzip,
  gzipFileDeterministically,
  splitUstarPath
};
