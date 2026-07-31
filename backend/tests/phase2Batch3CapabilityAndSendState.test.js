'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('../../frontend/js/r32-platform-capability-runtime.js');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('capability runtime distinguishes supported, partial and unsupported operations', () => {
  const contact = { platform: 'facebook', accountId: 'page-1', capabilityContracts: {
    text: { state: 'supported', note: '真实发送' },
    proactiveSend: { state: 'policy', note: '受消息窗口限制' },
    reaction: { state: 'unsupported', note: '没有正式消息回应接口' }
  }};
  assert.equal(runtime.actionDecision(contact, 'text').enabled, true);
  assert.equal(runtime.actionDecision(contact, 'proactiveSend').state, 'policy');
  assert.equal(runtime.actionDecision(contact, 'reaction').visible, false);
  const unavailable = runtime.actionDecision(contact, 'reaction', { showUnavailable: true });
  assert.equal(unavailable.visible, true);
  assert.equal(unavailable.enabled, false);
  assert.match(unavailable.reason, /回应接口/);
});

test('own-message constraints prevent fake revoke action on inbound messages', () => {
  const contact = { platform: 'whatsapp', capabilities: { revoke: 'partial' } };
  const inbound = runtime.actionDecision(contact, 'revoke', { requiresOwnMessage: true, fromMe: false, showUnavailable: true });
  assert.equal(inbound.enabled, false);
  assert.match(inbound.reason, /自己发送/);
});

test('conversation runtime exposes capability explanation and persistent send queue status', () => {
  const source = read('frontend/js/r32-conversation-capabilities.js');
  assert.match(source, /openCapabilityDialog/);
  assert.match(source, /r32SendQueueStatus/);
  assert.match(source, /renderSendQueueStatus/);
  assert.match(source, /send-queue:retry/);
  assert.match(source, /send-queue:failed/);
  assert.match(source, /YanceR32ConversationCapabilities=\{[^;]*openCapabilityDialog/);
  assert.doesNotMatch(source, /data-conv="capabilities"/);
});
