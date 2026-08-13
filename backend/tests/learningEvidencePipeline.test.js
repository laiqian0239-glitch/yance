'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const REQUIRED_ADAPTERS = [
  'backend/services/langfuseLearningEvidenceAdapter.js',
  'backend/services/learningDataPolicy.js',
  'backend/services/learningEvidenceBridge.js',
  'backend/services/learningEvaluationAdapter.js'
];

test('Learning evidence pipeline is owned by OSS adapters and binds Model Brain execution evidence', () => {
  for (const file of REQUIRED_ADAPTERS) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);
  }
  const bridge = read('backend/services/learningEvidenceBridge.js');
  assert.match(bridge, /modelBrainExecutionEvidence/u);
  assert.match(bridge, /Langfuse|langfuse/u);
  assert.match(bridge, /DATA_INSUFFICIENT/u);
});

test('production reply composition no longer injects the legacy learned profile', () => {
  const replyBrain = read('backend/services/contextAwareReplyBrain.js');
  assert.equal(/learnedProfile|replyLearningScopeAuthority|replyLearningSummaryService/u.test(replyBrain), false, 'legacy learned-profile injection must be removed');
});
