'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 2;
const RUNTIME_COMMAND_TYPES = Object.freeze(new Set([
  'runtime.ping',
  'runtime.setOperatingMode',
  'runtime.stop',
  'runtime.setNetwork',
  'runtime.suspend',
  'runtime.resume'
]));

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function integer(value, minimum = 0) { return Number.isInteger(Number(value)) && Number(value) >= minimum; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(stable(value)).digest('hex'); }
function makeError(reasonCode, message, details = {}, status = 409) {
  const error = new Error(message || reasonCode);
  error.reasonCode = reasonCode;
  error.code = reasonCode;
  error.status = status;
  if (details && Object.keys(details).length) error.details = details;
  return error;
}

function assertCommandEnvelope(envelope) {
  const commandId = String(envelope?.commandId || '').trim();
  const commandType = String(envelope?.commandType || '').trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!isObject(envelope) || Number(envelope.contractVersion) !== CONTRACT_VERSION || !uuid.test(commandId) ||
      !RUNTIME_COMMAND_TYPES.has(commandType) || !integer(envelope.expectedStateVersion, 0) ||
      !String(envelope.issuedAtUtc || '').trim() || Number.isNaN(Date.parse(envelope.issuedAtUtc)) || !isObject(envelope.payload)) {
    throw makeError('COMMAND_ENVELOPE_INVALID', 'Runtime API v2 command envelope is malformed', {}, 400);
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    commandId,
    commandType,
    expectedStateVersion: Number(envelope.expectedStateVersion),
    issuedAtUtc: String(envelope.issuedAtUtc),
    payload: Object.freeze({ ...envelope.payload })
  });
}

function createCommandEnvelope(input = {}, options = {}) {
  const envelope = {
    contractVersion: CONTRACT_VERSION,
    commandId: String(input.commandId || options.randomUUID?.() || crypto.randomUUID()),
    commandType: String(input.commandType || ''),
    expectedStateVersion: Number(input.expectedStateVersion),
    issuedAtUtc: String(input.issuedAtUtc || options.clock?.() || new Date().toISOString()),
    payload: isObject(input.payload) ? { ...input.payload } : {}
  };
  return assertCommandEnvelope(envelope);
}

function assertAuthorityTriple(snapshot) {
  const runtime = snapshot?.runtime;
  if (!integer(snapshot?.stateVersion, 1) || !integer(snapshot?.lastEventSequence, 0) ||
      !isObject(runtime) || !integer(runtime.operatingModeRevision, 1)) {
    throw makeError('WP6_SNAPSHOT_SCHEMA_INVALID', 'Snapshot authority triple is incomplete', {
      stateVersion: snapshot?.stateVersion,
      operatingModeRevision: runtime?.operatingModeRevision,
      lastEventSequence: snapshot?.lastEventSequence
    }, 502);
  }
  return Object.freeze({
    stateVersion: Number(snapshot.stateVersion),
    operatingModeRevision: Number(runtime.operatingModeRevision),
    lastEventSequence: Number(snapshot.lastEventSequence)
  });
}

function assertSnapshot(snapshot, options = {}) {
  if (!isObject(snapshot) || Number(snapshot.contractVersion) !== CONTRACT_VERSION) {
    throw makeError('WP6_SNAPSHOT_SCHEMA_INVALID', 'API v2 snapshot contractVersion must be 2', {}, 502);
  }
  const buildId = String(snapshot.buildId || '').trim();
  if (!buildId) throw makeError('WP6_SNAPSHOT_SCHEMA_INVALID', 'API v2 snapshot buildId is required', {}, 502);
  if (options.expectedBuildId && buildId !== String(options.expectedBuildId)) {
    throw makeError('WP6_SNAPSHOT_BUILD_ID_MISMATCH', 'API v2 snapshot buildId does not match the accepted release identity', {
      expectedBuildId: String(options.expectedBuildId), actualBuildId: buildId
    }, 409);
  }
  const runtime = snapshot.runtime;
  if (!isObject(runtime) || !String(runtime.lifecycleState || '').trim() ||
      !['normal', 'safeMode'].includes(String(runtime.operatingMode || '')) ||
      !String(runtime.ownerInstanceId || '').trim() || !integer(runtime.fencingToken, 1) ||
      typeof runtime.localReady !== 'boolean') {
    throw makeError('WP6_SNAPSHOT_SCHEMA_INVALID', 'API v2 snapshot runtime projection is incomplete', {}, 502);
  }
  const triple = assertAuthorityTriple(snapshot);
  if (triple.operatingModeRevision > triple.stateVersion) {
    throw makeError('WP6_SNAPSHOT_SCHEMA_INVALID', 'operatingModeRevision cannot exceed stateVersion', triple, 502);
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    buildId,
    stateVersion: triple.stateVersion,
    lastEventSequence: triple.lastEventSequence,
    runtime: Object.freeze({ ...runtime, fencingToken: Number(runtime.fencingToken), operatingModeRevision: triple.operatingModeRevision, localReady: runtime.localReady === true }),
    capabilities: isObject(snapshot.capabilities) ? Object.freeze({ ...snapshot.capabilities }) : Object.freeze({}),
    diagnosticsSummary: isObject(snapshot.diagnosticsSummary) ? Object.freeze({ ...snapshot.diagnosticsSummary }) : Object.freeze({}),
    credentialHydration: snapshot.credentialHydration && isObject(snapshot.credentialHydration) ? Object.freeze({ ...snapshot.credentialHydration }) : null,
    localCriticalWorkers: isObject(snapshot.localCriticalWorkers) ? Object.freeze({ ...snapshot.localCriticalWorkers }) : Object.freeze({}),
    externalWorkers: isObject(snapshot.externalWorkers) ? Object.freeze({ ...snapshot.externalWorkers }) : Object.freeze({}),
    generatedAtUtc: String(snapshot.generatedAtUtc || '')
  });
}

function assertEventBatch(batch, options = {}) {
  if (!isObject(batch) || Number(batch.contractVersion) !== CONTRACT_VERSION || !String(batch.buildId || '').trim()) {
    throw makeError('WP6_EVENT_BATCH_SCHEMA_INVALID', 'API v2 event batch is malformed', {}, 502);
  }
  if (options.expectedBuildId && String(batch.buildId) !== String(options.expectedBuildId)) {
    throw makeError('WP6_EVENT_BUILD_ID_MISMATCH', 'API v2 event buildId does not match the active baseline', {}, 409);
  }
  const after = Number(options.afterSequence || batch.fromSequenceExclusive || 0);
  if (!integer(after, 0) || !integer(batch.fromSequenceExclusive, 0) || Number(batch.fromSequenceExclusive) !== after ||
      !integer(batch.lastAvailableSequence, 0) || !Array.isArray(batch.events)) {
    throw makeError('WP6_EVENT_BATCH_SCHEMA_INVALID', 'API v2 event batch sequence metadata is invalid', {}, 502);
  }
  let expected = after + 1;
  const events = batch.events.map(row => {
    if (!isObject(row) || !integer(row.eventSequence, 1) || Number(row.eventSequence) !== expected ||
        !String(row.eventId || '').trim() || !String(row.eventType || '').trim() || !integer(row.stateVersion, 1) ||
        !String(row.occurredAtUtc || '').trim() || Number.isNaN(Date.parse(row.occurredAtUtc))) {
      throw makeError(Number(row?.eventSequence) > expected ? 'EVENT_SEQUENCE_GAP' : 'WP6_EVENT_OUT_OF_ORDER', 'API v2 persisted event sequence is not contiguous', {
        expectedEventSequence: expected, actualEventSequence: row?.eventSequence
      }, 409);
    }
    expected += 1;
    return Object.freeze({
      eventSequence: Number(row.eventSequence), eventId: String(row.eventId), eventType: String(row.eventType),
      stateVersion: Number(row.stateVersion), occurredAtUtc: String(row.occurredAtUtc),
      payload: isObject(row.payload) ? Object.freeze({ ...row.payload }) : Object.freeze({})
    });
  });
  const last = events.length ? events[events.length - 1].eventSequence : after;
  if (last > Number(batch.lastAvailableSequence)) {
    throw makeError('WP6_EVENT_BATCH_SCHEMA_INVALID', 'Event batch exceeds lastAvailableSequence', {}, 502);
  }
  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    buildId: String(batch.buildId),
    fromSequenceExclusive: after,
    lastAvailableSequence: Number(batch.lastAvailableSequence),
    events: Object.freeze(events)
  });
}

function assertNoRollback(previous, next, options = {}) {
  if (!previous) return next;
  const sameOwner = String(previous.runtime?.ownerInstanceId || '') === String(next.runtime?.ownerInstanceId || '');
  if (sameOwner && Number(next.runtime?.fencingToken || 0) < Number(previous.runtime?.fencingToken || 0)) {
    throw makeError('WP6_SNAPSHOT_FENCING_INVALID', 'Snapshot fencing token rolled back for the same owner', {}, 409);
  }
  if (sameOwner && Number(next.stateVersion) < Number(previous.stateVersion)) {
    throw makeError('WP6_SNAPSHOT_STATE_ROLLBACK', 'Snapshot stateVersion rolled back for the same owner', {}, 409);
  }
  if (sameOwner && Number(next.runtime.operatingModeRevision) < Number(previous.runtime.operatingModeRevision)) {
    throw makeError('WP6_MODE_REVISION_ROLLBACK', 'Snapshot operatingModeRevision rolled back for the same owner', {}, 409);
  }
  if (options.requireSameOwner && !sameOwner) {
    throw makeError('WP6_SNAPSHOT_OWNER_MISMATCH', 'Snapshot owner changed while the same owner was required', {}, 409);
  }
  return next;
}

module.exports = {
  CONTRACT_VERSION,
  RUNTIME_COMMAND_TYPES,
  assertAuthorityTriple,
  assertCommandEnvelope,
  assertEventBatch,
  assertNoRollback,
  assertSnapshot,
  createCommandEnvelope,
  digest,
  makeError,
  stable
};
