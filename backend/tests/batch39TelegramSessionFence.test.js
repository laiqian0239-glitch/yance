'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const telegramModule = require('../services/telegramAdapter');
const messageStore = require('../services/messageStore');
const syncCheckpoint = require('../services/syncCheckpointService');
const notificationPolicy = require('../services/notificationPolicy');

const { TelegramAdapter } = telegramModule;

function patch(t, object, key, value) {
  const original = object[key];
  object[key] = value;
  t.after(() => { object[key] = original; });
}

function account() {
  return {
    id: 'telegram-session-fence',
    platform: 'telegram',
    displayName: 'Telegram Session Fence',
    credentialRef: 'telegram-session-fence-credential'
  };
}

function clientFixture() {
  const handlers = [];
  const removed = [];
  return {
    handlers,
    removed,
    client: {
      addEventHandler(handler) {
        handlers.push(handler);
      },
      removeEventHandler(handler) {
        removed.push(handler);
      },
      async disconnect() {}
    }
  };
}

function inboundMessage(id = 701) {
  return {
    message: {
      id,
      chatId: 42,
      senderId: 42,
      date: 1783900800,
      out: false,
      message: `message-${id}`
    }
  };
}

function installIngestSpies(t, adapter) {
  const effects = {
    begin: 0,
    claim: 0,
    upsert: 0,
    commit: 0,
    fail: 0,
    release: 0,
    notify: 0,
    enrich: 0
  };
  patch(t, syncCheckpoint, 'begin', () => {
    effects.begin += 1;
    return { batchId: `batch-${effects.begin}` };
  });
  patch(t, syncCheckpoint, 'claimRemoteMessage', () => {
    effects.claim += 1;
    return { claimed: true, duplicate: false };
  });
  patch(t, syncCheckpoint, 'commit', () => {
    effects.commit += 1;
    return {};
  });
  patch(t, syncCheckpoint, 'fail', () => {
    effects.fail += 1;
    return {};
  });
  patch(t, syncCheckpoint, 'releaseRemoteMessage', () => {
    effects.release += 1;
    return {};
  });
  patch(t, messageStore, 'hasExternalMessage', () => false);
  patch(t, messageStore, 'upsert', async value => {
    effects.upsert += 1;
    return { inserted: true, message: value, conversation: {} };
  });
  patch(t, notificationPolicy, 'notify', () => {
    effects.notify += 1;
  });
  patch(t, adapter, 'scheduleMessageEnrichment', () => {
    effects.enrich += 1;
  });
  return effects;
}

class NewMessage {}

test('a Telegram handler captured from a replaced session has zero ingest effects', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  const oldClient = clientFixture();
  const oldRow = adapter.makeRow(currentAccount, oldClient.client, 'session', 'attempt-old');
  adapter.sessions.set(currentAccount.id, oldRow);
  const effects = installIngestSpies(t, adapter);

  adapter.attachMessageHandler(currentAccount, oldRow, NewMessage);
  const oldHandler = oldClient.handlers[0];
  assert.equal(typeof oldHandler, 'function');

  const replacement = clientFixture();
  const newRow = adapter.makeRow(currentAccount, replacement.client, 'session', 'attempt-new');
  adapter.sessions.set(currentAccount.id, newRow);
  await oldHandler(inboundMessage());

  assert.deepEqual(effects, {
    begin: 0,
    claim: 0,
    upsert: 0,
    commit: 0,
    fail: 0,
    release: 0,
    notify: 0,
    enrich: 0
  });
});

test('a Telegram handler that becomes stale during persistence cannot commit or emit later effects', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  const oldClient = clientFixture();
  const oldRow = adapter.makeRow(currentAccount, oldClient.client, 'session', 'attempt-old');
  adapter.sessions.set(currentAccount.id, oldRow);
  const effects = installIngestSpies(t, adapter);
  let resolveUpsert;
  patch(t, messageStore, 'upsert', value => {
    effects.upsert += 1;
    return new Promise(resolve => {
      resolveUpsert = () => resolve({ inserted: true, message: value, conversation: {} });
    });
  });

  adapter.attachMessageHandler(currentAccount, oldRow, NewMessage);
  const ingest = oldClient.handlers[0](inboundMessage(702));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(effects.upsert, 1);

  const replacement = clientFixture();
  adapter.sessions.set(
    currentAccount.id,
    adapter.makeRow(currentAccount, replacement.client, 'session', 'attempt-new')
  );
  resolveUpsert();
  await ingest;

  assert.equal(effects.commit, 0);
  assert.equal(effects.fail, 0);
  assert.equal(effects.release, 0);
  assert.equal(effects.notify, 0);
  assert.equal(effects.enrich, 0);
});

test('Telegram disconnect removes the exact main handler before awaiting client shutdown', async t => {
  const adapter = new TelegramAdapter();
  const currentAccount = account();
  const fixture = clientFixture();
  let resolveDisconnect;
  fixture.client.disconnect = () => new Promise(resolve => { resolveDisconnect = resolve; });
  const row = adapter.makeRow(currentAccount, fixture.client, 'session', 'attempt-current');
  row.state = 'connected';
  adapter.sessions.set(currentAccount.id, row);
  const effects = installIngestSpies(t, adapter);

  adapter.attachMessageHandler(currentAccount, row, NewMessage);
  const handler = fixture.handlers[0];
  const disconnecting = adapter.disconnect(currentAccount.id, false);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(fixture.removed, [handler]);
  await handler(inboundMessage(703));
  assert.equal(effects.upsert, 0);

  resolveDisconnect();
  await disconnecting;
});
