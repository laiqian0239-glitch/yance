'use strict';

const { getPrimaryStoreCapability } = require('./storeProvider');

const SCHEMA_VERSION = 23;
const ACTIVE = 'ACTIVE';
const LOGGED_OUT = 'LOGGED_OUT';
const QUARANTINED = 'QUARANTINED';
const IMPORT_PENDING = 'IMPORT_PENDING';
const PRIVATE = new WeakMap();

function repositoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppAuthStateRepositoryError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value !== value.trim() || !value) {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function nonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function exactEnvelopeBuffer(value, field) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data);
  throw repositoryError('WHATSAPP_AUTH_REPOSITORY_ENVELOPE_INVALID', 'Encrypted repository envelope is invalid', { field });
}

function normalizeForStorage(value, seen = new Set()) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw repositoryError('WHATSAPP_AUTH_REPOSITORY_VALUE_INVALID', 'Auth value contains a non-finite number');
    }
    return value;
  }
  if (typeof value === 'bigint') return { $type: 'BigInt', data: value.toString(10) };
  if (typeof value !== 'object') {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_VALUE_INVALID', 'Auth value contains an unsupported type');
  }
  if (seen.has(value)) {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_VALUE_INVALID', 'Auth value contains a cycle');
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeForStorage(item, seen));
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      output[key] = normalizeForStorage(value[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function reviveFromStorage(value) {
  if (Array.isArray(value)) return value.map(reviveFromStorage);
  if (!value || typeof value !== 'object') return value;
  if (value.$type === 'Buffer' && typeof value.data === 'string') {
    return Buffer.from(value.data, 'base64');
  }
  if (value.$type === 'BigInt' && typeof value.data === 'string') {
    return BigInt(value.data);
  }
  const output = {};
  for (const [key, candidate] of Object.entries(value)) output[key] = reviveFromStorage(candidate);
  return output;
}

function encodeValue(value) {
  return Buffer.from(JSON.stringify(normalizeForStorage(value)), 'utf8');
}

function decodeValue(buffer) {
  try {
    return reviveFromStorage(JSON.parse(Buffer.from(buffer).toString('utf8')));
  } catch (_) {
    throw repositoryError(
      'WHATSAPP_AUTH_REPOSITORY_DECODE_FAILED',
      'Encrypted WhatsApp auth value could not be decoded'
    );
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || seen.has(value)) return value;
  seen.add(value);
  for (const candidate of Object.values(value)) deepFreeze(candidate, seen);
  return Object.freeze(value);
}

function privateState(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INVALID', 'Repository private state is unavailable');
  return state;
}

function storeFor(instance) {
  const state = privateState(instance);
  const store = state.storeProvider();
  if (!store || !store.db || typeof store.transaction !== 'function') {
    throw repositoryError(
      'WHATSAPP_AUTH_REPOSITORY_STORE_UNAVAILABLE',
      'Primary Store capability is unavailable'
    );
  }
  return store;
}

function invokeFault(state, point, context = {}) {
  if (typeof state.faultInjector === 'function') state.faultInjector(point, Object.freeze({ ...context }));
}

function envelopeFromRow(row, prefix = '') {
  return {
    cipherVersion: Number(row[`${prefix}cipher_version`]),
    keyVersion: Number(row[`${prefix}key_version`]),
    nonce: exactEnvelopeBuffer(row[`${prefix}nonce`], `${prefix}nonce`),
    ciphertext: exactEnvelopeBuffer(row[`${prefix}ciphertext`], `${prefix}ciphertext`),
    authTag: exactEnvelopeBuffer(row[`${prefix}auth_tag`], `${prefix}auth_tag`),
    ciphertextSha256: String(row[`${prefix}ciphertext_sha256`] || '')
  };
}

function accountAad(row) {
  return {
    schemaVersion: SCHEMA_VERSION,
    accountKey: String(row.account_key),
    accountId: String(row.account_id),
    currentEpoch: Number(row.current_epoch)
  };
}

function keyAad(row, category, keyId) {
  return {
    ...accountAad(row),
    category,
    keyId
  };
}

function readAccountRow(db, accountKey) {
  return db.prepare(`SELECT account_key,account_id,current_epoch,state,
    creds_cipher_version,creds_key_version,creds_nonce,creds_ciphertext,
    creds_auth_tag,creds_ciphertext_sha256,registered,identity_jid_hmac,
    writer_generation,writer_socket_token,created_at,updated_at,
    logged_out_at,quarantine_reason
    FROM whatsapp_auth_accounts WHERE account_key=?`).get(accountKey) || null;
}

function writerExpectation(input) {
  return Object.freeze({
    accountKey: nonEmptyString(input?.accountKey, 'accountKey'),
    expectedEpoch: positiveInteger(input?.expectedEpoch, 'expectedEpoch'),
    expectedWriterGeneration: nonNegativeInteger(
      input?.expectedWriterGeneration,
      'expectedWriterGeneration'
    ),
    expectedSocketToken: nonEmptyString(input?.expectedSocketToken, 'expectedSocketToken')
  });
}

function assertWriterRow(db, input, options = {}) {
  const expected = writerExpectation(input);
  const row = readAccountRow(db, expected.accountKey);
  if (!row) {
    throw repositoryError('WHATSAPP_AUTH_ACCOUNT_NOT_FOUND', 'WhatsApp auth account is missing', {
      accountKey: expected.accountKey
    });
  }
  const mismatch = Number(row.current_epoch) !== expected.expectedEpoch
    || Number(row.writer_generation) !== expected.expectedWriterGeneration
    || String(row.writer_socket_token) !== expected.expectedSocketToken;
  if (mismatch) {
    throw repositoryError(
      'WHATSAPP_AUTH_GENERATION_STALE',
      'WhatsApp auth writer generation is stale',
      {
        accountKey: expected.accountKey,
        expectedEpoch: expected.expectedEpoch,
        actualEpoch: Number(row.current_epoch),
        expectedWriterGeneration: expected.expectedWriterGeneration,
        actualWriterGeneration: Number(row.writer_generation)
      }
    );
  }
  if (options.requireActive !== false && String(row.state) !== ACTIVE) {
    throw repositoryError(
      'WHATSAPP_AUTH_STATE_NOT_ACTIVE',
      'WhatsApp auth account is not active',
      { accountKey: expected.accountKey, state: String(row.state) }
    );
  }
  return row;
}

function publicWriter(row) {
  return Object.freeze({
    accountKey: String(row.account_key),
    accountId: String(row.account_id),
    currentEpoch: Number(row.current_epoch),
    state: String(row.state),
    writerGeneration: Number(row.writer_generation),
    writerSocketToken: String(row.writer_socket_token)
  });
}

function normalizeUpdates(updates) {
  if (!isPlainObject(updates)) {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', 'updates must be a plain object');
  }
  const flattened = [];
  for (const category of Object.keys(updates).sort()) {
    nonEmptyString(category, 'category');
    const categoryUpdates = updates[category];
    if (!isPlainObject(categoryUpdates)) {
      throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', 'category updates must be a plain object');
    }
    for (const keyId of Object.keys(categoryUpdates).sort()) {
      nonEmptyString(keyId, 'keyId');
      flattened.push(Object.freeze({ category, keyId, value: categoryUpdates[keyId] }));
    }
  }
  if (!flattened.length) {
    throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', 'updates must not be empty');
  }
  return flattened;
}

class WhatsAppAuthStateRepository {
  constructor(options = {}) {
    if (!options.cipher
      || typeof options.cipher.encrypt !== 'function'
      || typeof options.cipher.decrypt !== 'function'
      || typeof options.cipher.hmacIndex !== 'function') {
      throw repositoryError(
        'WHATSAPP_AUTH_REPOSITORY_CIPHER_REQUIRED',
        'WhatsAppAuthCipher capability is required'
      );
    }
    const storeProvider = options.storeProvider || getPrimaryStoreCapability;
    if (typeof storeProvider !== 'function') {
      throw repositoryError(
        'WHATSAPP_AUTH_REPOSITORY_STORE_PROVIDER_REQUIRED',
        'Primary Store provider is required'
      );
    }
    const clock = options.clock || (() => new Date().toISOString());
    if (typeof clock !== 'function') {
      throw repositoryError('WHATSAPP_AUTH_REPOSITORY_CLOCK_INVALID', 'Repository clock is invalid');
    }
    PRIVATE.set(this, Object.freeze({
      cipher: options.cipher,
      storeProvider,
      clock,
      faultInjector: options.faultInjector || null
    }));
    Object.freeze(this);
  }

  loadAccount(accountKey) {
    const state = privateState(this);
    const store = storeFor(this);
    const normalizedAccountKey = nonEmptyString(accountKey, 'accountKey');
    const row = readAccountRow(store.db, normalizedAccountKey);
    if (!row) return null;
    let creds = null;
    if (row.creds_cipher_version != null) {
      const plaintext = state.cipher.decrypt(
        'AUTH_CREDS',
        accountAad(row),
        envelopeFromRow(row, 'creds_')
      );
      try {
        creds = decodeValue(plaintext);
      } finally {
        plaintext.fill(0);
      }
    }
    return deepFreeze({
      ...publicWriter(row),
      registered: Boolean(row.registered),
      identityJidHmac: String(row.identity_jid_hmac || ''),
      loggedOutAt: String(row.logged_out_at || ''),
      quarantineReason: String(row.quarantine_reason || ''),
      creds
    });
  }

  initializeAccount(input = {}) {
    const state = privateState(this);
    const store = storeFor(this);
    const accountKey = nonEmptyString(input.accountKey, 'accountKey');
    const accountId = nonEmptyString(input.accountId, 'accountId');
    const currentEpoch = positiveInteger(input.currentEpoch ?? input.epoch, 'currentEpoch');
    const writerGeneration = nonNegativeInteger(input.writerGeneration, 'writerGeneration');
    const writerSocketToken = nonEmptyString(input.socketToken ?? input.writerSocketToken, 'socketToken');
    if (!isPlainObject(input.creds)) {
      throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', 'creds must be a plain object');
    }
    if (readAccountRow(store.db, accountKey)) {
      throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth account already exists');
    }
    const envelope = state.cipher.encrypt('AUTH_CREDS', {
      schemaVersion: SCHEMA_VERSION,
      accountKey,
      accountId,
      currentEpoch
    }, encodeValue(input.creds));
    const identity = String(input.creds?.me?.id || input.creds?.me?.lid || '');
    const identityJidHmac = identity ? state.cipher.hmacIndex('IDENTITY_JID', identity) : '';
    const at = String(state.clock());
    return store.transaction(() => {
      if (readAccountRow(store.db, accountKey)) {
        throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth account already exists');
      }
      const result = store.db.prepare(`INSERT INTO whatsapp_auth_accounts(
        account_key,account_id,current_epoch,state,creds_cipher_version,creds_key_version,
        creds_nonce,creds_ciphertext,creds_auth_tag,creds_ciphertext_sha256,registered,
        identity_jid_hmac,writer_generation,writer_socket_token,created_at,updated_at,
        logged_out_at,quarantine_reason
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        accountKey, accountId, currentEpoch, ACTIVE,
        envelope.cipherVersion, envelope.keyVersion, envelope.nonce, envelope.ciphertext,
        envelope.authTag, envelope.ciphertextSha256,
        input.creds.registered === true ? 1 : 0,
        identityJidHmac, writerGeneration, writerSocketToken, at, at, '', ''
      );
      invokeFault(state, 'after-initialize-write', { accountKey });
      return Object.freeze({ committed: true, changes: Number(result.changes), ...publicWriter(readAccountRow(store.db, accountKey)) });
    });
  }

  assertWriter(input = {}) {
    const store = storeFor(this);
    return publicWriter(assertWriterRow(store.db, input));
  }

  commitCreds(input = {}) {
    const state = privateState(this);
    const store = storeFor(this);
    const before = assertWriterRow(store.db, input);
    if (!isPlainObject(input.creds)) {
      throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', 'creds must be a plain object');
    }
    const envelope = state.cipher.encrypt(
      'AUTH_CREDS',
      accountAad(before),
      encodeValue(input.creds)
    );
    const identity = String(input.creds?.me?.id || input.creds?.me?.lid || '');
    const identityJidHmac = identity ? state.cipher.hmacIndex('IDENTITY_JID', identity) : '';
    const registered = input.creds.registered === true;
    const at = String(state.clock());
    return store.transaction(() => {
      const row = assertWriterRow(store.db, input);
      const result = store.db.prepare(`UPDATE whatsapp_auth_accounts SET
        creds_cipher_version=?,creds_key_version=?,creds_nonce=?,creds_ciphertext=?,
        creds_auth_tag=?,creds_ciphertext_sha256=?,registered=?,identity_jid_hmac=?,
        updated_at=?
        WHERE account_key=? AND current_epoch=? AND writer_generation=?
          AND writer_socket_token=? AND state='ACTIVE'`).run(
        envelope.cipherVersion, envelope.keyVersion, envelope.nonce, envelope.ciphertext,
        envelope.authTag, envelope.ciphertextSha256, registered ? 1 : 0, identityJidHmac,
        at, row.account_key, Number(row.current_epoch), Number(row.writer_generation),
        String(row.writer_socket_token)
      );
      if (Number(result.changes) !== 1) {
        throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth writer changed during creds commit');
      }
      invokeFault(state, 'after-creds-write', { accountKey: String(row.account_key) });
      return Object.freeze({ committed: true, changes: 1, ...publicWriter(readAccountRow(store.db, row.account_key)) });
    });
  }

  getKeys(accountKey, epoch, category, ids) {
    const state = privateState(this);
    const store = storeFor(this);
    const normalizedAccountKey = nonEmptyString(accountKey, 'accountKey');
    const normalizedEpoch = positiveInteger(epoch, 'epoch');
    const normalizedCategory = nonEmptyString(category, 'category');
    if (!Array.isArray(ids)) {
      throw repositoryError('WHATSAPP_AUTH_REPOSITORY_INPUT_INVALID', 'ids must be an array');
    }
    const uniqueIds = [...new Set(ids.map(id => nonEmptyString(id, 'keyId')))];
    if (!uniqueIds.length) return Object.freeze({});
    const account = readAccountRow(store.db, normalizedAccountKey);
    if (!account) throw repositoryError('WHATSAPP_AUTH_ACCOUNT_NOT_FOUND', 'WhatsApp auth account is missing');
    if (Number(account.current_epoch) !== normalizedEpoch) {
      throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth epoch is stale');
    }
    if (String(account.state) !== ACTIVE) {
      throw repositoryError('WHATSAPP_AUTH_STATE_NOT_ACTIVE', 'WhatsApp auth account is not active');
    }
    const placeholders = uniqueIds.map(() => '?').join(',');
    const rows = store.db.prepare(`SELECT category,key_id,value_present,cipher_version,key_version,
      nonce,ciphertext,auth_tag,ciphertext_sha256,epoch
      FROM whatsapp_auth_keys
      WHERE account_key=? AND epoch=? AND category=? AND value_present=1
        AND key_id IN (${placeholders})`).all(
      normalizedAccountKey, normalizedEpoch, normalizedCategory, ...uniqueIds
    );
    const output = {};
    for (const row of rows) {
      const plaintext = state.cipher.decrypt(
        'AUTH_KEY',
        keyAad(account, normalizedCategory, String(row.key_id)),
        envelopeFromRow(row)
      );
      try {
        output[String(row.key_id)] = decodeValue(plaintext);
      } finally {
        plaintext.fill(0);
      }
    }
    return deepFreeze(output);
  }

  setKeys(input = {}) {
    const state = privateState(this);
    const store = storeFor(this);
    const account = assertWriterRow(store.db, input);
    const entries = normalizeUpdates(input.updates);
    const prepared = entries.map(entry => {
      if (entry.value == null) return Object.freeze({ ...entry, envelope: null });
      const envelope = state.cipher.encrypt(
        'AUTH_KEY',
        keyAad(account, entry.category, entry.keyId),
        encodeValue(entry.value)
      );
      return Object.freeze({ ...entry, envelope });
    });
    const at = String(state.clock());
    return store.transaction(() => {
      const row = assertWriterRow(store.db, input);
      let changes = 0;
      for (let index = 0; index < prepared.length; index += 1) {
        const entry = prepared[index];
        let result;
        if (!entry.envelope) {
          result = store.db.prepare(`INSERT INTO whatsapp_auth_keys(
            account_key,category,key_id,value_present,cipher_version,key_version,nonce,
            ciphertext,auth_tag,ciphertext_sha256,epoch,updated_at
          ) VALUES(?,?,?,0,NULL,NULL,NULL,NULL,NULL,'',?,?)
          ON CONFLICT(account_key,category,key_id) DO UPDATE SET
            value_present=0,cipher_version=NULL,key_version=NULL,nonce=NULL,ciphertext=NULL,
            auth_tag=NULL,ciphertext_sha256='',epoch=excluded.epoch,updated_at=excluded.updated_at`).run(
            row.account_key, entry.category, entry.keyId, Number(row.current_epoch), at
          );
        } else {
          result = store.db.prepare(`INSERT INTO whatsapp_auth_keys(
            account_key,category,key_id,value_present,cipher_version,key_version,nonce,
            ciphertext,auth_tag,ciphertext_sha256,epoch,updated_at
          ) VALUES(?,?,?,1,?,?,?,?,?,?,?,?)
          ON CONFLICT(account_key,category,key_id) DO UPDATE SET
            value_present=1,cipher_version=excluded.cipher_version,key_version=excluded.key_version,
            nonce=excluded.nonce,ciphertext=excluded.ciphertext,auth_tag=excluded.auth_tag,
            ciphertext_sha256=excluded.ciphertext_sha256,epoch=excluded.epoch,
            updated_at=excluded.updated_at`).run(
            row.account_key, entry.category, entry.keyId,
            entry.envelope.cipherVersion, entry.envelope.keyVersion, entry.envelope.nonce,
            entry.envelope.ciphertext, entry.envelope.authTag,
            entry.envelope.ciphertextSha256, Number(row.current_epoch), at
          );
        }
        changes += Number(result.changes || 0);
        invokeFault(state, `after-key-write:${index + 1}`, {
          accountKey: String(row.account_key),
          category: entry.category,
          keyId: entry.keyId
        });
      }
      invokeFault(state, 'before-key-commit', {
        accountKey: String(row.account_key),
        changes
      });
      return Object.freeze({ committed: true, changes, ...publicWriter(row) });
    });
  }

  markLoggedOut(input = {}) {
    const state = privateState(this);
    const store = storeFor(this);
    const before = assertWriterRow(store.db, input);
    const nextEpoch = positiveInteger(input.nextEpoch, 'nextEpoch');
    if (nextEpoch !== Number(before.current_epoch) + 1) {
      throw repositoryError('WHATSAPP_AUTH_EPOCH_TRANSITION_INVALID', 'Logout epoch must advance by exactly one');
    }
    const at = nonEmptyString(input.loggedOutAt || state.clock(), 'loggedOutAt');
    return store.transaction(() => {
      const row = assertWriterRow(store.db, input);
      store.db.prepare('DELETE FROM whatsapp_auth_keys WHERE account_key=?').run(row.account_key);
      store.db.prepare('DELETE FROM whatsapp_message_retry_counters WHERE account_key=?').run(row.account_key);
      const result = store.db.prepare(`UPDATE whatsapp_auth_accounts SET
        current_epoch=?,state='LOGGED_OUT',
        creds_cipher_version=NULL,creds_key_version=NULL,creds_nonce=NULL,
        creds_ciphertext=NULL,creds_auth_tag=NULL,creds_ciphertext_sha256='',
        registered=0,identity_jid_hmac='',updated_at=?,logged_out_at=?,
        quarantine_reason=''
        WHERE account_key=? AND current_epoch=? AND writer_generation=?
          AND writer_socket_token=? AND state='ACTIVE'`).run(
        nextEpoch, at, at, row.account_key, Number(row.current_epoch),
        Number(row.writer_generation), String(row.writer_socket_token)
      );
      if (Number(result.changes) !== 1) {
        throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth writer changed during logout');
      }
      invokeFault(state, 'after-logout-write', { accountKey: String(row.account_key) });
      return publicWriter(readAccountRow(store.db, row.account_key));
    });
  }

  quarantine(input = {}) {
    const state = privateState(this);
    const store = storeFor(this);
    assertWriterRow(store.db, input);
    const reasonCode = nonEmptyString(input.reasonCode, 'reasonCode');
    const at = String(state.clock());
    return store.transaction(() => {
      const row = assertWriterRow(store.db, input);
      const result = store.db.prepare(`UPDATE whatsapp_auth_accounts SET
        state='QUARANTINED',quarantine_reason=?,updated_at=?
        WHERE account_key=? AND current_epoch=? AND writer_generation=?
          AND writer_socket_token=? AND state='ACTIVE'`).run(
        reasonCode, at, row.account_key, Number(row.current_epoch),
        Number(row.writer_generation), String(row.writer_socket_token)
      );
      if (Number(result.changes) !== 1) {
        throw repositoryError('WHATSAPP_AUTH_GENERATION_STALE', 'WhatsApp auth writer changed during quarantine');
      }
      invokeFault(state, 'after-quarantine-write', { accountKey: String(row.account_key) });
      return publicWriter(readAccountRow(store.db, row.account_key));
    });
  }

  importLegacySnapshot() {
    throw repositoryError(
      'WHATSAPP_AUTH_LEGACY_IMPORT_NOT_AUTHORIZED',
      'Legacy import requires the separately tested two-phase importer authority'
    );
  }
}

Object.freeze(WhatsAppAuthStateRepository.prototype);

function createWhatsAppAuthStateRepository(options = {}) {
  return new WhatsAppAuthStateRepository(options);
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  STATES: Object.freeze({ ACTIVE, LOGGED_OUT, QUARANTINED, IMPORT_PENDING }),
  WhatsAppAuthStateRepository,
  createWhatsAppAuthStateRepository
});
