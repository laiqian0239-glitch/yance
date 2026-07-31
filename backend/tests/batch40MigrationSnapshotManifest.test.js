'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createVerifiedSnapshot } = require('../migrations/migrationSnapshotManifest');
const { createPreMigrationSnapshot } = require('../migrations/stage6_3_4ArchitectureClosure');
const { createSnapshot: createRound12Snapshot } = require('../migrations/round12PlatformCoreUnification');
const { createSnapshot: createSelfCheckSnapshot } = require('../migrations/round12Round13SelfCheckHardening');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-snapshot-'));
  const dbPath = path.join(root, 'live.sqlite');
  fs.writeFileSync(dbPath, Buffer.from('sqlite-snapshot-source'));
  return { root, dbPath, snapshots: path.join(root, 'snapshots') };
}

test('verified snapshot binds canonical source identity, target bytes, and atomic manifest', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const result = createVerifiedSnapshot({
    dbPath: value.dbPath,
    migrationId: 'migration-40',
    processGeneration: 'process-generation-1',
    root: value.snapshots
  });

  assert.equal(result.created, true);
  assert.match(result.snapshotId, /^[a-f0-9]{64}$/);
  assert.equal(result.manifest.processGeneration, 'process-generation-1');
  assert.equal(result.manifest.source.canonicalPathHash,
    crypto.createHash('sha256').update(fs.realpathSync(value.dbPath)).digest('hex'));
  assert.equal(result.manifest.source.sha256, result.manifest.target.sha256);
  assert.equal(result.manifest.source.bytes, result.manifest.target.bytes);
  assert.deepEqual(fs.readFileSync(result.manifest.target.path), fs.readFileSync(value.dbPath));
  assert.equal(result.manifestPath.endsWith('.manifest.json'), true);
  assert.equal(fs.existsSync(`${result.manifestPath}.tmp`), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8')), result.manifest);
});


test('temporary manifest publication names stay within the Windows path budget', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const original = fs.openSync;
  let temporaryManifest = '';
  fs.openSync = (file, flags, ...args) => {
    if (flags === 'wx' && String(file).endsWith('.tmp')) temporaryManifest = String(file);
    return original(file, flags, ...args);
  };
  try {
    createVerifiedSnapshot({
      dbPath: value.dbPath,
      migrationId: 'migration-temp-budget',
      processGeneration: 'generation-temp-budget',
      root: value.snapshots
    });
  } finally {
    fs.openSync = original;
  }
  assert.ok(temporaryManifest);
  assert.ok(path.basename(temporaryManifest).length <= 96,
    `temporary manifest filename exceeded the Windows path budget: ${path.basename(temporaryManifest)}`);
});

test('Windows directory fsync EPERM does not invalidate an otherwise durable snapshot', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const original = fs.fsyncSync;
  let calls = 0;
  fs.fsyncSync = descriptor => {
    calls += 1;
    if (calls === 3) throw Object.assign(new Error('directory fsync unsupported'), { code: 'EPERM' });
    return original(descriptor);
  };
  try {
    const result = createVerifiedSnapshot({
      dbPath: value.dbPath,
      migrationId: 'migration-windows-directory-fsync',
      processGeneration: 'generation-windows-directory-fsync',
      root: value.snapshots,
      platform: 'win32'
    });
    assert.equal(result.created, true);
    assert.equal(fs.existsSync(result.manifestPath), true);
  } finally {
    fs.fsyncSync = original;
  }
});

test('Windows snapshot file fsync uses a writable descriptor', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const originalFsync = fs.fsyncSync;
  const descriptors = new Map();
  let snapshotFsyncFlags = '';

  fs.openSync = (file, flags, ...args) => {
    const descriptor = originalOpen(file, flags, ...args);
    descriptors.set(descriptor, { file: String(file), flags: String(flags) });
    return descriptor;
  };
  fs.closeSync = descriptor => {
    try {
      return originalClose(descriptor);
    } finally {
      descriptors.delete(descriptor);
    }
  };
  fs.fsyncSync = descriptor => {
    const opened = descriptors.get(descriptor);
    const isSnapshotTarget = opened
      && opened.file.startsWith(`${value.snapshots}${path.sep}`)
      && opened.file.endsWith('.sqlite');
    if (isSnapshotTarget) {
      snapshotFsyncFlags = opened.flags;
      if (opened.flags === 'r') {
        throw Object.assign(new Error('Windows rejects fsync on a read-only file descriptor'), { code: 'EPERM' });
      }
    }
    return originalFsync(descriptor);
  };

  try {
    const result = createVerifiedSnapshot({
      dbPath: value.dbPath,
      migrationId: 'migration-windows-writable-file-fsync',
      processGeneration: 'generation-windows-writable-file-fsync',
      root: value.snapshots,
      platform: 'win32'
    });
    assert.equal(result.created, true);
    assert.equal(snapshotFsyncFlags, 'r+');
    assert.equal(fs.existsSync(result.manifestPath), true);
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
    fs.fsyncSync = originalFsync;
  }
});

test('Windows file fsync EPERM remains fail-closed', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const original = fs.fsyncSync;
  fs.fsyncSync = () => {
    throw Object.assign(new Error('file fsync failed'), { code: 'EPERM' });
  };
  try {
    assert.throws(() => createVerifiedSnapshot({
      dbPath: value.dbPath,
      migrationId: 'migration-windows-file-fsync',
      processGeneration: 'generation-windows-file-fsync',
      root: value.snapshots,
      platform: 'win32'
    }), error => error.code === 'MIGRATION_SNAPSHOT_INTEGRITY_FAILED');
  } finally {
    fs.fsyncSync = original;
  }
});

test('Windows directory fsync errors other than EPERM remain fail-closed', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const original = fs.fsyncSync;
  let calls = 0;
  fs.fsyncSync = descriptor => {
    calls += 1;
    if (calls === 3) throw Object.assign(new Error('directory fsync failed'), { code: 'EIO' });
    return original(descriptor);
  };
  try {
    assert.throws(() => createVerifiedSnapshot({
      dbPath: value.dbPath,
      migrationId: 'migration-windows-directory-fsync-eio',
      processGeneration: 'generation-windows-directory-fsync-eio',
      root: value.snapshots,
      platform: 'win32'
    }), error => error.code === 'MIGRATION_SNAPSHOT_INTEGRITY_FAILED');
  } finally {
    fs.fsyncSync = original;
  }
});

test('source replacement and corrupted target abort before publishing a manifest', t => {
  for (const fault of ['source-replaced', 'target-corrupted']) {
    const value = fixture();
    t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
    const original = fs.copyFileSync;
    fs.copyFileSync = (source, target, ...args) => {
      original(source, target, ...args);
      if (fault === 'source-replaced') {
        fs.renameSync(source, `${source}.old`);
        fs.writeFileSync(source, Buffer.from('replacement-source'));
      } else {
        fs.appendFileSync(target, Buffer.from('corruption'));
      }
    };
    try {
      assert.throws(() => createVerifiedSnapshot({
        dbPath: value.dbPath,
        migrationId: 'migration-40',
        processGeneration: `generation-${fault}`,
        root: value.snapshots
      }), error => ['MIGRATION_SNAPSHOT_IDENTITY_INVALID', 'MIGRATION_SNAPSHOT_INTEGRITY_FAILED'].includes(error.code));
      assert.equal(fs.existsSync(value.snapshots)
        ? fs.readdirSync(value.snapshots).some(name => name.endsWith('.manifest.json'))
        : false, false);
    } finally {
      fs.copyFileSync = original;
    }
  }
});

test('manifest rename failure is fail-closed and leaves no published authority', t => {
  const value = fixture();
  t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
  const original = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('rename unavailable'), { code: 'EACCES' }); };
  try {
    assert.throws(() => createVerifiedSnapshot({
      dbPath: value.dbPath,
      migrationId: 'migration-40',
      processGeneration: 'generation-rename',
      root: value.snapshots
    }), error => error.code === 'MIGRATION_SNAPSHOT_INTEGRITY_FAILED');
    assert.deepEqual(fs.readdirSync(value.snapshots), []);
  } finally {
    fs.renameSync = original;
  }
});

test('a busy or incomplete WAL checkpoint is rejected even when SQLite does not throw', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-checkpoint-row-'));
  const storeRoot = path.join(root, 'store');
  const dbPath = path.join(storeRoot, 'live.sqlite');
  fs.mkdirSync(storeRoot, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from('sqlite-with-busy-wal'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = {
    prepare(sql) {
      if (sql === 'PRAGMA database_list') return { all: () => [{ name: 'main', file: dbPath }] };
      assert.equal(sql, 'PRAGMA wal_checkpoint(FULL)');
      return { all: () => [{ busy: 1, log: 10, checkpointed: 5 }] };
    }
  };

  assert.throws(() => createPreMigrationSnapshot(db), error =>
    error.code === 'MIGRATION_SNAPSHOT_CHECKPOINT_FAILED'
  );
  assert.equal(fs.existsSync(path.join(root, 'migration-backups')), false);
});

test('an empty main database identity fails closed instead of impersonating memory storage', () => {
  const db = {
    prepare(sql) {
      assert.equal(sql, 'PRAGMA database_list');
      return { all: () => [{ name: 'main', file: '' }] };
    }
  };
  assert.throws(() => createPreMigrationSnapshot(db), error =>
    error.code === 'MIGRATION_SNAPSHOT_IDENTITY_INVALID'
  );
});

test('a failed WAL checkpoint aborts before a migration snapshot is published', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b40-checkpoint-'));
  const storeRoot = path.join(root, 'store');
  const dbPath = path.join(storeRoot, 'live.sqlite');
  fs.mkdirSync(storeRoot, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from('sqlite-with-uncheckpointed-wal'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const db = {
    prepare(sql) {
      if (sql === 'PRAGMA database_list') {
        return { all: () => [{ name: 'main', file: dbPath }] };
      }
      assert.equal(sql, 'PRAGMA wal_checkpoint(FULL)');
      return {
        all() {
          throw Object.assign(new Error('checkpoint busy'), { code: 'SQLITE_BUSY' });
        }
      };
    }
  };

  assert.throws(() => createPreMigrationSnapshot(db), error =>
    error.code === 'MIGRATION_SNAPSHOT_CHECKPOINT_FAILED'
    && error.cause?.code === 'SQLITE_BUSY'
  );
  assert.equal(fs.existsSync(path.join(root, 'migration-backups')), false);
});

test('a failed database identity query cannot be treated as an in-memory database', () => {
  const db = {
    prepare(sql) {
      assert.equal(sql, 'PRAGMA database_list');
      throw Object.assign(new Error('database identity unavailable'), {
        code: 'SQLITE_CANTOPEN'
      });
    }
  };

  assert.throws(() => createPreMigrationSnapshot(db), error =>
    error.code === 'MIGRATION_SNAPSHOT_IDENTITY_INVALID'
  );
});


function vacuumFixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = path.join(root, 'store');
  const dbPath = path.join(store, 'yance-r32.db');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(dbPath, Buffer.from('sqlite-vacuum-source'));
  const db = {
    prepare(sql) {
      assert.equal(sql, 'PRAGMA database_list');
      return { all: () => [{ name: 'main', file: dbPath }] };
    },
    exec(sql) {
      if (sql === 'PRAGMA wal_checkpoint(FULL)') return;
      const match = String(sql).match(/^VACUUM INTO '(.+)'$/u);
      assert.ok(match, `unexpected SQL: ${sql}`);
      fs.writeFileSync(match[1].replace(/''/g, "'"), Buffer.from('sqlite-vacuum-snapshot'));
    }
  };
  return { root, db };
}

test('all VACUUM migration snapshots use a bounded collision-safe filename', t => {
  for (const [name, createSnapshot] of [
    ['round12', createRound12Snapshot],
    ['self-check', createSelfCheckSnapshot]
  ]) {
    const value = vacuumFixture(`yance-b40-${name}-path-budget-`);
    t.after(() => fs.rmSync(value.root, { recursive: true, force: true }));
    const result = createSnapshot(value.db);
    assert.equal(result.created, true);
    assert.ok(path.basename(result.path).length <= 72,
      `${name} snapshot filename exceeded the Windows path budget: ${path.basename(result.path)}`);
    assert.match(path.basename(result.path), /^[a-f0-9]{64}\.sqlite$/u);
  }
});
