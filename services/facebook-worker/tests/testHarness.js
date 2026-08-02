import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalRequest } from '../src/desktopAuth.js';
import { bytesToBase64Url, sha256Base64Url, utf8 } from '../src/utils.js';
import { encryptToken } from '../src/tokenVault.js';

class D1Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new D1Statement(this.database, this.sql, values); }
  async run() {
    const statement = this.database.prepare(this.sql);
    const result = statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
  async first() {
    const statement = this.database.prepare(this.sql);
    return statement.get(...this.values) || null;
  }
  async all() {
    const statement = this.database.prepare(this.sql);
    return { success: true, results: statement.all(...this.values) };
  }
}

export class TestD1 {
  constructor() { this.database = new DatabaseSync(':memory:'); }
  prepare(sql) { return new D1Statement(this.database, sql); }
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
  exec(sql) { this.database.exec(sql); }
  close() { this.database.close(); }
}

class TestR2Object {
  constructor(bytes, options = {}) {
    this.bytes = bytes;
    this.body = new ReadableStream({ start: controller => { controller.enqueue(bytes); controller.close(); } });
    this.httpMetadata = options.httpMetadata || {};
    this.customMetadata = options.customMetadata || {};
  }
  async arrayBuffer() { return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength); }
  writeHttpMetadata(headers) { if (this.httpMetadata.contentType) headers.set('content-type', this.httpMetadata.contentType); }
}

export class TestR2 {
  constructor() { this.rows = new Map(); }
  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    this.rows.set(key, { bytes, options });
  }
  async get(key) { const row = this.rows.get(key); return row ? new TestR2Object(row.bytes, row.options) : null; }
  async delete(key) { this.rows.delete(key); }
}

export function applyMigrations(db) {
  const directory = path.resolve(import.meta.dirname, '..', 'migrations');
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    try { db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); }
    catch (error) {
      if (!/duplicate column name:\s*(page_picture_url|granted_scopes|missing_permissions|history_sync_available|history_sync_reason|last_permission_check_at|permission_source|permission_checked_at|flow_mode|identity_json)/iu.test(String(error?.message || error))) throw error;
    }
  }
}

export function testEnv(overrides = {}) {
  const DB = overrides.DB || new TestD1();
  applyMigrations(DB);
  return {
    DB,
    MEDIA: overrides.MEDIA || new TestR2(),
    META_APP_ID: '123456789012345',
    META_APP_SECRET: 'test-meta-app-secret-0123456789',
    META_VERIFY_TOKEN: 'test-verify-token-01234567890123456789',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DESKTOP_AUTH_MASTER_KEY: 'test-desktop-master-key-01234567890123456789',
    FACEBOOK_GRAPH_VERSION: 'v25.0',
    META_BUSINESS_LOGIN_CONFIG_ID: '4234889550142986',
    WORKER_BASE_URL: 'https://yance-facebook-gateway.example.workers.dev',
    OAUTH_STATE_TTL_SECONDS: '600',
    DESKTOP_REQUEST_WINDOW_SECONDS: '300',
    DESKTOP_RATE_LIMIT_PER_MINUTE: '120',
    EVENT_RETENTION_DAYS: '7',
    MEDIA_RETENTION_DAYS: '14',
    ...overrides
  };
}

export async function deviceKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeySpki: bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)))
  };
}

export async function signedRequest(url, { method = 'GET', body = null, deviceId, privateKey, requestId = crypto.randomUUID(), timestamp = new Date().toISOString(), idempotencyKey = '' } = {}) {
  const bodyText = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const bodyBytes = utf8(bodyText);
  const bodySha256 = await sha256Base64Url(bodyBytes);
  const pathValue = `${new URL(url).pathname}${new URL(url).search}`;
  const canonical = canonicalRequest({ deviceId, timestamp, requestId, method, path: pathValue, bodySha256, idempotencyKey });
  const signature = bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, utf8(canonical))));
  const headers = {
    'x-yance-device-id': deviceId,
    'x-yance-timestamp': timestamp,
    'x-yance-request-id': requestId,
    'x-yance-body-sha256': bodySha256,
    'x-yance-signature': signature
  };
  if (idempotencyKey) headers['x-yance-idempotency-key'] = idempotencyKey;
  if (body != null) headers['content-type'] = 'application/json';
  return { request: new Request(url, { method, headers, body: body == null ? undefined : bodyText }), bodyBytes };
}

export async function seedAccountDevice(env, { accountId = 'fbacct_test', pageId = 'page-100', deviceId = 'device-100', pageToken = 'page-token-secret', pagePicture = 'https://scontent.fbcdn.net/page-avatar.jpg', publicKeySpki, registrationProof = 'proof' } = {}) {
  const now = new Date().toISOString();
  const encrypted = await encryptToken(pageToken, pageId, env.TOKEN_ENCRYPTION_KEY, now);
  env.DB.database.prepare(`INSERT INTO facebook_accounts(id,page_id,page_name,page_username,page_picture_url,graph_version,permission_status,permissions_json,webhook_status,token_status,created_at,updated_at) VALUES(?,?,?,?,?,?,'ready',?,'subscribed','active',?,?)`).run(accountId, pageId, 'Test Page', 'testpage', pagePicture, 'v25.0', JSON.stringify(['pages_show_list','pages_messaging','pages_manage_metadata','pages_read_engagement']), now, now);
  env.DB.database.prepare(`INSERT INTO facebook_page_tokens(account_id,page_id,version,key_id,ciphertext,iv,auth_tag,token_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)`).run(accountId, pageId, encrypted.version, encrypted.key_id, encrypted.ciphertext, encrypted.iv, encrypted.auth_tag, now, now);
  env.DB.database.prepare(`INSERT INTO facebook_desktop_devices(id,account_id,page_id,public_key_spki,status,display_name,registration_proof,created_at,updated_at) VALUES(?,?,?,?,'active','Test Device',?,?,?)`).run(deviceId, accountId, pageId, publicKeySpki, registrationProof, now, now);
  return { accountId, pageId, deviceId, pageToken };
}

export function waitContext() {
  const promises = [];
  return { promises, waitUntil(promise) { promises.push(Promise.resolve(promise)); } };
}
