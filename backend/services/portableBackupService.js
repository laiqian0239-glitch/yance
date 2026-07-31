'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { PATHS } = require('../config');
const { PRODUCT } = require('../../shared/constants');
const backupService = require('./backupService');
const logger = require('./logger');

const ENVELOPE_MAGIC = Buffer.from('YANCE32PORTABLE\n', 'utf8');
const ARCHIVE_MAGIC = Buffer.from('YANCE32ARCHIVE1\n', 'utf8');
const FOOTER_MAGIC = Buffer.from('\nYANCE32GCM\n', 'utf8');
const PORTABLE_EXTENSION = '.yancebackup';
const LEGACY_PORTABLE_EXTENSIONS = Object.freeze(['.yance28backup', '.yance32backup']);
const ACCEPTED_PORTABLE_EXTENSIONS = Object.freeze([PORTABLE_EXTENSION, ...LEGACY_PORTABLE_EXTENSIONS]);
const TAG_BYTES = 16;
const HEADER_LIMIT = 64 * 1024;
const MAX_FILES = Math.max(100, Number(process.env.YANCE_PORTABLE_MAX_FILES || 100000));
const MAX_ARCHIVE_BYTES = Math.max(64 * 1024 * 1024, Number(process.env.YANCE_PORTABLE_MAX_BYTES || 8 * 1024 * 1024 * 1024));
const IO_CHUNK = 1024 * 1024;
const SCRYPT = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const PROFILE_ROOTS = Object.freeze({
  'data-only': ['store', 'models', 'aiAssets', 'notificationSounds'],
  'account-data': ['store', 'models', 'whatsappAuth', 'aiAssets', 'notificationSounds'],
  'full-media': ['store', 'models', 'whatsappAuth', 'aiAssets', 'notificationSounds', 'media']
});

function portableError(message, code, status = 400, details) {
  return Object.assign(new Error(message), { code, status, ...(details ? { details } : {}) });
}

function ensureRoots() {
  fs.mkdirSync(PATHS.portableBackups, { recursive: true });
  fs.mkdirSync(path.join(PATHS.tmp, 'portable-backup-work'), { recursive: true });
}

function validatePassphrase(passphrase) {
  const value = String(passphrase || '');
  if (value.length < 10) throw portableError('可迁移备份密码至少需要 10 个字符', 'PORTABLE_PASSPHRASE_WEAK');
  if (Buffer.byteLength(value, 'utf8') > 1024) throw portableError('可迁移备份密码过长', 'PORTABLE_PASSPHRASE_TOO_LONG');
  return value;
}

function safePackageName(value) {
  const name = path.basename(String(value || ''));
  if (!name || name !== String(value || '') || !ACCEPTED_PORTABLE_EXTENSIONS.some(extension => name.toLowerCase().endsWith(extension))) {
    throw portableError('可迁移备份文件名无效', 'PORTABLE_NAME_INVALID');
  }
  return name;
}

function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || /^[A-Za-z]:\//.test(normalized)) {
    throw portableError('可迁移备份包含无效路径', 'PORTABLE_PATH_INVALID');
  }
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw portableError('可迁移备份包含越界路径', 'PORTABLE_PATH_TRAVERSAL');
  }
  return normalized;
}

function resolvePackage(name) {
  const safe = safePackageName(name);
  const file = path.resolve(PATHS.portableBackups, safe);
  const root = `${path.resolve(PATHS.portableBackups)}${path.sep}`;
  if (!file.startsWith(root)) throw portableError('可迁移备份路径越界', 'PORTABLE_PATH_TRAVERSAL');
  return { name: safe, file };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.allocUnsafe(IO_CHUNK);
    let read = 0;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function deriveKey(passphrase, salt, options = SCRYPT) {
  const N = Math.max(16384, Math.min(131072, Number(options.N || SCRYPT.N)));
  const r = Math.max(8, Math.min(32, Number(options.r || SCRYPT.r)));
  const p = Math.max(1, Math.min(8, Number(options.p || SCRYPT.p)));
  const minimumMemory = 128 * N * r + 32 * 1024 * 1024;
  const maxmem = Math.max(minimumMemory, Number(options.maxmem || SCRYPT.maxmem));
  return new Promise((resolve, reject) => {
    crypto.scrypt(passphrase, salt, 32, { N, r, p, maxmem }, (error, key) => error ? reject(error) : resolve(key));
  });
}

async function writeBuffer(handle, buffer, positionRef) {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.write(buffer, offset, buffer.length - offset, positionRef.value);
    if (!result.bytesWritten) throw portableError('写入可迁移备份时发生中断', 'PORTABLE_WRITE_FAILED', 500);
    offset += result.bytesWritten;
    positionRef.value += result.bytesWritten;
  }
}

async function copyFileIntoHandle(source, targetHandle, positionRef) {
  const sourceHandle = await fsp.open(source, 'r');
  const buffer = Buffer.allocUnsafe(IO_CHUNK);
  let sourcePosition = 0;
  try {
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, sourcePosition);
      if (!bytesRead) break;
      sourcePosition += bytesRead;
      await writeBuffer(targetHandle, buffer.subarray(0, bytesRead), positionRef);
    }
  } finally { await sourceHandle.close(); }
}

async function buildArchive(backupDir, backupManifest, archiveFile, profile) {
  const files = [
    { path: 'manifest.json', full: path.join(backupDir, 'manifest.json') },
    ...(backupManifest.files || []).map(entry => ({ path: safeRelative(entry.path), full: path.join(backupDir, ...safeRelative(entry.path).split('/')) }))
  ];
  if (files.length > MAX_FILES) throw portableError('可迁移备份文件数量超过安全上限', 'PORTABLE_TOO_MANY_FILES', 413, { count: files.length, limit: MAX_FILES });
  let totalBytes = 0;
  const manifestFiles = [];
  for (const file of files) {
    const stat = fs.statSync(file.full);
    if (!stat.isFile()) throw portableError(`备份条目不是文件：${file.path}`, 'PORTABLE_ENTRY_NOT_FILE');
    totalBytes += stat.size;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw portableError('可迁移备份超过当前安全容量上限', 'PORTABLE_TOO_LARGE', 413, { totalBytes, limitBytes: MAX_ARCHIVE_BYTES });
    manifestFiles.push({ path: file.path, size: stat.size, sha256: sha256File(file.full) });
  }
  const packageManifest = {
    schemaVersion: 'yance.portable.archive.v1',
    product: {
      name: PRODUCT.publicName,
      version: PRODUCT.publicVersion,
      updateName: PRODUCT.updateName,
      updateVersion: PRODUCT.updateVersion,
      internalProductId: PRODUCT.internalProductId,
      build: PRODUCT.build
    },
    createdAt: new Date().toISOString(),
    profile,
    portable: true,
    credentialPolicy: profile === 'data-only'
      ? 'no-account-credentials'
      : 'whatsapp-auth-included-device-bound-safe-storage-excluded',
    sourceBackup: {
      schemaVersion: backupManifest.schemaVersion,
      profile: backupManifest.profile,
      createdAt: backupManifest.createdAt,
      roots: backupManifest.roots,
      manifestSha256: sha256File(path.join(backupDir, 'manifest.json'))
    },
    files: manifestFiles,
    totalBytes
  };
  const manifestBuffer = Buffer.from(JSON.stringify(packageManifest), 'utf8');
  if (manifestBuffer.length > 16 * 1024 * 1024) throw portableError('可迁移备份清单过大', 'PORTABLE_MANIFEST_TOO_LARGE', 413);
  const handle = await fsp.open(archiveFile, 'w', 0o600);
  const position = { value: 0 };
  try {
    await writeBuffer(handle, ARCHIVE_MAGIC, position);
    const manifestLength = Buffer.alloc(4);
    manifestLength.writeUInt32BE(manifestBuffer.length, 0);
    await writeBuffer(handle, manifestLength, position);
    await writeBuffer(handle, manifestBuffer, position);
    for (const file of files) {
      const name = Buffer.from(file.path, 'utf8');
      if (name.length > 65535) throw portableError(`备份路径过长：${file.path}`, 'PORTABLE_PATH_TOO_LONG');
      const header = Buffer.alloc(10);
      header.writeUInt16BE(name.length, 0);
      header.writeBigUInt64BE(BigInt(fs.statSync(file.full).size), 2);
      await writeBuffer(handle, header, position);
      await writeBuffer(handle, name, position);
      await copyFileIntoHandle(file.full, handle, position);
    }
    const end = Buffer.alloc(2);
    end.writeUInt16BE(0, 0);
    await writeBuffer(handle, end, position);
    await handle.sync();
  } finally { await handle.close(); }
  return { packageManifest, archiveBytes: position.value, archiveSha256: sha256File(archiveFile) };
}

async function encryptArchive(archiveFile, destination, passphrase, summary) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const header = {
    schemaVersion: 'yance.portable.envelope.v1',
    algorithm: 'AES-256-GCM',
    kdf: { name: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    archiveBytes: summary.archiveBytes,
    archiveSha256: summary.archiveSha256,
    createdAt: summary.packageManifest.createdAt,
    profile: summary.packageManifest.profile,
    fileCount: summary.packageManifest.files.length,
    totalBytes: summary.packageManifest.totalBytes,
    product: summary.packageManifest.product,
    credentialPolicy: summary.packageManifest.credentialPolicy
  };
  const prefix = Buffer.concat([ENVELOPE_MAGIC, Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')]);
  await fsp.writeFile(destination, prefix, { mode: 0o600 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  await pipeline(fs.createReadStream(archiveFile), cipher, fs.createWriteStream(destination, { flags: 'a', mode: 0o600 }));
  await fsp.appendFile(destination, Buffer.concat([FOOTER_MAGIC, cipher.getAuthTag()]));
  return header;
}

async function readEnvelope(file) {
  const stat = await fsp.stat(file);
  const minimum = ENVELOPE_MAGIC.length + 3 + FOOTER_MAGIC.length + TAG_BYTES;
  if (!stat.isFile() || stat.size < minimum) throw portableError('不是有效的言策可迁移备份', 'PORTABLE_FILE_INVALID');
  const handle = await fsp.open(file, 'r');
  try {
    const headSize = Math.min(HEADER_LIMIT, stat.size);
    const head = Buffer.alloc(headSize);
    await handle.read(head, 0, head.length, 0);
    if (!head.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) throw portableError('不是有效的言策可迁移备份', 'PORTABLE_MAGIC_INVALID');
    const headerEnd = head.indexOf(0x0a, ENVELOPE_MAGIC.length);
    if (headerEnd < 0) throw portableError('可迁移备份头损坏', 'PORTABLE_HEADER_INVALID');
    let header;
    try { header = JSON.parse(head.subarray(ENVELOPE_MAGIC.length, headerEnd).toString('utf8')); }
    catch (_) { throw portableError('可迁移备份头无法解析', 'PORTABLE_HEADER_INVALID'); }
    if (header.schemaVersion !== 'yance.portable.envelope.v1') throw portableError('可迁移备份格式不受支持', 'PORTABLE_SCHEMA_UNSUPPORTED');
    const footerSize = FOOTER_MAGIC.length + TAG_BYTES;
    const footer = Buffer.alloc(footerSize);
    await handle.read(footer, 0, footer.length, stat.size - footerSize);
    if (!footer.subarray(0, FOOTER_MAGIC.length).equals(FOOTER_MAGIC)) throw portableError('可迁移备份尾部损坏', 'PORTABLE_FOOTER_INVALID');
    const cipherStart = headerEnd + 1;
    const cipherEnd = stat.size - footerSize - 1;
    if (cipherEnd < cipherStart) throw portableError('可迁移备份没有有效载荷', 'PORTABLE_PAYLOAD_MISSING');
    return { header, tag: footer.subarray(FOOTER_MAGIC.length), cipherStart, cipherEnd, size: stat.size };
  } finally { await handle.close(); }
}

async function decryptToArchive(file, passphrase, workDir) {
  const envelope = await readEnvelope(file);
  const password = validatePassphrase(passphrase);
  const salt = Buffer.from(String(envelope.header.salt || ''), 'base64');
  const iv = Buffer.from(String(envelope.header.iv || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12 || envelope.tag.length !== TAG_BYTES) throw portableError('可迁移备份加密参数损坏', 'PORTABLE_CRYPTO_HEADER_INVALID');
  const key = await deriveKey(password, salt, envelope.header.kdf || SCRYPT);
  const archiveFile = path.join(workDir, 'archive.bin');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(envelope.tag);
  try {
    await pipeline(fs.createReadStream(file, { start: envelope.cipherStart, end: envelope.cipherEnd }), decipher, fs.createWriteStream(archiveFile, { mode: 0o600 }));
  } catch (error) {
    throw portableError('可迁移备份密码错误或文件已损坏', 'PORTABLE_DECRYPT_FAILED', 400, { cause: error.message });
  }
  const stat = await fsp.stat(archiveFile);
  if (Number(envelope.header.archiveBytes) !== stat.size || sha256File(archiveFile) !== envelope.header.archiveSha256) {
    throw portableError('可迁移备份解密后完整性校验失败', 'PORTABLE_ARCHIVE_INTEGRITY_FAILED');
  }
  return { archiveFile, envelope };
}

async function readExact(handle, length, positionRef) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, positionRef.value);
    if (!bytesRead) throw portableError('可迁移备份归档意外结束', 'PORTABLE_ARCHIVE_TRUNCATED');
    offset += bytesRead;
    positionRef.value += bytesRead;
  }
  return buffer;
}

async function consumeFile(handle, size, positionRef, destination = '') {
  const hash = crypto.createHash('sha256');
  let remaining = size;
  let target = null;
  if (destination) {
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    target = await fsp.open(destination, 'w', 0o600);
  }
  try {
    while (remaining > 0) {
      const amount = Math.min(IO_CHUNK, remaining);
      const chunk = await readExact(handle, amount, positionRef);
      hash.update(chunk);
      if (target) await target.write(chunk);
      remaining -= amount;
    }
    if (target) await target.sync();
  } finally { if (target) await target.close(); }
  return hash.digest('hex');
}

async function parseArchive(archiveFile, extractionRoot = '') {
  const handle = await fsp.open(archiveFile, 'r');
  const position = { value: 0 };
  try {
    const magic = await readExact(handle, ARCHIVE_MAGIC.length, position);
    if (!magic.equals(ARCHIVE_MAGIC)) throw portableError('可迁移备份内部归档格式无效', 'PORTABLE_ARCHIVE_MAGIC_INVALID');
    const manifestLength = (await readExact(handle, 4, position)).readUInt32BE(0);
    if (!manifestLength || manifestLength > 16 * 1024 * 1024) throw portableError('可迁移备份内部清单长度无效', 'PORTABLE_MANIFEST_INVALID');
    let manifest;
    try { manifest = JSON.parse((await readExact(handle, manifestLength, position)).toString('utf8')); }
    catch (_) { throw portableError('可迁移备份内部清单无法解析', 'PORTABLE_MANIFEST_INVALID'); }
    if (manifest.schemaVersion !== 'yance.portable.archive.v1' || !Array.isArray(manifest.files)) throw portableError('可迁移备份内部清单格式不受支持', 'PORTABLE_MANIFEST_UNSUPPORTED');
    if (manifest.files.length > MAX_FILES) throw portableError('可迁移备份文件数量超过安全上限', 'PORTABLE_TOO_MANY_FILES', 413);
    const expected = new Map(manifest.files.map(item => [safeRelative(item.path), item]));
    const seen = new Set();
    let totalBytes = 0;
    while (true) {
      const nameLength = (await readExact(handle, 2, position)).readUInt16BE(0);
      if (nameLength === 0) break;
      const sizeBuffer = await readExact(handle, 8, position);
      const sizeBig = sizeBuffer.readBigUInt64BE(0);
      if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER)) throw portableError('可迁移备份单文件过大', 'PORTABLE_ENTRY_TOO_LARGE', 413);
      const size = Number(sizeBig);
      const name = safeRelative((await readExact(handle, nameLength, position)).toString('utf8'));
      if (seen.has(name)) throw portableError(`可迁移备份包含重复文件：${name}`, 'PORTABLE_DUPLICATE_ENTRY');
      const item = expected.get(name);
      if (!item || Number(item.size) !== size) throw portableError(`可迁移备份清单不匹配：${name}`, 'PORTABLE_MANIFEST_MISMATCH');
      totalBytes += size;
      if (totalBytes > MAX_ARCHIVE_BYTES) throw portableError('可迁移备份超过安全容量上限', 'PORTABLE_TOO_LARGE', 413);
      let destination = '';
      if (extractionRoot) {
        destination = path.resolve(extractionRoot, ...name.split('/'));
        const allowed = `${path.resolve(extractionRoot)}${path.sep}`;
        if (!destination.startsWith(allowed)) throw portableError('可迁移备份解压路径越界', 'PORTABLE_PATH_TRAVERSAL');
      }
      const digest = await consumeFile(handle, size, position, destination);
      if (digest !== item.sha256) throw portableError(`可迁移备份文件校验失败：${name}`, 'PORTABLE_ENTRY_CHECKSUM_FAILED');
      seen.add(name);
    }
    if (seen.size !== expected.size) {
      const missing = [...expected.keys()].filter(name => !seen.has(name));
      throw portableError(`可迁移备份缺少文件：${missing.slice(0, 5).join(', ')}`, 'PORTABLE_ENTRY_MISSING');
    }
    const archiveStat = await handle.stat();
    if (position.value !== archiveStat.size) throw portableError('可迁移备份归档包含异常尾随数据', 'PORTABLE_ARCHIVE_TRAILING_DATA');
    return { manifest, filesChecked: seen.size, totalBytes };
  } finally { await handle.close(); }
}

function workDirectory(prefix) {
  ensureRoots();
  return fs.mkdtempSync(path.join(PATHS.tmp, 'portable-backup-work', `${prefix}-`));
}

async function createPortableBackup(options = {}) {
  ensureRoots();
  const passphrase = validatePassphrase(options.passphrase);
  const profile = String(options.profile || 'data-only');
  const roots = PROFILE_ROOTS[profile];
  if (!roots) throw portableError('可迁移备份类型不受支持', 'PORTABLE_PROFILE_UNSUPPORTED');
  const label = String(options.label || 'portable').replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 40) || 'portable';
  const work = workDirectory('create');
  let sourceBackup = null;
  let destination = '';
  let temporaryDestination = '';
  try {
    sourceBackup = backupService.createBackup(`portable_source_${Date.now()}`, { roots });
    const verification = backupService.verifyBackup(sourceBackup.name, { force: true });
    if (!verification.ok) throw portableError(`源恢复点校验失败：${verification.message}`, verification.code || 'PORTABLE_SOURCE_VERIFY_FAILED', 500);
    const archiveFile = path.join(work, 'archive.bin');
    const summary = await buildArchive(sourceBackup.dir, sourceBackup.manifest, archiveFile, profile);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = safePackageName(`Yance-${stamp}-${label}-${profile}${PORTABLE_EXTENSION}`);
    destination = resolvePackage(name).file;
    temporaryDestination = `${destination}.${process.pid}.${Date.now()}.tmp`;
    const header = await encryptArchive(archiveFile, temporaryDestination, passphrase, summary);
    await fsp.rename(temporaryDestination, destination);
    temporaryDestination = '';
    logger.info('backup', 'portable-backup-created', { name, profile, fileCount: header.fileCount, totalBytes: header.totalBytes, packageBytes: fs.statSync(destination).size });
    return { ok: true, name, profile, fileCount: header.fileCount, totalBytes: header.totalBytes, packageBytes: fs.statSync(destination).size, createdAt: header.createdAt, credentialPolicy: header.credentialPolicy };
  } finally {
    if (sourceBackup?.dir) {
      try { fs.rmSync(sourceBackup.dir, { recursive: true, force: true }); } catch (_) {}
      backupService.clearVerificationCache(sourceBackup.name);
    }
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
    if (temporaryDestination) { try { fs.rmSync(temporaryDestination, { force: true }); } catch (_) {} }
  }
}

async function inspectPortableBackup(name) {
  const resolved = resolvePackage(name);
  const envelope = await readEnvelope(resolved.file);
  const stat = await fsp.stat(resolved.file);
  return { name: resolved.name, packageBytes: stat.size, modifiedAt: stat.mtime.toISOString(), ...envelope.header };
}

async function listPortableBackups() {
  ensureRoots();
  const entries = await fsp.readdir(PATHS.portableBackups, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !ACCEPTED_PORTABLE_EXTENSIONS.some(extension => entry.name.toLowerCase().endsWith(extension))) continue;
    try { rows.push(await inspectPortableBackup(entry.name)); }
    catch (error) {
      const stat = await fsp.stat(path.join(PATHS.portableBackups, entry.name)).catch(() => null);
      rows.push({ name: entry.name, invalid: true, error: error.message, packageBytes: stat?.size || 0, modifiedAt: stat?.mtime?.toISOString?.() || '' });
    }
  }
  return rows.sort((a, b) => String(b.createdAt || b.modifiedAt).localeCompare(String(a.createdAt || a.modifiedAt)));
}

async function verifyPortableBackup(name, passphrase) {
  const resolved = resolvePackage(name);
  const work = workDirectory('verify');
  try {
    const { archiveFile, envelope } = await decryptToArchive(resolved.file, passphrase, work);
    const parsed = await parseArchive(archiveFile);
    if (parsed.manifest.profile !== envelope.header.profile) throw portableError('可迁移备份内外清单不一致', 'PORTABLE_MANIFEST_MISMATCH');
    return { ok: true, valid: true, name: resolved.name, profile: parsed.manifest.profile, credentialPolicy: parsed.manifest.credentialPolicy, createdAt: parsed.manifest.createdAt, filesChecked: parsed.filesChecked, totalBytes: parsed.totalBytes, manifest: parsed.manifest };
  } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} }
}

async function importPortableAsBackup(name, passphrase) {
  const resolved = resolvePackage(name);
  const work = workDirectory('import');
  const extracted = path.join(work, 'extracted');
  fs.mkdirSync(extracted, { recursive: true });
  let finalDir = '';
  try {
    const { archiveFile } = await decryptToArchive(resolved.file, passphrase, work);
    const parsed = await parseArchive(archiveFile, extracted);
    const innerManifest = path.join(extracted, 'manifest.json');
    if (!fs.existsSync(innerManifest)) throw portableError('可迁移备份缺少 R32 恢复清单', 'PORTABLE_BACKUP_MANIFEST_MISSING');
    if (sha256File(innerManifest) !== parsed.manifest.sourceBackup?.manifestSha256) throw portableError('R32 恢复清单校验失败', 'PORTABLE_BACKUP_MANIFEST_CHECKSUM_FAILED');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = backupService.safeBackupName(`${stamp}-portable_import_${crypto.randomBytes(3).toString('hex')}`);
    finalDir = path.join(PATHS.backups, backupName);
    if (fs.existsSync(finalDir)) throw portableError('同名恢复点已经存在', 'PORTABLE_IMPORT_CONFLICT', 409);
    fs.renameSync(extracted, finalDir);
    const verification = backupService.verifyBackup(backupName, { force: true });
    if (!verification.ok) throw portableError(`导入后的恢复点校验失败：${verification.message}`, verification.code || 'PORTABLE_IMPORTED_BACKUP_INVALID');
    logger.warn('backup', 'portable-backup-imported', { package: resolved.name, backupName, files: verification.filesChecked, roots: verification.roots });
    return { ok: true, imported: true, packageName: resolved.name, backupName, verification, manifest: parsed.manifest };
  } catch (error) {
    if (finalDir) { try { fs.rmSync(finalDir, { recursive: true, force: true }); } catch (_) {} }
    throw error;
  } finally { try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {} }
}

async function stagePortableRestore(name, passphrase) {
  const imported = await importPortableAsBackup(name, passphrase);
  try {
    const staged = backupService.stageRestore(imported.backupName);
    return { ...imported, staged: true, restore: staged.plan };
  } catch (error) {
    throw Object.assign(error, { importedBackupName: imported.backupName });
  }
}

function deletePortableBackup(name) {
  const resolved = resolvePackage(name);
  if (!fs.existsSync(resolved.file)) return { ok: true, deleted: false, name: resolved.name };
  fs.rmSync(resolved.file, { force: true });
  logger.warn('backup', 'portable-backup-deleted', { name: resolved.name });
  return { ok: true, deleted: true, name: resolved.name };
}

module.exports = {
  ENVELOPE_MAGIC,
  ARCHIVE_MAGIC,
  FOOTER_MAGIC,
  PROFILE_ROOTS,
  PORTABLE_EXTENSION,
  LEGACY_PORTABLE_EXTENSIONS,
  ACCEPTED_PORTABLE_EXTENSIONS,
  createPortableBackup,
  inspectPortableBackup,
  listPortableBackups,
  verifyPortableBackup,
  importPortableAsBackup,
  stagePortableRestore,
  deletePortableBackup,
  safePackageName,
  resolvePackage,
  readEnvelope,
  parseArchive
};
