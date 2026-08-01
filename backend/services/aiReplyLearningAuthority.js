'use strict';

const crypto = require('node:crypto');
const { getStore } = require('../repositories/storeProvider');
const evidenceAuthority = require('./evidenceAuthority');

const AUTHORITY = 'AIReplyLearningAuthority';
const SCHEMA_VERSION = 1;
const EVENT_STATE = Object.freeze({ created: 'pending', approve: 'approved', reject: 'rejected', 'start-shadow': 'shadow', activate: 'active', revoke: 'revoked', rollback: 'rolled_back' });
const TRANSITIONS = Object.freeze({ pending: ['approve','reject'], approved: ['start-shadow','revoke'], shadow: ['activate','revoke'], active: ['revoke','rollback'], rejected: [], revoked: [], rolled_back: [] });
const SUCCESS_DELIVERY = new Set(['ACCEPTED','DELIVERED','READ']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function defaultClock() { return new Date().toISOString(); }
function defaultIdFactory(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function eventRow(row) { return row ? { eventId: clean(row.event_id), learningReceiptId: clean(row.learning_receipt_id), sequence: Number(row.sequence || 0), action: clean(row.action), actor: clean(row.actor), reasonCode: clean(row.reason_code), createdAt: clean(row.created_at) } : null; }
function stateOf(events = []) { return events.length ? EVENT_STATE[events.at(-1).action] || 'pending' : 'pending'; }

class AIReplyLearningAuthority {
  constructor({ storeProvider = getStore, evidenceAuthority: evidence = evidenceAuthority, idFactory = defaultIdFactory, clock = defaultClock } = {}) { this.storeProvider = storeProvider; this.evidence = evidence; this.idFactory = idFactory; this.clock = clock; }
  store() { return this.storeProvider(); }

  get(learningReceiptId) {
    const store = this.store(); const row = store.db.prepare('SELECT * FROM ai_learning_receipts_v2 WHERE learning_receipt_id=?').get(clean(learningReceiptId));
    if (!row) return null;
    const events = store.db.prepare('SELECT * FROM ai_learning_receipt_events WHERE learning_receipt_id=? ORDER BY sequence').all(clean(learningReceiptId)).map(eventRow);
    return {
      authority: AUTHORITY, schemaVersion: SCHEMA_VERSION,
      learningReceiptId: clean(row.learning_receipt_id), traceId: clean(row.trace_id), contactId: clean(row.contact_id), contactSnapshotId: clean(row.contact_snapshot_id),
      candidateTraceId: clean(row.candidate_trace_id), deliveryAttemptId: clean(row.delivery_attempt_id), sourceKind: clean(row.source_kind), reviewOutcome: clean(row.review_outcome),
      version: Number(row.version || 0), state: stateOf(events), createdAt: clean(row.created_at), events
    };
  }

  createPending(input = {}) {
    if (clean(input.messageDirection).toLowerCase() !== 'outbound') throw Object.assign(new Error('Only reviewed outbound replies may enter learning'), { code: 'LEARNING_SOURCE_DIRECTION_INVALID', status: 409 });
    if (input.humanReviewed !== true || !['accepted','edited'].includes(clean(input.reviewOutcome).toLowerCase())) throw Object.assign(new Error('Human review is required before learning'), { code: 'LEARNING_HUMAN_REVIEW_REQUIRED', status: 409 });
    if (input.emergencyMode === true) throw Object.assign(new Error('Emergency replies are excluded from learning'), { code: 'LEARNING_EMERGENCY_EXCLUDED', status: 409 });
    if (clean(input.sourceKind) !== 'reviewed-reply') throw Object.assign(new Error('Unsupported learning source'), { code: 'LEARNING_SOURCE_KIND_INVALID', status: 409 });
    const store = this.store(); const contactId = clean(input.contactId); const snapshotId = clean(input.contactSnapshotId); const candidateTraceId = clean(input.candidateTraceId); const attemptId = clean(input.deliveryAttemptId);
    const snapshot = store.db.prepare('SELECT contact_id FROM contact_context_snapshots WHERE snapshot_id=?').get(snapshotId);
    if (!snapshot || clean(snapshot.contact_id) !== contactId) throw Object.assign(new Error('Contact snapshot scope mismatch'), { code: 'LEARNING_CONTACT_SNAPSHOT_INVALID', status: 409 });
    const candidateTrace = store.db.prepare('SELECT execution_mode FROM evidence_traces WHERE trace_id=?').get(candidateTraceId);
    if (!candidateTrace || clean(candidateTrace.execution_mode) !== 'candidate-only') throw Object.assign(new Error('Candidate-only execution evidence is required'), { code: 'LEARNING_CANDIDATE_TRACE_INVALID', status: 409 });
    const delivery = store.db.prepare('SELECT state,platform_message_id FROM communication_delivery_attempts WHERE attempt_id=?').get(attemptId);
    if (!delivery || !SUCCESS_DELIVERY.has(clean(delivery.state)) || !clean(delivery.platform_message_id)) throw Object.assign(new Error('Successful platform delivery evidence is required'), { code: 'LEARNING_DELIVERY_SUCCESS_REQUIRED', status: 409 });
    const existing = store.db.prepare('SELECT learning_receipt_id FROM ai_learning_receipts_v2 WHERE candidate_trace_id=? AND delivery_attempt_id=? AND contact_snapshot_id=?').get(candidateTraceId, attemptId, snapshotId);
    if (existing) return this.get(existing.learning_receipt_id);
    const learningReceiptId = clean(input.learningReceiptId) || this.idFactory('learning-receipt'); const at = this.clock();
    const version = Number(store.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS next FROM ai_learning_receipts_v2 WHERE contact_id=?').get(contactId)?.next || 1);
    store.transaction(() => {
      store.db.prepare(`INSERT INTO ai_learning_receipts_v2(learning_receipt_id,trace_id,contact_id,contact_snapshot_id,candidate_trace_id,delivery_attempt_id,source_kind,review_outcome,version,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(learningReceiptId, clean(input.traceId || candidateTraceId), contactId, snapshotId, candidateTraceId, attemptId, 'reviewed-reply', clean(input.reviewOutcome).toLowerCase(), version, at);
      store.db.prepare(`INSERT INTO ai_learning_receipt_events(event_id,learning_receipt_id,sequence,action,actor,reason_code,created_at) VALUES(?,?,1,'created','','',?)`)
        .run(this.idFactory('learning-event'), learningReceiptId, at);
    });
    this.evidence.appendObservation({ traceId: candidateTraceId, idempotencyKey: `learning-pending:${learningReceiptId}`, kind: 'event', stage: 'learning-pending', status: 'pending', learningReceiptId, deliveryReceiptId: attemptId, evidence: { learningReceiptId, status: 'pending' }, allowTerminalAppend: true });
    return this.get(learningReceiptId);
  }

  transition(input = {}) {
    const action = clean(input.action).toLowerCase(); const current = this.get(input.learningReceiptId);
    if (!current) throw Object.assign(new Error('Learning receipt not found'), { code: 'LEARNING_RECEIPT_NOT_FOUND', status: 404 });
    if (!(TRANSITIONS[current.state] || []).includes(action)) throw Object.assign(new Error(`Invalid learning transition ${current.state} -> ${action}`), { code: 'LEARNING_RECEIPT_TRANSITION_INVALID', status: 409, currentState: current.state, action });
    const sequence = current.events.length + 1; const at = this.clock(); const store = this.store();
    store.db.prepare(`INSERT INTO ai_learning_receipt_events(event_id,learning_receipt_id,sequence,action,actor,reason_code,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(this.idFactory('learning-event'), current.learningReceiptId, sequence, action, clean(input.actor), clean(input.reasonCode), at);
    const updated = this.get(current.learningReceiptId);
    this.evidence.appendObservation({ traceId: current.candidateTraceId, idempotencyKey: `learning-${action}:${current.learningReceiptId}`, kind: 'event', stage: `learning-${action}`, status: updated.state, learningReceiptId: current.learningReceiptId, evidence: { learningReceiptId: current.learningReceiptId, status: updated.state, reasonCode: clean(input.reasonCode) }, allowTerminalAppend: true });
    return updated;
  }

  recordRetrieval(input = {}) {
    const learning = this.get(input.learningReceiptId);
    if (!learning) throw Object.assign(new Error('Learning receipt not found'), { code: 'LEARNING_RECEIPT_NOT_FOUND', status: 404 });
    if (learning.state !== 'active') throw Object.assign(new Error('Only active learning may be retrieved'), { code: 'LEARNING_RECEIPT_NOT_ACTIVE', status: 409, state: learning.state });
    const store = this.store(); const snapshot = store.db.prepare('SELECT contact_id FROM contact_context_snapshots WHERE snapshot_id=?').get(clean(input.contactSnapshotId));
    if (!snapshot || clean(snapshot.contact_id) !== learning.contactId) throw Object.assign(new Error('Learning retrieval snapshot scope mismatch'), { code: 'LEARNING_RETRIEVAL_SCOPE_MISMATCH', status: 409 });
    const traceId = clean(input.traceId) || this.idFactory('learning-retrieval-trace');
    this.evidence.startTrace({ traceId, traceType: 'learning-retrieval', task: clean(input.purpose || 'reply-context'), executionMode: 'retrieval' });
    const retrievalReceiptId = clean(input.retrievalReceiptId) || this.idFactory('learning-retrieval'); const at = this.clock();
    store.db.prepare(`INSERT INTO ai_learning_retrieval_receipts(retrieval_receipt_id,learning_receipt_id,trace_id,contact_snapshot_id,purpose,created_at) VALUES(?,?,?,?,?,?)`)
      .run(retrievalReceiptId, learning.learningReceiptId, traceId, clean(input.contactSnapshotId), clean(input.purpose), at);
    this.evidence.appendObservation({ traceId, idempotencyKey: `learning-retrieved:${retrievalReceiptId}`, kind: 'retriever', stage: 'learning-retrieved', status: 'completed', learningReceiptId: learning.learningReceiptId, evidence: { learningReceiptId: learning.learningReceiptId, status: 'active' } });
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, retrievalReceiptId, learningReceiptId: learning.learningReceiptId, traceId, contactSnapshotId: clean(input.contactSnapshotId), purpose: clean(input.purpose), createdAt: at };
  }
}

const singleton = new AIReplyLearningAuthority();
module.exports = singleton;
module.exports.AIReplyLearningAuthority = AIReplyLearningAuthority;
module.exports.AUTHORITY = AUTHORITY;
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
