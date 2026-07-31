'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b23-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  store.upsertAccount({ id: 'page-1', accountId: 'page-1', adapterAccountId: 'page-1', platform: 'facebook', state: 'online' });
  store.upsertConversation({ sessionKey: 'page-1:psid-1', accountId: 'page-1', platform: 'facebook', title: 'Alex', routeState: 'bound', chatJid: 'psid-1', externalId: 'psid-1' });
  const authority = new OutboxRouteAuthority({ storeProvider: () => store, externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store }) });
  return { root, store, authority, close() { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
function command(f, id='send-1') {
  return {
    store: f.store, outboxRouteAuthority: f.authority,
    route: { conversationId: 'page-1:psid-1', accountId: 'page-1', platform: 'facebook', routeTarget: 'psid-1', capabilitySnapshotId: 'cap-1' },
    queue: { id, idempotencyKey: id, accountId: 'page-1', sessionKey: 'page-1:psid-1', messageType: 'text', payload: { operation: 'text', text: 'Hallo' }, capabilitySnapshotId: 'cap-1' },
    message: { id, dedupeKey: id, externalMessageId: id, accountId: 'page-1', conversationId: 'page-1:psid-1', sessionKey: 'page-1:psid-1', chatJid: 'psid-1', platform: 'facebook', direction: 'outbound', fromMe: true, type: 'text', text: 'Hallo' }
  };
}

test('outbound route, queue, message and conversation projection commit atomically', () => {
  const f = fixture();
  try {
    const created = outboundCommandRepository.createAtomic(command(f));
    assert.equal(created.queue.outbox_route_id, created.route.outboxRouteId);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox_routes').get().n, 1);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM r32_send_queue').get().n, 1);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM r32_messages').get().n, 1);
    assert.equal(f.store.db.prepare('SELECT last_message FROM r32_conversations WHERE session_key=?').get('page-1:psid-1').last_message, 'Hallo');
  } finally { f.close(); }
});

test('message projection failure rolls back route and queue with no hidden send', () => {
  const f = fixture();
  try {
    const original = f.store.upsertMessage;
    f.store.upsertMessage = () => { throw Object.assign(new Error('simulated projection failure'), { code: 'SIMULATED_MESSAGE_PROJECTION_FAILURE' }); };
    assert.throws(() => outboundCommandRepository.createAtomic(command(f, 'send-fail')), /simulated projection failure/);
    f.store.upsertMessage = original;
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox_routes').get().n, 0);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM r32_send_queue').get().n, 0);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM r32_messages').get().n, 0);
  } finally { f.close(); }
});

test('queue failure rolls back newly created route and external identity', () => {
  const f = fixture();
  try {
    const original = f.store.enqueueSend;
    f.store.enqueueSend = () => { throw Object.assign(new Error('simulated queue failure'), { code: 'SIMULATED_QUEUE_FAILURE' }); };
    assert.throws(() => outboundCommandRepository.createAtomic(command(f, 'queue-fail')), /simulated queue failure/);
    f.store.enqueueSend = original;
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM outbox_routes').get().n, 0);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM external_identities').get().n, 0);
  } finally { f.close(); }
});
