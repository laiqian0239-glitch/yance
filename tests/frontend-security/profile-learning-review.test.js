'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const runtime = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');


test('pending AI profile is visibly isolated and requires explicit user review', () => {
  assert.match(runtime, /function\s+pendingProfileReviewSummary\s*\(/);
  assert.match(runtime, /AI画像待人工审核/);
  assert.match(runtime, /未批准前不会进入事实层或回复上下文/);
  assert.match(runtime, /data-profile-review="approved"/);
  assert.match(runtime, /data-profile-review="rejected"/);
  assert.match(runtime, /function\s+handlePendingProfileReview\s*\(/);
  assert.match(runtime, /\/profile-review/);
  assert.match(runtime, /decision:normalized/);
  assert.match(html, /\.pending-profile-review\{/);
  assert.match(html, /\.pending-profile-review-head\{/);
});

test('pending profile values are escaped before rendering', () => {
  assert.match(runtime, /htmlText\(pendingProfileReview\.modelName\)/);
  assert.match(runtime, /htmlText\(row\.title\)/);
  assert.match(runtime, /htmlText\(row\.text\)/);
  assert.match(runtime, /htmlText\(profileText\(pendingProfileReview\.proposal\.nextAction\)\)/);
  assert.doesNotMatch(runtime, /\$\{pendingProfileReview\.proposal\.nextAction\}/);
});

test('stable user feedback preferences are visible and can be reset per contact', () => {
  assert.match(runtime, /function\s+feedbackPreferenceRows\s*\(/);
  assert.match(runtime, /从你的批改中学习/);
  assert.match(runtime, /至少3次同方向证据后才会生效/);
  assert.match(runtime, /data-feedback-action="clear"/);
  assert.match(runtime, /data-feedback-action="restore"/);
  assert.match(runtime, /function\s+handleReplyFeedbackAction\s*\(/);
  assert.match(runtime, /\/api\/r32\/store\/customers\/\$\{encodeURIComponent\(contactId\)\}\/reply-feedback/);
  assert.match(runtime, /reply-feedback\/restore/);
  assert.match(html, /\.feedback-learning-card\{/);
});
