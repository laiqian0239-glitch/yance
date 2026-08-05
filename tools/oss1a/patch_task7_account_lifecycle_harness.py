from pathlib import Path

path = Path('backend/tests/accountLifecycleRegression.test.js')
source = path.read_text(encoding='utf-8')

import_marker = "const assert = require('node:assert/strict');\n"
imports = """const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
"""
assert source.count(import_marker) == 1
source = source.replace(import_marker, imports, 1)

store_marker = "const { getStore } = require('../repositories/storeProvider');\n"
setup = """const { getStore } = require('../repositories/storeProvider');
const { acquireAuthorityWriteHost } = require('../services/authorityWriteHost');
const {
  createSqliteConnectionBroker,
  resetSqliteConnectionBrokerForTests
} = require('../lib/sqliteConnectionBroker');

let regressionSqliteRoot = '';
let regressionAuthorityWriteHost = null;

test.before(() => {
  process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET = '1';
  resetSqliteConnectionBrokerForTests();
  regressionSqliteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-account-lifecycle-regression-'));
  const dbPath = path.join(regressionSqliteRoot, 'database', 'yance.db');
  regressionAuthorityWriteHost = acquireAuthorityWriteHost({
    dbPath,
    instanceId: `account-lifecycle-regression-${process.pid}`
  });
  const broker = createSqliteConnectionBroker({
    dbPath,
    authorityWriteHostCapability: regressionAuthorityWriteHost.capability
  });
  broker.open();
});

test.after(() => {
  try { resetSqliteConnectionBrokerForTests(); } catch (_) {}
  try { regressionAuthorityWriteHost?.close(); } catch (_) {}
  if (regressionSqliteRoot) fs.rmSync(regressionSqliteRoot, { recursive: true, force: true });
  delete process.env.YANCE_TEST_ONLY_SQLITE_BROKER_RESET;
});
"""
assert source.count(store_marker) == 1
source = source.replace(store_marker, setup, 1)

assert source.count("test.before(() => {") == 1
assert source.count("createSqliteConnectionBroker({") == 1
assert source.count("acquireAuthorityWriteHost({") == 1
path.write_text(source, encoding='utf-8')
