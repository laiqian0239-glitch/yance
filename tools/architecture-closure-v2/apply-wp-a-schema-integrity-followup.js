'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function replaceOnce(relativePath, before, after) {
  const target = path.join(ROOT, relativePath);
  const source = fs.readFileSync(target, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${relativePath}: expected one replacement, found ${count}`);
  fs.writeFileSync(target, source.replace(before, after), 'utf8');
}

function patchLedgerReplayTimestamp() {
  const relativePath = 'backend/services/canonicalEventLedgerAuthority.js';
  replaceOnce(
    relativePath,
    "    const occurredAt = timestamp(source.occurredAt, new Date(Number(this.clock())).toISOString(), 'occurredAt');\n",
    "    const requestedOccurredAt = optional(source.occurredAt, 'occurredAt', 64);\n"
  );
  replaceOnce(
    relativePath,
    `    const commandId = optional(source.commandId, 'commandId', 512)\n      || deterministicId('command', { authority: AUTHORITY, idempotencyKey });\n    const traceId = optional(source.traceId, 'traceId', 512)\n`,
    `    const commandId = optional(source.commandId, 'commandId', 512)\n      || deterministicId('command', { authority: AUTHORITY, idempotencyKey });\n    const existingEvent = requestedOccurredAt ? null : this.readEvent(eventId);\n    const occurredAt = timestamp(\n      requestedOccurredAt,\n      existingEvent?.occurredAt || new Date(Number(this.clock())).toISOString(),\n      'occurredAt'\n    );\n    const traceId = optional(source.traceId, 'traceId', 512)\n`
  );
}

function patchSchemaVersionContracts() {
  const relativePath = 'backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js';
  replaceOnce(
    relativePath,
    "test('A1 registers Schema 21 and the AuthorityWriteHost public boundary', () => {\n",
    "test('A1 base migration plus post-merge integrity migration expose Schema 22 and the AuthorityWriteHost boundary', () => {\n"
  );
  replaceOnce(
    relativePath,
    "  assert.ok(fs.existsSync(migrationPath), 'Schema 21 migration is missing');\n",
    "  assert.ok(fs.existsSync(migrationPath), 'WP-A schema migration entrypoint is missing');\n"
  );
  replaceOnce(relativePath, '  assert.equal(SCHEMA_VERSION, 21);\n', '  assert.equal(SCHEMA_VERSION, 22);\n');
  replaceOnce(
    relativePath,
    "test('fresh database bootstrap and Schema 20 upgrade both converge to the complete Schema 21 object set', () => {\n",
    "test('fresh database bootstrap and Schema 20 upgrade both converge to the complete Schema 22 object set', () => {\n"
  );
  replaceOnce(relativePath, "      assert.equal(store.getMeta('schema_version'), 21);\n", "      assert.equal(store.getMeta('schema_version'), 22);\n");
  replaceOnce(
    relativePath,
    `      const migration = store.db.prepare("SELECT status,checksum FROM r32_schema_migrations WHERE migration_id='021_architecture_closure_v2_wp_a'").get();\n      assert.equal(migration?.status, 'completed');\n      assert.match(String(migration?.checksum || ''), /^[a-f0-9]{64}$/);\n`,
    `      const baseMigration = store.db.prepare("SELECT status,checksum FROM r32_schema_migrations WHERE migration_id='021_architecture_closure_v2_wp_a'").get();\n      assert.equal(baseMigration?.status, 'completed');\n      assert.match(String(baseMigration?.checksum || ''), /^[a-f0-9]{64}$/);\n      const integrityMigration = store.db.prepare("SELECT status,checksum,target_schema_version FROM r32_schema_migrations WHERE migration_id='022_architecture_closure_v2_wp_a_integrity'").get();\n      assert.equal(integrityMigration?.status, 'completed');\n      assert.equal(integrityMigration?.target_schema_version, 22);\n      assert.match(String(integrityMigration?.checksum || ''), /^[a-f0-9]{64}$/);\n`
  );
}

function addLedgerRegression() {
  const relativePath = 'backend/tests/round12PlatformCoreAuthorities.test.js';
  replaceOnce(
    relativePath,
    "    const first = events.append(input);\n    const second = events.append(input);\n",
    "    const first = events.append(input);\n    const second = events.append(input);\n    assert.equal(second.event.occurredAt, first.event.occurredAt);\n"
  );
}

patchLedgerReplayTimestamp();
patchSchemaVersionContracts();
addLedgerRegression();

console.log(JSON.stringify({
  ok: true,
  changedFiles: [
    'backend/services/canonicalEventLedgerAuthority.js',
    'backend/tests/architectureClosureV2/wpA/authorityWriteHost.test.js',
    'backend/tests/round12PlatformCoreAuthorities.test.js'
  ]
}, null, 2));
