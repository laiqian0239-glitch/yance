'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b39-account-lane-root-'));
process.env.YANCE_DATA_DIR = dataRoot;
process.env.NODE_ENV = 'test';

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { ExternalIdentityAuthority } = require('../services/externalIdentityAuthority');
const { OutboxRouteAuthority } = require('../services/outboxRouteAuthority');
const outboundCommandRepository = require('../repositories/outboundCommandRepository');

function fixture(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db') });
  return {
    store,
    close() {
      try { store.close(); } catch (_) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function seedScope(store, { accountId, platform, peer }) {
  const sessionKey = `${accountId}:${peer}`;
  store.upsertAccount({
    id: accountId,
    accountId,
    adapterAccountId: accountId,
    platform,
    state: 'online',
    canSend: true,
    canReceive: true
  });
  store.upsertConversation({
    sessionKey,
    accountId,
    platform,
    title: peer,
    routeState: 'bound',
    chatJid: peer,
    externalId: peer
  });
  return { accountId, platform, sessionKey, target: peer };
}

function routeAuthority(store) {
  return new OutboxRouteAuthority({
    storeProvider: () => store,
    externalIdentityAuthority: new ExternalIdentityAuthority({ storeProvider: () => store })
  });
}

function enqueue(store, scope, id) {
  return outboundCommandRepository.createAtomic({
    store,
    outboxRouteAuthority: routeAuthority(store),
    route: {
      conversationId: scope.sessionKey,
      accountId: scope.accountId,
      platform: scope.platform,
      routeTarget: scope.target,
      capabilitySnapshotId: 'cap-b39-account-lane'
    },
    queue: {
      id,
      idempotencyKey: id,
      accountId: scope.accountId,
      sessionKey: scope.sessionKey,
      messageType: 'text',
      capabilitySnapshotId: 'cap-b39-account-lane',
      payload: { platform: scope.platform, operation: 'text', text: id }
    },
    message: {
      id,
      dedupeKey: id,
      externalMessageId: id,
      accountId: scope.accountId,
      conversationId: scope.sessionKey,
      sessionKey: scope.sessionKey,
      chatJid: scope.target,
      platform: scope.platform,
      direction: 'outbound',
      fromMe: true,
      type: 'text',
      text: id
    }
  });
}

function makeUnknown(store, scope, id, unknownScope = 'account') {
  enqueue(store, scope, id);
  const claimed = store.claimNextSend();
  assert.equal(claimed.id, id);
  return store.markSendOutcomeUnknown(id, {
    error: 'simulated uncertain platform result',
    unknownScope,
    unknownLane: `${scope.platform}:${scope.accountId}`
  }, {
    generation: claimed.claim_generation,
    token: claimed.claim_token
  });
}

test.after(() => {
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test('account-scoped unknown atomically skips only its platform/account lane', () => {
  const f = fixture('yance-b39-account-lane-');
  try {
    const blocked = seedScope(f.store, {
      accountId: 'account-a',
      platform: 'telegram',
      peer: 'peer-a'
    });
    const available = seedScope(f.store, {
      accountId: 'account-b',
      platform: 'telegram',
      peer: 'peer-b'
    });

    makeUnknown(f.store, blocked, 'send-a-unknown');
    enqueue(f.store, blocked, 'send-a-pending');
    enqueue(f.store, available, 'send-b-pending');

    const claimed = f.store.claimNextSend();
    assert.equal(claimed.id, 'send-b-pending');
    assert.equal(f.store.getSendQueueItem('send-a-pending').state, 'pending');
  } finally {
    f.close();
  }
});

test('legacy empty unknown_lane derives the same durable platform/account lane', () => {
  const f = fixture('yance-b39-account-lane-legacy-');
  try {
    const blocked = seedScope(f.store, {
      accountId: 'account-legacy',
      platform: 'whatsapp',
      peer: 'peer-legacy'
    });
    const available = seedScope(f.store, {
      accountId: 'account-other',
      platform: 'whatsapp',
      peer: 'peer-other'
    });

    makeUnknown(f.store, blocked, 'send-legacy-unknown');
    f.store.db.prepare("UPDATE r32_send_queue SET unknown_lane='' WHERE id=?")
      .run('send-legacy-unknown');
    enqueue(f.store, blocked, 'send-legacy-pending');
    enqueue(f.store, available, 'send-other-pending');

    const claimed = f.store.claimNextSend();
    assert.equal(claimed.id, 'send-other-pending');
    assert.equal(f.store.getSendQueueItem('send-legacy-pending').state, 'pending');
  } finally {
    f.close();
  }
});

test('command-scoped unknown does not block a later command in the same lane', () => {
  const f = fixture('yance-b39-command-scope-');
  try {
    const scope = seedScope(f.store, {
      accountId: 'account-command',
      platform: 'facebook',
      peer: 'peer-command'
    });

    makeUnknown(f.store, scope, 'send-command-unknown', 'command');
    enqueue(f.store, scope, 'send-command-next');

    assert.equal(f.store.claimNextSend().id, 'send-command-next');
  } finally {
    f.close();
  }
});
