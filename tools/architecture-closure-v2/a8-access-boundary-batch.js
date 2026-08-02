'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function absolute(relativePath) { return path.join(repoRoot, relativePath); }
function read(relativePath) { return fs.readFileSync(absolute(relativePath), 'utf8'); }
function write(relativePath, content) {
  fs.mkdirSync(path.dirname(absolute(relativePath)), { recursive: true });
  fs.writeFileSync(absolute(relativePath), content, 'utf8');
}
function replaceExactlyOnce(relativePath, before, after) {
  const source = read(relativePath);
  const first = source.indexOf(before);
  const second = first < 0 ? -1 : source.indexOf(before, first + before.length);
  if (first < 0 || second >= 0) {
    throw new Error(`${relativePath}: replacement target count must be exactly one`);
  }
  write(relativePath, source.slice(0, first) + after + source.slice(first + before.length));
}

// False-positive cleanup: remove obsolete code-shaped prose. The runtime logic
// remains unchanged; the comments now describe the actual capability model.
replaceExactlyOnce(
  'backend/lib/sqliteOwnership.js',
  '// Risk closed: `R32SqliteStore` opens the app-data SQLite (`yance-r32.db`)\n// with `new DatabaseSync(dbPath)` and NO cross-instance ownership guard. A\n',
  '// Risk closed: legacy primary-store construction opened the app-data SQLite\n// without a cross-instance ownership guard. A\n'
);
replaceExactlyOnce(
  'backend/store/contactIdentityConfirmationRepository.js',
  ' *  - 通过依赖注入的 node:sqlite DatabaseSync（生产来自 getR32Store().db）。\n',
  ' *  - 通过依赖注入接收 broker-owned primary database capability；仓储本身不获取主存储。\n'
);

// Store persistence adapters must be explicitly bound to the broker-owned
// store. There is no process-global fallback.
replaceExactlyOnce(
  'backend/store/adapters/SqliteStorePersistenceAdapter.js',
  "const { getR32Store } = require('../../lib/r32StoreSingleton');\n",
  ''
);
replaceExactlyOnce(
  'backend/store/adapters/SqliteStorePersistenceAdapter.js',
  `class SqliteStorePersistenceAdapter {\n  constructor(options = {}) {\n    this.store = options.store || getR32Store();\n`,
  `class SqliteStorePersistenceAdapter {\n  constructor(options = {}) {\n    if (!options.store || !options.store.db || typeof options.store.transactionAsync !== 'function') {\n      const error = new TypeError('SqliteStorePersistenceAdapter requires the broker-owned primary store capability');\n      error.code = 'PRIMARY_STORE_CAPABILITY_REQUIRED';\n      throw error;\n    }\n    this.store = options.store;\n`
);
replaceExactlyOnce(
  'backend/server.js',
  'const storeReadyPromise = storeManagerService.initialize()\n',
  'const storeReadyPromise = storeManagerService.initialize({ persistenceOptions: { store: APP_RUNTIME.primaryAuthorityStore } })\n'
);

// Build route-level identity commands once from the runtime authority graph.
const facadePath = 'backend/services/workspaceIdentityCommandFacade.js';
if (fs.existsSync(absolute(facadePath))) throw new Error(`${facadePath} already exists`);
write(facadePath, `'use strict';\n\nconst { ContactIdentityConfirmationRepository } = require('../store/contactIdentityConfirmationRepository');\nconst { createContactIdentityConfirmationService } = require('./contactIdentityConfirmationService');\nconst { ContactMergeRepository } = require('../store/contactMergeRepository');\nconst { createContactMergeService } = require('./contactMergeService');\nconst { RelationshipKeyNodeRepository } = require('../store/relationshipKeyNodeRepository');\nconst { createRelationshipKeyNodeService } = require('./relationshipKeyNodeService');\n\nlet binding = null;\n\nfunction facadeError(code, message) {\n  return Object.assign(new Error(message), { code, status: 503 });\n}\n\nfunction configureWorkspaceIdentityCommandFacade(options = {}) {\n  const db = options.db;\n  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') {\n    throw facadeError('WORKSPACE_IDENTITY_DB_CAPABILITY_REQUIRED', 'Workspace identity commands require the broker-owned database capability');\n  }\n  if (binding) {\n    if (binding.db === db) return binding.facade;\n    const testReset = process.env.YANCE_TEST_ONLY_RUNTIME_RESET === '1' || process.env.NODE_ENV === 'test';\n    if (!testReset) {\n      throw facadeError('WORKSPACE_IDENTITY_AUTHORITY_ALREADY_CONFIGURED', 'Workspace identity command authority is already bound to another database');\n    }\n  }\n  const identityService = createContactIdentityConfirmationService({\n    store: new ContactIdentityConfirmationRepository({ db }),\n    now: () => Date.now()\n  });\n  const mergeService = createContactMergeService({\n    store: new ContactMergeRepository({ db }),\n    now: () => Date.now()\n  });\n  const keyNodeService = createRelationshipKeyNodeService({\n    store: new RelationshipKeyNodeRepository({ db }),\n    now: () => Date.now()\n  });\n  const facade = Object.freeze({\n    identityService,\n    mergeService,\n    keyNodeService\n  });\n  binding = Object.freeze({ db, facade });\n  return facade;\n}\n\nfunction getWorkspaceIdentityCommandFacade() {\n  if (!binding) {\n    throw facadeError('WORKSPACE_IDENTITY_AUTHORITY_NOT_READY', 'Workspace identity command authority is not configured');\n  }\n  return binding.facade;\n}\n\nmodule.exports = {\n  configureWorkspaceIdentityCommandFacade,\n  getWorkspaceIdentityCommandFacade\n};\n`);

replaceExactlyOnce(
  'backend/routes/workspace.js',
  `// P0-B 集成层：把 身份确认 / 合并 / 关键节点 稳定契约接到 R32 权威 SQLite。\nconst { getR32Store } = require('../lib/r32StoreSingleton');\nconst { ContactIdentityConfirmationRepository } = require('../store/contactIdentityConfirmationRepository');\nconst { createContactIdentityConfirmationService } = require('../services/contactIdentityConfirmationService');\nconst { ContactMergeRepository } = require('../store/contactMergeRepository');\nconst { createContactMergeService } = require('../services/contactMergeService');\nconst { RelationshipKeyNodeRepository } = require('../store/relationshipKeyNodeRepository');\nconst { createRelationshipKeyNodeService } = require('../services/relationshipKeyNodeService');\n`,
  `// P0-B integration is bound once by AppRuntimeComposition to the broker-owned\n// database capability. HTTP routes never acquire a primary store.\nconst { getWorkspaceIdentityCommandFacade } = require('../services/workspaceIdentityCommandFacade');\n`
);
replaceExactlyOnce(
  'backend/routes/workspace.js',
  `// 惰性构建服务（每次请求基于单例 db；ensureSchema 幂等，对现有数据非破坏）。\nfunction buildIdentityService() {\n  const repo = new ContactIdentityConfirmationRepository({ db: getR32Store().db });\n  return createContactIdentityConfirmationService({ store: repo, now: () => Date.now() });\n}\nfunction buildMergeService() {\n  const repo = new ContactMergeRepository({ db: getR32Store().db });\n  return createContactMergeService({ store: repo, now: () => Date.now() });\n}\nfunction buildKeyNodeService() {\n  const repo = new RelationshipKeyNodeRepository({ db: getR32Store().db });\n  return createRelationshipKeyNodeService({ store: repo, now: () => Date.now() });\n}\n`,
  `function buildIdentityService() { return getWorkspaceIdentityCommandFacade().identityService; }\nfunction buildMergeService() { return getWorkspaceIdentityCommandFacade().mergeService; }\nfunction buildKeyNodeService() { return getWorkspaceIdentityCommandFacade().keyNodeService; }\n`
);

replaceExactlyOnce(
  'backend/runtime/AppRuntimeComposition.js',
  "const aiGateway = require('../services/aiGateway');\n",
  "const aiGateway = require('../services/aiGateway');\nconst { configureWorkspaceIdentityCommandFacade } = require('../services/workspaceIdentityCommandFacade');\n"
);
replaceExactlyOnce(
  'backend/runtime/AppRuntimeComposition.js',
  `  const authorityTransactionCoordinator = new AuthorityTransactionCoordinator({ store: authorityStore, eventBus });\n`,
  `  const workspaceIdentityCommandFacade = configureWorkspaceIdentityCommandFacade({ db: authorityStore.db });\n\n  const authorityTransactionCoordinator = new AuthorityTransactionCoordinator({ store: authorityStore, eventBus });\n`
);
replaceExactlyOnce(
  'backend/runtime/AppRuntimeComposition.js',
  `    authorities: Object.freeze({ authorityWriteHostCapability, authorityTransactionCoordinator, canonicalEventLedgerAuthority, identityAuthority, platformCoreRepository }),\n`,
  `    authorities: Object.freeze({ authorityWriteHostCapability, authorityTransactionCoordinator, canonicalEventLedgerAuthority, identityAuthority, platformCoreRepository, workspaceIdentityCommandFacade }),\n`
);

// Register the three legitimate low-level capabilities instead of pretending
// they are ordinary domain access paths.
const registryPath = 'governance/architecture-closure-v2/authority-registry.json';
const registry = JSON.parse(read(registryPath));
const additions = [
  {
    id: 'A0-AUTHORITY-WRITE-HOST-BOOTSTRAP',
    path: 'backend/services/authorityWriteHost.js',
    classification: 'AUTHORITY_WRITER',
    authorityOwner: 'AuthorityWriteHost',
    commandEntrypoint: 'acquireAuthorityWriteHost',
    eventTypes: ['authority-host.acquired'],
    aggregate: 'AuthorityHostLease',
    versionStrategy: 'hostGeneration+fencingToken',
    idempotencyKey: 'startupNonce',
    receiptIssuer: 'AuthorityWriteHost',
    projection: 'authority_write_host_lease',
    legacyPaths: { writer: ['bootstrap SQLite lease compare-and-swap'], recovery: [], fallback: [] },
    removalCondition: 'The bootstrap handle exists only while atomically acquiring the one current host capability and is closed before returning.',
    blockingWorkPackage: 'WP-A',
    closureState: 'OPEN',
    requiredSourceMarkers: ['assertPrimarySqliteHost', 'claimOwnership', 'new DatabaseSync', 'ensureAuthorityWriteHostBootstrapObjects'],
    forbiddenSourceMarkers: []
  },
  {
    id: 'A0-RUNTIME-LEGACY-READ-AUTHORITY',
    path: 'backend/runtime/RuntimeAuthorityMigrationCoordinator.js',
    classification: 'RECOVERY',
    authorityOwner: 'ArchitectureRuntime',
    commandEntrypoint: 'RuntimeAuthorityMigrationCoordinator.ensureAuthority',
    eventTypes: ['runtime-authority.migrated'],
    aggregate: 'RuntimeAuthorityMigration',
    versionStrategy: 'sourceFingerprint+migrationVersion',
    idempotencyKey: 'legacyRoot+sourceFingerprint',
    receiptIssuer: 'ArchitectureRuntime',
    projection: 'runtime authority state',
    legacyPaths: { writer: [], recovery: ['read-only Yance27 runtime inspection'], fallback: [] },
    removalCondition: 'Legacy SQLite is opened read-only with query_only and only the broker-owned runtime store receives the migration result.',
    blockingWorkPackage: 'WP-A',
    closureState: 'OPEN',
    requiredSourceMarkers: ['{ readOnly: true }', 'PRAGMA query_only=ON', 'sourceMutationCount: 0'],
    forbiddenSourceMarkers: []
  },
  {
    id: 'A0-BACKUP-SNAPSHOT-AUTHORITY',
    path: 'backend/services/backupService.js',
    classification: 'RECOVERY',
    authorityOwner: 'BackupAuthority',
    commandEntrypoint: 'createConsistentSqliteSnapshot',
    eventTypes: ['backup.snapshot-created'],
    aggregate: 'BackupSnapshot',
    versionStrategy: 'manifestSchemaVersion+sha256',
    idempotencyKey: 'backupName+sourceDigest',
    receiptIssuer: 'BackupAuthority',
    projection: 'verified offline backup file',
    legacyPaths: { writer: [], recovery: ['read-only primary snapshot and offline integrity verification'], fallback: [] },
    removalCondition: 'Primary SQLite is opened read-only; output is a separate backup file verified before publication.',
    blockingWorkPackage: 'WP-A',
    closureState: 'OPEN',
    requiredSourceMarkers: ['{ readOnly: true }', 'VACUUM INTO', 'PRAGMA integrity_check'],
    forbiddenSourceMarkers: []
  }
];
const existingIds = new Set(registry.entries.map(entry => entry.id));
const existingPaths = new Set(registry.entries.map(entry => entry.path));
for (const entry of additions) {
  if (existingIds.has(entry.id) || existingPaths.has(entry.path)) {
    throw new Error(`registry entry collision: ${entry.id} ${entry.path}`);
  }
  registry.entries.push(entry);
}
write(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

// Structural assertions: no raw primary-store acquisition remains in the two
// production integration layers.
for (const relativePath of ['backend/routes/workspace.js', 'backend/store/adapters/SqliteStorePersistenceAdapter.js']) {
  if (read(relativePath).includes('getR32Store')) throw new Error(`${relativePath}: raw primary store acquisition remains`);
}

console.log(JSON.stringify({
  ok: true,
  changedFiles: [
    'backend/lib/sqliteOwnership.js',
    'backend/store/contactIdentityConfirmationRepository.js',
    'backend/store/adapters/SqliteStorePersistenceAdapter.js',
    'backend/server.js',
    facadePath,
    'backend/routes/workspace.js',
    'backend/runtime/AppRuntimeComposition.js',
    registryPath
  ]
}, null, 2));
