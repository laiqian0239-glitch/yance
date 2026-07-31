import { all, changes, first, run } from './db.js';
import { GatewayError, invariant } from './errors.js';
import { base64UrlToBytes, bytesToBase64Url, clean, requestPath, sha256Base64Url, timingSafeEqualBytes, utcNow, addSeconds, utf8 } from './utils.js';

export function canonicalRequest({ deviceId, timestamp, requestId, method, path, bodySha256, idempotencyKey = '' }) {
  return [
    'YANCE-FACEBOOK-DESKTOP-V1',
    clean(deviceId),
    clean(timestamp),
    clean(requestId),
    clean(method).toUpperCase(),
    clean(path),
    clean(bodySha256),
    clean(idempotencyKey)
  ].join('\n');
}

async function importEd25519PublicKey(spkiBase64Url) {
  try {
    return await crypto.subtle.importKey('spki', base64UrlToBytes(spkiBase64Url), { name: 'Ed25519' }, false, ['verify']);
  } catch (_) {
    throw new GatewayError('FACEBOOK_DEVICE_PUBLIC_KEY_INVALID', '设备公钥无效', 401);
  }
}

export async function signEnrollment(masterKey, value) {
  const key = await crypto.subtle.importKey('raw', utf8(masterKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(value))));
}

export async function verifyEnrollment(masterKey, value, signature) {
  const expected = base64UrlToBytes(await signEnrollment(masterKey, value));
  const supplied = base64UrlToBytes(signature);
  return timingSafeEqualBytes(expected, supplied);
}

export async function authenticateDesktop(request, env, config, bodyBytes = new Uint8Array()) {
  const deviceId = clean(request.headers.get('x-yance-device-id'));
  const timestamp = clean(request.headers.get('x-yance-timestamp'));
  const requestId = clean(request.headers.get('x-yance-request-id'));
  const suppliedBodyHash = clean(request.headers.get('x-yance-body-sha256'));
  const idempotencyKey = clean(request.headers.get('x-yance-idempotency-key'));
  const signature = clean(request.headers.get('x-yance-signature'));
  invariant(deviceId && timestamp && requestId && suppliedBodyHash && signature, 'FACEBOOK_DESKTOP_AUTH_HEADERS_MISSING', '桌面端认证信息不完整', 401);
  invariant(requestId.length <= 128 && deviceId.length <= 128 && idempotencyKey.length <= 200, 'FACEBOOK_DESKTOP_AUTH_HEADER_INVALID', '桌面端认证字段过长', 400);
  invariant(/^[A-Za-z0-9_-]{43}$/.test(suppliedBodyHash) && /^[A-Za-z0-9_-]{86}$/.test(signature), 'FACEBOOK_DESKTOP_AUTH_ENCODING_INVALID', '桌面端认证编码无效', 401);
  const timestampMs = Date.parse(timestamp);
  invariant(Number.isFinite(timestampMs) && Math.abs(Date.now() - timestampMs) <= config.requestWindowSeconds * 1000, 'FACEBOOK_DESKTOP_REQUEST_EXPIRED', '桌面端请求已过期', 401);
  const actualBodyHash = await sha256Base64Url(bodyBytes);
  let suppliedBodyHashBytes;
  try { suppliedBodyHashBytes = base64UrlToBytes(suppliedBodyHash); }
  catch (_) { throw new GatewayError('FACEBOOK_DESKTOP_AUTH_ENCODING_INVALID', '桌面端认证编码无效', 401); }
  invariant(timingSafeEqualBytes(base64UrlToBytes(actualBodyHash), suppliedBodyHashBytes), 'FACEBOOK_DESKTOP_BODY_HASH_MISMATCH', '桌面端请求正文校验失败', 401);
  const device = await first(env.DB, `SELECT * FROM facebook_desktop_devices WHERE id = ? AND status = 'active'`, [deviceId]);
  invariant(device, 'FACEBOOK_DEVICE_NOT_REGISTERED', '当前设备尚未完成 Facebook 授权', 401);
  const canonical = canonicalRequest({ deviceId, timestamp, requestId, method: request.method, path: requestPath(request), bodySha256: actualBodyHash, idempotencyKey });
  const publicKey = await importEd25519PublicKey(device.public_key_spki);
  let verified = false;
  try { verified = await crypto.subtle.verify('Ed25519', publicKey, base64UrlToBytes(signature), utf8(canonical)); }
  catch (error) {
    console.error(JSON.stringify({ level: 'error', component: 'facebook-worker', operation: 'desktopAuth.verifySignature', accountId: clean(device.account_id), conversationId: '', reasonCode: 'FACEBOOK_DESKTOP_SIGNATURE_VERIFY_FAILED', httpStatus: 401, attempt: 1, nextRetryAt: '', deviceId, requestId, error: clean(error?.message) }));
  }
  invariant(verified, 'FACEBOOK_DESKTOP_SIGNATURE_INVALID', '桌面端请求签名无效', 401);

  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const count = await first(env.DB, `SELECT COUNT(*) AS count FROM facebook_device_requests WHERE device_id = ? AND created_at >= ?`, [deviceId, minuteAgo]);
  invariant(Number(count?.count || 0) < config.rateLimitPerMinute, 'FACEBOOK_DESKTOP_RATE_LIMITED', '桌面端请求过于频繁', 429);
  try {
    const inserted = await run(env.DB, `INSERT INTO facebook_device_requests(request_id, device_id, method, path, body_sha256, idempotency_key, created_at, expires_at) VALUES(?,?,?,?,?,?,?,?)`, [
      requestId, deviceId, request.method.toUpperCase(), requestPath(request), actualBodyHash, idempotencyKey, utcNow(), addSeconds(utcNow(), 86400)
    ]);
    invariant(changes(inserted) === 1, 'FACEBOOK_DESKTOP_REPLAY_REJECTED', '重复桌面请求已拒绝', 409);
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique') || String(error?.message || '').toLowerCase().includes('constraint')) {
      throw new GatewayError('FACEBOOK_DESKTOP_REPLAY_REJECTED', '重复桌面请求已拒绝', 409);
    }
    throw error;
  }
  await run(env.DB, `UPDATE facebook_desktop_devices SET last_seen_at = ?, updated_at = ? WHERE id = ?`, [utcNow(), utcNow(), deviceId]);
  return { device, deviceId, accountId: clean(device.account_id), pageId: clean(device.page_id), requestId, idempotencyKey, bodySha256: actualBodyHash };
}
