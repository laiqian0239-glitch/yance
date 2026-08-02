'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProjectorDatabaseCapability
} = require('../../../services/authorityTransactionCoordinator');

function captureDatabase() {
  const prepared = [];
  return {
    prepared,
    db: {
      prepare(sql) {
        prepared.push(sql);
        return {
          run() { return { changes: 0 }; },
          get() { return null; },
          all() { return []; }
        };
      }
    }
  };
}

test('projector SQL policy preserves string literals comments and semicolons byte-for-byte', () => {
  const capture = captureDatabase();
  const capability = createProjectorDatabaseCapability(capture.db);
  const sql = "SELECT 'random(); -- canonical_event_headers /* literal */ CURRENT_TIMESTAMP' AS payload;";
  capability.facade.prepare(sql).get();
  assert.deepEqual(capture.prepared, [sql]);
});

test('projector SQL policy rejects a second statement but allows a semicolon inside a literal', () => {
  const capture = captureDatabase();
  const capability = createProjectorDatabaseCapability(capture.db);
  const valid = "SELECT 'first;second' AS payload";
  capability.facade.prepare(valid).get();
  assert.throws(
    () => capability.facade.prepare('SELECT 1; SELECT 2'),
    error => error?.code === 'AUTHORITY_PROJECTOR_SQL_FORBIDDEN'
  );
  assert.deepEqual(capture.prepared, [valid]);
});

test('projector SQL policy detects nondeterministic calls across whitespace and comments', () => {
  const capture = captureDatabase();
  const capability = createProjectorDatabaseCapability(capture.db);
  for (const sql of [
    'SELECT random /* split */ ()',
    'SELECT randomblob\n(16)',
    "SELECT datetime /* split */ ('now')",
    'SELECT CURRENT_\nTIMESTAMP'
  ]) {
    assert.throws(
      () => capability.facade.prepare(sql),
      error => error?.code === 'AUTHORITY_PROJECTOR_SQL_NONDETERMINISTIC'
    );
  }
  assert.equal(capture.prepared.length, 0);
});

test('projector SQL policy ignores authority names in literals but rejects real authority identifiers', () => {
  const capture = captureDatabase();
  const capability = createProjectorDatabaseCapability(capture.db);
  const literal = "SELECT 'canonical_event_headers authority_payload_store' AS documentation";
  capability.facade.prepare(literal).get();
  for (const sql of [
    'SELECT * FROM canonical_event_headers',
    'SELECT * FROM main.authority_payload_store',
    'SELECT * FROM "authority_command_receipts"',
    'SELECT * FROM [projection_checkpoints_v2]'
  ]) {
    assert.throws(
      () => capability.facade.prepare(sql),
      error => error?.code === 'AUTHORITY_PROJECTOR_SQL_FORBIDDEN'
    );
  }
  assert.deepEqual(capture.prepared, [literal]);
});

test('projector SQL policy rejects unterminated comments and quoted literals fail-closed', () => {
  const capture = captureDatabase();
  const capability = createProjectorDatabaseCapability(capture.db);
  for (const sql of [
    "SELECT 'unterminated",
    'SELECT "unterminated',
    'SELECT /* unterminated'
  ]) {
    assert.throws(
      () => capability.facade.prepare(sql),
      error => error?.code === 'AUTHORITY_PROJECTOR_SQL_FORBIDDEN'
    );
  }
  assert.equal(capture.prepared.length, 0);
});
