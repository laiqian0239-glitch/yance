'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunction(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing ${startMarker}`);
  return source.slice(start, end);
}

test('duplicate contact events share one persisted send queue request per conversation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-conversation-capabilities.js'), 'utf8');
  const loadSource = extractFunction(source, 'async function loadPersistedSendQueueState', '\nfunction schedulePersistedSendQueueState');
  const scheduleSource = extractFunction(source, 'function schedulePersistedSendQueueState', '\nasync function reconcileQueueOutcome');
  let calls = 0;
  let activeContact = { id: 'whatsapp:account:peer' };
  const context = {
    Date,
    Promise,
    setTimeout,
    clearTimeout,
    console,
    sendQueueState: null,
    sendQueueLoadKey: '',
    sendQueueLoadPromise: null,
    sendQueueLoadConversationId: '',
    sendQueueLoadedAt: 0,
    sendQueueRefreshTimer: 0,
    contact: () => activeContact,
    renderSendQueueStatus() {},
    window: {
      YanceCore: {
        messages: {
          async listQueue() {
            calls += 1;
            await new Promise(resolve => setTimeout(resolve, 25));
            return { queue: [{ id: 'q1', sessionKey: activeContact.id, state: 'queued', updatedAt: '2026-07-25T00:00:00.000Z' }] };
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${loadSource}\n${scheduleSource}`, context);
  const [first, second] = await Promise.all([
    vm.runInContext('loadPersistedSendQueueState()', context),
    vm.runInContext('loadPersistedSendQueueState()', context)
  ]);
  assert.equal(calls, 1);
  assert.equal(first.id, 'q1');
  assert.equal(second.id, 'q1');

  await vm.runInContext('loadPersistedSendQueueState()', context);
  assert.equal(calls, 1, 'recent state should be reused for the same conversation');

  activeContact = { id: 'whatsapp:account:other' };
  await vm.runInContext('loadPersistedSendQueueState()', context);
  assert.equal(calls, 2, 'changing conversation must load its own queue state');
});

test('both conversation selection events schedule a coalesced refresh instead of direct duplicate reads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'r32-conversation-capabilities.js'), 'utf8');
  assert.match(source, /yance:r32-contact-selected[^\n]+schedulePersistedSendQueueState\(\)/);
  assert.match(source, /yance:r32-active-conversation-changed[^\n]+schedulePersistedSendQueueState\(\)/);
  assert.doesNotMatch(source, /yance:r32-contact-selected[^\n]+loadPersistedSendQueueState\(\)/);
});
