'use strict';

const crypto = require('crypto');

const AUTHORITY = 'AIContextReductionAuthority';
const SCHEMA_VERSION = 1;
const ELIGIBLE_TASKS = new Set(['director', 'quick_reply', 'deep_reply', 'understanding', 'relationship', 'learning_synthesis', 'fact_extraction', 'memory_extraction', 'quality_review', 'summary']);
const CRITICAL_ARRAY_KEYS = new Set(['confirmedFacts', 'mustUseMemory', 'evidenceRefs', 'riskBoundaries', 'candidateBranches', 'constraints']);
const RECENT_ARRAY_KEYS = new Set(['recentMessages', 'messages', 'history', 'relationshipTimeline', 'timeline', 'eligibleSignals', 'memories', 'memoryCandidates']);
const LOW_VALUE_KEYS = new Set(['diagnostics', 'debug', 'raw', 'rawMeta', 'trace', 'modelAttempts', 'mediaAnalysisDetails', 'allMessages', 'fullHistory']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function chars(messages = []) { return messages.reduce((sum, row) => sum + clean(row?.content).length, 0); }
function clipped(text, maximum) {
  const value = String(text == null ? '' : text);
  if (value.length <= maximum) return value;
  const head = Math.max(200, Math.floor(maximum * 0.62));
  const tail = Math.max(120, maximum - head - 48);
  return `${value.slice(0, head)}\n[CONTEXT_REDUCED]\n${value.slice(-tail)}`;
}
function compactValue(value, key = '', depth = 0, state = null) {
  const context = state || { nodes: 0, maxNodes: 2500, maxDepth: 12 };
  context.nodes += 1;
  if (depth > context.maxDepth || context.nodes > context.maxNodes) return '[CONTEXT_REDUCED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return clipped(value, depth <= 2 ? 1800 : 900);
  if (Array.isArray(value)) {
    const limit = CRITICAL_ARRAY_KEYS.has(key) ? 16 : RECENT_ARRAY_KEYS.has(key) ? 8 : 10;
    const rows = value.length > limit ? value.slice(-limit) : value;
    return rows.map(item => compactValue(item, key, depth + 1, context));
  }
  if (typeof value !== 'object') return String(value);
  const output = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (LOW_VALUE_KEYS.has(childKey)) continue;
    output[childKey] = compactValue(child, childKey, depth + 1, context);
  }
  return output;
}
function compactConversationContext(content, targetChars) {
  const text = String(content || '');
  const match = text.match(/([\s\S]*?<conversation_context>\s*)([\s\S]*?)(\s*<\/conversation_context>[\s\S]*)/i);
  if (!match) return clipped(text, targetChars);
  try {
    const parsed = JSON.parse(match[2]);
    const compacted = JSON.stringify(compactValue(parsed));
    const rebuilt = `${match[1]}${compacted}${match[3]}`;
    return rebuilt.length <= targetChars ? rebuilt : clipped(rebuilt, targetChars);
  } catch (_) {
    return clipped(text, targetChars);
  }
}
function reduceMessages(messages = [], options = {}) {
  const task = clean(options.task).toLowerCase();
  const original = Array.isArray(messages) ? messages.map(row => ({ ...row, content: String(row?.content || '') })) : [];
  const originalChars = chars(original);
  if (!ELIGIBLE_TASKS.has(task) || originalChars < 5000) {
    return { authority: AUTHORITY, schemaVersion: SCHEMA_VERSION, task, changed: false, reasonCode: !ELIGIBLE_TASKS.has(task) ? 'TASK_NOT_ELIGIBLE' : 'CONTEXT_ALREADY_SMALL', messages: original, originalChars, reducedChars: originalChars, reductionRatio: 0, originalHash: hash(original), reducedHash: hash(original) };
  }
  const targetChars = Math.max(3200, Math.floor(originalChars * Math.min(0.7, Math.max(0.35, Number(options.targetRatio || 0.55)))));
  const systems = original.filter(row => clean(row.role).toLowerCase() === 'system');
  const nonSystems = original.filter(row => clean(row.role).toLowerCase() !== 'system');
  const systemBudget = Math.min(Math.floor(targetChars * 0.42), Math.max(1800, systems.reduce((sum, row) => sum + row.content.length, 0)));
  const nonSystemBudget = Math.max(1200, targetChars - systemBudget);
  const reducedSystems = systems.map((row, index) => ({ ...row, content: clipped(row.content, Math.max(900, Math.floor(systemBudget / Math.max(1, systems.length)))) }));
  const retained = nonSystems.slice(-Math.max(1, Math.min(nonSystems.length, 4)));
  const reducedNonSystems = retained.map((row, index) => {
    const latest = index === retained.length - 1;
    const budget = latest ? Math.floor(nonSystemBudget * 0.65) : Math.max(700, Math.floor((nonSystemBudget * 0.35) / Math.max(1, retained.length - 1)));
    return { ...row, content: compactConversationContext(row.content, budget) };
  });
  const reduced = [...reducedSystems, ...reducedNonSystems];
  const reducedChars = chars(reduced);
  const changed = reducedChars < originalChars * 0.9;
  return {
    authority: AUTHORITY,
    schemaVersion: SCHEMA_VERSION,
    task,
    changed,
    reasonCode: changed ? 'TIMEOUT_CONTEXT_REDUCED' : 'CONTEXT_REDUCTION_INSUFFICIENT',
    messages: changed ? reduced : original,
    originalChars,
    reducedChars: changed ? reducedChars : originalChars,
    reductionRatio: changed ? 1 - (reducedChars / originalChars) : 0,
    originalHash: hash(original),
    reducedHash: hash(changed ? reduced : original),
    retainedMessages: changed ? reduced.length : original.length,
    observedAt: new Date().toISOString()
  };
}

module.exports = { AUTHORITY, SCHEMA_VERSION, ELIGIBLE_TASKS, reduceMessages, compactConversationContext, compactValue, chars };
