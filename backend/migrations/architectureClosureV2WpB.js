'use strict';

const engine = require('./architectureClosureV2WpBEngine');

const REQUIRED_FOREIGN_KEYS = Object.freeze([
  Object.freeze({ table: 'durable_execution_events', from: 'execution_id', target: 'durable_executions', to: 'execution_id' }),
  Object.freeze({ table: 'external_action_intents', from: 'execution_id', target: 'durable_executions', to: 'execution_id' }),
  Object.freeze({ table: 'external_action_claims', from: 'intent_id', target: 'external_action_intents', to: 'intent_id' }),
  Object.freeze({ table: 'external_action_attempts', from: 'intent_id', target: 'external_action_intents', to: 'intent_id' }),
  Object.freeze({ table: 'external_action_receipts', from: 'intent_id', target: 'external_action_intents', to: 'intent_id' }),
  Object.freeze({ table: 'external_action_receipts', from: 'attempt_id', target: 'external_action_attempts', to: 'attempt_id' }),
  Object.freeze({ table: 'external_outcome_reconciliations', from: 'intent_id', target: 'external_action_intents', to: 'intent_id' }),
  Object.freeze({ table: 'external_outcome_reconciliations', from: 'attempt_id', target: 'external_action_attempts', to: 'attempt_id' }),
  Object.freeze({ table: 'durable_execution_checkpoints', from: 'execution_id', target: 'durable_executions', to: 'execution_id' })
]);
const REQUIRED_COMPOSITE_FOREIGN_KEYS = Object.freeze([
  Object.freeze({
    table: 'external_action_receipts',
    target: 'external_action_attempts',
    columns: Object.freeze([
      Object.freeze({ from: 'attempt_id', to: 'attempt_id' }),
      Object.freeze({ from: 'intent_id', to: 'intent_id' })
    ])
  }),
  Object.freeze({
    table: 'external_outcome_reconciliations',
    target: 'external_action_attempts',
    columns: Object.freeze([
      Object.freeze({ from: 'attempt_id', to: 'attempt_id' }),
      Object.freeze({ from: 'intent_id', to: 'intent_id' })
    ])
  })
]);

function foreignKeyError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function normalizedForeignKeyRows(db, table) {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row => Object.freeze({
    id: Number(row.id),
    sequence: Number(row.seq),
    table: String(row.table || ''),
    from: String(row.from || ''),
    to: String(row.to || '')
  }));
}

function hasCompositeForeignKey(db, expected) {
  const groups = new Map();
  for (const row of normalizedForeignKeyRows(db, expected.table)) {
    const rows = groups.get(row.id) || [];
    rows.push(row);
    groups.set(row.id, rows);
  }
  return [...groups.values()].some(rows => {
    const ordered = [...rows].sort((left, right) => left.sequence - right.sequence);
    return ordered.length === expected.columns.length
      && ordered.every((row, index) => row.table === expected.target
        && row.from === expected.columns[index].from
        && row.to === expected.columns[index].to);
  });
}

function ensureForeignKeyIntegrity(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Schema 23 foreign-key validation requires a SQLite database');
  }
  const contractViolations = [];
  for (const expected of REQUIRED_FOREIGN_KEYS) {
    const rows = normalizedForeignKeyRows(db, expected.table);
    if (!rows.some(row => row.table === expected.target && row.from === expected.from && row.to === expected.to)) {
      contractViolations.push(Object.freeze({ ...expected, actual: Object.freeze(rows) }));
    }
    if (rows.some(row => /_v23_new$/u.test(row.table))) {
      contractViolations.push(Object.freeze({
        table: expected.table,
        code: 'TEMPORARY_FOREIGN_KEY_TARGET_RETAINED',
        actual: Object.freeze(rows)
      }));
    }
  }
  for (const expected of REQUIRED_COMPOSITE_FOREIGN_KEYS) {
    if (!hasCompositeForeignKey(db, expected)) {
      contractViolations.push(Object.freeze({
        ...expected,
        code: 'COMPOSITE_ATTEMPT_INTENT_FOREIGN_KEY_MISSING',
        actual: Object.freeze(normalizedForeignKeyRows(db, expected.table))
      }));
    }
  }

  if (contractViolations.length > 0) {
    throw foreignKeyError(
      'ACV2_WP_B_FOREIGN_KEY_CONTRACT_MISMATCH',
      'Schema 23 foreign-key targets do not match the frozen contract',
      { violations: Object.freeze(contractViolations) }
    );
  }

  const violations = db.prepare('PRAGMA foreign_key_check').all().map(row => Object.freeze({
    table: String(row.table || ''),
    rowid: row.rowid == null ? null : Number(row.rowid),
    parent: String(row.parent || ''),
    foreignKeyId: Number(row.fkid)
  }));
  if (violations.length > 0) {
    throw foreignKeyError(
      'ACV2_WP_B_FOREIGN_KEY_INTEGRITY_FAILED',
      'Schema 23 contains persisted foreign-key violations',
      { violations: Object.freeze(violations) }
    );
  }
  return Object.freeze({
    ok: true,
    requiredForeignKeyCount: REQUIRED_FOREIGN_KEYS.length,
    requiredCompositeForeignKeyCount: REQUIRED_COMPOSITE_FOREIGN_KEYS.length
  });
}

function isArchitectureClosureV2WpBApplied(db) {
  const applied = engine.isArchitectureClosureV2WpBApplied(db);
  if (applied) ensureForeignKeyIntegrity(db);
  return applied;
}

function applyArchitectureClosureV2WpB(db, options = {}) {
  const result = engine.applyArchitectureClosureV2WpB(db, options);
  ensureForeignKeyIntegrity(db);
  return result;
}

module.exports = Object.freeze({
  ...engine,
  REQUIRED_FOREIGN_KEYS,
  REQUIRED_COMPOSITE_FOREIGN_KEYS,
  ensureForeignKeyIntegrity,
  isArchitectureClosureV2WpBApplied,
  applyArchitectureClosureV2WpB
});
