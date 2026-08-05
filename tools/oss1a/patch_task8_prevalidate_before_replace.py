from pathlib import Path

path = Path('backend/repositories/whatsappMessageKeyIndexRepository.js')
source = path.read_text(encoding='utf-8')

delete_block = """    store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(canonicalMessageId);
    store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(canonicalMessageId);
    if (revoked || !rawMessage || typeof rawMessage !== 'object') {
      return Object.freeze({ indexed: false, canonicalMessageId, reasonCode: revoked ? 'WHATSAPP_MESSAGE_REVOKED' : 'WHATSAPP_RAW_MESSAGE_ABSENT' });
    }

"""
revoked_block = """    if (revoked || !rawMessage || typeof rawMessage !== 'object') {
      store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(canonicalMessageId);
      store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(canonicalMessageId);
      return Object.freeze({ indexed: false, canonicalMessageId, reasonCode: revoked ? 'WHATSAPP_MESSAGE_REVOKED' : 'WHATSAPP_RAW_MESSAGE_ABSENT' });
    }

"""
assert source.count(delete_block) == 1
source = source.replace(delete_block, revoked_block, 1)

validation_tail = """    if (canonicalDigest.sourceAccountId !== accountId || canonicalDigest.digest !== rawMessageSha256) {
      throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH', 'Canonical communication digest and retry payload differ', {
        canonicalMessageId,
        accountId
      });
    }
    const plaintext = encode({ rawMessage, rawMessageSha256 });
"""
validated_replace = """    if (canonicalDigest.sourceAccountId !== accountId || canonicalDigest.digest !== rawMessageSha256) {
      throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH', 'Canonical communication digest and retry payload differ', {
        canonicalMessageId,
        accountId
      });
    }
    store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(canonicalMessageId);
    store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(canonicalMessageId);
    const plaintext = encode({ rawMessage, rawMessageSha256 });
"""
assert source.count(validation_tail) == 1
source = source.replace(validation_tail, validated_replace, 1)

method_start = source.index('  upsertWithinTransaction(')
method_end = source.index('\n  deleteWithinTransaction(', method_start)
method = source[method_start:method_end]
index_delete = "store.db.prepare('DELETE FROM whatsapp_message_key_index"
payload_delete = "store.db.prepare('DELETE FROM whatsapp_message_retry_payloads"
validate_position = method.index('canonicalPayloadSha256(store, canonicalMessageId)')
revoked_index_delete_position = method.index(index_delete)
replacement_index_delete_position = method.rindex(index_delete)
replacement_payload_delete_position = method.rindex(payload_delete)
assert revoked_index_delete_position < validate_position
assert validate_position < replacement_index_delete_position
assert validate_position < replacement_payload_delete_position
assert method.count('DELETE FROM whatsapp_message_key_index') == 2
assert method.count('DELETE FROM whatsapp_message_retry_payloads') == 2
path.write_text(source, encoding='utf-8')
