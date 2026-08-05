from pathlib import Path

# Bind the encrypted retry payload to the immutable canonical communication digest.
index_path = Path('backend/repositories/whatsappMessageKeyIndexRepository.js')
index_source = index_path.read_text(encoding='utf-8')

helper_marker = """function publicLookupRow(row) {
  return Object.freeze({
    canonicalMessageId: String(row.canonical_message_id),
    accountId: String(row.account_id),
    fromMe: Boolean(row.from_me),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  });
}
"""
helper_replacement = helper_marker + """

function canonicalPayloadSha256(store, canonicalMessageId) {
  const row = store.db.prepare(`SELECT source_account_id,raw_event_ref_json
    FROM communication_canonical_messages WHERE message_id=?`).get(canonicalMessageId);
  if (!row) {
    throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_PARENT_MISSING', 'Canonical communication parent is missing', {
      canonicalMessageId
    });
  }
  let rawEventRef;
  try { rawEventRef = JSON.parse(String(row.raw_event_ref_json || '{}')); }
  catch (_) {
    throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_DIGEST_INVALID', 'Canonical communication payload digest is invalid', {
      canonicalMessageId
    });
  }
  const digest = String(rawEventRef?.payloadSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_DIGEST_INVALID', 'Canonical communication payload digest is missing or malformed', {
      canonicalMessageId
    });
  }
  return Object.freeze({ digest, sourceAccountId: String(row.source_account_id || '') });
}
"""
assert index_source.count(helper_marker) == 1
index_source = index_source.replace(helper_marker, helper_replacement, 1)

upsert_old = """    const key = keyFromMessage(this, message);
    const cipher = cipherFor(this);
    const rawMessageSha256 = hashRawMessage(rawMessage);
    const plaintext = encode({ rawMessage, rawMessageSha256 });
"""
upsert_new = """    const key = keyFromMessage(this, message);
    const cipher = cipherFor(this);
    const rawMessageSha256 = hashRawMessage(rawMessage);
    const canonicalDigest = canonicalPayloadSha256(store, canonicalMessageId);
    if (canonicalDigest.sourceAccountId !== accountId || canonicalDigest.digest !== rawMessageSha256) {
      throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH', 'Canonical communication digest and retry payload differ', {
        canonicalMessageId,
        accountId
      });
    }
    const plaintext = encode({ rawMessage, rawMessageSha256 });
"""
assert index_source.count(upsert_old) == 1
index_source = index_source.replace(upsert_old, upsert_new, 1)

lookup_old = """    const payloadHash = hashRawMessage(decoded.rawMessage);
    const canonicalHash = canonical.rawMessage && typeof canonical.rawMessage === 'object'
      ? hashRawMessage(canonical.rawMessage)
      : '';
    if (decoded.rawMessageSha256 !== payloadHash || !canonicalHash || canonicalHash !== payloadHash) {
      throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_HASH_MISMATCH', 'Canonical raw message and encrypted retry payload differ', {
        canonicalMessageId: String(row.canonical_message_id)
      });
    }
    return decoded.rawMessage;
"""
lookup_new = """    const payloadHash = hashRawMessage(decoded.rawMessage);
    const canonicalDigest = canonicalPayloadSha256(store, String(row.canonical_message_id));
    if (canonicalDigest.sourceAccountId !== key.accountId
      || decoded.rawMessageSha256 !== payloadHash
      || canonicalDigest.digest !== payloadHash) {
      throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_HASH_MISMATCH', 'Canonical digest and encrypted retry payload differ', {
        canonicalMessageId: String(row.canonical_message_id)
      });
    }
    return decoded.rawMessage;
"""
assert index_source.count(lookup_old) == 1
index_source = index_source.replace(lookup_old, lookup_new, 1)

assert index_source.index('canonicalPayloadSha256(store, canonicalMessageId)') < index_source.index("store.db.prepare('DELETE FROM whatsapp_message_key_index")
assert 'WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH' in index_source
index_path.write_text(index_source, encoding='utf-8')

message_path = Path('backend/repositories/messageRepository.js')
message_source = message_path.read_text(encoding='utf-8')
import_old = "const { createWhatsAppMessageKeyIndexRepository } = require('./whatsappMessageKeyIndexRepository');"
import_new = "const { createWhatsAppMessageKeyIndexRepository, hashRawMessage } = require('./whatsappMessageKeyIndexRepository');"
assert message_source.count(import_old) == 1
message_source = message_source.replace(import_old, import_new, 1)

raw_meta_old = """  const rawMeta = message.rawMeta || {};
  const canonical = communicationAuthority.ingestMessage({
"""
raw_meta_new = """  const rawMeta = message.rawMeta || {};
  const rawMessageSha256 = message.rawMessage && typeof message.rawMessage === 'object'
    ? hashRawMessage(message.rawMessage)
    : '';
  const canonical = communicationAuthority.ingestMessage({
"""
assert message_source.count(raw_meta_old) == 1
message_source = message_source.replace(raw_meta_old, raw_meta_new, 1)

payload_old = "payloadSha256: String(rawMeta.payloadSha256 || ''),"
payload_new = "payloadSha256: rawMessageSha256,"
assert message_source.count(payload_old) == 1
message_source = message_source.replace(payload_old, payload_new, 1)

identity_tail_old = """    throw error;
  }
  return canonical;
}
"""
identity_tail_new = """    throw error;
  }
  const canonicalDigest = String(canonical?.rawEventRef?.payloadSha256 || '').trim().toLowerCase();
  if (rawMessageSha256 && canonicalDigest !== rawMessageSha256) {
    const error = new Error('Canonical communication payload digest does not match the WhatsApp raw message');
    error.code = 'WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH';
    error.reasonCode = error.code;
    error.messageId = canonicalMessageId;
    throw error;
  }
  return canonical;
}
"""
assert message_source.count(identity_tail_old) == 1
message_source = message_source.replace(identity_tail_old, identity_tail_new, 1)
assert 'payloadSha256: rawMessageSha256' in message_source
assert 'WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH' in message_source
message_path.write_text(message_source, encoding='utf-8')

# Make the behavior tests create and verify the same authoritative digest.
test_path = Path('backend/tests/oss1aWhatsappGetMessage.test.js')
test_source = test_path.read_text(encoding='utf-8')
test_import_old = "const { createWhatsAppMessageKeyIndexRepository } = require('../repositories/whatsappMessageKeyIndexRepository');"
test_import_new = "const { createWhatsAppMessageKeyIndexRepository, hashRawMessage } = require('../repositories/whatsappMessageKeyIndexRepository');"
assert test_source.count(test_import_old) == 1
test_source = test_source.replace(test_import_old, test_import_new, 1)

fixture_digest_old = "payloadSha256: '',"
fixture_digest_new = "payloadSha256: hashRawMessage(value.rawMessage),"
assert test_source.count(fixture_digest_old) == 1
test_source = test_source.replace(fixture_digest_old, fixture_digest_new, 1)

lookup_old = """    const result = restarted.lookup({
      accountId: 'account-1',
      remoteJid: 'A1B2C3@lid',
      id: 'platform-message-1',
      fromMe: false,
      participant: ''
    });
    assert.deepEqual(result, { conversation: 'hello', contextInfo: { stanzaId: 'quoted-1' } });
"""
lookup_new = """    const lookupKey = {
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
"""
assert test_source.count(lookup_old) == 1
test_source = test_source.replace(lookup_old, lookup_new, 1)

mismatch_old = """    persist(store, repository, original, transactionAuthority, communicationAuthority);
    store.transaction(() => store.upsertMessage({ ...original, rawMessage: { conversation: 'tampered' } }));
    assert.throws(() => repository.lookup({
      accountId: 'account-1', remoteJid: original.chatJid, id: original.externalMessageId, fromMe: false
    }), error => error?.code === 'WHATSAPP_MESSAGE_RETRY_PAYLOAD_HASH_MISMATCH');

    persist(store, repository, original, transactionAuthority, communicationAuthority);
"""
mismatch_new = """    persist(store, repository, original, transactionAuthority, communicationAuthority);
    assert.throws(() => store.transaction(() => repository.upsertWithinTransaction(
      store,
      { ...original, rawMessage: { conversation: 'tampered' } },
      transactionAuthority
    )), error => error?.code === 'WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH');
    assert.deepEqual(repository.lookup({
      accountId: 'account-1', remoteJid: original.chatJid, id: original.externalMessageId, fromMe: false
    }), original.rawMessage);

    persist(store, repository, original, transactionAuthority, communicationAuthority);
"""
assert test_source.count(mismatch_old) == 1
test_source = test_source.replace(mismatch_old, mismatch_new, 1)

structural_old = "  assert.match(messageSource, /WHATSAPP_CANONICAL_MESSAGE_ID_MISMATCH/u);"
structural_new = structural_old + "\n  assert.match(messageSource, /WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH/u);"
assert test_source.count(structural_old) == 1
test_source = test_source.replace(structural_old, structural_new, 1)

assert 'hashRawMessage(value.rawMessage)' in test_source
assert 'the exact alias-normalized HMAC index must survive restart' in test_source
assert 'WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH' in test_source
test_path.write_text(test_source, encoding='utf-8')
