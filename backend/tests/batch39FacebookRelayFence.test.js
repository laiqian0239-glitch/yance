'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const facebookRelay = require('../services/facebookRelayClient');
const { createSessionGenerationFence } = require('../services/sessionGenerationFence');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const client = new facebookRelay.constructor();
  const account = { id: 'facebook-relay-fence' };
  const row = {
    accountId: account.id,
    state: 'connected',
    stopped: false,
    lastSyncAt: '',
    lastAckAt: '',
    pendingEvents: 0
  };
  row.sessionFence = createSessionGenerationFence(
    () => client.sessions.get(account.id) === row,
    { prefix: `facebook:${account.id}` }
  );
  client.sessions.set(account.id, row);
  return { client, account, row };
}

function event() {
  return {
    event_id: 'event-1',
    delivery_id: 'delivery-1',
    lease_token: 'lease-1',
    payload: { object: 'page', entry: [] }
  };
}

test('a Facebook /events response cannot persist or ACK after relay generation replacement', async () => {
  const { client, account, row } = fixture();
  const events = deferred();
  let webhookCalls = 0;
  let ackCalls = 0;
  client.request = async (_secret, endpoint) => {
    if (endpoint.startsWith('/api/desktop/events')) return events.promise;
    if (endpoint === '/api/desktop/ack') {
      ackCalls += 1;
      return { acked: ['delivery-1'], failed: [] };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };

  const pending = client.syncOnce(account, {}, async () => { webhookCalls += 1; });
  client.sessions.set(account.id, { accountId: account.id, state: 'connected' });
  events.resolve({ events: [event()], has_more: false });
  const result = await pending;

  assert.equal(webhookCalls, 0);
  assert.equal(ackCalls, 0);
  assert.equal(row.lastSyncAt, '');
  assert.equal(result.stale, true);
});

test('a Facebook event processed by a stale generation never becomes an ACK candidate', async () => {
  const { client, account, row } = fixture();
  const persisted = deferred();
  let ackCalls = 0;
  client.request = async (_secret, endpoint) => {
    if (endpoint.startsWith('/api/desktop/events')) return { events: [event()], has_more: false };
    if (endpoint === '/api/desktop/ack') {
      ackCalls += 1;
      return { acked: ['delivery-1'], failed: [] };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };

  const pending = client.syncOnce(account, {}, async () => persisted.promise);
  await new Promise(resolve => setImmediate(resolve));
  client.sessions.set(account.id, { accountId: account.id, state: 'connected' });
  persisted.resolve();
  const result = await pending;

  assert.equal(ackCalls, 0);
  assert.equal(row.lastAckAt, '');
  assert.equal(row.lastSyncAt, '');
  assert.equal(result.stale, true);
});

test('a local Facebook persistence failure is never included in the ACK body', async () => {
  const { client, account } = fixture();
  let ackBody = null;
  client.request = async (_secret, endpoint, options = {}) => {
    if (endpoint.startsWith('/api/desktop/events')) {
      return {
        events: [event(), { ...event(), event_id: 'event-2', delivery_id: 'delivery-2', lease_token: 'lease-2' }],
        has_more: false
      };
    }
    if (endpoint === '/api/desktop/ack') {
      ackBody = options.body;
      return { acked: ['delivery-2'], failed: [] };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };

  let calls = 0;
  await client.syncOnce(account, {}, async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('local persistence failed'), { code: 'SQLITE_BUSY' });
  });

  assert.deepEqual(ackBody.acknowledgements, [{ delivery_id: 'delivery-2', lease_token: 'lease-2' }]);
});
