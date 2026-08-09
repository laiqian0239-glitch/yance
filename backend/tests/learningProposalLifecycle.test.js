'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Learning proposals enter evaluation instead of directly deploying', () => {
  const proposalPath = path.join(ROOT, 'backend/services/learningProposalService.js');
  const promotionPath = path.join(ROOT, 'backend/services/learningPromotionAdapter.js');
  assert.equal(fs.existsSync(proposalPath), true, 'learningProposalService.js must exist');
  assert.equal(fs.existsSync(promotionPath), true, 'learningPromotionAdapter.js must exist');
  const source = `${read('backend/services/learningProposalService.js')}\n${read('backend/services/learningPromotionAdapter.js')}`;
  for (const token of ['Evidence', 'Hypothesis', 'Candidate', 'Regression', 'Shadow']) {
    assert.match(source, new RegExp(token, 'u'));
  }
  assert.match(source, /OpenFeature|flagd/u);
  assert.match(source, /Langfuse|langfuse/u);
});
