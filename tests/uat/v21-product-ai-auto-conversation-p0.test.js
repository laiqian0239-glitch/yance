'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('conversation center exposes persistent HUMAN / AI_ASSIST / AI_AUTO control with immediate manual takeover', () => {
  const client = read('frontend/js/r32-store-client.js');
  const center = read('frontend/js/r32-conversation-center-v3.js');

  assert.match(client, /setConversationAutomationMode/u);
  assert.match(center, /HUMAN/u);
  assert.match(center, /AI_ASSIST/u);
  assert.match(center, /AI_AUTO/u);
  assert.match(center, /人工接管/u);
  assert.match(center, /setConversationAutomationMode/u);
});

test('automation mode is Store-backed rather than a localStorage-only product toggle', () => {
  const center = read('frontend/js/r32-conversation-center-v3.js');
  assert.match(center, /automationModeReceipt|conversationAutomationMode/u);
  assert.doesNotMatch(center, /localStorage\.setItem\([^\n]*conversationAutomationMode/u);
});

test('committed automation receipt remains UI authority until the Store snapshot catches up', () => {
  const center = read('frontend/js/r32-conversation-center-v3.js');
  assert.match(center, /automationModePendingReceipt/u);
  assert.match(center, /policyVersion/u);
  assert.match(center, /automationModePendingReceipt\s*=\s*result\?\.automationModeReceipt/u);
  assert.match(center, /pendingReceipt[\s\S]*currentReceipt/u);
});
