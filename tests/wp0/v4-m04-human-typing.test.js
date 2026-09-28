'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OWNER = path.join(ROOT, 'backend/services/typingStateService.js');
const ROUTE = path.join(ROOT, 'backend/routes/messages.js');
const BRIDGE = path.join(ROOT, 'electron/r32StoreBridge.js');
const PRELOAD = path.join(ROOT, 'electron/preload.js');
const INDEX = path.join(ROOT, 'integration/element-module/src/index.tsx');
const ACCESSORY = path.join(ROOT, 'integration/element-module/src/product-experience/ProductComposerAccessory.tsx');

function read(file) { return fs.readFileSync(file, 'utf8'); }

test('M04 uses a mature TypingStateService Element handoff instead of a Product timer owner', () => {
  const owner = read(OWNER);
  for (const marker of ['prepareExternalTextSend', 'releaseExternalTextSend', 'completeExternalTextSend']) {
    assert.ok(owner.includes(marker), `missing mature typing handoff: ${marker}`);
  }
  assert.match(owner, /buildHumanTypingPlan/u);
  assert.match(owner, /beginSelfTyping/u);
  assert.match(owner, /approvedRuns/u);
});

test('M04 local API and Electron bridge expose only narrow typing handoff commands', () => {
  const route = read(ROUTE), bridge = read(BRIDGE), preload = read(PRELOAD);
  for (const marker of [
    '/typing/element/prepare', '/typing/element/release', '/typing/element/cancel', '/typing/element/complete',
  ]) assert.ok(route.includes(marker), `missing route: ${marker}`);
  assert.match(route, /typingStateService\.prepareExternalTextSend/u);
  assert.match(route, /typingStateService\.releaseExternalTextSend/u);
  assert.match(route, /typingStateService\.notifyUserCancel/u);
  assert.match(route, /typingStateService\.completeExternalTextSend/u);

  for (const marker of [
    'store:human-typing-prepare', 'store:human-typing-release',
    'store:human-typing-cancel', 'store:human-typing-complete',
  ]) assert.ok(bridge.includes(marker), `missing bridge channel: ${marker}`);
  for (const marker of [
    'prepareHumanTypingElementSend', 'releaseHumanTypingElementSend',
    'cancelHumanTypingElementSend', 'completeHumanTypingElementSend',
  ]) assert.ok(preload.includes(marker), `missing preload method: ${marker}`);
});

test('M04 keeps Element as physical send owner and applies artificial cadence only to staged external/AI text', () => {
  const index = read(INDEX);
  assert.match(index, /registerOutgoingMessagePrepare/u);
  assert.match(index, /prepareOutboundMessage/u);
  assert.match(index, /prepareHumanTypingElementSend/u);
  assert.match(index, /pendingAiAssistElementSend/u);
  assert.match(index, /registerOutgoingMessageCompletion/u);
  assert.match(index, /completeHumanTypingElementSend/u);
  assert.doesNotMatch(index, /sendMessage\(|sendEvent\(/u);
});

test('M04 visible state is an owner-backed projection with real immediate-send and cancel controls', () => {
  const accessory = read(ACCESSORY);
  for (const marker of ['正在输入', '立即发送', '取消']) {
    assert.ok(accessory.includes(marker), `missing M04 visible control/state: ${marker}`);
  }
  assert.match(accessory, /storeSnapshot/u);
  assert.match(accessory, /releaseHumanTypingElementSend/u);
  assert.match(accessory, /cancelHumanTypingElementSend/u);
  assert.doesNotMatch(accessory, /setTimeout|setInterval/u);
});
