'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const orchestrator = fs.readFileSync(path.join(root, 'backend/services/aiBrainOrchestrator.js'), 'utf8');

test('deterministic AI_AUTO generation failures are classified separately from analysis failures', () => {
  assert.match(orchestrator, /function\s+isDeterministicAutoReplyGenerationError\s*\(/u);
  for (const code of [
    'AI_DIRECTOR_INVALID_OUTPUT',
    'AI_DIRECTOR_INTERNAL_ID_LEAK',
    'AI_DIRECTOR_LANGUAGE_MISMATCH',
    'AI_DIRECTOR_LANGUAGE_UNVERIFIED',
    'AI_REPLY_LANGUAGE_MISMATCH',
    'AI_REPLY_QUALITY_REJECTED',
    'REPLY_TECHNICAL_REJECTED',
    'PERSONA_TRUTH_FIREWALL_BLOCKED',
    'CUSTOMER_NOT_FOUND',
    'SOCIAL_CONTEXT_NOT_READY',
    'STALE_CONVERSATION_CONTEXT',
    'STALE_PERSONA_PROFILE'
  ]) {
    assert.match(orchestrator, new RegExp(code));
  }
  assert.match(orchestrator, /automatic-reply-generation-failed/u);
});

test('deterministic generation failure terminates the durable analysis operation without retry storm', () => {
  const scheduledIndex = orchestrator.indexOf('async function runScheduledAnalysis');
  assert.ok(scheduledIndex >= 0);
  const scheduled = orchestrator.slice(scheduledIndex, orchestrator.indexOf('\nfunction schedule(', scheduledIndex));
  assert.match(scheduled, /automatic-reply-generation-failed[\s\S]{0,800}retryable:\s*false/u);
  assert.match(scheduled, /reason\s*===\s*['"]failed['"][\s\S]{0,500}retryable:\s*true/u);
});

test('candidate persistence stale semantics remain fail-closed through existing AI_STALE_RESULT path', () => {
  assert.match(orchestrator, /function\s+isSupersededAnalysisError\s*\([\s\S]{0,300}AI_STALE_RESULT/u);
  assert.match(orchestrator, /isSupersededAnalysisError\(error\)/u);
  assert.doesNotMatch(orchestrator, /isDeterministicAutoReplyGenerationError\([\s\S]{0,500}AI_STALE_RESULT/u);
});
