'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function file(relativePath) {
  return path.join(ROOT, relativePath);
}

function replaceOnce(relativePath, before, after) {
  const target = file(relativePath);
  const source = fs.readFileSync(target, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${relativePath}: expected exactly one replacement, found ${count}`);
  }
  fs.writeFileSync(target, source.replace(before, after), 'utf8');
}

function patchArchitectureMigration() {
  const relativePath = 'backend/migrations/architectureClosureV2WpA.js';
  replaceOnce(
    relativePath,
    "const crypto = require('node:crypto');\n",
    "const crypto = require('node:crypto');\nconst {\n  applyArchitectureClosureV2WpAIntegrity,\n  isArchitectureClosureV2WpAIntegrityApplied,\n  TARGET_SCHEMA_VERSION: INTEGRITY_TARGET_SCHEMA_VERSION\n} = require('./architectureClosureV2WpAIntegrity');\n"
  );
  replaceOnce(
    relativePath,
    "  ensureObjects(db);\n  ensureConsistency(db);\n",
    "  const integrityApplied = isArchitectureClosureV2WpAIntegrityApplied(db);\n  ensureObjects(db);\n  if (!integrityApplied) ensureConsistency(db);\n"
  );
  replaceOnce(
    relativePath,
    `  return {\n    migrationId: MIGRATION_ID,\n    targetSchemaVersion: TARGET_SCHEMA_VERSION,\n    checksum: MIGRATION_CHECKSUM,\n    bootstrapChecksum: BOOTSTRAP_CHECKSUM,\n    schemaContractVersion: 2\n  };\n`,
    `  const integrity = applyArchitectureClosureV2WpAIntegrity(db);\n  return {\n    migrationId: integrity.migrationId,\n    baseMigrationId: MIGRATION_ID,\n    targetSchemaVersion: integrity.targetSchemaVersion,\n    baseTargetSchemaVersion: TARGET_SCHEMA_VERSION,\n    checksum: integrity.checksum,\n    baseChecksum: MIGRATION_CHECKSUM,\n    bootstrapChecksum: BOOTSTRAP_CHECKSUM,\n    schemaContractVersion: 3,\n    legacyReceiptPolicy: integrity.legacyReceiptPolicy\n  };\n`
  );
  replaceOnce(
    relativePath,
    `module.exports = {\n  MIGRATION_ID,\n  TARGET_SCHEMA_VERSION,\n`,
    `module.exports = {\n  MIGRATION_ID,\n  BASE_TARGET_SCHEMA_VERSION: TARGET_SCHEMA_VERSION,\n  TARGET_SCHEMA_VERSION: INTEGRITY_TARGET_SCHEMA_VERSION,\n`
  );
}

function patchCoordinator() {
  const relativePath = 'backend/services/authorityTransactionCoordinator.js';
  replaceOnce(
    relativePath,
    `function normalizeProjector(input) {\n`,
    `function eventContentSha256(event) {\n  return canonicalHash({\n    eventId: event.eventId,\n    eventType: event.eventType,\n    schemaVersion: event.schemaVersion,\n    payloadClassification: event.payloadClassification,\n    payloadSha256: event.payloadSha256,\n    occurredAt: event.occurredAt,\n    platform: event.platform,\n    sourceAccountId: event.sourceAccountId,\n    generation: event.generation,\n    redactionVersion: event.redactionVersion,\n    retentionClass: event.retentionClass,\n    ledgerSegmentId: event.ledgerSegmentId\n  });\n}\n\nfunction normalizeProjector(input) {\n`
  );

  replaceOnce(
    relativePath,
    `  assertIdempotency(existing, command) {\n    const document = parseJson(existing.result_json, {}) || {};\n    if (String(document.commandContentSha256 || '') !== command.contentSha256) {\n      throw coordinatorError(\n        'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT',\n        'The idempotency key already belongs to different command content',\n        {\n          authorityScope: command.authorityScope,\n          idempotencyKey: command.idempotencyKey,\n          existingCommandId: String(existing.command_id || ''),\n          incomingCommandId: command.commandId,\n          existingContentSha256: String(document.commandContentSha256 || ''),\n          incomingContentSha256: command.contentSha256\n        }\n      );\n    }\n    return receiptFromRow(existing, true);\n  }\n`,
    `  assertIdempotency(existing, command, incomingEventContentSha256) {\n    const document = parseJson(existing.result_json, {}) || {};\n    const existingCommandContentSha256 = String(\n      existing.command_content_sha256 || document.commandContentSha256 || ''\n    );\n    const existingEventContentSha256 = String(\n      existing.event_content_sha256 || document.eventContentSha256 || ''\n    );\n    if (existingCommandContentSha256 !== command.contentSha256) {\n      throw coordinatorError(\n        'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT',\n        'The idempotency key already belongs to different command content',\n        {\n          authorityScope: command.authorityScope,\n          idempotencyKey: command.idempotencyKey,\n          existingCommandId: String(existing.command_id || ''),\n          incomingCommandId: command.commandId,\n          existingContentSha256: existingCommandContentSha256,\n          incomingContentSha256: command.contentSha256\n        }\n      );\n    }\n    if (!/^[a-f0-9]{64}$/u.test(existingEventContentSha256)) {\n      throw coordinatorError(\n        'AUTHORITY_COMMAND_EVENT_CONTENT_UNVERIFIABLE',\n        'The historical receipt does not contain a verifiable event content hash',\n        {\n          authorityScope: command.authorityScope,\n          idempotencyKey: command.idempotencyKey,\n          existingCommandId: String(existing.command_id || ''),\n          incomingCommandId: command.commandId,\n          existingEventContentSha256,\n          incomingEventContentSha256\n        }\n      );\n    }\n    if (existingEventContentSha256 !== incomingEventContentSha256) {\n      throw coordinatorError(\n        'AUTHORITY_COMMAND_IDEMPOTENCY_CONFLICT',\n        'The idempotency key already belongs to different event content',\n        {\n          authorityScope: command.authorityScope,\n          idempotencyKey: command.idempotencyKey,\n          existingCommandId: String(existing.command_id || ''),\n          incomingCommandId: command.commandId,\n          existingEventContentSha256,\n          incomingEventContentSha256\n        }\n      );\n    }\n    return receiptFromRow(existing, true);\n  }\n`
  );

  replaceOnce(
    relativePath,
    `    const event = normalizeEvent(input.event);\n    const projector = normalizeProjector(input.projector);\n`,
    `    const event = normalizeEvent(input.event);\n    const incomingEventContentSha256 = eventContentSha256(event);\n    const projector = normalizeProjector(input.projector);\n`
  );
  replaceOnce(
    relativePath,
    `        if (existing) return { receipt: this.assertIdempotency(existing, command), replayed: true };\n`,
    `        if (existing) {\n          return {\n            receipt: this.assertIdempotency(existing, command, incomingEventContentSha256),\n            replayed: true\n          };\n        }\n`
  );
  replaceOnce(
    relativePath,
    `            generation,occurred_at,recorded_at,payload_id,payload_sha256,redaction_version,schema_version,\n            canonicalization_version,writer_authority,host_generation,fencing_token,ledger_segment_id\n          )\n          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?\n`,
    `            generation,occurred_at,recorded_at,payload_id,payload_sha256,redaction_version,schema_version,\n            canonicalization_version,writer_authority,host_generation,fencing_token,ledger_segment_id,retention_class\n          )\n          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?\n`
  );
  replaceOnce(
    relativePath,
    `          event.ledgerSegmentId,\n          command.aggregateType,\n`,
    `          event.ledgerSegmentId,\n          event.retentionClass,\n          command.aggregateType,\n`
  );
  replaceOnce(
    relativePath,
    `        const receiptDocument = {\n          commandContentSha256: command.contentSha256,\n`,
    `        const receiptDocument = {\n          commandContentSha256: command.contentSha256,\n          eventContentSha256: incomingEventContentSha256,\n`
  );
  replaceOnce(
    relativePath,
    `        this.db.prepare(\`INSERT INTO authority_command_receipts(\n          command_id,authority_scope,idempotency_key,status,first_event_id,last_event_id,aggregate_version,\n          host_generation,fencing_token,result_json,committed_at\n        ) VALUES(?,?,?,'COMMITTED',?,?,?,?,?,?,?)\`).run(\n          command.commandId,\n          command.authorityScope,\n          command.idempotencyKey,\n          event.eventId,\n`,
    `        this.db.prepare(\`INSERT INTO authority_command_receipts(\n          command_id,authority_scope,idempotency_key,command_content_sha256,event_content_sha256,status,\n          first_event_id,last_event_id,aggregate_version,host_generation,fencing_token,result_json,committed_at\n        ) VALUES(?,?,?,?,?,'COMMITTED',?,?,?,?,?,?,?)\`).run(\n          command.commandId,\n          command.authorityScope,\n          command.idempotencyKey,\n          command.contentSha256,\n          incomingEventContentSha256,\n          event.eventId,\n`
  );
  replaceOnce(
    relativePath,
    `  AuthorityTransactionCoordinator,\n  createProjectorDatabaseCapability,\n`,
    `  AuthorityTransactionCoordinator,\n  createProjectorDatabaseCapability,\n  eventContentSha256,\n`
  );
}

function patchIntegrityTest() {
  const relativePath = 'backend/tests/architectureClosureV2/wpA/authorityTransactionCoordinatorIntegrity.test.js';
  replaceOnce(
    relativePath,
    `test('projector SQL capability rejects nondeterministic functions extension loading and SQLite internal tables', () => {\n`,
    `test('legacy receipts without an event content hash fail closed instead of guessing historical semantics', () => {\n  const h = harness();\n  try {\n    const envelope = command();\n    h.store.db.prepare(\`INSERT INTO authority_command_receipts(\n      command_id,authority_scope,idempotency_key,command_content_sha256,event_content_sha256,status,\n      first_event_id,last_event_id,aggregate_version,host_generation,fencing_token,result_json,committed_at\n    ) VALUES(?,?,?,?,?,'COMMITTED','','',0,?,?,?,?)\`).run(\n      envelope.commandId,\n      envelope.authorityScope,\n      envelope.idempotencyKey,\n      envelope.contentSha256,\n      '',\n      1,\n      1,\n      JSON.stringify({ commandContentSha256: envelope.contentSha256, receipt: { status: 'COMMITTED' } }),\n      '2026-08-03T00:00:00.000Z'\n    );\n    assert.throws(\n      () => h.coordinator.execute({ command: envelope, event: event(), projector: projector() }),\n      error => error?.code === 'AUTHORITY_COMMAND_EVENT_CONTENT_UNVERIFIABLE'\n        && error?.existingEventContentSha256 === ''\n        && /^[a-f0-9]{64}$/u.test(error?.incomingEventContentSha256 || '')\n    );\n    assert.equal(h.store.db.prepare('SELECT COUNT(*) AS count FROM canonical_event_headers').get().count, 0);\n  } finally { h.close(); }\n});\n\ntest('projector SQL capability rejects nondeterministic functions extension loading and SQLite internal tables', () => {\n`
  );
}

function patchAuthorityRegistry() {
  const relativePath = 'governance/architecture-closure-v2/authority-registry.json';
  const target = file(relativePath);
  const document = JSON.parse(fs.readFileSync(target, 'utf8'));
  const entry = {
    id: 'A8-SCHEMA-INTEGRITY-MIGRATION',
    path: 'backend/migrations/architectureClosureV2WpAIntegrity.js',
    classification: 'RECOVERY',
    authorityOwner: 'AuthorityWriteHost',
    commandEntrypoint: 'applyArchitectureClosureV2WpAIntegrity',
    eventTypes: ['authority-schema.integrity-upgraded'],
    aggregate: 'SchemaIntegrity',
    versionStrategy: 'schemaVersion+migrationChecksum',
    idempotencyKey: '022_architecture_closure_v2_wp_a_integrity',
    receiptIssuer: 'AuthorityWriteHost',
    projection: 'r32_schema_migrations',
    legacyPaths: {
      writer: ['Schema 21 receipts without explicit event content hash'],
      recovery: ['Schema 21 to Schema 22 forward migration'],
      fallback: []
    },
    removalCondition: 'Schema 22 is installed transactionally and historical unverifiable event content fails closed.',
    blockingWorkPackage: 'WP-A',
    closureState: 'CLOSED',
    requiredSourceMarkers: ['AuthorityWriteHost'],
    forbiddenSourceMarkers: ['new R32SqliteStore']
  };
  if (document.entries.some(candidate => candidate.id === entry.id || candidate.path === entry.path)) {
    throw new Error(`${relativePath}: integrity migration entry already exists`);
  }
  document.entries.push(entry);
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function patchPostMergeWorkflow() {
  const relativePath = '.github/workflows/wp-a-post-merge-validation.yml';
  replaceOnce(
    relativePath,
    `on:\n  push:\n`,
    `on:\n  pull_request:\n    branches:\n      - main\n    paths:\n      - .github/workflows/wp-a-post-merge-validation.yml\n      - backend/**\n      - electron/**\n      - governance/architecture-closure-v2/**\n      - package.json\n      - package-lock.json\n      - shared/release/**\n      - tests/runtime-delivery/repository-source-identity-authority.test.js\n      - tests/wp0/**\n      - tests/wp3/stale-fencing-token-outbox-denied.test.js\n      - tests/wp4/application-matrix-temp-path.test.js\n      - tests/wp5/m5-sqlite-ownership.test.js\n      - tools/architecture-closure-v2/**\n      - tools/layered-ci/**\n      - tools/wp0/**\n  push:\n`
  );
  replaceOnce(
    relativePath,
    `          node tools/architecture-closure-v2/verify-wp-a-post-merge.js --require-origin-main\n`,
    `          if [ "${GITHUB_EVENT_NAME}" = "push" ]; then\n            node tools/architecture-closure-v2/verify-wp-a-post-merge.js --require-origin-main\n          else\n            node tools/architecture-closure-v2/verify-wp-a-post-merge.js\n          fi\n`
  );
}

function patchPostMergeTest() {
  const relativePath = 'tests/wp0/wp-a-post-merge-validation.test.js';
  replaceOnce(
    relativePath,
    `  assert.match(workflow, /push:\\n\\s+branches:\\n\\s+- main/u);\n`,
    `  assert.match(workflow, /pull_request:\\n\\s+branches:\\n\\s+- main/u);\n  assert.match(workflow, /push:\\n\\s+branches:\\n\\s+- main/u);\n`
  );
  replaceOnce(
    relativePath,
    `  assert.match(workflow, /verify-wp-a-post-merge\\.js --require-origin-main/u);\n`,
    `  assert.match(workflow, /GITHUB_EVENT_NAME/u);\n  assert.match(workflow, /verify-wp-a-post-merge\\.js --require-origin-main/u);\n  assert.match(workflow, /else\\n\\s+node tools\\/architecture-closure-v2\\/verify-wp-a-post-merge\\.js/u);\n`
  );
}

patchArchitectureMigration();
patchCoordinator();
patchIntegrityTest();
patchAuthorityRegistry();
patchPostMergeWorkflow();
patchPostMergeTest();

console.log(JSON.stringify({
  ok: true,
  changedFiles: [
    'backend/migrations/architectureClosureV2WpA.js',
    'backend/services/authorityTransactionCoordinator.js',
    'backend/tests/architectureClosureV2/wpA/authorityTransactionCoordinatorIntegrity.test.js',
    'governance/architecture-closure-v2/authority-registry.json',
    '.github/workflows/wp-a-post-merge-validation.yml',
    'tests/wp0/wp-a-post-merge-validation.test.js'
  ]
}, null, 2));
