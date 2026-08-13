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

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp3-paths-')); }

test('canonical database path is the proper-lockfile target across trailing separators dot segments and symlink aliases', () => {
  const base = root();
  const physical = path.join(base, 'physical');
  const child = path.join(physical, 'child');
  fs.mkdirSync(child, { recursive: true });
  const aliases = [physical + path.sep, path.join(physical, '.'), path.join(child, '..')];
  const link = path.join(base, 'alias-link');
  try { fs.symlinkSync(physical, link, process.platform === 'win32' ? 'junction' : 'dir'); aliases.push(link); } catch (_) {}
  const rows = aliases.map(dataRoot => canonicalizeRuntimePaths({ dataRoot, dbPath: path.join(dataRoot, 'store', 'runtime.db') }));
  assert.equal(new Set(rows.map(row => row.dataRootIdentity)).size, 1);
  assert.equal(new Set(rows.map(row => row.dbPathIdentity)).size, 1);
  assert.equal(new Set(rows.map(row => row.dbPath)).size, 1);
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('Windows path identity folds case drive letter and trailing separators', () => {
  const variants = ['c:\\Data\\Yance\\Store\\runtime.db', 'C:\\DATA\\YANCE\\STORE\\RUNTIME.DB\\', 'c:/data/yance/store/runtime.db'];
  assert.equal(new Set(variants.map(value => normalizePathIdentity(value, 'win32'))).size, 1);
});

test('Windows physical database identity still collapses 8.3 aliases while file locking uses canonical path', () => {
  const physical = 'win32-directory-file-id-v1:1a:2b';
  const first = runtimeMutexIdentity({ platform: 'win32', canonicalDbPath: 'C:\\Users\\Stage\\Yance\\store\\yance-r32.db', dbPathIdentity: 'unused', physicalIdentityProvider: () => physical });
  const alias = runtimeMutexIdentity({ platform: 'win32', canonicalDbPath: 'C:\\Users\\STAGEA~1\\YANCE2~1\\store\\YANCE-R32.DB', dbPathIdentity: 'unused', physicalIdentityProvider: () => physical });
  assert.equal(first, alias);
});

test('Windows physical identity fails closed when the filesystem exposes no stable file id', () => {
  assert.throws(() => windowsDirectoryPhysicalIdentity('C:\\Data', { statSync: () => ({ isDirectory: () => true, dev: 0n, ino: 0n }) }), error => error?.reasonCode === 'RUNTIME_PATH_PHYSICAL_IDENTITY_UNAVAILABLE');
});

test('explicit database path resolving outside canonical data root is rejected', () => {
  const base = root();
  const dataRoot = path.join(base, 'data');
  const outside = path.join(base, 'outside', 'runtime.db');
  assert.throws(() => canonicalizeRuntimePaths({ dataRoot, dbPath: outside }), error => error.reasonCode === 'RUNTIME_DB_PATH_OUTSIDE_DATA_ROOT');
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
