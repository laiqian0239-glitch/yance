'use strict';

const AUTHORITY = 'GoalDrivenMemoryRecallAuthority';
const SCHEMA_VERSION = 1;
const MEMORY_TYPE = Object.freeze({
  CONFIRMED_FACT: 'confirmed_fact', PREFERENCE: 'preference', RELATIONSHIP_EVENT: 'relationship_event',
  UNFINISHED_TOPIC: 'unfinished_topic', COMMITMENT: 'commitment', SENSITIVE_BOUNDARY: 'sensitive_boundary',
  CONFLICT: 'conflict', EXPIRED_OR_SUPERSEDED: 'expired_or_superseded'
});
const GOAL_WEIGHTS = Object.freeze({
  natural_continue: Object.freeze({ unfinished_topic: 1, preference: 0.8, relationship_event: 0.6, confirmed_fact: 0.5 }),
  advance_relationship: Object.freeze({ relationship_event: 1, unfinished_topic: 0.8, preference: 0.7, commitment: 0.6 }),
  light_screening: Object.freeze({ preference: 1, confirmed_fact: 0.7, commitment: 0.7, sensitive_boundary: 0.5 }),
  cool_down: Object.freeze({ sensitive_boundary: 1, relationship_event: 0.8, conflict: 0.8, commitment: 0.4 }),
  comfort: Object.freeze({ relationship_event: 1, sensitive_boundary: 0.9, preference: 0.7, unfinished_topic: 0.4 }),
  maintain_and_learn: Object.freeze({ unfinished_topic: 0.8, preference: 0.7, confirmed_fact: 0.6, relationship_event: 0.6 })
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, Number(value || 0))); }
function nowMs(value) { const parsed = Date.parse(clean(value)); return Number.isFinite(parsed) ? parsed : 0; }
function recencyScore(value, reference = Date.now()) {
  const time = nowMs(value);
  if (!time) return 0.25;
  const days = Math.max(0, (reference - time) / 86400000);
  return Math.exp(-days / 90);
}
function normalizeMemory(memory = {}) {
  return {
    memoryId: clean(memory.memoryId || memory.id),
    type: clean(memory.type || memory.memoryType || MEMORY_TYPE.CONFIRMED_FACT),
    text: clean(memory.text || memory.value || memory.summary),
    confidence: clamp(memory.confidence == null ? 0.5 : memory.confidence),
    evidenceRef: clean(memory.evidenceRef || memory.evidenceId || memory.sourceMessageId),
    updatedAt: clean(memory.updatedAt || memory.occurredAt || memory.createdAt),
    status: clean(memory.status || 'active'),
    conflictGroup: clean(memory.conflictGroup || memory.factKey),
    sensitive: memory.sensitive === true || clean(memory.type) === MEMORY_TYPE.SENSITIVE_BOUNDARY,
    payload: memory.payload || memory
  };
}
function scoreMemory(memory, goal, options = {}) {
  const weights = GOAL_WEIGHTS[goal] || GOAL_WEIGHTS.maintain_and_learn;
  const typeWeight = Number(weights[memory.type] || 0.2);
  const recency = recencyScore(memory.updatedAt, Number(options.referenceTime || Date.now()));
  const evidence = memory.evidenceRef ? 1 : 0.25;
  const mustUseBoost = new Set((options.mustUseMemory || []).map(clean)).has(memory.memoryId) ? 1.5 : 1;
  const sensitivityPenalty = memory.sensitive && !['cool_down','comfort'].includes(goal) ? 0.35 : 1;
  return (typeWeight * 0.4 + memory.confidence * 0.25 + recency * 0.2 + evidence * 0.15)
    * mustUseBoost * sensitivityPenalty;
}

function recall(input = {}) {
  const goal = clean(input.goal || input.relationshipGoal || 'maintain_and_learn');
  const limit = Math.max(1, Math.min(20, Number(input.limit || 8)));
  const avoid = new Set((input.avoidMemoryIds || []).map(clean));
  const normalized = (Array.isArray(input.memories) ? input.memories : []).map(normalizeMemory)
    .filter(memory => memory.memoryId && memory.text)
    .filter(memory => !avoid.has(memory.memoryId))
    .filter(memory => !['expired','superseded','forgotten','retracted'].includes(memory.status))
    .filter(memory => memory.type !== MEMORY_TYPE.EXPIRED_OR_SUPERSEDED);

  const grouped = new Map();
  for (const memory of normalized) {
    const key = memory.conflictGroup || `memory:${memory.memoryId}`;
    const rows = grouped.get(key) || [];
    rows.push(memory);
    grouped.set(key, rows);
  }
  const candidates = [];
  for (const rows of grouped.values()) {
    if (rows.length === 1 || !rows[0].conflictGroup) {
      candidates.push(...rows);
      continue;
    }
    const active = rows.filter(row => row.type !== MEMORY_TYPE.CONFLICT && row.status === 'active');
    if (active.length === 1) candidates.push(active[0]);
    else candidates.push({
      memoryId: `conflict:${rows[0].conflictGroup}`,
      type: MEMORY_TYPE.CONFLICT,
      text: '该记忆存在未解决冲突，不应在回复中作为确定事实使用。',
      confidence: 1,
      evidenceRef: rows.map(row => row.evidenceRef).filter(Boolean).join(','),
      updatedAt: rows.map(row => row.updatedAt).sort().at(-1) || '',
      status: 'active',
      conflictGroup: rows[0].conflictGroup,
      sensitive: false,
      payload: { conflictingMemoryIds: rows.map(row => row.memoryId) }
    });
  }
  const ranked = candidates.map(memory => {
    const score = scoreMemory(memory, goal, input);
    const useAllowed = memory.type !== MEMORY_TYPE.CONFLICT && Boolean(memory.evidenceRef);
    return {
      memoryId: memory.memoryId,
      type: memory.type,
      text: memory.text,
      evidenceRef: memory.evidenceRef,
      confidence: memory.confidence,
      score,
      useAllowed,
      relevanceReason: `goal=${goal};type=${memory.type};evidence=${memory.evidenceRef ? 'present' : 'missing'}`,
      conflictGroup: memory.conflictGroup,
      payload: memory.payload
    };
  }).sort((a, b) => b.score - a.score || a.memoryId.localeCompare(b.memoryId));

  const selected = ranked.filter(row => row.useAllowed).slice(0, limit);
  const suppressed = ranked.filter(row => !row.useAllowed || !selected.some(item => item.memoryId === row.memoryId));
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    goal,
    selected,
    suppressed,
    evidenceRequired: true,
    selectedCount: selected.length,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { AUTHORITY, SCHEMA_VERSION, MEMORY_TYPE, GOAL_WEIGHTS, recall, normalizeMemory, scoreMemory };
