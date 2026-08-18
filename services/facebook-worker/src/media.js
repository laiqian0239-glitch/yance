import { all, first, run } from './db.js';
import { GatewayError } from './errors.js';
import { addDays, clean, hostOnly, sha256Hex, utcNow } from './utils.js';

const ALLOWED_MEDIA_HOSTS = Object.freeze(['facebook.com', 'fbcdn.net', 'fbsbx.com']);

export function validateMetaMediaUrl(value) {
  const url = new URL(clean(value));
  const host = url.hostname.toLowerCase();
  const allowed = url.protocol === 'https:' && ALLOWED_MEDIA_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) throw new GatewayError('FACEBOOK_MEDIA_URL_BLOCKED', 'Facebook 媒体地址不在允许范围内', 400);
  return url.toString();
}

export async function fetchMetaMedia(value, fetchImpl = fetch) {
  let current = validateMetaMediaUrl(value);
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetchImpl(current, { redirect: 'manual', headers: { 'user-agent': 'Yance-FacebookWorker/1' } });
    if (response.status < 300 || response.status >= 400) return response;
    const location = clean(response.headers.get('location'));
    if (!location) throw new GatewayError('FACEBOOK_MEDIA_REDIRECT_INVALID', 'Facebook 媒体重定向无效', 502);
    current = validateMetaMediaUrl(new URL(location, current).toString());
  }
  throw new GatewayError('FACEBOOK_MEDIA_REDIRECT_LIMIT', 'Facebook 媒体重定向次数过多', 502);
}

function attachmentsOf(payload) {
  const rows = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const attachments = Array.isArray(event.message?.attachments) ? event.message.attachments : [];
      attachments.forEach((attachment, index) => rows.push({ event, attachment, index, url: clean(attachment?.payload?.url), workerMedia: attachment?.payload?.worker_media || null }));
    }
  }
  return rows;
}

function requireMediaAttemptIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.isFrozen(value)) {
    throw new GatewayError('FACEBOOK_MEDIA_PERSISTED_ATTEMPT_REQUIRED', 'Facebook 媒体物理 I/O 需要已签名的持久化 attempt identity', 409);
  }
  for (const field of ['executionId', 'attemptId', 'claimId', 'ownerId']) {
    if (!clean(value[field])) throw new GatewayError('FACEBOOK_MEDIA_PERSISTED_ATTEMPT_REQUIRED', 'Facebook 媒体 attempt identity 不完整', 409, { field });
  }
  for (const field of ['generation', 'hostGeneration', 'fencingToken']) {
    const number = Number(value[field]);
    if (!Number.isSafeInteger(number) || number < 1) throw new GatewayError('FACEBOOK_MEDIA_PERSISTED_ATTEMPT_REQUIRED', 'Facebook 媒体 fencing identity 无效', 409, { field });
  }
  return value;
}

async function persistMediaState(env, values) {
  await run(env.DB, `INSERT INTO facebook_event_media(id,event_id,attachment_index,r2_key,kind,mime_type,filename,size_bytes,sha256,status,attempt_count,next_retry_at,last_error_code,source_host,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,attachment_index) DO UPDATE SET r2_key=excluded.r2_key,kind=excluded.kind,mime_type=excluded.mime_type,filename=excluded.filename,size_bytes=excluded.size_bytes,sha256=excluded.sha256,status=excluded.status,attempt_count=excluded.attempt_count,next_retry_at=NULL,last_error_code=excluded.last_error_code,source_host=excluded.source_host,updated_at=excluded.updated_at,expires_at=excluded.expires_at`, values);
}

async function recordEventMediaReferences(env, config, eventId) {
  const event = await first(env.DB, `SELECT * FROM facebook_webhook_events WHERE id = ?`, [eventId]);
  if (!event) return { cached: 0, failed: 0, pending: 0, metadataOnly: true };
  const normalized = JSON.parse(event.normalized_payload_json || '{}');
  const raw = JSON.parse(event.raw_payload_json || event.normalized_payload_json || '{}');
  const rows = attachmentsOf(normalized);
  const sources = attachmentsOf(raw);
  if (!rows.length) {
    await run(env.DB, `UPDATE facebook_webhook_events SET media_status='none', updated_at=? WHERE id=?`, [utcNow(), eventId]);
    return { cached: 0, failed: 0, pending: 0, metadataOnly: true };
  }
  const now = utcNow();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const source = sources[index] || row;
    const sourceUrl = clean(source.url || row.url);
    const validatedUrl = sourceUrl ? validateMetaMediaUrl(sourceUrl) : '';
    const mediaId = `${eventId}:${index}`;
    const r2Key = `facebook/incoming/${event.page_id}/${eventId}/${index}`;
    const existing = await first(env.DB, `SELECT * FROM facebook_event_media WHERE event_id=? AND attachment_index=?`, [eventId, index]);
    if (!existing) {
      await persistMediaState(env, [
        mediaId, eventId, index, r2Key, clean(row.attachment.type, 'unknown'), 'application/octet-stream', clean(row.attachment.name, `facebook-${eventId}-${index}`),
        0, '', 'pending', 0, null, '', validatedUrl ? hostOnly(validatedUrl) : '', now, now, addDays(now, config.mediaRetentionDays)
      ]);
    }
    row.attachment.payload = {
      ...(row.attachment.payload || {}),
      url: '',
      worker_media: {
        event_id: eventId,
        index,
        status: existing?.status === 'ready' ? 'ready' : 'pending',
        mime_type: clean(existing?.mime_type),
        filename: clean(existing?.filename || row.attachment.name),
        size: Number(existing?.size_bytes || 0)
      }
    };
  }
  // Media references are deliverable immediately. The actual Graph/R2 transfer is
  // performed only when a signed persisted attempt requests a concrete media item.
  await run(env.DB, `UPDATE facebook_webhook_events SET normalized_payload_json=?, media_status='ready', updated_at=? WHERE id=?`, [JSON.stringify(normalized), now, eventId]);
  return { cached: 0, failed: 0, pending: rows.length, metadataOnly: true };
}

export async function cacheEventMedia(env, config, eventId, attemptIdentity = null, requestedIndex = null) {
  if (!attemptIdentity) return recordEventMediaReferences(env, config, eventId);
  requireMediaAttemptIdentity(attemptIdentity);
  await recordEventMediaReferences(env, config, eventId);
  const event = await first(env.DB, `SELECT * FROM facebook_webhook_events WHERE id = ?`, [eventId]);
  if (!event) return { cached: 0, failed: 0, pending: 0, metadataOnly: false };
  const raw = JSON.parse(event.raw_payload_json || '{}');
  const normalized = JSON.parse(event.normalized_payload_json || '{}');
  const sources = attachmentsOf(raw);
  const rows = attachmentsOf(normalized);
  const indexes = requestedIndex == null ? rows.map((_, index) => index) : [Number(requestedIndex)];
  let cached = 0;
  for (const index of indexes) {
    const row = rows[index];
    const source = sources[index] || row;
    if (!row || !source) throw new GatewayError('FACEBOOK_MEDIA_NOT_AVAILABLE', 'Facebook 媒体引用不存在', 404);
    const existing = await first(env.DB, `SELECT * FROM facebook_event_media WHERE event_id=? AND attachment_index=?`, [eventId, index]);
    if (existing?.status === 'ready') { cached += 1; continue; }
    const url = validateMetaMediaUrl(source.url);
    const createdAt = utcNow();
    const attemptCount = Number(existing?.attempt_count || 0) + 1;
    const mediaId = `${eventId}:${index}`;
    const r2Key = `facebook/incoming/${event.page_id}/${eventId}/${index}`;
    try {
      const response = await fetchMetaMedia(url);
      if (!response.ok || !response.body) throw new GatewayError('FACEBOOK_MEDIA_FETCH_FAILED', 'Facebook 媒体下载失败', 502, { status: response.status });
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > config.maxDesktopBodyBytes) throw new GatewayError('FACEBOOK_MEDIA_TOO_LARGE', 'Facebook 媒体超过大小限制', 413);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > config.maxDesktopBodyBytes) throw new GatewayError('FACEBOOK_MEDIA_TOO_LARGE', 'Facebook 媒体超过大小限制', 413);
      const mimeType = clean(response.headers.get('content-type'), 'application/octet-stream');
      await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { eventId, sourceHost: hostOnly(url), executionId: attemptIdentity.executionId, attemptId: attemptIdentity.attemptId } });
      await persistMediaState(env, [
        mediaId, eventId, index, r2Key, clean(row.attachment.type, 'unknown'), mimeType,
        clean(row.attachment.name, `facebook-${eventId}-${index}`), bytes.byteLength, await sha256Hex(bytes),
        'ready', attemptCount, null, '', hostOnly(url), existing?.created_at || createdAt, createdAt, addDays(createdAt, config.mediaRetentionDays)
      ]);
      row.attachment.payload = { ...(row.attachment.payload || {}), url: '', worker_media: { event_id: eventId, index, status: 'ready', mime_type: mimeType, filename: clean(row.attachment.name), size: bytes.byteLength } };
      cached += 1;
    } catch (error) {
      const code = clean(error?.code, 'FACEBOOK_MEDIA_FETCH_FAILED');
      await persistMediaState(env, [
        mediaId, eventId, index, r2Key, clean(row.attachment.type, 'unknown'), 'application/octet-stream', clean(row.attachment.name), 0, '',
        'failed', attemptCount, null, code, hostOnly(url), existing?.created_at || createdAt, createdAt, addDays(createdAt, config.mediaRetentionDays)
      ]);
      // No retry is scheduled here. A new durable attempt may explicitly call the
      // same endpoint again after reconciliation decides retry is safe.
      throw error;
    }
  }
  await run(env.DB, `UPDATE facebook_webhook_events SET normalized_payload_json=?, media_status='ready', updated_at=? WHERE id=?`, [JSON.stringify(normalized), utcNow(), eventId]);
  return { cached, failed: 0, pending: 0, metadataOnly: false, attemptId: attemptIdentity.attemptId };
}

export async function getMediaObject(env, eventId, index, device, attemptIdentity) {
  requireMediaAttemptIdentity(attemptIdentity);
  const row = await first(env.DB, `SELECT m.* FROM facebook_event_media m JOIN facebook_webhook_events e ON e.id=m.event_id JOIN facebook_event_deliveries d ON d.event_id=e.id WHERE m.event_id=? AND m.attachment_index=? AND d.device_id=? AND d.status IN ('leased','acked') LIMIT 1`, [eventId, Number(index), device.id]);
  if (!row || row.status !== 'ready') throw new GatewayError('FACEBOOK_MEDIA_NOT_AVAILABLE', 'Facebook 媒体暂不可用', 404);
  const object = await env.MEDIA.get(row.r2_key);
  if (!object) throw new GatewayError('FACEBOOK_MEDIA_NOT_AVAILABLE', 'Facebook 媒体已过期或不存在', 404);
  return { row, object };
}

export async function cleanupExpiredMedia(env, nowIso = utcNow(), attemptIdentity = null) {
  requireMediaAttemptIdentity(attemptIdentity);
  const rows = await all(env.DB, `SELECT id,r2_key FROM facebook_event_media WHERE expires_at <= ? LIMIT 500`, [nowIso]);
  for (const row of rows) {
    await env.MEDIA.delete(row.r2_key);
    await run(env.DB, `DELETE FROM facebook_event_media WHERE id=?`, [row.id]);
  }
  return { deleted: rows.length, attemptId: attemptIdentity.attemptId };
}
