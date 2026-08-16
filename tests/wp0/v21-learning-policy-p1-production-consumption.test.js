'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const source = () => fs.readFileSync(path.join(ROOT, 'backend/services/contextAwareReplyBrain.js'), 'utf8');

test('production reply brain consumes Learned Policy before existing frontier generation', () => {
  const text = source();
  assert.match(text, /require\(['"]\.\/learningPolicyRuntimeAdapter['"]\)/);
  assert.match(text, /selectLearnedPolicyAction\s*\(/);
  assert.match(text, /candidateStrategyBranch/);
  assert.match(text, /aiGateway\.execute\s*\(/, 'existing Model Brain gateway must remain the final generator');
});

test('Learned Policy production consumption cannot take provider/model credential or final-text authority', () => {
  const text = source();
  assert.doesNotMatch(text, /learnedPolicy[^\n]{0,120}(apiKey|credential|providerCredential)/i);
  assert.doesNotMatch(text, /learnedPolicy[^\n]{0,120}modelId\s*:/i);
  assert.doesNotMatch(text, /learnedPolicy[^\n]{0,120}(finalReply|finalText)\s*:/i);
});
