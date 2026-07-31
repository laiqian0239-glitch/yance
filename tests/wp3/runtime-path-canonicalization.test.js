'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  canonicalizeRuntimePaths,
  normalizePathIdentity,
  runtimeMutexIdentity,
  windowsDirectoryPhysicalIdentity
} = require('../../backend/runtime/RuntimePathIdentity');
const { runtimeMutexName } = require('../../backend/runtime/NamedRuntimeMutex');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp3-paths-')); }

test('runtime identity canonicalizes trailing separators dot segments and symlink aliases before mutex naming', () => {
  const base = root();
  const physical = path.join(base, 'physical');
  const child = path.join(physical, 'child');
  fs.mkdirSync(child, { recursive: true });
  const aliases = [physical + path.sep, path.join(physical, '.'), path.join(child, '..')];
  const link = path.join(base, 'alias-link');
  try { fs.symlinkSync(physical, link, process.platform === 'win32' ? 'junction' : 'dir'); aliases.push(link); } catch (_) {}
  const identities = aliases.map(dataRoot => canonicalizeRuntimePaths({ dataRoot, dbPath: path.join(dataRoot, 'store', 'runtime.db') }));
  assert.equal(new Set(identities.map(row => row.dataRootIdentity)).size, 1);
  assert.equal(new Set(identities.map(row => row.dbPathIdentity)).size, 1);
  assert.equal(new Set(identities.map(row => runtimeMutexName(row.mutexIdentity))).size, 1);
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('Windows path identity folds case drive letter and trailing separators', () => {
  const variants = ['c:\\Data\\Yance\\Store\\runtime.db', 'C:\\DATA\\YANCE\\STORE\\RUNTIME.DB\\', 'c:/data/yance/store/runtime.db'];
  assert.equal(new Set(variants.map(value => normalizePathIdentity(value, 'win32'))).size, 1);
});

test('Windows mutex identity uses physical database-directory identity plus database filename', () => {
  const physical = 'win32-directory-file-id-v1:1a:2b';
  const first = runtimeMutexIdentity({
    platform: 'win32',
    canonicalDbPath: 'C:\\Users\\Stage\\Yance\\store\\yance-r32.db',
    dbPathIdentity: 'C:\\users\\stage\\yance\\store\\yance-r32.db',
    physicalIdentityProvider: () => physical
  });
  const shortAlias = runtimeMutexIdentity({
    platform: 'win32',
    canonicalDbPath: 'C:\\Users\\STAGEA~1\\YANCE2~1\\store\\YANCE-R32.DB',
    dbPathIdentity: 'C:\\users\\stagea~1\\yance2~1\\store\\yance-r32.db',
    physicalIdentityProvider: () => physical
  });
  assert.equal(first, shortAlias);
  assert.equal(runtimeMutexName(first), runtimeMutexName(shortAlias));
  assert.match(first, /^win32-database-file-id-v1:/);
});

test('Windows mutex identity keeps different database filenames separated inside one physical directory', () => {
  const options = {
    platform: 'win32',
    dbPathIdentity: 'unused',
    physicalIdentityProvider: () => 'win32-directory-file-id-v1:1a:2b'
  };
  const primary = runtimeMutexIdentity({ ...options, canonicalDbPath: 'C:\\Data\\store\\primary.db' });
  const secondary = runtimeMutexIdentity({ ...options, canonicalDbPath: 'C:\\Data\\store\\secondary.db' });
  assert.notEqual(primary, secondary);
  assert.notEqual(runtimeMutexName(primary), runtimeMutexName(secondary));
});

test('Windows physical identity fails closed when the filesystem does not expose a stable file id', () => {
  assert.throws(
    () => windowsDirectoryPhysicalIdentity('C:\\Data', {
      statSync: () => ({ isDirectory: () => true, dev: 0n, ino: 0n })
    }),
    error => error?.reasonCode === 'RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE'
  );
});

test('Windows physical identity recovers the volume id when an 8.3 alias reports st_dev zero', () => {
  const identity = windowsDirectoryPhysicalIdentity('C:\\DATA~1\\store', {
    realpathSync: value => value,
    statSync: value => value === 'C:\\'
      ? { isDirectory: () => true, dev: 0x5051fa4dn, ino: 1n }
      : { isDirectory: () => true, dev: 0n, ino: 0x1a000000071e5an }
  });
  assert.equal(identity, 'win32-directory-file-id-v1:5051fa4d:1a000000071e5a');
});

test('Windows physical identity is stable for path aliases that resolve to the same directory', () => {
  const base = root();
  const physical = path.join(base, 'physical');
  const alias = path.join(base, 'alias');
  fs.mkdirSync(physical, { recursive: true });
  try {
    fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const first = windowsDirectoryPhysicalIdentity(physical);
    const second = windowsDirectoryPhysicalIdentity(alias);
    assert.equal(first, second);
  } finally {
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

test('explicit database path resolving outside canonical data root is rejected', () => {
  const base = root();
  const dataRoot = path.join(base, 'data');
  const outside = path.join(base, 'outside', 'runtime.db');
  assert.throws(() => canonicalizeRuntimePaths({ dataRoot, dbPath: outside }), error => error.reasonCode === 'RUNTIME_DB_PATH_OUTSIDE_DATA_ROOT');
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
