'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_FILE_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_CREATOR_VERSION_UNIX = (3 << 8) | ZIP_VERSION;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 0x0021; // 1980-01-01
const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffff;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function canonicalZipPath(value) {
  const raw = String(value || '').replace(/\\/g, '/').normalize('NFC').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) {
    fail('WP7_CANDIDATE_ARCHIVE_CREATE_FAILED', 'ZIP entry path is not canonical and relative', { path: value });
  }
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    fail('WP7_CANDIDATE_ARCHIVE_CREATE_FAILED', 'ZIP entry path contains unsafe segments', { path: value });
  }
  return raw;
}

function compareUtf8(left, right) {
  return Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'));
}

function collectRegularFiles(sourceRoot, entryRoot) {
  const root = fs.realpathSync(path.resolve(sourceRoot || ''));
  const prefix = canonicalZipPath(entryRoot);
  const top = path.join(root, ...prefix.split('/'));
  if (!fs.existsSync(top) || !fs.statSync(top).isDirectory()) {
    fail('WP7_CANDIDATE_ARCHIVE_CREATE_FAILED', 'candidate ZIP root directory is missing', { sourceRoot: root, entryRoot: prefix });
  }
  const records = [];
  function visit(fullPath, relativePath) {
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) fail('WP7_CANDIDATE_ARCHIVE_CREATE_FAILED', 'symlinks are forbidden in candidate ZIP', { path: relativePath });
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(fullPath).sort(compareUtf8)) visit(path.join(fullPath, name), `${relativePath}/${name}`);
      return;
    }
    if (!stat.isFile()) fail('WP7_CANDIDATE_ARCHIVE_CREATE_FAILED', 'unsupported filesystem object in candidate ZIP', { path: relativePath });
    records.push({ fullPath, relativePath: canonicalZipPath(relativePath), stat });
  }
  visit(top, prefix);
  return records.sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
}

function updateCrc32(crc, bytes) {
  let value = crc >>> 0;
  for (let index = 0; index < bytes.length; index += 1) value = CRC32_TABLE[(value ^ bytes[index]) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function inspectFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let crc = 0xffffffff;
  let sizeBytes = 0;
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      sizeBytes += bytesRead;
      if (sizeBytes > ZIP_MAX_UINT32) fail('WP7_CANDIDATE_ARCHIVE_ZIP64_REQUIRED', 'candidate ZIP file exceeds classic ZIP size limit', { filePath, sizeBytes });
      crc = updateCrc32(crc, buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { crc32: (crc ^ 0xffffffff) >>> 0, sizeBytes };
}

function writeAll(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) offset += fs.writeSync(fd, buffer, offset, buffer.length - offset);
}

function copyFileToDescriptor(outputFd, filePath) {
  const inputFd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(inputFd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      writeAll(outputFd, bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(inputFd);
  }
}

function regularFileUnixMode(stat, relativePath) {
  const raw = stat.mode & 0o777;
  const executable = (raw & 0o111) !== 0 || /\.(?:exe|cmd|bat|ps1)$/i.test(relativePath);
  return executable ? 0o100755 : 0o100644;
}

function createLocalHeader(record) {
  const name = Buffer.from(record.relativePath, 'utf8');
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(ZIP_STORE_METHOD, 8);
  header.writeUInt16LE(ZIP_DOS_TIME, 10);
  header.writeUInt16LE(ZIP_DOS_DATE, 12);
  header.writeUInt32LE(record.crc32, 14);
  header.writeUInt32LE(record.sizeBytes, 18);
  header.writeUInt32LE(record.sizeBytes, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  name.copy(header, 30);
  return header;
}

function createCentralHeader(record) {
  const name = Buffer.from(record.relativePath, 'utf8');
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(ZIP_CENTRAL_FILE_HEADER, 0);
  header.writeUInt16LE(ZIP_CREATOR_VERSION_UNIX, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(ZIP_STORE_METHOD, 10);
  header.writeUInt16LE(ZIP_DOS_TIME, 12);
  header.writeUInt16LE(ZIP_DOS_DATE, 14);
  header.writeUInt32LE(record.crc32, 16);
  header.writeUInt32LE(record.sizeBytes, 20);
  header.writeUInt32LE(record.sizeBytes, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(((regularFileUnixMode(record.stat, record.relativePath) << 16) | 0x20) >>> 0, 38);
  header.writeUInt32LE(record.localHeaderOffset, 42);
  name.copy(header, 46);
  return header;
}

function createEndRecord(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

function createDeterministicZip(options = {}) {
  const outputPath = path.resolve(options.outputPath || '');
  if (!options.sourceRoot || !options.entryRoot || !options.outputPath) {
    fail('WP7_CANDIDATE_ARCHIVE_CREATE_FAILED', 'candidate ZIP inputs are incomplete', { sourceRoot: options.sourceRoot, entryRoot: options.entryRoot, outputPath: options.outputPath });
  }
  const files = collectRegularFiles(options.sourceRoot, options.entryRoot).map((record) => ({ ...record, ...inspectFile(record.fullPath) }));
  if (files.length > ZIP_MAX_UINT16) fail('WP7_CANDIDATE_ARCHIVE_ZIP64_REQUIRED', 'candidate ZIP entry count exceeds classic ZIP limit', { entryCount: files.length });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.rmSync(outputPath, { force: true });
  const fd = fs.openSync(outputPath, 'wx', 0o600);
  let position = 0;
  try {
    for (const record of files) {
      record.localHeaderOffset = position;
      if (position > ZIP_MAX_UINT32) fail('WP7_CANDIDATE_ARCHIVE_ZIP64_REQUIRED', 'candidate ZIP local header offset exceeds classic ZIP limit', { path: record.relativePath, position });
      const header = createLocalHeader(record);
      writeAll(fd, header);
      position += header.length;
      copyFileToDescriptor(fd, record.fullPath);
      position += record.sizeBytes;
    }
    const centralOffset = position;
    for (const record of files) {
      const header = createCentralHeader(record);
      writeAll(fd, header);
      position += header.length;
    }
    const centralSize = position - centralOffset;
    if (position > ZIP_MAX_UINT32 || centralOffset > ZIP_MAX_UINT32 || centralSize > ZIP_MAX_UINT32) {
      fail('WP7_CANDIDATE_ARCHIVE_ZIP64_REQUIRED', 'candidate ZIP exceeds classic ZIP central-directory limits', { position, centralOffset, centralSize });
    }
    writeAll(fd, createEndRecord(files.length, centralSize, centralOffset));
  } finally {
    fs.closeSync(fd);
  }
  return Object.freeze({
    outputPath,
    entryCount: files.length,
    sizeBytes: fs.statSync(outputPath).size,
    implementation: 'NODE_DETERMINISTIC_ZIP_STORE_V1'
  });
}

module.exports = {
  canonicalZipPath,
  collectRegularFiles,
  createDeterministicZip,
  updateCrc32
};
