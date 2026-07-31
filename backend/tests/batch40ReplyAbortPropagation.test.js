'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('HTTP response disconnect aborts an unfinished reply operation but normal completion does not', () => {
  const { createHttpAbortScope } = require('../lib/httpAbortScope');
  const req = new EventEmitter();
  req.aborted = false;
  const res = new EventEmitter();
  res.writableEnded = false;
  const scope = createHttpAbortScope(req, res, { code: 'AI_REPLY_CLIENT_DISCONNECTED' });
  res.emit('close');
  assert.equal(scope.signal.aborted, true);
  assert.equal(scope.signal.reason.code, 'AI_REPLY_CLIENT_DISCONNECTED');
  scope.dispose();

  const completedReq = new EventEmitter();
  completedReq.aborted = false;
  const completedRes = new EventEmitter();
  completedRes.writableEnded = true;
  const completed = createHttpAbortScope(completedReq, completedRes);
  completedRes.emit('close');
  assert.equal(completed.signal.aborted, false);
  completed.dispose();
});

test('reply generation propagates AbortSignal from UI fetch through route and brain', () => {
  const client = read('frontend/js/r32-store-client.js');
  const ui = read('frontend/js/r32-ui-runtime.js');
  const route = read('backend/routes/store.js');
  assert.match(client, /signal:\s*input\.signal/u);
  assert.match(ui, /replyCandidateRequestControllers=new Map\(\)/u);
  assert.match(ui, /generateReplyCandidate\(/u);
  assert.match(ui, /signal:\s*extra\?\.signal/u);
  assert.match(route, /createHttpAbortScope\(req, res/u);
  assert.match(route, /signal:\s*requestAbort\.signal/u);
  assert.match(route, /requestAbort\.dispose\(\)/u);
});

test('desktop IPC reply cancellation aborts the main-process local API fetch in the same renderer scope', async () => {
  const { installR32StoreBridge, CHANNELS } = require('../../electron/r32StoreBridge');
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    removeHandler(channel) { handlers.delete(channel); },
    on(channel, handler) { listeners.set(channel, handler); },
    removeListener(channel, handler) { if (listeners.get(channel) === handler) listeners.delete(channel); }
  };
  let capturedSignal;
  const apiRequest = (_endpoint, options = {}) => new Promise((_resolve, reject) => {
    capturedSignal = options.signal;
    options.signal?.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });
  const dispose = installR32StoreBridge({ ipcMain, apiRequest });
  const event = { sender: { id: 7 } };
  const pending = handlers.get(CHANNELS.generateReply)(event, {
    __yanceBridgeRequestId: 'reply-request-1',
    conversationId: 'conversation-1'
  });
  await Promise.resolve();
  assert.equal(capturedSignal?.aborted, false);
  listeners.get(CHANNELS.cancelRequest)(event, { requestId: 'reply-request-1' });
  const result = await pending;
  assert.equal(capturedSignal.aborted, true);
  assert.equal(result.__yanceBridgeError, true);
  assert.equal(result.code, 'AI_REPLY_GENERATION_SUPERSEDED');
  dispose();
});

test('preload exposes a cancellable desktop reply invocation without attempting to clone AbortSignal over IPC', () => {
  const preload = read('electron/preload.js');
  const client = read('frontend/js/r32-store-client.js');
  assert.match(preload, /invokeStoreCancelable/u);
  assert.match(preload, /store:cancel-request/u);
  assert.match(preload, /storeGenerateReply:\s*\(input, options/u);
  assert.match(client, /storeGenerateReply\(body,\s*\{\s*signal:\s*input\.signal\s*\}\)/u);
});

test('every UI reply-generation entry point owns a cancellable request scope', () => {
  const ui = read('frontend/js/r32-ui-runtime.js');
  assert.match(ui, /function beginReplyCandidateRequest/u);
  assert.match(ui, /mergeCandidates:[\s\S]*?signal:\s*requestController\.signal/u);
  assert.match(ui, /strictInstruction[\s\S]*?signal:\s*requestController\.signal/u);
  assert.match(ui, /manualText:t[\s\S]*?signal:\s*manualRequestController\.signal/u);
});
