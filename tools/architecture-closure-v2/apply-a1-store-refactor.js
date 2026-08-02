'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const filePath = path.join(repoRoot, 'backend', 'lib', 'r32SqliteStore.js');
let source = fs.readFileSync(filePath, 'utf8');

function count(text, needle) {
  let total = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) >= 0) {
    total += 1;
    offset += needle.length;
  }
  return total;
}

function replaceOne(label, before, after) {
  const matches = count(source, before);
  if (matches !== 1) {
    throw new Error(`${label}: expected exactly one source anchor, found ${matches}`);
  }
  source = source.replace(before, after);
}

if (source.includes("require('../migrations/architectureClosureV2WpA')")) {
  process.stdout.write('A1 store refactor already applied\n');
  process.exit(0);
}

replaceOne(
  'imports',
  "const {\n  applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime,\n  TARGET_SCHEMA_VERSION: BATCH42_FIX6O_SCHEMA_VERSION\n} = require('../migrations/batch42Fix6OScopedSafetyAndOmnichannelRuntime');\nconst { claimOwnership, SqliteOwnershipError } = require('./sqliteOwnership');",
  "const {\n  applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime,\n  TARGET_SCHEMA_VERSION: BATCH42_FIX6O_SCHEMA_VERSION\n} = require('../migrations/batch42Fix6OScopedSafetyAndOmnichannelRuntime');\nconst {\n  applyArchitectureClosureV2WpA,\n  TARGET_SCHEMA_VERSION: ACV2_WP_A_SCHEMA_VERSION\n} = require('../migrations/architectureClosureV2WpA');\nconst {\n  acquireAuthorityWriteHost,\n  assertCurrentAuthorityWriteHostToken,\n  requireAuthorityWriteHostCapability\n} = require('../services/authorityWriteHost');\nconst { claimOwnership, SqliteOwnershipError } = require('./sqliteOwnership');"
);

replaceOne(
  'schema-version',
  'const SCHEMA_VERSION = Math.max(STAGE634_SCHEMA_VERSION, ROUND12_SCHEMA_VERSION, ROUND12_13_HARDENING_SCHEMA_VERSION, ROUND12_13_REMAINING_SCHEMA_VERSION, ROUND12_13_FINAL_GOVERNANCE_SCHEMA_VERSION, ROUND12_13_FINAL_SEVEN_SCHEMA_VERSION, BATCH22_IDENTITY_ROUTE_SCHEMA_VERSION, BATCH24_STATE_TRANSACTION_SCHEMA_VERSION, BATCH26_PLATFORM_AI_LEARNING_SCHEMA_VERSION, BATCH27_DEVELOPER_HANDOFF_SCHEMA_VERSION, BATCH41_FIX6M_SCHEMA_VERSION, BATCH42_FIX6O_SCHEMA_VERSION);',
  'const SCHEMA_VERSION = Math.max(STAGE634_SCHEMA_VERSION, ROUND12_SCHEMA_VERSION, ROUND12_13_HARDENING_SCHEMA_VERSION, ROUND12_13_REMAINING_SCHEMA_VERSION, ROUND12_13_FINAL_GOVERNANCE_SCHEMA_VERSION, ROUND12_13_FINAL_SEVEN_SCHEMA_VERSION, BATCH22_IDENTITY_ROUTE_SCHEMA_VERSION, BATCH24_STATE_TRANSACTION_SCHEMA_VERSION, BATCH26_PLATFORM_AI_LEARNING_SCHEMA_VERSION, BATCH27_DEVELOPER_HANDOFF_SCHEMA_VERSION, BATCH41_FIX6M_SCHEMA_VERSION, BATCH42_FIX6O_SCHEMA_VERSION, ACV2_WP_A_SCHEMA_VERSION);'
);

replaceOne(
  'constructor-capability',
  "    this.ownershipLostError = null;\n    this.ownershipStaleMs = Math.max(1000, Number(options.ownershipStaleMs || 30000));",
  "    this.ownershipLostError = null;\n    this.ownedAuthorityWriteHost = null;\n    if (options.authorityWriteHostCapability) {\n      this.authorityWriteHostCapability = requireAuthorityWriteHostCapability(options.authorityWriteHostCapability);\n    } else {\n      this.ownedAuthorityWriteHost = acquireAuthorityWriteHost({\n        dbPath,\n        instanceId: options.instanceId,\n        ownershipStaleMs: options.ownershipStaleMs,\n        ownershipPid: options.ownershipPid,\n        ownershipPidAlive: options.ownershipPidAlive,\n        ownershipProcessIdentity: options.ownershipProcessIdentity,\n        ownershipCapturePidIdentity: options.ownershipCapturePidIdentity,\n        ownershipFsProvider: options.ownershipFsProvider,\n        clock: options.ownershipClock\n      });\n      this.authorityWriteHostCapability = this.ownedAuthorityWriteHost.capability;\n    }\n    if (path.resolve(this.authorityWriteHostCapability.dbPath) !== dbPath) {\n      throw Object.assign(new Error('AuthorityWriteHost capability path mismatch'), { code: 'AUTHORITY_WRITE_HOST_CAPABILITY_PATH_MISMATCH' });\n    }\n    this.ownershipStaleMs = Math.max(1000, Number(options.ownershipStaleMs || 30000));"
);

replaceOne(
  'attach-capability',
  "      this.commitSchemaMigrationReceipt(schemaPreflight);\n      this.startOwnershipHeartbeat();",
  "      this.commitSchemaMigrationReceipt(schemaPreflight);\n      this.authorityWriteHostCapability.attachStore(this);\n      this.startOwnershipHeartbeat();"
);

replaceOne(
  'constructor-cleanup',
  "      if (closeError && error && typeof error === 'object') {\n        error.sqliteCloseError = {\n          code: closeError.code || '',\n          message: closeError.message || String(closeError)\n        };\n      }\n      throw error;",
  "      if (closeError && error && typeof error === 'object') {\n        error.sqliteCloseError = {\n          code: closeError.code || '',\n          message: closeError.message || String(closeError)\n        };\n      }\n      try { this.ownedAuthorityWriteHost?.close(); } catch (_) {}\n      try { this.authorityWriteHostCapability?.close(); } catch (_) {}\n      throw error;"
);

replaceOne(
  'heartbeat',
  "      try { ok = this.ownership.heartbeat() === true; } catch (_) { ok = false; }",
  "      try { ok = this.authorityWriteHostCapability.heartbeat() === true; } catch (error) { this.ownershipLostError = error; ok = false; }"
);

replaceOne(
  'ownership-assertion',
  "  assertOwnership() {\n    if (this.ownershipLostError) throw this.ownershipLostError;\n    if (!this.db) throw Object.assign(new Error('SQLite store is closed'), { code: 'SQLITE_STORE_CLOSED', dbPath: this.dbPath });\n    return true;\n  }",
  "  assertOwnership() {\n    if (this.ownershipLostError) throw this.ownershipLostError;\n    if (!this.db) throw Object.assign(new Error('SQLite store is closed'), { code: 'SQLITE_STORE_CLOSED', dbPath: this.dbPath });\n    assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);\n    return true;\n  }"
);

replaceOne(
  'schema21-migration',
  "    applyBatch41Fix6MArchitectureReferenceClosure(this.db);\n    applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime(this.db);",
  "    applyBatch41Fix6MArchitectureReferenceClosure(this.db);\n    applyBatch42Fix6OScopedSafetyAndOmnichannelRuntime(this.db);\n    applyArchitectureClosureV2WpA(this.db);"
);

replaceOne(
  'transaction-fencing',
  "  transaction(callback) {\n    this.assertOwnership();\n    return this.transactions.runSync(() => callback(this));\n  }\n\n  transactionAsync(callback) {\n    this.assertOwnership();\n    return this.transactions.runAsync(() => callback(this));\n  }",
  "  transaction(callback) {\n    this.assertOwnership();\n    return this.transactions.runSync(() => {\n      assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);\n      return callback(this);\n    });\n  }\n\n  transactionAsync(callback) {\n    this.assertOwnership();\n    return this.transactions.runAsync(() => {\n      assertCurrentAuthorityWriteHostToken(this.authorityWriteHostCapability, this.db);\n      return callback(this);\n    });\n  }"
);

replaceOne(
  'close-capability',
  "    try { this.ownership?.release(); } catch (_) {}\n  }\n}\n\nmodule.exports = {",
  "    try { this.ownership?.release(); } catch (_) {}\n    try { this.ownedAuthorityWriteHost?.close(); } catch (_) {}\n    try { this.authorityWriteHostCapability?.close(); } catch (_) {}\n  }\n}\n\nmodule.exports = {"
);

fs.writeFileSync(filePath, source, 'utf8');
process.stdout.write('Applied deterministic A1 AuthorityWriteHost refactor to backend/lib/r32SqliteStore.js\n');
