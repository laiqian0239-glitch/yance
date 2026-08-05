from pathlib import Path
import textwrap

message_path = Path('backend/repositories/messageRepository.js')
source = message_path.read_text(encoding='utf-8')

import_marker = "const { createWhatsAppMessageKeyIndexRepository } = require('./whatsappMessageKeyIndexRepository');\n"
new_import = import_marker + "const communicationAuthority = require('../services/communicationAuthority');\n"
assert source.count(import_marker) == 1
source = source.replace(import_marker, new_import, 1)

state_marker = """function getWhatsAppMessageByKey(input = {}) {
  return whatsappMessageKeyIndexRepository ? whatsappMessageKeyIndexRepository.lookup(input) : undefined;
}
"""
helper_block = state_marker + textwrap.dedent(r'''

function canonicalCommunicationContent(message = {}) {
  const type = String(message.messageType || message.type || '').trim().toLowerCase();
  if (type === 'text' || (!type && String(message.text || '').trim())) {
    return { kind: 'text', text: String(message.text || '') };
  }
  const media = message.rawMeta?.mediaEnvelope || message.mediaEnvelope || message.media || {};
  const mediaId = String(media.mediaId || media.id || message.attachmentId || '').trim();
  if (type === 'image' || type === 'video') {
    return { kind: type, mediaId, caption: String(message.text || media.caption || '') };
  }
  if (type === 'audio' || type === 'voice') {
    return { kind: 'audio', mediaId, durationMs: Number(media.durationMs || message.durationMs || 0) };
  }
  if (type === 'file' || type === 'document') {
    return { kind: 'file', mediaId, filename: String(media.filename || message.filename || '') };
  }
  if (type === 'sticker') {
    return {
      kind: 'sticker',
      mediaId,
      nativeReference: String(media.nativeReference || ''),
      animated: media.animated === true
    };
  }
  if (type === 'gif') {
    return { kind: 'gif', mediaId, nativeReference: String(media.nativeReference || '') };
  }
  return {
    kind: 'unsupported',
    platformType: type || 'unknown',
    rawSummary: String(message.text || '')
  };
}

function ensureCanonicalCommunicationParent(message = {}) {
  const canonicalMessageId = String(message.id || message.dedupeKey || '').trim();
  const platform = String(message.platform || '').trim().toLowerCase();
  if (platform !== 'whatsapp' || !canonicalMessageId) return null;
  const sourceAccountId = String(message.sourceAccountId || message.accountId || '').trim();
  const externalConversationId = String(
    message.rawMeta?.canonicalJid
      || message.rawMeta?.remoteJid
      || message.chatJid
      || message.conversationId
      || message.sessionKey
      || ''
  ).trim();
  const externalMessageId = String(
    message.externalMessageId
      || message.rawMeta?.messageId
      || canonicalMessageId
  ).trim();
  const rawMeta = message.rawMeta || {};
  const canonical = communicationAuthority.ingestMessage({
    messageId: canonicalMessageId,
    traceId: String(message.traceId || rawMeta.traceId || ''),
    platform,
    sourceAccountId,
    externalConversationId,
    externalMessageId,
    direction: String(message.direction || (message.fromMe === true ? 'outbound' : 'inbound')),
    senderExternalId: String(message.senderId || rawMeta.participant || rawMeta.remoteJid || ''),
    occurredAt: String(message.timestamp || message.sentAt || message.createdAt || new Date().toISOString()),
    rawEventRef: {
      eventId: String(rawMeta.eventId || externalMessageId),
      payloadSha256: String(rawMeta.payloadSha256 || ''),
      redactionVersion: String(rawMeta.redactionVersion || 'v1')
    },
    content: canonicalCommunicationContent(message)
  });
  if (String(canonical?.messageId || '') !== canonicalMessageId) {
    const error = new Error('Canonical communication message identity does not match the R32 message identity');
    error.code = 'WHATSAPP_CANONICAL_MESSAGE_ID_MISMATCH';
    error.reasonCode = error.code;
    error.expectedMessageId = canonicalMessageId;
    error.actualMessageId = String(canonical?.messageId || '');
    throw error;
  }
  return canonical;
}
''')
assert source.count(state_marker) == 1
source = source.replace(state_marker, helper_block, 1)

upsert_marker = """      store.upsertMessage(message);
      if (whatsappMessageKeyIndexRepository && String(message.platform || '').toLowerCase() === 'whatsapp') {
"""
upsert_replacement = """      ensureCanonicalCommunicationParent(message);
      store.upsertMessage(message);
      if (whatsappMessageKeyIndexRepository && String(message.platform || '').toLowerCase() === 'whatsapp') {
"""
assert source.count(upsert_marker) == 1
source = source.replace(upsert_marker, upsert_replacement, 1)

assert source.index('ensureCanonicalCommunicationParent(message);') < source.index('store.upsertMessage(message);')
assert "WHATSAPP_CANONICAL_MESSAGE_ID_MISMATCH" in source
message_path.write_text(source, encoding='utf-8')

get_test_path = Path('backend/tests/oss1aWhatsappGetMessage.test.js')
test_source = get_test_path.read_text(encoding='utf-8')

import_marker = "const { createWhatsAppMessageKeyIndexRepository } = require('../repositories/whatsappMessageKeyIndexRepository');\n"
new_import = import_marker + "const { CommunicationAuthority } = require('../services/communicationAuthority');\n"
assert test_source.count(import_marker) == 1
test_source = test_source.replace(import_marker, new_import, 1)

fixture_marker = """  const transactionAuthority = Symbol('test-canonical-message-transaction-authority');
  try {
"""
fixture_replacement = """  const transactionAuthority = Symbol('test-canonical-message-transaction-authority');
  const communicationAuthority = new CommunicationAuthority({
    storeProvider: () => store,
    clock: () => '2026-08-05T00:00:00.000Z'
  });
  try {
"""
assert test_source.count(fixture_marker) == 1
test_source = test_source.replace(fixture_marker, fixture_replacement, 1)
test_source = test_source.replace(
    "return callback({ store, cipher, remoteJidNormalizer, transactionAuthority });",
    "return callback({ store, cipher, remoteJidNormalizer, transactionAuthority, communicationAuthority });",
    1
)

persist_old = """function persist(store, repository, value, transactionAuthority) {
  store.upsertConversation({
    sessionKey: value.sessionKey,
    accountId: value.accountId,
    platform: 'whatsapp',
    title: 'Peer',
    updatedAt: value.timestamp
  });
  return store.transaction(() => {
    store.upsertMessage(value);
    return repository.upsertWithinTransaction(store, value, transactionAuthority);
  });
}
"""
persist_new = """function persist(store, repository, value, transactionAuthority, communicationAuthority) {
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
        payloadSha256: '',
        redactionVersion: 'v1'
      },
      content: { kind: 'text', text: value.text }
    });
    assert.equal(canonical.messageId, value.id);
    store.upsertMessage(value);
    return repository.upsertWithinTransaction(store, value, transactionAuthority);
  });
}
"""
assert test_source.count(persist_old) == 1
test_source = test_source.replace(persist_old, persist_new, 1)

# Thread the real authority through both fixtures and all persistence calls.
test_source = test_source.replace(
    "fixture(({ store, cipher, remoteJidNormalizer, transactionAuthority }) => {",
    "fixture(({ store, cipher, remoteJidNormalizer, transactionAuthority, communicationAuthority }) => {",
    2
)
test_source = test_source.replace(
    "persist(store, first, message(), transactionAuthority);",
    "persist(store, first, message(), transactionAuthority, communicationAuthority);",
    1
)
test_source = test_source.replace(
    "persist(store, repository, original, transactionAuthority);",
    "persist(store, repository, original, transactionAuthority, communicationAuthority);",
    2
)

# Pin production order and fail-closed identity behavior.
structural_marker = "  assert.match(messageSource, /store\\.upsertMessage\\(message\\);\\s*\\n\\s*if \\(whatsappMessageKeyIndexRepository/u);\n"
structural_replacement = """  assert.match(messageSource, /communicationAuthority\.ingestMessage/u);
  assert.match(messageSource, /WHATSAPP_CANONICAL_MESSAGE_ID_MISMATCH/u);
  assert.ok(
    messageSource.indexOf('ensureCanonicalCommunicationParent(message);')
      < messageSource.indexOf('store.upsertMessage(message);')
  );
  assert.match(messageSource, /store\.upsertMessage\(message\);\s*\n\s*if \(whatsappMessageKeyIndexRepository/u);
"""
assert test_source.count(structural_marker) == 1
test_source = test_source.replace(structural_marker, structural_replacement, 1)

assert test_source.count('communicationAuthority)') >= 3
assert "CommunicationAuthority" in test_source
get_test_path.write_text(test_source, encoding='utf-8')
