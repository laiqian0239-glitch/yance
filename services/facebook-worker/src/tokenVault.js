import { GatewayError } from './errors.js';
import { base64ToBytes, bytesToBase64, clean, utf8, decodeUtf8 } from './utils.js';

function decodeKey(value) {
  const raw = clean(value);
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    const bytes = new Uint8Array(32);
    for (let index = 0; index < 32; index += 1) bytes[index] = Number.parseInt(raw.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  try {
    const bytes = base64ToBytes(raw);
    if (bytes.length === 32) return bytes;
  } catch (_) {}
  throw new GatewayError('FACEBOOK_TOKEN_KEY_INVALID', 'Token 加密密钥必须是 32 字节', 503);
}

export function parseKeyRing(secretValue) {
  const raw = clean(secretValue);
  try {
    const document = JSON.parse(raw);
    if (document && typeof document === 'object' && typeof document.active === 'string' && document.keys && typeof document.keys === 'object') {
      const keys = new Map();
      for (const [keyId, value] of Object.entries(document.keys)) keys.set(keyId, decodeKey(value));
      if (!keys.has(document.active)) throw new GatewayError('FACEBOOK_TOKEN_ACTIVE_KEY_MISSING', 'Token 活动密钥不存在', 503);
      return { active: document.active, keys };
    }
  } catch (error) {
    if (error instanceof GatewayError) throw error;
  }
  return { active: 'k1', keys: new Map([['k1', decodeKey(raw)]]) };
}

async function importAesKey(bytes, usages) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usages);
}

export async function encryptToken(token, pageId, secretValue, now = new Date().toISOString()) {
  const ring = parseKeyRing(secretValue);
  const key = await importAesKey(ring.keys.get(ring.active), ['encrypt']);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const associatedData = utf8(`yance-facebook-page-token:${clean(pageId)}:v1`);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: associatedData, tagLength: 128 }, key, utf8(token)));
  const ciphertext = encrypted.slice(0, -16);
  const authTag = encrypted.slice(-16);
  return {
    version: 1,
    key_id: ring.active,
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    auth_tag: bytesToBase64(authTag),
    created_at: now,
    updated_at: now,
    page_id: clean(pageId),
    token_status: 'active'
  };
}

export async function decryptToken(record, secretValue) {
  const ring = parseKeyRing(secretValue);
  const keyBytes = ring.keys.get(clean(record?.key_id));
  if (!keyBytes) throw new GatewayError('FACEBOOK_TOKEN_KEY_UNAVAILABLE', 'Page Token 所需密钥不可用', 503, { keyId: clean(record?.key_id) });
  const key = await importAesKey(keyBytes, ['decrypt']);
  const ciphertext = base64ToBytes(record.ciphertext);
  const tag = base64ToBytes(record.auth_tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext); combined.set(tag, ciphertext.length);
  const associatedData = utf8(`yance-facebook-page-token:${clean(record.page_id)}:v1`);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(record.iv), additionalData: associatedData, tagLength: 128 }, key, combined);
    return decodeUtf8(new Uint8Array(plaintext));
  } catch (_) {
    throw new GatewayError('FACEBOOK_TOKEN_DECRYPT_FAILED', 'Page Token 解密或完整性校验失败', 503);
  }
}
