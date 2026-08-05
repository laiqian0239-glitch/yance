'use strict';

const crypto = require('node:crypto');
const { getPrimaryStoreCapability } = require('./storeProvider');
const whatsappIdentityAuthority = require('../services/whatsappIdentityAuthority');

const SCHEMA_VERSION = 23;
const PRIVATE = new WeakMap();

function repositoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppMessageKeyIndexRepositoryError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function nonEmptyString(value, field) {
  const text = String(value == null ? '' : value).trim();
  if (!text) throw repositoryError('WHATSAPP_MESSAGE_KEY_INPUT_INVALID', `${field} is invalid`, { field });
  return text;
}

function normalizeForStorage(value, seen = new Set()) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { $type: 'Buffer', data: Buffer.from(value).toString('base64') };
  }
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_INVALID', 'Raw message contains a non-finite number');
    return value;
  }
  if (typeof value === 'bigint') return { $type: 'BigInt', data: value.toString(10) };
  if (typeof value !== 'object') throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_INVALID', 'Raw message contains an unsupported value');
  if (seen.has(value)) throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_INVALID', 'Raw message contains a cycle');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => normalizeForStorage(item, seen));
    const output = Object.create(null);
    for (const key of Object.keys(value).sort()) output[key] = normalizeForStorage(value[key], seen);
    return output;
  } finally {
    seen.delete(value);
  }
}

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (!value || typeof value !== 'object') return value;
  if (value.$type === 'Buffer' && typeof value.data === 'string') return Buffer.from(value.data, 'base64');
  if (value.$type === 'BigInt' && typeof value.data === 'string') return BigInt(value.data);
  const output = {};
  for (const [key, candidate] of Object.entries(value)) output[key] = revive(candidate);
  return output;
}

function encode(value) {
  return Buffer.from(JSON.stringify(normalizeForStorage(value)), 'utf8');
}

function decode(buffer) {
  try { return revive(JSON.parse(Buffer.from(buffer).toString('utf8'))); }
  catch (_) { throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_DECODE_FAILED', 'Encrypted raw message payload could not be decoded'); }
}

function hashRawMessage(value) {
  return crypto.createHash('sha256').update(encode(value)).digest('hex');
}

function defaultRemoteJidNormalizer(accountId, value) {
  const raw = nonEmptyString(value, 'remoteJid').toLowerCase();
  try {
    const resolved = whatsappIdentityAuthority.resolve(accountId, [raw]);
    const canonical = String(resolved?.canonicalJid || '').trim().toLowerCase();
    if (canonical) return canonical;
  } catch (_) {}
  const [local, domain = ''] = raw.split('@');
  return `${local.replace(/:\d+$/u, '')}@${domain}`;
}

function stateFor(instance) {
  const state = PRIVATE.get(instance);
  if (!state) throw repositoryError('WHATSAPP_MESSAGE_KEY_REPOSITORY_INVALID', 'Repository private state is unavailable');
  return state;
}

function storeFor(instance) {
  const state = stateFor(instance);
  const store = state.storeProvider();
  if (!store?.db || typeof store.transaction !== 'function') {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_STORE_UNAVAILABLE', 'Primary Store capability is unavailable');
  }
  return store;
}

function cipherFor(instance) {
  const cipher = stateFor(instance).cipherProvider();
  if (!cipher || typeof cipher.encrypt !== 'function' || typeof cipher.decrypt !== 'function' || typeof cipher.hmacIndex !== 'function') {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_CIPHER_UNAVAILABLE', 'WhatsApp auth cipher capability is unavailable');
  }
  return cipher;
}

function requireTransaction(instance, transactionAuthority) {
  const state = stateFor(instance);
  if (transactionAuthority !== state.transactionAuthority) {
    throw repositoryError('WHATSAPP_MESSAGE_KEY_TRANSACTION_REQUIRED', 'Canonical message index writes require the canonical message transaction authority');
  }
}

function keyInput(instance, input = {}) {
  const state = stateFor(instance);
  const accountId = nonEmptyString(input.accountId, 'accountId');
  const remoteJid = state.remoteJidNormalizer(accountId, input.remoteJid);
  const messageId = nonEmptyString(input.id ?? input.messageId, 'messageId');
  const participant = String(input.participant || '').trim();
  const canonicalParticipant = participant ? state.remoteJidNormalizer(accountId, participant) : '';
  return Object.freeze({
    accountId,
    remoteJid,
    messageId,
    participant: canonicalParticipant,
    fromMe: input.fromMe === true
  });
}

function keyFromMessage(instance, message = {}) {
  const rawMeta = message.rawMeta || message.raw || {};
  return keyInput(instance, {
    accountId: message.sourceAccountId || message.accountId,
    remoteJid: rawMeta.canonicalJid || rawMeta.remoteJid || message.chatJid,
    id: message.externalMessageId || rawMeta.messageId || message.id,
    participant: rawMeta.participant || message.participant || '',
    fromMe: message.fromMe === true || message.direction === 'outbound'
  });
}

function publicLookupRow(row) {
  return Object.freeze({
    canonicalMessageId: String(row.canonical_message_id),
    accountId: String(row.account_id),
    fromMe: Boolean(row.from_me),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  });
}


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

class WhatsAppMessageKeyIndexRepository {
  constructor(options = {}) {
    const cipherProvider = options.cipherProvider || (() => options.cipher);
    const storeProvider = options.storeProvider || getPrimaryStoreCapability;
    const remoteJidNormalizer = options.remoteJidNormalizer || defaultRemoteJidNormalizer;
    const transactionAuthority = options.transactionAuthority;
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
    Object.freeze(this);
  }

  upsertWithinTransaction(store, message = {}, transactionAuthority) {
    requireTransaction(this, transactionAuthority);
    const canonicalMessageId = nonEmptyString(message.id || message.dedupeKey, 'canonicalMessageId');
    const accountId = nonEmptyString(message.sourceAccountId || message.accountId, 'accountId');
    const revoked = message.revoked === true || String(message.type || message.messageType || '').toLowerCase() === 'revoke';
    const rawMessage = message.rawMessage;
    if (revoked || !rawMessage || typeof rawMessage !== 'object') {
      store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(canonicalMessageId);
      store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(canonicalMessageId);
      return Object.freeze({ indexed: false, canonicalMessageId, reasonCode: revoked ? 'WHATSAPP_MESSAGE_REVOKED' : 'WHATSAPP_RAW_MESSAGE_ABSENT' });
    }

    const key = keyFromMessage(this, message);
    const cipher = cipherFor(this);
    const rawMessageSha256 = hashRawMessage(rawMessage);
    const canonicalDigest = canonicalPayloadSha256(store, canonicalMessageId);
    if (canonicalDigest.sourceAccountId !== accountId || canonicalDigest.digest !== rawMessageSha256) {
      throw repositoryError('WHATSAPP_CANONICAL_MESSAGE_DIGEST_MISMATCH', 'Canonical communication digest and retry payload differ', {
        canonicalMessageId,
        accountId
      });
    }
    store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(canonicalMessageId);
    store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(canonicalMessageId);
    const plaintext = encode({ rawMessage, rawMessageSha256 });
    let envelope;
    try {
      envelope = cipher.encrypt('RETRY_PAYLOAD', {
        schemaVersion: SCHEMA_VERSION,
        accountId,
        canonicalMessageId
      }, plaintext);
    } finally {
      plaintext.fill(0);
    }
    const state = stateFor(this);
    const at = String(state.clock());
    store.db.prepare(`INSERT INTO whatsapp_message_retry_payloads(
      canonical_message_id,account_id,cipher_version,key_version,nonce,ciphertext,
      auth_tag,ciphertext_sha256,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      canonicalMessageId, accountId, envelope.cipherVersion, envelope.keyVersion,
      envelope.nonce, envelope.ciphertext, envelope.authTag, envelope.ciphertextSha256,
      at, at
    );
    store.db.prepare(`INSERT INTO whatsapp_message_key_index(
      account_id,remote_jid_hmac,message_id_hmac,from_me,participant_hmac,
      canonical_message_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`).run(
      accountId,
      cipher.hmacIndex('REMOTE_JID', key.remoteJid),
      cipher.hmacIndex('MESSAGE_ID', key.messageId),
      key.fromMe ? 1 : 0,
      key.participant ? cipher.hmacIndex('PARTICIPANT', key.participant) : '',
      canonicalMessageId,
      at,
      at
    );
    return Object.freeze({ indexed: true, canonicalMessageId, rawMessageSha256, key: Object.freeze({ ...key }) });
  }

  deleteWithinTransaction(store, canonicalMessageId, transactionAuthority) {
    requireTransaction(this, transactionAuthority);
    const id = nonEmptyString(canonicalMessageId, 'canonicalMessageId');
    const index = store.db.prepare('DELETE FROM whatsapp_message_key_index WHERE canonical_message_id=?').run(id);
    const payload = store.db.prepare('DELETE FROM whatsapp_message_retry_payloads WHERE canonical_message_id=?').run(id);
    return Object.freeze({ deleted: Number(index.changes) + Number(payload.changes), canonicalMessageId: id });
  }

  lookup(input = {}) {
    const store = storeFor(this);
    const cipher = cipherFor(this);
    const key = keyInput(this, input);
    const row = store.db.prepare(`SELECT account_id,canonical_message_id,from_me,created_at,updated_at
      FROM whatsapp_message_key_index
      WHERE account_id=? AND remote_jid_hmac=? AND message_id_hmac=?
        AND from_me=? AND participant_hmac=?`).get(
      key.accountId,
      cipher.hmacIndex('REMOTE_JID', key.remoteJid),
      cipher.hmacIndex('MESSAGE_ID', key.messageId),
      key.fromMe ? 1 : 0,
      key.participant ? cipher.hmacIndex('PARTICIPANT', key.participant) : ''
    );
    if (!row) return undefined;
    const canonical = store.getMessage(String(row.canonical_message_id));
    if (!canonical) return undefined;
    if (canonical.revoked === true || String(canonical.type || canonical.messageType || '').toLowerCase() === 'revoke') return undefined;
    const payload = store.db.prepare(`SELECT canonical_message_id,account_id,cipher_version,key_version,
      nonce,ciphertext,auth_tag,ciphertext_sha256 FROM whatsapp_message_retry_payloads
      WHERE canonical_message_id=?`).get(String(row.canonical_message_id));
    if (!payload) return undefined;
    const plaintext = cipher.decrypt('RETRY_PAYLOAD', {
      schemaVersion: SCHEMA_VERSION,
      accountId: String(payload.account_id),
      canonicalMessageId: String(payload.canonical_message_id)
    }, {
      cipherVersion: Number(payload.cipher_version),
      keyVersion: Number(payload.key_version),
      nonce: payload.nonce,
      ciphertext: payload.ciphertext,
      authTag: payload.auth_tag,
      ciphertextSha256: String(payload.ciphertext_sha256)
    });
    let decoded;
    try { decoded = decode(plaintext); }
    finally { plaintext.fill(0); }
    const payloadHash = hashRawMessage(decoded.rawMessage);
    const canonicalDigest = canonicalPayloadSha256(store, String(row.canonical_message_id));
    if (canonicalDigest.sourceAccountId !== key.accountId
      || decoded.rawMessageSha256 !== payloadHash
      || canonicalDigest.digest !== payloadHash) {
      throw repositoryError('WHATSAPP_MESSAGE_RETRY_PAYLOAD_HASH_MISMATCH', 'Canonical digest and encrypted retry payload differ', {
        canonicalMessageId: String(row.canonical_message_id)
      });
    }
    return decoded.rawMessage;
  }

  inspect(input = {}) {
    const store = storeFor(this);
    const key = keyInput(this, input);
    const cipher = cipherFor(this);
    const row = store.db.prepare(`SELECT account_id,canonical_message_id,from_me,created_at,updated_at
      FROM whatsapp_message_key_index WHERE account_id=? AND remote_jid_hmac=?
      AND message_id_hmac=? AND from_me=? AND participant_hmac=?`).get(
      key.accountId,
      cipher.hmacIndex('REMOTE_JID', key.remoteJid),
      cipher.hmacIndex('MESSAGE_ID', key.messageId),
      key.fromMe ? 1 : 0,
      key.participant ? cipher.hmacIndex('PARTICIPANT', key.participant) : ''
    );
    return row ? publicLookupRow(row) : null;
  }
}

Object.freeze(WhatsAppMessageKeyIndexRepository.prototype);

function createWhatsAppMessageKeyIndexRepository(options = {}) {
  return new WhatsAppMessageKeyIndexRepository(options);
}

module.exports = Object.freeze({
  SCHEMA_VERSION,
  WhatsAppMessageKeyIndexRepository,
  createWhatsAppMessageKeyIndexRepository,
  defaultRemoteJidNormalizer,
  hashRawMessage
});
