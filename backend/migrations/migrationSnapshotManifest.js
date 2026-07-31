'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function digestFile(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function identity(filePath) {
  const canonicalPath = fs.realpathSync(filePath);
  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) throw new Error('Snapshot source is not a file');
  return {
    canonicalPath,
    canonicalPathHash: crypto.createHash('sha256').update(canonicalPath).digest('hex'),
    dev: Number.isInteger(stat.dev) ? stat.dev : null,
    ino: Number.isInteger(stat.ino) ? stat.ino : null,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: digestFile(canonicalPath)
  };
}

function sameIdentity(before, after) {
  return before.canonicalPath === after.canonicalPath
    && before.dev === after.dev
    && before.ino === after.ino
    && before.bytes === after.bytes
    && before.mtimeMs === after.mtimeMs
    && before.sha256 === after.sha256;
}

function snapshotError(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function fsyncSyncIfSupported(descriptor, context, platform = process.platform) {
  try {
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (context === 'directory' && platform === 'win32' && error?.code === 'EPERM') return;
    throw error;
  }
}


function createCompactSnapshotTarget({
  root,
  dbPath,
  migrationId,
  processGeneration,
  extension = 'sqlite',
  nonce = crypto.randomUUID()
}) {
  const snapshotRoot = String(root || '').trim();
  const sourcePath = String(dbPath || '').trim();
  const migration = String(migrationId || '').trim();
  const generation = String(processGeneration || '').trim();
  const suffix = String(extension || '').replace(/^\.+/u, '').trim().toLowerCase();
  if (!snapshotRoot || !sourcePath || !migration || !generation || !suffix || !/^[a-z0-9]+$/u.test(suffix)) {
    throw snapshotError('MIGRATION_SNAPSHOT_IDENTITY_INVALID', 'Compact snapshot identity fields are required');
  }
  const sourcePathHash = crypto.createHash('sha256').update(path.resolve(sourcePath)).digest('hex');
  const snapshotId = crypto.createHash('sha256')
    .update([migration, generation, sourcePathHash, String(nonce)].join('\u001f'))
    .digest('hex');
  return {
    snapshotId,
    targetPath: path.join(snapshotRoot, `${snapshotId}.${suffix}`)
  };
}

function createVerifiedSnapshot({
  dbPath,
  migrationId,
  processGeneration,
  root,
  platform = process.platform
}) {
  const sourcePath = String(dbPath || '').trim();
  const migration = String(migrationId || '').trim();
  const generation = String(processGeneration || '').trim();
  if (!sourcePath || !migration || !generation || !root) {
    throw snapshotError('MIGRATION_SNAPSHOT_IDENTITY_INVALID', 'Snapshot identity fields are required');
  }

  let temporaryManifest = '';
  let targetPath = '';
  let manifestPath = '';
  try {
    fs.mkdirSync(root, { recursive: true });
    const before = identity(sourcePath);
    const compactTarget = createCompactSnapshotTarget({
      root,
      dbPath: before.canonicalPath,
      migrationId: migration,
      processGeneration: generation,
      extension: 'sqlite',
      nonce: [before.canonicalPathHash, before.sha256, crypto.randomUUID()].join('\u001f')
    });
    const { snapshotId } = compactTarget;
    targetPath = compactTarget.targetPath;
    manifestPath = path.join(root, `${snapshotId}.manifest.json`);
    const temporaryId = crypto.createHash('sha256')
      .update([snapshotId, process.pid, crypto.randomUUID()].join('\u001f'))
      .digest('hex')
      .slice(0, 16);
    temporaryManifest = path.join(root, `${snapshotId}.${temporaryId}.tmp`);

    fs.copyFileSync(before.canonicalPath, targetPath, fs.constants.COPYFILE_EXCL);
    const after = identity(sourcePath);
    if (!sameIdentity(before, after)) {
      throw snapshotError('MIGRATION_SNAPSHOT_IDENTITY_INVALID', 'Snapshot source identity changed during copy');
    }
    const targetStat = fs.statSync(targetPath);
    const targetHash = digestFile(targetPath);
    if (!targetStat.isFile() || targetStat.size !== before.bytes || targetHash !== before.sha256) {
      throw snapshotError('MIGRATION_SNAPSHOT_INTEGRITY_FAILED', 'Snapshot target does not match its source');
    }
    const snapshotDescriptor = fs.openSync(targetPath, 'r+');
    try { fs.fsyncSync(snapshotDescriptor); } finally { fs.closeSync(snapshotDescriptor); }

    const manifest = {
      schemaVersion: 1,
      snapshotId,
      migrationId: migration,
      processGeneration: generation,
      createdAt: new Date().toISOString(),
      source: {
        canonicalPathHash: before.canonicalPathHash,
        dev: before.dev,
        ino: before.ino,
        bytes: before.bytes,
        mtimeMs: before.mtimeMs,
        sha256: before.sha256
      },
      target: {
        path: targetPath,
        bytes: targetStat.size,
        sha256: targetHash
      }
    };
    const descriptor = fs.openSync(temporaryManifest, 'wx');
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporaryManifest, manifestPath);
    temporaryManifest = '';
    const directoryDescriptor = fs.openSync(root, 'r');
    try {
      fsyncSyncIfSupported(directoryDescriptor, 'directory', platform);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
    return { created: true, snapshotId, manifestPath, manifest };
  } catch (error) {
    if (temporaryManifest) {
      try { fs.unlinkSync(temporaryManifest); } catch (_) {}
    }
    if (manifestPath) {
      try { fs.unlinkSync(manifestPath); } catch (_) {}
    }
    if (targetPath) {
      try { fs.unlinkSync(targetPath); } catch (_) {}
    }
    if (error?.code === 'MIGRATION_SNAPSHOT_IDENTITY_INVALID'
      || error?.code === 'MIGRATION_SNAPSHOT_INTEGRITY_FAILED') throw error;
    throw snapshotError('MIGRATION_SNAPSHOT_INTEGRITY_FAILED', 'Verified migration snapshot could not be published', error);
  }
}

module.exports = { createVerifiedSnapshot, createCompactSnapshotTarget, digestFile };
