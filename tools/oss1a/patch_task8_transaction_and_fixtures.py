from pathlib import Path

# Bind index writes to an unforgeable authority owned by the canonical message repository.
index_path = Path('backend/repositories/whatsappMessageKeyIndexRepository.js')
index_source = index_path.read_text(encoding='utf-8')
old_guard = """function requireTransaction(store) {
  if (store?.db?.inTransaction !== true) {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_TRANSACTION_REQUIRED', 'Canonical message index writes require the canonical message transaction');
  }
}
"""
new_guard = """function requireTransaction(instance, transactionAuthority) {
  const state = stateFor(instance);
  if (transactionAuthority !== state.transactionAuthority) {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_TRANSACTION_REQUIRED', 'Canonical message index writes require the canonical message transaction authority');
  }
}
"""
assert index_source.count(old_guard) == 1
index_source = index_source.replace(old_guard, new_guard, 1)

old_constructor = """    if (typeof cipherProvider !== 'function' || typeof storeProvider !== 'function' || typeof remoteJidNormalizer !== 'function') {
      throw repositoryError('WHATSAPP_MESSAGE_KEY_REPOSITORY_CONFIGURATION_INVALID', 'Repository dependencies are invalid');
    }
    PRIVATE.set(this, Object.freeze({ cipherProvider, storeProvider, remoteJidNormalizer, clock: options.clock || (() => new Date().toISOString()) }));
"""
new_constructor = """    const transactionAuthority = options.transactionAuthority;
    if (typeof cipherProvider !== 'function'
      || typeof storeProvider !== 'function'
      || typeof remoteJidNormalizer !== 'function'
      || transactionAuthority == null) {
      throw repositoryError('WHATSAPP_MESSAGE_KEY_REPOSITORY_CONFIGURATION_INVALID', 'Repository dependencies are invalid');
    }
    PRIVATE.set(this, Object.freeze({
      cipherProvider,
      storeProvider,
      remoteJidNormalizer,
      transactionAuthority,
      clock: options.clock || (() => new Date().toISOString())
    }));
"""
assert index_source.count(old_constructor) == 1
index_source = index_source.replace(old_constructor, new_constructor, 1)
index_source = index_source.replace(
    "  upsertWithinTransaction(store, message = {}) {\n    requireTransaction(store);",
    "  upsertWithinTransaction(store, message = {}, transactionAuthority) {\n    requireTransaction(this, transactionAuthority);",
    1
)
index_source = index_source.replace(
    "  deleteWithinTransaction(store, canonicalMessageId) {\n    requireTransaction(store);",
    "  deleteWithinTransaction(store, canonicalMessageId, transactionAuthority) {\n    requireTransaction(this, transactionAuthority);",
    1
)
assert "requireTransaction(this, transactionAuthority);" in index_source
index_path.write_text(index_source, encoding='utf-8')

message_path = Path('backend/repositories/messageRepository.js')
message_source = message_path.read_text(encoding='utf-8')
old_state = """let whatsappMessageKeyIndexRepository = null;

function configureWhatsAppMessageKeyIndex(options = {}) {
  whatsappMessageKeyIndexRepository = createWhatsAppMessageKeyIndexRepository(options);
"""
new_state = """const whatsappMessageIndexTransactionAuthority = Symbol('whatsapp-message-index-transaction-authority');
let whatsappMessageKeyIndexRepository = null;

function configureWhatsAppMessageKeyIndex(options = {}) {
  whatsappMessageKeyIndexRepository = createWhatsAppMessageKeyIndexRepository({
    ...options,
    transactionAuthority: whatsappMessageIndexTransactionAuthority
  });
"""
assert message_source.count(old_state) == 1
message_source = message_source.replace(old_state, new_state, 1)
message_source = message_source.replace(
    "whatsappMessageKeyIndexRepository.upsertWithinTransaction(store, message);",
    "whatsappMessageKeyIndexRepository.upsertWithinTransaction(\n          store,\n          message,\n          whatsappMessageIndexTransactionAuthority\n        );",
    1
)
message_source = message_source.replace(
    "whatsappMessageKeyIndexRepository.deleteWithinTransaction(store, found.row.id);",
    "whatsappMessageKeyIndexRepository.deleteWithinTransaction(\n        store,\n        found.row.id,\n        whatsappMessageIndexTransactionAuthority\n      );",
    1
)
assert "whatsappMessageIndexTransactionAuthority" in message_source
message_path.write_text(message_source, encoding='utf-8')

get_test_path = Path('backend/tests/oss1aWhatsappGetMessage.test.js')
get_test = get_test_path.read_text(encoding='utf-8')
old_fixture = """  const remoteJidNormalizer = (_accountId, value) => aliases.get(String(value)) || String(value).toLowerCase();
  try {
    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    return callback({ store, cipher, remoteJidNormalizer });
"""
new_fixture = """  const remoteJidNormalizer = (_accountId, value) => aliases.get(String(value)) || String(value).toLowerCase();
  const transactionAuthority = Symbol('test-canonical-message-transaction-authority');
  try {
    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    return callback({ store, cipher, remoteJidNormalizer, transactionAuthority });
"""
assert get_test.count(old_fixture) == 1
get_test = get_test.replace(old_fixture, new_fixture, 1)
old_persist = """function persist(store, repository, value) {
  store.upsertConversation({
"""
new_persist = """function persist(store, repository, value, transactionAuthority) {
  store.upsertConversation({
"""
assert get_test.count(old_persist) == 1
get_test = get_test.replace(old_persist, new_persist, 1)
get_test = get_test.replace(
    "return repository.upsertWithinTransaction(store, value);",
    "return repository.upsertWithinTransaction(store, value, transactionAuthority);",
    1
)
get_test = get_test.replace(
    "fixture(({ store, cipher, remoteJidNormalizer }) => {\n    const options = { cipher, storeProvider: () => store, remoteJidNormalizer, clock:",
    "fixture(({ store, cipher, remoteJidNormalizer, transactionAuthority }) => {\n    const options = { cipher, storeProvider: () => store, remoteJidNormalizer, transactionAuthority, clock:",
    1
)
get_test = get_test.replace("persist(store, first, message());", "persist(store, first, message(), transactionAuthority);", 1)
get_test = get_test.replace(
    "fixture(({ store, cipher, remoteJidNormalizer }) => {\n    const repository = createWhatsAppMessageKeyIndexRepository({ cipher, storeProvider: () => store, remoteJidNormalizer });",
    "fixture(({ store, cipher, remoteJidNormalizer, transactionAuthority }) => {\n    const repository = createWhatsAppMessageKeyIndexRepository({\n      cipher,\n      storeProvider: () => store,\n      remoteJidNormalizer,\n      transactionAuthority\n    });",
    1
)
get_test = get_test.replace("persist(store, repository, original);", "persist(store, repository, original, transactionAuthority);", 2)
get_test = get_test.replace(
    "repository.deleteWithinTransaction(store, original.id);",
    "repository.deleteWithinTransaction(store, original.id, transactionAuthority);",
    1
)
# Pin the authority contract in the structural integration proof.
get_test = get_test.replace(
    "assert.match(messageSource, /upsertWithinTransaction\\(store, message\\)/u);",
    "assert.match(messageSource, /whatsappMessageIndexTransactionAuthority/u);\n  assert.match(messageSource, /upsertWithinTransaction/u);",
    1
)
assert get_test.count("transactionAuthority") >= 8
get_test_path.write_text(get_test, encoding='utf-8')

# Build valid ACTIVE auth state through the production repository instead of bypassing Schema 23.
retry_test_path = Path('backend/tests/oss1aWhatsappRetryStore.test.js')
retry_test = retry_test_path.read_text(encoding='utf-8')
import_marker = "const { createWhatsAppAuthCipher } = require('../security/whatsappAuthCipher');\n"
new_import = import_marker + "const { createWhatsAppAuthStateRepository } = require('../repositories/whatsappAuthStateRepository');\n"
assert retry_test.count(import_marker) == 1
retry_test = retry_test.replace(import_marker, new_import, 1)
old_seed = """    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
      account_key,account_id,current_epoch,state,registered,identity_jid_hmac,
      writer_generation,writer_socket_token,created_at,updated_at,logged_out_at,quarantine_reason
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'whatsapp-auth-account:account-1','account-1',1,'ACTIVE',1,'',1,'socket-1',
      new Date(now).toISOString(),new Date(now).toISOString(),'',''
    );
"""
new_seed = """    store.upsertAccount({ id: 'account-1', platform: 'whatsapp', adapterAccountId: 'device-1' });
    const authRepository = createWhatsAppAuthStateRepository({
      storeProvider: () => store,
      cipher,
      clock: () => new Date(now).toISOString()
    });
    authRepository.initializeAccount({
      accountKey: 'whatsapp-auth-account:account-1',
      accountId: 'account-1',
      currentEpoch: 1,
      writerGeneration: 1,
      socketToken: 'socket-1',
      creds: { registered: true, me: { id: '15550001111:1@s.whatsapp.net' } }
    });
"""
assert retry_test.count(old_seed) == 1
retry_test = retry_test.replace(old_seed, new_seed, 1)
assert "initializeAccount" in retry_test
retry_test_path.write_text(retry_test, encoding='utf-8')
