'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { acquireAuthorityWriteHost } = require('../../../services/authorityWriteHost');
const { SqliteConnectionBroker } = require('../../../lib/sqliteConnectionBroker');

function tempDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-acv2-schema21-review-'));
  return { root, dbPath: path.join(root, 'yance-r32.db') };
}

function columns(db, table) {
  return new Map(db.prepare(`PRAGMA table_info(${table})`).all().map(row => [String(row.name), row]));
}

function indexes(db, table) {
  return db.prepare(`PRAGMA index_list(${table})`).all();
}

test('Schema 21 canonical event header carries the complete frozen replay and fencing metadata', () => {
  const { root, dbPath } = tempDb();
  let host;
  let broker;
  try {
    host = acquireAuthorityWriteHost({ dbPath, instanceId: 'schema21-review-host' });
    broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
    const db = broker.open().db;
    const actual = columns(db, 'canonical_event_headers');
    const required = [
      'ledger_sequence',
      'event_id',
      'event_type',
      'aggregate_type',
      'aggregate_id',
      'aggregate_version',
      'command_id',
      'idempotency_key',
      'trace_id',
      'correlation_id',
      'causation_id',
      'platform',
      'source_account_id',
      'generation',
      'occurred_at',
      'recorded_at',
      'payload_id',
      'payload_sha256',
      'redaction_version',
      'schema_version',
      'canonicalization_version',
      'writer_authority',
      'host_generation',
      'fencing_token',
      'ledger_segment_id'
    ];
    for (const name of required) assert.equal(actual.has(name), true, `canonical_event_headers.${name}`);
    assert.equal(Number(actual.get('ledger_sequence')?.notnull), 1);
    assert.ok(indexes(db, 'canonical_event_headers').some(index => Number(index.unique) === 1 && String(index.name).includes('ledger_sequence')));
  } finally {
    try { broker?.close(); } catch (_) {}
    try { host?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Schema 21 projector checkpoint carries global ledger sequence, lease ownership, generation, fencing and lag', () => {
  const { root, dbPath } = tempDb();
  let host;
  let broker;
  try {
    host = acquireAuthorityWriteHost({ dbPath, instanceId: 'schema21-projector-review-host' });
    broker = new SqliteConnectionBroker({ dbPath, authorityWriteHostCapability: host.capability });
    const db = broker.open().db;
    const actual = columns(db, 'projection_checkpoints_v2');
    for (const name of [
      'projector_id',
      'projector_version',
      'ledger_sequence',
      'lease_owner',
      'generation',
      'fencing_token',
      'output_hash',
      'lag',
      'updated_at'
    ]) assert.equal(actual.has(name), true, `projection_checkpoints_v2.${name}`);
    assert.equal(Number(actual.get('ledger_sequence')?.notnull), 1);
    assert.equal(Number(actual.get('generation')?.notnull), 1);
    assert.equal(Number(actual.get('fencing_token')?.notnull), 1);
  } finally {
    try { broker?.close(); } catch (_) {}
    try { host?.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});
