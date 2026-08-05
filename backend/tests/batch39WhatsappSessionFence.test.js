'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createSessionGenerationFence,
  createSocketGenerationGuard
} = require('../services/sessionGenerationFence');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('captured WhatsApp socket callbacks have zero effects after socket replacement', () => {
  const row = { socket: { id: 'old' } };
  const authoritativeSocket = row.socket;
  const fence = createSessionGenerationFence(() => true, { prefix: 'whatsapp:test' });
  const guard = createSocketGenerationGuard(fence, () => row.socket === authoritativeSocket);
  const handlers = new Map();
  const emitter = { on(name, handler) { handlers.set(name, handler); } };
  let effects = 0;
  const events = [
    'creds.update',
    'connection.update',
    'messaging-history.set',
    'messages.upsert',
    'lid-mapping.update',
    'presence.update',
    'messages.update',
    'message-receipt.update',
    'chats.upsert',
    'chats.update',
    'contacts.upsert',
    'contacts.update'
  ];
  for (const eventName of events) guard.bind(emitter, eventName, () => { effects += 1; });

  row.socket = { id: 'replacement' };
  for (const handler of handlers.values()) handler({});

  assert.equal(effects, 0);
});

test('late async WhatsApp callback completion is quarantined without an unhandled stale error', async () => {
  const row = { socket: { id: 'old' } };
  const authoritativeSocket = row.socket;
  const fence = createSessionGenerationFence(() => true, { prefix: 'whatsapp:test' });
  const guard = createSocketGenerationGuard(fence, () => row.socket === authoritativeSocket);
  const wait = deferred();
  let effects = 0;
  const callback = guard.wrap(async () => {
    await wait.promise;
    guard.assertCurrent({ phase: 'after-await' });
    effects += 1;
  });

  const pending = callback();
  row.socket = { id: 'replacement' };
  wait.resolve();
  await assert.doesNotReject(pending);
  assert.equal(effects, 0);
});

test('every WhatsApp Baileys event category is registered through the guarded binder', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  const expectedEvents = [
    'creds.update',
    'connection.update',
    'messaging-history.set',
    'messages.upsert',
    'lid-mapping.update',
    'presence.update',
    'messages.update',
    'message-receipt.update',
    'chats.upsert',
    'chats.update',
    'contacts.upsert',
    'contacts.update'
  ];

  assert.equal(source.includes('socket.ev.on('), false);
  for (const eventName of expectedEvents) {
    assert.match(source, new RegExp(`onSocket\\('${eventName.replace('.', '\\.')}[^']*'`));
  }
});

test('creds.update enters runWrite before saveCreds and never uses the old write-then-assert order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  const start = source.indexOf("onSocket('creds.update'");
  const end = source.indexOf("onSocket('connection.update'", start);
  assert.ok(start >= 0 && end > start, 'creds.update handler block is missing');
  const block = source.slice(start, end);
  const runWriteIndex = block.indexOf('socketGuard.runWrite(');
  const saveCredsIndex = block.indexOf('saveCreds(');
  assert.ok(runWriteIndex >= 0, 'creds.update must use socketGuard.runWrite');
  assert.ok(saveCredsIndex > runWriteIndex, 'saveCreds must execute only inside runWrite');
  assert.doesNotMatch(
    block,
    /await\s+saveCreds\(update\);[\s\S]*socketGuard\.assertCurrent/u,
    'legacy write-then-assert ordering must be removed'
  );
});
