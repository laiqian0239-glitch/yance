'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { acquireAuthorityWriteHost } = require('../../backend/services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../backend/lib/sqliteConnectionBroker');
const {
  applicationMatrixTempPrefix,
  createApplicationMatrixTempRoot
} = require('../../tools/wp4/desktop-credential-application-lifecycle-matrix');

const LONG_WINDOWS_CASES = Object.freeze([
  'A12_READY_GENERATION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED',
  'A14_RUNTIME_PROJECTION_MISMATCH_CLEANUP_STOP_FAILURE_CONTAINED',
  'A20_LIVE_REJECTED_OWNER_APPLICATION_EXIT_RETAINS_FENCE',
  'A21_REJECTED_OWNER_EVENTUAL_EXIT_RECOVERY_STARTS_NEW_OWNER'
]);

test('WP4 matrix case ids are evidence metadata and do not inflate Windows SQLite paths', () => {
  const prefixes = LONG_WINDOWS_CASES.map(applicationMatrixTempPrefix);
  assert.equal(new Set(prefixes).size, LONG_WINDOWS_CASES.length);
  for (let index = 0; index < prefixes.length; index += 1) {
    const prefix = prefixes[index];
    assert.match(prefix, /^y4-a(?:12|14|20|21)-[0-9a-f]{12}-$/);
    assert.ok(prefix.length <= 22, prefix);
    assert.equal(prefix.includes(LONG_WINDOWS_CASES[index].toLowerCase()), false);
    const windowsDbPath = path.win32.join(
      'C:\\Users\\1\\AppData\\Local\\Temp',
      `${prefix}ABCDEF`,
      'store',
      'yance-r32.db'
    );
    assert.ok(windowsDbPath.length < 100, `${windowsDbPath.length}: ${windowsDbPath}`);
  }
});

test('short matrix temp roots can open and close the production SQLite store', () => {
  for (const caseId of LONG_WINDOWS_CASES) {
    const root = createApplicationMatrixTempRoot(caseId);
    const dbPath = path.join(root, 'store', 'yance-r32.db');
    const host = acquireAuthorityWriteHost({
      dbPath,
      instanceId: `wp4-temp-path-${applicationMatrixTempPrefix(caseId)}`
    });
    const broker = new SqliteConnectionBroker({
      dbPath,
      authorityWriteHostCapability: host.capability
    });
    try {
      const store = broker.open();
      assert.equal(path.resolve(store.dbPath), path.resolve(dbPath));
      assert.equal(fs.existsSync(dbPath), true);
    } finally {
      try { broker.checkpointAndClose(); } catch (_) {}
      try { host.release(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('matrix source uses the bounded temp-root helper instead of raw case names', () => {
  const source = fs.readFileSync(require.resolve('../../tools/wp4/desktop-credential-application-lifecycle-matrix'), 'utf8');
  assert.match(source, /const root = createApplicationMatrixTempRoot\(name\)/);
  assert.doesNotMatch(source, /mkdtempSync\(path\.join\(os\.tmpdir\(\), `wp4-desktop-app-\$\{name\}-`\)\)/);
});
