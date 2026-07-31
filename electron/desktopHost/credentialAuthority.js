'use strict';

const crypto = require('node:crypto');
const { ALLOWED_STATES, canTransition } = require('../../shared/credentialTransactionStateMachine');
const { validateOwnerSession } = require('../../shared/credentialAuthorityLifecycleStateMachine');

const METADATA_SCHEMA_VERSION = 2;
const JOURNAL_SCHEMA_VERSION = 3;
const TRANSACTION_SCHEMA_VERSION = 3;
const AUTHORITY_EVENT_SCHEMA_VERSION = 1;
const SHA256 = /^[0-9a-f]{64}$/;
const OPERATIONS = new Set(['persist', 'remove', 'reset']);
const EVENT_TYPES = new Set(['GENESIS', 'MIGRATION_GENESIS', 'HYDRATION_ISSUED', 'TRANSACTION_COMMITTED', 'TRANSACTION_ROLLED_BACK', 'RESET_COMMITTED']);

class CredentialAuthorityError extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message || reasonCode);
    this.name = 'CredentialAuthorityError';
    this.reasonCode = reasonCode;
    this.code = reasonCode;
    Object.assign(this, details);
  }
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex'); }
function digestRaw(raw) { return sha256(isObject(raw) ? raw : {}); }
function referenceCount(raw) { return Object.keys(isObject(raw) ? raw : {}).length; }
function transactionHistoryDigest(transactions) { return sha256(isObject(transactions) ? transactions : {}); }
function refreshJournalIntegrity(journal) {
  journal.transactionCount = Object.keys(isObject(journal.transactions) ? journal.transactions : {}).length;
  journal.transactionsDigest = transactionHistoryDigest(journal.transactions);
  return journal;
}
function fail(reasonCode, message, details = {}) { throw new CredentialAuthorityError(reasonCode, message, details); }
function requireString(value, field, reasonCode = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID') {
  if (typeof value !== 'string' || !value.trim()) fail(reasonCode, `${field} must be a non-empty string`, { field });
  return value;
}
function requireInteger(value, field, minimum = 0, reasonCode = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID') {
  if (!Number.isInteger(value) || value < minimum) fail(reasonCode, `${field} must be an integer >= ${minimum}`, { field, value });
  return value;
}
function requireSha(value, field, reasonCode = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID') {
  if (!SHA256.test(String(value || ''))) fail(reasonCode, `${field} must be lowercase SHA256`, { field });
  return value;
}

function metadataProjection(metadata) {
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    vaultEpoch: String(metadata.vaultEpoch || ''),
    generation: Number(metadata.generation),
    vaultDigest: String(metadata.vaultDigest || ''),
    referenceCount: Number(metadata.referenceCount),
    authorityEventId: String(metadata.authorityEventId || ''),
    authorityEventCount: Number(metadata.authorityEventCount)
  };
}
function metadataDigest(metadata) { return sha256(metadataProjection(metadata)); }
function validateMetadata(metadata, reasonCode = 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH') {
  if (!isObject(metadata) || metadata.schemaVersion !== METADATA_SCHEMA_VERSION) fail(reasonCode, 'Credential metadata schema is invalid');
  requireString(metadata.vaultEpoch, 'metadata.vaultEpoch', reasonCode);
  requireInteger(metadata.generation, 'metadata.generation', 0, reasonCode);
  requireSha(metadata.vaultDigest, 'metadata.vaultDigest', reasonCode);
  requireInteger(metadata.referenceCount, 'metadata.referenceCount', 0, reasonCode);
  requireString(metadata.authorityEventId, 'metadata.authorityEventId', reasonCode);
  requireInteger(metadata.authorityEventCount, 'metadata.authorityEventCount', 1, reasonCode);
  requireSha(metadata.authorityHeadDigest, 'metadata.authorityHeadDigest', reasonCode);
  if (metadata.pendingReset !== null && metadata.pendingReset !== undefined && !isObject(metadata.pendingReset)) fail(reasonCode, 'metadata.pendingReset must be null or object');
  return metadata;
}
function makeMetadata({ vaultEpoch, generation, raw, authorityEventId, authorityEventCount, authorityHeadDigest = '0'.repeat(64), pendingReset = null, updatedAtUtc = '' }) {
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    vaultEpoch: String(vaultEpoch),
    generation: Number(generation),
    vaultDigest: digestRaw(raw),
    referenceCount: referenceCount(raw),
    authorityEventId: String(authorityEventId),
    authorityEventCount: Number(authorityEventCount),
    authorityHeadDigest: String(authorityHeadDigest),
    pendingReset: pendingReset || null,
    updatedAtUtc: String(updatedAtUtc || '')
  };
}
function sameMetadataAuthority(left, right) {
  if (!left || !right) return false;
  const a = metadataProjection(left); const b = metadataProjection(right);
  return stable(a) === stable(b) && String(left.authorityHeadDigest || '') === String(right.authorityHeadDigest || '');
}

function eventBody(event) {
  const copy = { ...event };
  delete copy.eventDigest;
  return copy;
}
function makeAuthorityEvent(options = {}) {
  if (!EVENT_TYPES.has(options.eventType)) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Authority event type is invalid');
  const sequence = Number(options.eventSequence);
  const eventId = String(options.eventId || '');
  const raw = options.raw || {};
  const metadata = makeMetadata({
    vaultEpoch: options.vaultEpoch,
    generation: options.generation,
    raw,
    authorityEventId: eventId,
    authorityEventCount: sequence,
    authorityHeadDigest: '0'.repeat(64),
    pendingReset: options.pendingReset || null,
    updatedAtUtc: options.createdAtUtc
  });
  const event = {
    schemaVersion: AUTHORITY_EVENT_SCHEMA_VERSION,
    eventId,
    eventType: options.eventType,
    eventSequence: sequence,
    previousEventDigest: String(options.previousEventDigest || ''),
    previousGeneration: options.previousGeneration === null || options.previousGeneration === undefined ? null : Number(options.previousGeneration),
    generation: Number(options.generation),
    vaultEpoch: String(options.vaultEpoch || ''),
    vaultDigest: metadata.vaultDigest,
    referenceCount: metadata.referenceCount,
    transactionId: String(options.transactionId || ''),
    startupNonce: String(options.startupNonce || ''),
    rollbackOfEventId: String(options.rollbackOfEventId || ''),
    resetAuthorization: options.pendingReset || null,
    migration: options.migration || null,
    metadata: metadataProjection(metadata),
    metadataDigest: metadataDigest(metadata),
    createdAtUtc: String(options.createdAtUtc || new Date().toISOString())
  };
  event.eventDigest = sha256(eventBody(event));
  metadata.authorityHeadDigest = event.eventDigest;
  return { event, metadata };
}

function validateEvent(event, previousEvent = null) {
  const reasonCode = 'WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH';
  if (!isObject(event) || event.schemaVersion !== AUTHORITY_EVENT_SCHEMA_VERSION) fail(reasonCode, 'Authority event schema is invalid');
  requireString(event.eventId, 'event.eventId', reasonCode);
  if (!EVENT_TYPES.has(event.eventType)) fail(reasonCode, `Unknown authority event type: ${event.eventType}`);
  requireInteger(event.eventSequence, 'event.eventSequence', 1, reasonCode);
  requireInteger(event.generation, 'event.generation', 0, reasonCode);
  requireString(event.vaultEpoch, 'event.vaultEpoch', reasonCode);
  requireSha(event.vaultDigest, 'event.vaultDigest', reasonCode);
  requireInteger(event.referenceCount, 'event.referenceCount', 0, reasonCode);
  requireSha(event.metadataDigest, 'event.metadataDigest', reasonCode);
  requireSha(event.eventDigest, 'event.eventDigest', reasonCode);
  if (event.resetAuthorization !== null && event.resetAuthorization !== undefined && !isObject(event.resetAuthorization)) fail(reasonCode, 'Authority event resetAuthorization is invalid', { eventId: event.eventId });
  if (event.migration !== null && event.migration !== undefined && !isObject(event.migration)) fail(reasonCode, 'Authority event migration record is invalid', { eventId: event.eventId });
  if (sha256(eventBody(event)) !== event.eventDigest) fail(reasonCode, 'Authority event digest is invalid', { eventId: event.eventId });
  if (!isObject(event.metadata) || metadataDigest(event.metadata) !== event.metadataDigest) fail(reasonCode, 'Authority event metadata digest is invalid', { eventId: event.eventId });
  if (event.metadata.authorityEventId !== event.eventId || event.metadata.authorityEventCount !== event.eventSequence || event.metadata.vaultEpoch !== event.vaultEpoch || event.metadata.generation !== event.generation || event.metadata.vaultDigest !== event.vaultDigest || event.metadata.referenceCount !== event.referenceCount) fail(reasonCode, 'Authority event metadata projection is inconsistent', { eventId: event.eventId });

  if (!previousEvent) {
    if (event.eventSequence !== 1 || !['GENESIS', 'MIGRATION_GENESIS'].includes(event.eventType) || event.previousEventDigest !== '' || event.previousGeneration !== null || event.generation !== 0) fail(reasonCode, 'Authority history must start with a generation-zero GENESIS or MIGRATION_GENESIS event');
    if (event.eventType === 'MIGRATION_GENESIS') {
      const migration = event.migration;
      if (!isObject(migration)) fail(reasonCode, 'MIGRATION_GENESIS requires migration evidence');
      for (const field of ['migrationId', 'sourceSchema', 'sourceVaultDigest', 'targetVaultDigest']) requireString(migration[field], `event.migration.${field}`, reasonCode);
      requireSha(migration.sourceVaultDigest, 'event.migration.sourceVaultDigest', reasonCode);
      requireSha(migration.targetVaultDigest, 'event.migration.targetVaultDigest', reasonCode);
      if (migration.targetVaultDigest !== event.vaultDigest) fail(reasonCode, 'MIGRATION_GENESIS target digest does not match vault digest');
    }
  } else {
    if (event.eventSequence !== previousEvent.eventSequence + 1 || event.previousEventDigest !== previousEvent.eventDigest) fail(reasonCode, 'Authority event chain is not continuous', { eventId: event.eventId });
    if (event.eventType === 'HYDRATION_ISSUED') {
      if (!event.startupNonce || event.vaultEpoch !== previousEvent.vaultEpoch || event.previousGeneration !== previousEvent.generation || event.generation !== previousEvent.generation + 1 || event.vaultDigest !== previousEvent.vaultDigest || event.referenceCount !== previousEvent.referenceCount) fail(reasonCode, 'HYDRATION_ISSUED event boundary is invalid', { eventId: event.eventId });
    } else if (event.eventType === 'TRANSACTION_COMMITTED') {
      if (!event.transactionId || event.vaultEpoch !== previousEvent.vaultEpoch || event.previousGeneration !== previousEvent.generation || event.generation !== previousEvent.generation + 1) fail(reasonCode, 'TRANSACTION_COMMITTED event boundary is invalid', { eventId: event.eventId });
    } else if (event.eventType === 'RESET_COMMITTED') {
      if (!event.transactionId || event.vaultEpoch === previousEvent.vaultEpoch || event.previousGeneration !== previousEvent.generation || event.generation !== 0 || event.referenceCount !== 0) fail(reasonCode, 'RESET_COMMITTED event boundary is invalid', { eventId: event.eventId });
    } else if (event.eventType === 'TRANSACTION_ROLLED_BACK') {
      if (!event.transactionId) fail(reasonCode, 'TRANSACTION_ROLLED_BACK requires transactionId', { eventId: event.eventId });
      const noAdvance = event.vaultEpoch === previousEvent.vaultEpoch && event.previousGeneration === previousEvent.generation && event.generation === previousEvent.generation;
      const compensation = Boolean(event.rollbackOfEventId) && event.rollbackOfEventId === previousEvent.eventId && event.previousGeneration === previousEvent.generation;
      if (!noAdvance && !compensation) fail(reasonCode, 'TRANSACTION_ROLLED_BACK event boundary is invalid', { eventId: event.eventId });
    } else if (event.eventType === 'GENESIS' || event.eventType === 'MIGRATION_GENESIS') fail(reasonCode, 'GENESIS events may only appear at the beginning of authority history');
  }
  return event;
}

function validateTransaction(tx, key) {
  const reasonCode = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID';
  if (!isObject(tx) || tx.schemaVersion !== TRANSACTION_SCHEMA_VERSION) fail(reasonCode, 'Credential transaction schema is invalid', { key });
  requireString(tx.requestId, 'transaction.requestId', reasonCode);
  if (tx.requestId !== key) fail(reasonCode, 'Credential transaction requestId does not match journal key', { key, requestId: tx.requestId });
  if (!ALLOWED_STATES.has(tx.state)) fail(reasonCode, `Credential transaction state is invalid: ${tx.state}`, { requestId: tx.requestId });
  if (!OPERATIONS.has(tx.operation)) fail(reasonCode, 'Credential transaction operation is invalid', { requestId: tx.requestId });
  if (tx.operation === 'reset') {
    if (String(tx.ref || '') !== '') fail(reasonCode, 'Reset transaction ref must be empty', { requestId: tx.requestId });
  } else requireString(tx.ref, 'transaction.ref', reasonCode);
  requireSha(tx.mutationSha256, 'transaction.mutationSha256', reasonCode);
  requireInteger(tx.previousGeneration, 'transaction.previousGeneration', 0, reasonCode);
  requireInteger(tx.generation, 'transaction.generation', 0, reasonCode);
  requireString(tx.previousVaultEpoch, 'transaction.previousVaultEpoch', reasonCode);
  requireString(tx.vaultEpoch, 'transaction.vaultEpoch', reasonCode);
  if (tx.operation === 'reset') {
    if (tx.vaultEpoch === tx.previousVaultEpoch || tx.generation !== 0) fail(reasonCode, 'Reset transaction epoch/generation is invalid', { requestId: tx.requestId });
  } else if (tx.vaultEpoch !== tx.previousVaultEpoch || tx.generation !== tx.previousGeneration + 1) fail(reasonCode, 'Credential transaction generation must advance exactly once', { requestId: tx.requestId });
  if (!isObject(tx.beforeRaw) || !isObject(tx.afterRaw)) fail(reasonCode, 'Credential transaction beforeRaw and afterRaw must be objects', { requestId: tx.requestId });
  requireSha(tx.beforeDigest, 'transaction.beforeDigest', reasonCode);
  requireSha(tx.afterDigest, 'transaction.afterDigest', reasonCode);
  if (digestRaw(tx.beforeRaw) !== tx.beforeDigest || digestRaw(tx.afterRaw) !== tx.afterDigest) fail(reasonCode, 'Credential transaction raw digest is invalid', { requestId: tx.requestId });
  requireInteger(tx.beforeReferenceCount, 'transaction.beforeReferenceCount', 0, reasonCode);
  requireInteger(tx.afterReferenceCount, 'transaction.afterReferenceCount', 0, reasonCode);
  if (referenceCount(tx.beforeRaw) !== tx.beforeReferenceCount || referenceCount(tx.afterRaw) !== tx.afterReferenceCount) fail(reasonCode, 'Credential transaction reference count is invalid', { requestId: tx.requestId });
  if (!isObject(tx.previousAuthority) || !isObject(tx.nextAuthority)) fail(reasonCode, 'Credential transaction authority boundary is incomplete', { requestId: tx.requestId });
  const previous = tx.previousAuthority; const next = tx.nextAuthority;
  if (previous.vaultEpoch !== tx.previousVaultEpoch || previous.generation !== tx.previousGeneration || previous.vaultDigest !== tx.beforeDigest || previous.referenceCount !== tx.beforeReferenceCount) fail(reasonCode, 'Credential transaction previous authority boundary is invalid', { requestId: tx.requestId });
  if (next.vaultEpoch !== tx.vaultEpoch || next.generation !== tx.generation || next.vaultDigest !== tx.afterDigest || next.referenceCount !== tx.afterReferenceCount) fail(reasonCode, 'Credential transaction next authority boundary is invalid', { requestId: tx.requestId });
  if (!Array.isArray(tx.stateHistory) || tx.stateHistory.length < 1 || tx.stateHistory[tx.stateHistory.length - 1]?.state !== tx.state) fail(reasonCode, 'Credential transaction state history is incomplete', { requestId: tx.requestId });
  for (let index = 0; index < tx.stateHistory.length; index += 1) {
    const row = tx.stateHistory[index];
    if (!isObject(row) || !ALLOWED_STATES.has(row.state) || typeof row.atUtc !== 'string') fail(reasonCode, 'Credential transaction state history row is invalid', { requestId: tx.requestId });
    if (index === 0 && row.state !== 'NEW') fail(reasonCode, 'Credential transaction state history must start at NEW', { requestId: tx.requestId });
    if (index > 0) {
      const prior = tx.stateHistory[index - 1];
      if (row.state === prior.state || !canTransition(prior.state, row.state)) fail(reasonCode, 'Credential transaction state history contains an illegal transition', { requestId: tx.requestId, from: prior.state, to: row.state });
    }
  }
  if (tx.ownerSession !== null && tx.ownerSession !== undefined) validateOwnerSession(tx.ownerSession, reasonCode);
  if (tx.commitEventId && typeof tx.commitEventId !== 'string') fail(reasonCode, 'Credential transaction commitEventId is invalid', { requestId: tx.requestId });
  if (tx.rollbackEventId && typeof tx.rollbackEventId !== 'string') fail(reasonCode, 'Credential transaction rollbackEventId is invalid', { requestId: tx.requestId });
  return tx;
}

function validateJournal(journal) {
  const reasonCode = 'WP4_CREDENTIAL_TRANSACTION_JOURNAL_INVALID';
  if (!isObject(journal) || journal.schemaVersion !== JOURNAL_SCHEMA_VERSION || !isObject(journal.transactions) || !Array.isArray(journal.authorityEvents)) fail(reasonCode, 'Credential authority journal schema is invalid');
  requireString(journal.journalId, 'journal.journalId', reasonCode);
  requireInteger(journal.eventCount, 'journal.eventCount', 1, reasonCode);
  requireString(journal.headEventId, 'journal.headEventId', reasonCode);
  requireSha(journal.headEventDigest, 'journal.headEventDigest', reasonCode);
  requireInteger(journal.transactionCount, 'journal.transactionCount', 0, reasonCode);
  requireSha(journal.transactionsDigest, 'journal.transactionsDigest', reasonCode);
  const actualTransactionCount = Object.keys(journal.transactions).length;
  const actualTransactionsDigest = transactionHistoryDigest(journal.transactions);
  if (journal.transactionCount !== actualTransactionCount || journal.transactionsDigest !== actualTransactionsDigest) fail('WP4_CREDENTIAL_DURABLE_IDEMPOTENCY_HISTORY_LOST', 'Durable transaction history header does not match transaction rows', { expectedCount: journal.transactionCount, actualCount: actualTransactionCount });
  if (journal.eventCount !== journal.authorityEvents.length) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Authority event count does not match journal header');
  let previous = null;
  const eventIds = new Set();
  for (const event of journal.authorityEvents) {
    validateEvent(event, previous);
    if (eventIds.has(event.eventId)) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Authority eventId is duplicated', { eventId: event.eventId });
    eventIds.add(event.eventId);
    previous = event;
  }
  const head = previous;
  if (!head || head.eventId !== journal.headEventId || head.eventDigest !== journal.headEventDigest) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Authority journal head is invalid');
  for (const [key, tx] of Object.entries(journal.transactions)) validateTransaction(tx, key);
  for (const event of journal.authorityEvents) {
    if (!event.transactionId) continue;
    const tx = journal.transactions[event.transactionId];
    if (!tx) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Authority event references a missing transaction row', { eventId: event.eventId, transactionId: event.transactionId });
    if (event.eventType === 'TRANSACTION_COMMITTED' || event.eventType === 'RESET_COMMITTED') {
      if (tx.commitEventId !== event.eventId) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Transaction commit event linkage is invalid', { transactionId: tx.requestId });
      if (event.vaultDigest !== tx.afterDigest || event.referenceCount !== tx.afterReferenceCount || event.generation !== tx.generation || event.vaultEpoch !== tx.vaultEpoch) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Transaction commit event boundary does not match transaction', { transactionId: tx.requestId });
    }
    if (event.eventType === 'TRANSACTION_ROLLED_BACK') {
      if (tx.rollbackEventId !== event.eventId || event.vaultDigest !== tx.beforeDigest || event.referenceCount !== tx.beforeReferenceCount || event.generation !== tx.previousGeneration || event.vaultEpoch !== tx.previousVaultEpoch) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Transaction rollback event boundary does not match transaction', { transactionId: tx.requestId });
    }
  }
  for (const tx of Object.values(journal.transactions)) {
    if (tx.state === 'COMMITTED' && !tx.commitEventId) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Committed transaction is missing its authority event', { transactionId: tx.requestId });
    if (tx.state === 'ROLLED_BACK' && !tx.rollbackEventId) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Rolled-back transaction is missing its authority event', { transactionId: tx.requestId });
    if (tx.commitEventId && !eventIds.has(tx.commitEventId)) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Transaction commit event is missing from journal', { transactionId: tx.requestId });
    if (tx.rollbackEventId && !eventIds.has(tx.rollbackEventId)) fail('WP4_CREDENTIAL_AUTHORITY_HISTORY_MISMATCH', 'Transaction rollback event is missing from journal', { transactionId: tx.requestId });
  }
  return journal;
}

function metadataFromEvent(event, updatedAtUtc = '') {
  const metadata = { ...clone(event.metadata), authorityHeadDigest: event.eventDigest, pendingReset: event.resetAuthorization || null, updatedAtUtc: String(updatedAtUtc || event.createdAtUtc || '') };
  validateMetadata(metadata);
  return metadata;
}
function headEvent(journal) { return journal.authorityEvents[journal.authorityEvents.length - 1]; }
function previousEvent(journal) { return journal.authorityEvents.length > 1 ? journal.authorityEvents[journal.authorityEvents.length - 2] : null; }
function appendAuthorityEvent(journal, options) {
  validateJournal(journal);
  const previous = headEvent(journal);
  const made = makeAuthorityEvent({ ...options, eventSequence: previous.eventSequence + 1, previousEventDigest: previous.eventDigest });
  validateEvent(made.event, previous);
  journal.authorityEvents.push(made.event);
  journal.eventCount = journal.authorityEvents.length;
  journal.headEventId = made.event.eventId;
  journal.headEventDigest = made.event.eventDigest;
  return made;
}
function createGenesisJournal({ journalId, eventId, vaultEpoch, raw = {}, createdAtUtc, eventType = 'GENESIS', migration = null }) {
  const made = makeAuthorityEvent({ eventType, eventId, eventSequence: 1, previousEventDigest: '', previousGeneration: null, generation: 0, vaultEpoch, raw, createdAtUtc, migration });
  const journal = refreshJournalIntegrity({ schemaVersion: JOURNAL_SCHEMA_VERSION, journalId, eventCount: 1, headEventId: made.event.eventId, headEventDigest: made.event.eventDigest, transactions: {}, authorityEvents: [made.event], updatedAtUtc: createdAtUtc });
  validateJournal(journal);
  return { journal, metadata: made.metadata };
}

module.exports = {
  AUTHORITY_EVENT_SCHEMA_VERSION, CredentialAuthorityError, EVENT_TYPES, JOURNAL_SCHEMA_VERSION,
  METADATA_SCHEMA_VERSION, OPERATIONS, TRANSACTION_SCHEMA_VERSION, appendAuthorityEvent, clone,
  createGenesisJournal, digestRaw, headEvent, isObject, makeAuthorityEvent, makeMetadata,
  metadataDigest, metadataFromEvent, metadataProjection, previousEvent, referenceCount, refreshJournalIntegrity, sameMetadataAuthority,
  sha256, stable, transactionHistoryDigest, validateEvent, validateJournal, validateMetadata, validateTransaction
};
