#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function absolute(relativePath) {
  return path.join(REPO_ROOT, ...relativePath.split('/'));
}

function read(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(absolute(relativePath), content, 'utf8');
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source fragment not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: source fragment is not unique`);
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

function replaceAllExact(source, before, after, expectedCount, label) {
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} matches, found ${count}`);
  }
  return source.split(before).join(after);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function removeClassMethod(source, methodName) {
  const expression = new RegExp(
    `^  ${escapeRegExp(methodName)}\\([^\\n]*\\) \\{[\\s\\S]*?(?=^  [A-Za-z_$][\\w$]*\\([^\\n]*\\) \\{|^\\})`,
    'mu'
  );
  const matches = source.match(expression);
  if (!matches) throw new Error(`legacy method ${methodName} not found`);
  return source.replace(expression, '');
}

function refactorLegacyEngine() {
  const relativePath = 'backend/lib/r32SqliteStoreEngineLegacy.js';
  let source = read(relativePath);

  source = replaceOnce(
    source,
    "const fs = require('fs');\nconst path = require('path');\n",
    '',
    'remove legacy filesystem lifecycle imports'
  );
  source = replaceOnce(source, "const { DatabaseSync } = require('node:sqlite');\n", '', 'remove legacy DatabaseSync import');
  source = replaceOnce(
    source,
    "const { createCompactSnapshotTarget } = require('../migrations/migrationSnapshotManifest');\n",
    '',
    'remove legacy backup target import'
  );
  source = replaceOnce(
    source,
    "const {\n  acquireAuthorityWriteHost,\n  assertCurrentAuthorityWriteHostToken,\n  requireAuthorityWriteHostCapability\n} = require('../services/authorityWriteHost');\n",
    "const {\n  assertCurrentAuthorityWriteHostToken\n} = require('../services/authorityWriteHost');\n",
    'narrow legacy AuthorityWriteHost import'
  );
  source = replaceOnce(
    source,
    "const { claimOwnership, SqliteOwnershipError } = require('./sqliteOwnership');\n",
    '',
    'remove legacy ownership import'
  );
  source = replaceOnce(
    source,
    "const { SqliteTransactionCoordinator } = require('../store/sqliteTransactionCoordinator');\n",
    '',
    'remove legacy transaction coordinator constructor import'
  );
  source = replaceOnce(source, 'class R32SqliteStore {', 'class R32SqliteStoreOperations {', 'rename legacy operation base');

  for (const method of [
    'constructor',
    'startOwnershipHeartbeat',
    'assertOwnership',
    'existingSchemaVersion',
    'preflightSchemaVersion',
    'prepareSchemaMigrationBackup',
    'governSchemaVersion',
    'commitSchemaMigrationReceipt',
    'close'
  ]) {
    source = removeClassMethod(source, method);
  }

  source = replaceOnce(
    source,
    "module.exports = {\n  R32SqliteStore,\n  SCHEMA_VERSION,\n  stableId,\n  parseJson\n};\n",
    "module.exports = Object.freeze({\n  R32SqliteStoreOperations,\n  SCHEMA_VERSION,\n  stableId,\n  parseJson\n});\n",
    'replace legacy exports'
  );

  for (const forbidden of [
    'DatabaseSync',
    'createCompactSnapshotTarget',
    'acquireAuthorityWriteHost',
    'requireAuthorityWriteHostCapability',
    'claimOwnership',
    'SqliteOwnershipError',
    'SqliteTransactionCoordinator',
    'class R32SqliteStore {'
  ]) {
    if (source.includes(forbidden)) throw new Error(`legacy operation base still contains ${forbidden}`);
  }
  for (const required of [
    'class R32SqliteStoreOperations {',
    'assertCurrentAuthorityWriteHostToken',
    'transaction(callback)',
    'transactionAsync(callback)',
    'ensureSchema()'
  ]) {
    if (!source.includes(required)) throw new Error(`legacy operation base lost ${required}`);
  }

  write(relativePath, source);
}

function refactorPublicEngine() {
  const relativePath = 'backend/lib/r32SqliteStoreEngine.js';
  let source = read(relativePath);

  source = replaceOnce(
    source,
    "const {\n  acquireAuthorityWriteHost,\n  requireAuthorityWriteHostCapability\n} = require('../services/authorityWriteHost');\n",
    "const {\n  acquireAuthorityWriteHost,\n  assertCurrentAuthorityWriteHostToken,\n  requireAuthorityWriteHostCapability\n} = require('../services/authorityWriteHost');\n",
    'extend public AuthorityWriteHost import'
  );
  source = replaceOnce(
    source,
    'const LEGACY_ENGINE_PROTOTYPE = legacy.R32SqliteStore.prototype;',
    'const LEGACY_ENGINE_PROTOTYPE = legacy.R32SqliteStoreOperations.prototype;',
    'bind public Engine to operation-only base'
  );
  source = replaceOnce(
    source,
    '  const current = LEGACY_ENGINE_PROTOTYPE.existingSchemaVersion.call(store);',
    '  const current = existingSchemaVersion(store);',
    'move schema preflight authority to public Engine'
  );

  const lifecycleFunctions = `function startOwnershipHeartbeat(store) {
  if (!store.ownership || store.ownershipHeartbeatTimer) return;
  const loseOwnership = () => {
    if (store.ownershipLostError) return;
    store.ownershipLostError = Object.assign(
      new Error('SQLite write ownership heartbeat was lost; store is fail-closed'),
      { code: 'SQLITE_OWNERSHIP_HEARTBEAT_LOST', dbPath: store.dbPath }
    );
    if (store.ownershipHeartbeatTimer) clearInterval(store.ownershipHeartbeatTimer);
    store.ownershipHeartbeatTimer = null;
    try { store.db?.exec('PRAGMA query_only = ON'); } catch (_) {}
    try { store.db?.close(); store.db = null; } catch (_) {}
  };
  store.ownershipHeartbeatTimer = setInterval(() => {
    let ok = false;
    try {
      ok = store.authorityWriteHostCapability.heartbeat() === true;
    } catch (error) {
      store.ownershipLostError = error;
      ok = false;
    }
    if (!ok) loseOwnership();
  }, store.ownershipHeartbeatMs);
  store.ownershipHeartbeatTimer.unref?.();
}

function assertOwnership(store) {
  if (store.ownershipLostError) throw store.ownershipLostError;
  if (!store.db) {
    throw Object.assign(
      new Error('SQLite store is closed'),
      { code: 'SQLITE_STORE_CLOSED', dbPath: store.dbPath }
    );
  }
  assertCurrentAuthorityWriteHostToken(store.authorityWriteHostCapability, store.db);
  return true;
}

function existingSchemaVersion(store) {
  const tables = new Set(
    store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map(row => String(row.name || ''))
  );
  if (!tables.has('r32_meta')) return null;
  const rows = store.db.prepare(
    "SELECT key, value_json FROM r32_meta WHERE key IN ('schema_version','schemaVersion')"
  ).all();
  if (!rows.length) return null;
  const versions = [];
  for (const row of rows) {
    const parsed = legacy.parseJson(row.value_json, row.value_json);
    const number = Number(parsed);
    if (!Number.isInteger(number) || number < 0) {
      throw new SqliteOwnershipError(
        'SCHEMA_VERSION_INVALID',
        \`Database schema version metadata \${row.key} is invalid\`,
        { key: row.key, value: row.value_json, dbPath: store.dbPath }
      );
    }
    versions.push(number);
  }
  return Math.max(...versions);
}

function closeStore(store) {
  if (store.ownershipHeartbeatTimer) clearInterval(store.ownershipHeartbeatTimer);
  store.ownershipHeartbeatTimer = null;
  if (store.db) {
    store.db.close();
    store.db = null;
  }
  try { store.ownership?.release(); } catch (_) {}
  try { store.ownedAuthorityWriteHost?.close(); } catch (_) {}
  try { store.authorityWriteHostCapability?.close(); } catch (_) {}
}

`;

  source = replaceOnce(
    source,
    'function initializeStore(store, options = {}) {',
    `${lifecycleFunctions}function initializeStore(store, options = {}) {`,
    'install public Engine lifecycle functions'
  );

  const prototypeAnchor = `R32SqliteStore.prototype.supportedSchemaVersion = function supportedSchemaVersionMethod() {
  return SCHEMA_VERSION;
};
R32SqliteStore.prototype.preflightSchemaVersion = function preflightSchemaVersionMethod() {
  return preflightSchemaVersion(this);
};`;
  const prototypeReplacement = `R32SqliteStore.prototype.supportedSchemaVersion = function supportedSchemaVersionMethod() {
  return SCHEMA_VERSION;
};
R32SqliteStore.prototype.startOwnershipHeartbeat = function startOwnershipHeartbeatMethod() {
  return startOwnershipHeartbeat(this);
};
R32SqliteStore.prototype.assertOwnership = function assertOwnershipMethod() {
  return assertOwnership(this);
};
R32SqliteStore.prototype.existingSchemaVersion = function existingSchemaVersionMethod() {
  return existingSchemaVersion(this);
};
R32SqliteStore.prototype.close = function closeMethod() {
  return closeStore(this);
};
R32SqliteStore.prototype.preflightSchemaVersion = function preflightSchemaVersionMethod() {
  return preflightSchemaVersion(this);
};`;
  source = replaceOnce(source, prototypeAnchor, prototypeReplacement, 'publish lifecycle methods from public Engine');

  for (const required of [
    'legacy.R32SqliteStoreOperations.prototype',
    'new DatabaseSync(dbPath)',
    'assertCurrentAuthorityWriteHostToken',
    'function startOwnershipHeartbeat(store)',
    'function assertOwnership(store)',
    'function existingSchemaVersion(store)',
    'function closeStore(store)'
  ]) {
    if (!source.includes(required)) throw new Error(`public Engine lost ${required}`);
  }
  write(relativePath, source);
}

function hardenFacade() {
  const relativePath = 'backend/lib/r32SqliteStore.js';
  let source = read(relativePath);
  source = replaceOnce(
    source,
    "const engine = require('./r32SqliteStoreEngine');\n",
    "const engine = require('./r32SqliteStoreEngine');\nconst { assertCurrentAuthorityWriteHostToken } = require('../services/authorityWriteHost');\n",
    'import public facade host-token assertion'
  );
  source = replaceOnce(
    source,
    `function R32SqliteStore(options = {}) {
  if (!(this instanceof R32SqliteStore)) return new R32SqliteStore(options);
  return engine.R32SqliteStore.call(this, options);
}`,
    `function R32SqliteStore(options = {}) {
  if (!(this instanceof R32SqliteStore)) return new R32SqliteStore(options);
  const store = engine.R32SqliteStore.call(this, options);
  assertCurrentAuthorityWriteHostToken(store.authorityWriteHostCapability, store.db);
  return store;
}`,
    'assert host token at public store boundary'
  );
  write(relativePath, source);
}

function updateSingleAuthorityContract() {
  const relativePath = 'backend/tests/architectureClosureV2/wpB/sqliteStoreSingleAuthority.test.js';
  let source = read(relativePath);
  source = replaceOnce(
    source,
    "/const legacy = require\\('\\.\\/r32SqliteStoreEngineLegacy'\\)/u);\n  assert.match(source, /function R32SqliteStore\\(options = \\{\\}\\)/u);\n  assert.match(source, /R32SqliteStore\\.prototype = Object\\.create\\(LEGACY_ENGINE_PROTOTYPE\\)/u);",
    "/const legacy = require\\('\\.\\/r32SqliteStoreEngineLegacy'\\)/u);\n  assert.match(source, /legacy\\.R32SqliteStoreOperations\\.prototype/u);\n  assert.match(source, /function R32SqliteStore\\(options = \\{\\}\\)/u);\n  assert.match(source, /R32SqliteStore\\.prototype = Object\\.create\\(LEGACY_ENGINE_PROTOTYPE\\)/u);",
    'bind contract to operation-only base'
  );
  source = replaceOnce(
    source,
    `    'restoreMigrationBackup',
    'initializeStore'`,
    `    'restoreMigrationBackup',
    'startOwnershipHeartbeat',
    'assertOwnership',
    'existingSchemaVersion',
    'closeStore',
    'initializeStore'`,
    'require public lifecycle ownership'
  );
  source = replaceOnce(
    source,
    "  assert.match(source, /ensureCanonicalProjectionReceiptSchema\\(store\\.db\\)/u);\n",
    "  assert.match(source, /ensureCanonicalProjectionReceiptSchema\\(store\\.db\\)/u);\n  assert.match(source, /assertCurrentAuthorityWriteHostToken\\(store\\.authorityWriteHostCapability, store\\.db\\)/u);\n",
    'require facade boundary assertion'
  );

  const pureOperationContract = `test('internal legacy Engine is a pure operation base with no startup authority', () => {
  const source = fs.readFileSync(LEGACY_ENGINE_PATH, 'utf8');
  assert.match(source, /class R32SqliteStoreOperations \\{/u);
  assert.match(source, /transaction\\(callback\\)/u);
  assert.match(source, /transactionAsync\\(callback\\)/u);
  assert.match(source, /assertCurrentAuthorityWriteHostToken/u);
  assert.match(source, /ensureSchema\\(\\)/u);

  for (const forbidden of [
    'DatabaseSync',
    'createCompactSnapshotTarget',
    'acquireAuthorityWriteHost',
    'requireAuthorityWriteHostCapability',
    'claimOwnership',
    'SqliteOwnershipError',
    'SqliteTransactionCoordinator'
  ]) {
    assert.equal(source.includes(forbidden), false, \`\${forbidden} must remain in the public Engine lifecycle\`);
  }
  for (const forbiddenMethod of [
    'constructor',
    'startOwnershipHeartbeat',
    'assertOwnership',
    'existingSchemaVersion',
    'preflightSchemaVersion',
    'prepareSchemaMigrationBackup',
    'governSchemaVersion',
    'commitSchemaMigrationReceipt',
    'close'
  ]) {
    assert.doesNotMatch(source, new RegExp(\`^  \${forbiddenMethod}\\\\([^\\\\n]*\\\\) \\\\{\`, 'mu'));
  }
});

`;
  source = replaceOnce(
    source,
    "test('internal legacy Engine has exactly one production importer', () => {",
    `${pureOperationContract}test('internal legacy Engine has exactly one production importer', () => {`,
    'add pure operation-base contract'
  );
  write(relativePath, source);
}

function updateRegistryCapability() {
  const relativePath = 'governance/architecture-closure-v2/wp-b-authority-registry-extension.json';
  const document = JSON.parse(read(relativePath));
  if (!Array.isArray(document.entries) || document.entries.length !== 1) {
    throw new Error('WP-B registry extension must retain one exact authority entry');
  }
  document.entries[0].allowedCapabilities = ['PRIMARY_DB_CONSTRUCTOR'];
  write(relativePath, `${JSON.stringify(document, null, 2)}\n`);
}

function updatePermanentWorkflowTriggers() {
  const relativePath = '.github/workflows/wp-b-validation.yml';
  let source = read(relativePath);
  source = replaceAllExact(
    source,
    '      - backend/lib/r32SqliteStoreEngine.js\n',
    '      - backend/lib/r32SqliteStoreEngine.js\n      - backend/lib/r32SqliteStoreEngineLegacy.js\n',
    2,
    'add internal Engine trigger'
  );
  source = replaceAllExact(
    source,
    '      - governance/architecture-closure-v2/wp-b-*.json\n',
    '      - governance/architecture-closure-v2/wp-b-*.json\n      - release/architecture-closure-v2/wp-b-governance-package.json\n',
    2,
    'add packaged governance trigger'
  );
  write(relativePath, source);
}

function updateGovernancePackagingContract() {
  const relativePath = 'backend/tests/architectureClosureV2/wpB/governancePackagingContract.test.js';
  let source = read(relativePath);
  const title = 'WP-B validation permanently watches internal SQLite authority and packaged governance evidence';
  if (source.includes(title)) throw new Error('permanent workflow trigger contract already exists');
  source += `\ntest('${title}', () => {
  const workflow = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'wp-b-validation.yml'), 'utf8');
  for (const watchedPath of [
    'backend/lib/r32SqliteStoreEngineLegacy.js',
    'release/architecture-closure-v2/wp-b-governance-package.json'
  ]) {
    const line = \`      - \${watchedPath}\`;
    assert.equal(workflow.split(line).length - 1, 2, \`\${watchedPath} must trigger both pull_request and push validation\`);
  }
});\n`;
  write(relativePath, source);
}

function consolidateWp0Contracts() {
  const targetPath = 'tests/wp0/acv2-work-package-scope-wiring.test.js';
  let source = read(targetPath);
  const title = 'WP-B authority keeps exact internal engines and packaged evidence without adjacent expansion';
  if (source.includes(title)) throw new Error('WP-B exact path contract already consolidated');
  source += `\ntest('${title}', () => {
  const {
    ADDITIONAL_WP_B_AUTHORITY_PATHS,
    evaluateAuthorizedWpBScope,
    resolveWpBImplementationAuthority
  } = require('../../shared/release/implementationBranchPolicy');
  const authority = resolveWpBImplementationAuthority();
  assert.ok(authority, 'active WP-B authority must resolve');
  const exactPaths = [
    'backend/lib/r32SqliteStoreEngineLegacy.js',
    'backend/migrations/architectureClosureV2WpBEngine.js',
    'release/architecture-closure-v2/wp-b-governance-package.json',
    'shared/release/acv2ActiveWorkPackageAuthorityEngine.js'
  ];
  assert.deepEqual([...ADDITIONAL_WP_B_AUTHORITY_PATHS].sort(), exactPaths);

  const exact = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: exactPaths
  });
  assert.equal(exact.pass, true, JSON.stringify(exact));
  assert.deepEqual(exact.unauthorizedPaths, []);

  const adjacent = [
    'backend/lib/r32SqliteStoreEngineLegacyCopy.js',
    'backend/migrations/architectureClosureV2WpCEngine.js',
    'release/architecture-closure-v2/wp-c-governance-package.json',
    'shared/release/anotherAuthorityEngine.js'
  ];
  const rejected = evaluateAuthorizedWpBScope({
    authority,
    branch: authority.authorizedBranch,
    changedFiles: adjacent
  });
  assert.equal(rejected.pass, false);
  assert.equal(rejected.reasonCode, 'ACV2_WP_B_SCOPE_VIOLATION');
  assert.deepEqual(rejected.unauthorizedPaths, adjacent.sort());
});\n`;
  write(targetPath, source);

  const temporaryTest = absolute('tests/wp0/wp-b-additional-authority-paths.test.js');
  if (!fs.existsSync(temporaryTest)) throw new Error('temporary WP0 authority test is missing');
  fs.rmSync(temporaryTest);

  const restored = execFileSync(
    'git',
    ['show', '319fbef354284340af7bb6187105cf5b24380a6b:tests/wp0/forbidden-hotfix-entrypoints.test.js'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  write('tests/wp0/forbidden-hotfix-entrypoints.test.js', restored);
}

function main() {
  refactorLegacyEngine();
  refactorPublicEngine();
  hardenFacade();
  updateSingleAuthorityContract();
  updateRegistryCapability();
  updatePermanentWorkflowTriggers();
  updateGovernancePackagingContract();
  consolidateWp0Contracts();

  const forbiddenLegacy = read('backend/lib/r32SqliteStoreEngineLegacy.js');
  if (/new\s+DatabaseSync\s*\(/u.test(forbiddenLegacy)) {
    throw new Error('Legacy operation base still constructs the primary database');
  }
  process.stdout.write('R32_SQLITE_SINGLE_AUTHORITY_REFACTOR_APPLIED\n');
}

main();
