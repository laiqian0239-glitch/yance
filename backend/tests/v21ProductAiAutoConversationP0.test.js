'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('AI_AUTO is a durable per-conversation authorization mode, not a second send stack', () => {
  const runtimeCommands = read('backend/store/commands/registerRuntimeStateCommands.js');
  const aiCommands = read('backend/store/commands/registerAiReplyCommands.js');
  const outbox = read('backend/services/aiReplyOutboxService.js');

  assert.match(runtimeCommands, /CONVERSATION_AI_AUTOMATION_MODE_SET/u);
  assert.match(runtimeCommands, /HUMAN[\s\S]*AI_ASSIST[\s\S]*AI_AUTO/u);
  assert.match(runtimeCommands, /automationModeReceipt/u);
  assert.match(aiCommands, /AI_AUTO/u);
  assert.match(aiCommands, /machineApproved|automationReceipt/u);
  assert.match(outbox, /AI_AUTO/u);
  assert.match(outbox, /manual takeover|MANUAL_TAKEOVER|automationMode/u);
  assert.doesNotMatch(outbox, /automaticSendEnabled:\s*false/u);
  assert.match(outbox, /sendQueueService\.enqueueText/u);
  assert.match(outbox, /typingStateService\.simulateApprovedSend/u);
});

test('AI_AUTO preserves fail-closed stale checks and distinguishes machine authorization from human approval', () => {
  const aiCommands = read('backend/store/commands/registerAiReplyCommands.js');
  const outbox = read('backend/services/aiReplyOutboxService.js');

  assert.match(aiCommands, /authorizationType/u);
  assert.match(aiCommands, /machine|automation/u);
  assert.match(aiCommands, /STALE_CONVERSATION/u);
  assert.match(outbox, /STALE_CONVERSATION_CONTEXT/u);
  assert.match(outbox, /MANUAL_TYPING_STARTED/u);
  assert.match(outbox, /CONVERSATION_CHANGED/u);
});

test('reply generation receives local temporal context and authoritative Persona lifeStatus', () => {
  const compiler = read('backend/personaBrain/compiler.js');
  const brain = read('backend/services/contextAwareReplyBrain.js');

  assert.match(compiler, /lifeStatus/u);
  assert.match(brain, /temporalContext/u);
  assert.match(brain, /localDate/u);
  assert.match(brain, /localTime/u);
  assert.match(brain, /weekday/u);
  assert.match(brain, /daypart/u);
  assert.match(brain, /timeZone/u);
  assert.match(brain, /不得.*时间.*编造|temporal.*not.*fabricat/is);
});
