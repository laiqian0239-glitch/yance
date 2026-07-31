'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { summarizeContactLearning, summarizeWorkspaceLearning } = require('../services/replyLearningSummaryService');

function repositoryFixture() {
  return {
    getProfile(scopeType, scopeId) {
      if (scopeType === 'contact' && scopeId === 'canonical-kurt') return {
        version: 3,
        profile: {
          effective: {
            tone: { value: 'natural', disabled: false },
            questionFrequency: { value: 'low', disabled: false },
            stale: { value: 'formal', disabled: true }
          },
          evidence: [{ id: 'e1' }, { id: 'e2' }]
        }
      };
      return null;
    },
    listEvents({ contactId }) {
      return contactId === 'canonical-kurt'
        ? [{ id: 'f1', eventType: 'accepted' }, { id: 'f2', eventType: 'edited' }]
        : [];
    },
    listLifecycleEvents({ contactId }) {
      return contactId === 'canonical-kurt'
        ? [
            { eventId: 'l1', stage: 'generated' },
            { eventId: 'l2', stage: 'accepted' },
            { eventId: 'l3', stage: 'edited' },
            { eventId: 'l4', stage: 'sent' }
          ]
        : [];
    }
  };
}

test('reply learning summary separates real feedback events from imported materials and resolves canonical aliases', () => {
  const contact = { id: 'facebook:page:kurt', canonicalContactId: 'canonical-kurt', contactId: 'platform-kurt' };
  const summary = summarizeContactLearning(contact, { repository: repositoryFixture() });
  assert.equal(summary.contactId, contact.id);
  assert.equal(summary.profileVersion, 3);
  assert.equal(summary.preferenceCount, 2);
  assert.equal(summary.evidenceCount, 2);
  assert.equal(summary.feedbackEventCount, 2);
  assert.equal(summary.lifecycleCount, 4);
  assert.equal(summary.generated, 1);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.edited, 1);
  assert.equal(summary.sent, 1);
  assert.equal(summary.active, true);
});

test('workspace learning summary is keyed by the actual conversation contact id used by the workbench', () => {
  const workspace = summarizeWorkspaceLearning([
    { id: 'facebook:page:kurt', canonicalContactId: 'canonical-kurt' },
    { id: 'whatsapp:account:empty', canonicalContactId: 'canonical-empty' }
  ], { repository: repositoryFixture() });
  assert.equal(workspace.byContactId['facebook:page:kurt'].feedbackEventCount, 2);
  assert.equal(workspace.byContactId['whatsapp:account:empty'].active, false);
  assert.equal(workspace.totals.feedbackEventCount, 2);
});

test('AI workbench consumes authoritative reply learning governance instead of equating learning with imported materials only', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-ai-workbench-runtime.js'), 'utf8');
  assert.match(source, /learningGovernance/);
  assert.match(source, /真实回复学习/);
  assert.match(source, /与真实回复学习分开治理/);
  assert.match(source, /actualLearning\+state\.materials\.length/);
});
