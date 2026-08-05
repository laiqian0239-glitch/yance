'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');
const { createWhatsAppMessageKeyIndexRepository, hashRawMessage } = require('../repositories/whatsappMessageKeyIndexRepository');
const { CommunicationAuthority } = require('../services/communicationAuthority');

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-oss1a-message-index-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'database', 'yance.db'), ownershipHeartbeatMs: 60000, ownershipStaleMs: 120000 });
  const cipher = createWhatsAppAuthCipher({ key: Buffer.alloc(32, 0x62), keyVersion: 1 });
  const aliases = new Map([
    ['15550001111:7@s.whatsapp.net', 'canonical-peer@whatsapp'],
    ['A1B2C3@lid', 'canonical-peer@whatsapp'],
    ['canonical-peer@whatsapp', 'canonical-peer@whatsapp']
  ]);
  const remoteJidNormalizer = (_accountId, value) => aliases.get(String(value)) || String(value).toLowerCase();
  const transactionAuthority = Symbol('test-canonical-message-transaction-authority');
  const communicationAuthority = new CommunicationAuthority({
    storeProvider: () => store,
    clock: () => '2026-08-05T00:00:00.000Z'
  });
  try {
    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    return callback({ store, cipher, remoteJidNormalizer, transactionAuthority, communicationAuthority });
  } finally {
    try { cipher.close(); } catch (_) {}
    try { store.close(); } catch (_) {}
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function message(rawMessage = { conversation: 'hello', contextInfo: { stanzaId: 'quoted-1' } }) {
  return {
    id: 'canonical-message-1',
    dedupeKey: 'canonical-message-1',
    externalMessageId: 'platform-message-1',
    accountId: 'account-1',
    sourceAccountId: 'account-1',
    sessionKey: 'account-1:15550001111@s.whatsapp.net',
    conversationId: 'account-1:15550001111@s.whatsapp.net',
    chatJid: '15550001111:7@s.whatsapp.net',
    senderId: 'peer-1',
    role: 'user',
    direction: 'inbound',
    fromMe: false,
    messageType: 'text',
    type: 'text',
    text: 'hello',
    rawMessage,
    rawMeta: { remoteJid: '15550001111:7@s.whatsapp.net', messageId: 'platform-message-1' },
    timestamp: '2026-08-05T00:00:00.000Z',
    sentAt: '2026-08-05T00:00:00.000Z',
    platform: 'whatsapp'
  };
}

function persist(store, repository, value, transactionAuthority, communicationAuthority) {
  store.upsertConversation({
    sessionKey: value.sessionKey,
    accountId: value.accountId,
    platform: 'whatsapp',
    title: 'Peer',
    updatedAt: value.timestamp
  });
  return store.transaction(() => {
    const canonical = communicationAuthority.ingestMessage({
      messageId: value.id,
      traceId: 'trace-task8',
      platform: 'whatsapp',
      sourceAccountId: value.sourceAccountId,
      externalConversationId: value.rawMeta.remoteJid,
      externalMessageId: value.externalMessageId,
      direction: value.direction,
      senderExternalId: value.senderId,
      occurredAt: value.timestamp,
      rawEventRef: {
        eventId: value.externalMessageId,
        payloadSha256: hashRawMessage(value.rawMessage),
        redactionVersion: 'v1'
      },
      content: { kind: 'text', text: value.text }
    });
    assert.equal(canonical.messageId, value.id);
    store.upsertMessage(value);
    return repository.upsertWithinTransaction(store, value, transactionAuthority);
  });
}

test('exact key lookup survives restart and LID/PN alias normalization without scans', () => {
  fixture(({ store, cipher, remoteJidNormalizer, transactionAuthority, communicationAuthority }) => {
    const options = { cipher, storeProvider: () => store, remoteJidNormalizer, transactionAuthority, clock: () => '2026-08-05T00:00:00.000Z' };
    const first = createWhatsAppMessageKeyIndexRepository(options);
    const written = persist(store, first, message(), transactionAuthority, communicationAuthority);
    assert.equal(written.indexed, true);

    const restarted = createWhatsAppMessageKeyIndexRepository(options);
    const lookupKey = {
      accountId: 'account-1',
      remoteJid: 'A1B2C3@lid',
      id: 'platform-message-1',
      fromMe: false,
      participant: ''
    };
    const inspected = restarted.inspect(lookupKey);
    assert.ok(inspected, 'the exact alias-normalized HMAC index must survive restart');
    assert.equal(inspected.canonicalMessageId, 'canonical-message-1');
    const result = restarted.lookup(lookupKey);
    assert.deepEqual(result, { conversation: 'hello', contextInfo: { stanzaId: 'quoted-1' } });

    const indexRow = store.db.prepare('SELECT * FROM whatsapp_message_key_index').get();
    const payloadRow = store.db.prepare('SELECT * FROM whatsapp_message_retry_payloads').get();
    assert.equal(JSON.stringify(indexRow).includes('15550001111'), false);
    assert.equal(JSON.stringify(indexRow).includes('platform-message-1'), false);
    assert.equal(Buffer.from(payloadRow.ciphertext).toString('utf8').includes('hello'), false);
  });
});

test('raw payload mismatch fails closed and revoked rows never return content', () => {
  fixture(({ store, cipher, remoteJidNormalizer, transactionAuthority, communicationAuthority }) => {
    const repository = createWhatsAppMessageKeyIndexRepository({
      cipher,
      storeProvider: () => store,
      remoteJidNormalizer,
      transactionAuthority
    });
    const original = message();
    persist(store, repository, original, transactionAuthority, communicationAuthority);
    assert.throws(() => store.transaction(() => repository.upsertWithinTransaction(
      store,
      { ...original, rawMessage: { conversation: 'tampered' } },
      transactionAuthority
    )), error => error?.code === 'WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH');
    assert.deepEqual(repository.lookup({
      accountId: 'account-1', remoteJid: original.chatJid, id: original.externalMessageId, fromMe: false
    }), original.rawMessage);

    persist(store, repository, original, transactionAuthority, communicationAuthority);
    store.transaction(() => {
      store.upsertMessage({ ...original, revoked: true, type: 'revoke', messageType: 'revoke', rawMessage: null });
      repository.deleteWithinTransaction(store, original.id, transactionAuthority);
    });
    assert.equal(repository.lookup({
      accountId: 'account-1', remoteJid: original.chatJid, id: original.externalMessageId, fromMe: false
    }), undefined);
  });
});

test('production composition and canonical message transaction own the index while adapter performs exact lookup', () => {
  const adapterSource = fs.readFileSync(path.join(__dirname, '../services/whatsappAdapter.js'), 'utf8');
  const messageSource = fs.readFileSync(path.join(__dirname, '../repositories/messageRepository.js'), 'utf8');
  const compositionSource = fs.readFileSync(path.join(__dirname, '../runtime/AppRuntimeComposition.js'), 'utf8');
  const getMessageStart = adapterSource.indexOf('getMessage: async key =>');
  const getMessageEnd = adapterSource.indexOf('\n      }', getMessageStart);
  const getMessageBlock = adapterSource.slice(getMessageStart, getMessageEnd + 8);
  assert.ok(getMessageStart >= 0);
  assert.match(getMessageBlock, /getWhatsAppMessageByKey/u);
  assert.doesNotMatch(getMessageBlock, /listMessages/u);
  assert.doesNotMatch(getMessageBlock, /5000/u);
  assert.match(adapterSource, /msgRetryCounterCache/u);
  assert.match(messageSource, /communicationAuthority\.ingestMessage/u);
  assert.match(messageSource, /WHATSAPP_CANONICAL_MESSAGE_ID_MISMATCH/u);
  assert.match(messageSource, /WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH/u);
  assert.ok(
    messageSource.indexOf('ensureCanonicalCommunicationParent(message);')
      < messageSource.indexOf('store.upsertMessage(message);')
  );
  const canonicalParentPosition = messageSource.indexOf('ensureCanonicalCommunicationParent(message);');
  const r32MessagePosition = messageSource.indexOf('store.upsertMessage(message);');
  const indexPosition = messageSource.indexOf('whatsappMessageKeyIndexRepository.upsertWithinTransaction');
  assert.ok(canonicalParentPosition >= 0);
  assert.ok(canonicalParentPosition < r32MessagePosition);
  assert.ok(r32MessagePosition < indexPosition);
  assert.match(messageSource, /whatsappMessageIndexTransactionAuthority/u);
  assert.match(messageSource, /upsertWithinTransaction/u);
  assert.match(
    messageSource,
    /deleteWithinTransaction\(\s*store,\s*found\.row\.id,\s*whatsappMessageIndexTransactionAuthority\s*\)/u
  );
  assert.match(compositionSource, /configureWhatsAppMessageKeyIndex/u);
  assert.match(compositionSource, /configureRuntimeAuthorities/u);
});
