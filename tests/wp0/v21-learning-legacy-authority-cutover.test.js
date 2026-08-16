'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const RETIRED = [
  'backend/repositories/replyFeedbackRepository.js',
  'backend/repositories/replyLearningProjectionRepository.js',
  'backend/services/aiReplyLearningAuthority.js',
  'backend/services/learningPreferenceAuthority.js',
  'backend/services/learningSynthesisScheduler.js',
  'backend/services/replyLearningGovernanceService.js',
  'backend/services/replyLearningQualityService.js',
  'backend/services/replyLearningScopeAuthority.js',
  'backend/services/replyLearningSummaryService.js',
  'backend/store/social/replyFeedbackLearningEngine.js'
];

test('Stage-visible Learning cutover removes every retired Yance Learning authority', () => {
  const remaining = RETIRED.filter(file => fs.existsSync(path.join(ROOT, file)));
  assert.deepEqual(remaining, [], `retired Learning authority still present: ${remaining.join(', ')}`);
});

test('Stage-visible Learning cutover removes legacy learned-profile injection from production reply composition', () => {
  const replyBrainPath = path.join(ROOT, 'backend/services/contextAwareReplyBrain.js');
  assert.equal(fs.existsSync(replyBrainPath), true, 'contextAwareReplyBrain.js must remain present');
  const replyBrain = fs.readFileSync(replyBrainPath, 'utf8');
  assert.doesNotMatch(replyBrain, /learnedProfile|replyLearningScopeAuthority|replyLearningSummaryService/u);
});
