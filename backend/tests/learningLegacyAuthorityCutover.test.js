'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const RETIRED = [
  'backend/store/social/replyFeedbackLearningEngine.js',
  'backend/services/replyLearningScopeAuthority.js',
  'backend/services/learningPreferenceAuthority.js',
  'backend/services/learningSynthesisScheduler.js',
  'backend/services/replyLearningGovernanceService.js',
  'backend/services/aiReplyLearningAuthority.js',
  'backend/repositories/replyLearningProjectionRepository.js',
  'backend/services/replyLearningQualityService.js',
  'backend/repositories/replyFeedbackRepository.js',
  'backend/services/replyLearningSummaryService.js'
];

test('legacy Yance Learning authorities are removed from the production source tree', () => {
  const remaining = RETIRED.filter(file => fs.existsSync(path.join(ROOT, file)));
  assert.deepEqual(remaining, [], `legacy Learning authority still present: ${remaining.join(', ')}`);
});
