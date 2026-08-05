from pathlib import Path

retry_path = Path('backend/repositories/whatsappMessageRetryRepository.js')
retry_source = retry_path.read_text(encoding='utf-8')
old_insert = """      store.db.prepare(`INSERT INTO whatsapp_message_retry_counters(
        account_key,cache_key_hmac,value_json,expires_at,created_at,updated_at
      ) VALUES(?,?,?,?,?,?)
      ON CONFLICT(account_key,cache_key_hmac) DO UPDATE SET
        value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).run(
        state.accountKey, cacheKeyHmac, JSON.stringify(normalized), expiresAt, nowIso, nowIso
      );
"""
new_insert = """      store.db.prepare(`INSERT INTO whatsapp_message_retry_counters(
        account_key,cache_key_hmac,value_json,expires_at,updated_at
      ) VALUES(?,?,?,?,?)
      ON CONFLICT(account_key,cache_key_hmac) DO UPDATE SET
        value_json=excluded.value_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`).run(
        state.accountKey, cacheKeyHmac, JSON.stringify(normalized), expiresAt, nowIso
      );
"""
assert retry_source.count(old_insert) == 1
retry_source = retry_source.replace(old_insert, new_insert, 1)
assert 'created_at' not in retry_source
retry_path.write_text(retry_source, encoding='utf-8')

get_test_path = Path('backend/tests/oss1aWhatsappGetMessage.test.js')
test_source = get_test_path.read_text(encoding='utf-8')
old_broken = """  assert.match(messageSource, /store\.upsertMessage\(message\);\s*
\s*if \(whatsappMessageKeyIndexRepository/u);
"""
new_safe = """  const canonicalParentPosition = messageSource.indexOf('ensureCanonicalCommunicationParent(message);');
  const r32MessagePosition = messageSource.indexOf('store.upsertMessage(message);');
  const indexPosition = messageSource.indexOf('whatsappMessageKeyIndexRepository.upsertWithinTransaction');
  assert.ok(canonicalParentPosition >= 0);
  assert.ok(canonicalParentPosition < r32MessagePosition);
  assert.ok(r32MessagePosition < indexPosition);
"""
assert test_source.count(old_broken) == 1
test_source = test_source.replace(old_broken, new_safe, 1)
get_test_path.write_text(test_source, encoding='utf-8')

assert 'created_at' not in retry_source
assert "indexPosition" in test_source
