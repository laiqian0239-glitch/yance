import { all, first, run } from './db.js';
import { GatewayError } from './errors.js';
import { addDays, addSeconds, clean, hostOnly, sha256Hex, utcNow } from './utils.js';

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
      attachments.forEach((attachment, index) => {
        const url = clean(attachment?.payload?.url);
        const workerMedia = attachment?.payload?.worker_media || null;
        if (url || workerMedia) rows.push({ event, attachment, index, url, workerMedia });
      });
    }
  }
  return rows;
}

function terminalMediaError(error) {
  const code = clean(error?.code);
  if (['FACEBOOK_MEDIA_URL_BLOCKED', 'FACEBOOK_MEDIA_TOO_LARGE'].includes(code)) return true;
  const sourceStatus = Number(error?.details?.status || 0);
  return sourceStatus >= 400 && sourceStatus < 500 && ![408, 429].includes(sourceStatus);
}

function retryAt(now, config, attemptCount) {
  const delay = Math.min(3600, config.mediaRetryBaseSeconds * (2 ** Math.max(0, attemptCount - 1)));
  return addSeconds(now, delay);
}

async function persistMediaState(env, values) {
  await run(env.DB, `INSERT INTO facebook_event_media(id,event_id,attachment_index,r2_key,kind,mime_type,filename,size_bytes,sha256,status,attempt_count,next_retry_at,last_error_code,source_host,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,attachment_index) DO UPDATE SET r2_key=excluded.r2_key,kind=excluded.kind,mime_type=excluded.mime_type,filename=excluded.filename,size_bytes=excluded.size_bytes,sha256=excluded.sha256,status=excluded.status,attempt_count=excluded.attempt_count,next_retry_at=excluded.next_retry_at,last_error_code=excluded.last_error_code,source_host=excluded.source_host,updated_at=excluded.updated_at,expires_at=excluded.expires_at`, values);
}

export async function cacheEventMedia(env, config, eventId) {
  const event = await first(env.DB, `SELECT * FROM facebook_webhook_events WHERE id = ?`, [eventId]);
  if (!event) return { cached: 0, failed: 0, pending: 0 };
  const payload = JSON.parse(event.normalized_payload_json || '{}');
  const attachments = attachmentsOf(payload);
  if (!attachments.length) {
    await run(env.DB, `UPDATE facebook_webhook_events SET media_status='none', updated_at=? WHERE id=?`, [utcNow(), eventId]);
    return { cached: 0, failed: 0, pending: 0 };
  }
  let cached = 0; let failed = 0; let pending = 0;
  for (let index = 0; index < attachments.length; index += 1) {
    const row = attachments[index];
    const mediaId = `${eventId}:${index}`;
    const r2Key = `facebook/incoming/${event.page_id}/${eventId}/${index}`;
    const existing = await first(env.DB, `SELECT * FROM facebook_event_media WHERE event_id=? AND attachment_index=?`, [eventId, index]);
    if (existing?.status === 'ready') {
      row.attachment.payload = { ...(row.attachment.payload || {}), url: '', worker_media: { event_id: eventId, index, mime_type: existing.mime_type, filename: existing.filename, size: Number(existing.size_bytes || 0) } };
      cached += 1;
      continue;
    }
    if (existing?.status === 'failed') {
      row.attachment.payload = { ...(row.attachment.payload || {}), url: '', worker_media: { event_id: eventId, index, status: 'failed', code: clean(existing.last_error_code) } };
      failed += 1;
      continue;
    }
    const createdAt = utcNow();
    if (existing?.next_retry_at && Date.parse(existing.next_retry_at) > Date.now()) {
      pending += 1;
      continue;
    }
    const attemptCount = Number(existing?.attempt_count || 0) + 1;
    try {
      const url = validateMetaMediaUrl(row.url);
      const response = await fetchMetaMedia(url);
      if (!response.ok || !response.body) throw new GatewayError('FACEBOOK_MEDIA_FETCH_FAILED', 'Facebook 媒体下载失败', 502, { status: response.status });
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > config.maxDesktopBodyBytes) throw new GatewayError('FACEBOOK_MEDIA_TOO_LARGE', 'Facebook 媒体超过大小限制', 413);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > config.maxDesktopBodyBytes) throw new GatewayError('FACEBOOK_MEDIA_TOO_LARGE', 'Facebook 媒体超过大小限制', 413);
      const mimeType = clean(response.headers.get('content-type'), 'application/octet-stream');
      await env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType: mimeType }, customMetadata: { eventId, sourceHost: hostOnly(url) } });
      await persistMediaState(env, [
        mediaId, eventId, index, r2Key, clean(row.attachment.type, 'unknown'), mimeType,
        clean(row.attachment.name, `facebook-${eventId}-${index}`), bytes.byteLength, await sha256Hex(bytes),
        'ready', attemptCount, null, '', hostOnly(url), existing?.created_at || createdAt, createdAt, addDays(createdAt, config.mediaRetentionDays)
      ]);
      row.attachment.payload = { ...(row.attachment.payload || {}), url: '', worker_media: { event_id: eventId, index, mime_type: mimeType, filename: clean(row.attachment.name), size: bytes.byteLength } };
      cached += 1;
    } catch (error) {
      const code = clean(error?.code, 'FACEBOOK_MEDIA_FETCH_FAILED');
      const terminal = terminalMediaError(error) || attemptCount >= config.mediaRetryMaxAttempts;
      await persistMediaState(env, [
        mediaId, eventId, index, r2Key, clean(row.attachment.type, 'unknown'), 'application/octet-stream', clean(row.attachment.name), 0, '',
        terminal ? 'failed' : 'retrying', attemptCount, terminal ? null : retryAt(createdAt, config, attemptCount), code,
        hostOnly(row.url), existing?.created_at || createdAt, createdAt, addDays(createdAt, config.mediaRetentionDays)
      ]);
      if (terminal) {
        row.attachment.payload = { ...(row.attachment.payload || {}), url: '', worker_media: { event_id: eventId, index, status: 'failed', code } };
        failed += 1;
      } else {
        pending += 1;
      }
    }
  }
  const mediaStatus = pending ? 'pending' : failed ? 'failed' : 'ready';
  await run(env.DB, `UPDATE facebook_webhook_events SET normalized_payload_json=?, media_status=?, updated_at=? WHERE id=?`, [JSON.stringify(payload), mediaStatus, utcNow(), eventId]);
  return { cached, failed, pending };
}

export async function retryPendingMedia(env, config, nowIso = utcNow(), limit = 50) {
  const rows = await all(env.DB, `SELECT e.id FROM facebook_webhook_events e WHERE e.media_status='pending' AND e.processing_status NOT IN ('acked','expired') AND (NOT EXISTS (SELECT 1 FROM facebook_event_media m WHERE m.event_id=e.id) OR EXISTS (SELECT 1 FROM facebook_event_media m WHERE m.event_id=e.id AND m.status IN ('pending','retrying') AND (m.next_retry_at IS NULL OR m.next_retry_at<=?))) ORDER BY e.created_at ASC LIMIT ?`, [nowIso, Math.max(1, Math.min(200, Number(limit || 50)))]);
  let cached = 0; let failed = 0; let pending = 0;
  for (const row of rows) {
    const result = await cacheEventMedia(env, config, row.id);
    cached += result.cached; failed += result.failed; pending += result.pending;
  }
  return { events: rows.length, cached, failed, pending };
}

export async function getMediaObject(env, eventId, index, device) {
  const row = await first(env.DB, `SELECT m.* FROM facebook_event_media m JOIN facebook_webhook_events e ON e.id=m.event_id JOIN facebook_event_deliveries d ON d.event_id=e.id WHERE m.event_id=? AND m.attachment_index=? AND d.device_id=? AND d.status IN ('leased','acked') LIMIT 1`, [eventId, Number(index), device.id]);
  if (!row || row.status !== 'ready') throw new GatewayError('FACEBOOK_MEDIA_NOT_AVAILABLE', 'Facebook 媒体暂不可用', 404);
  const object = await env.MEDIA.get(row.r2_key);
  if (!object) throw new GatewayError('FACEBOOK_MEDIA_NOT_AVAILABLE', 'Facebook 媒体已过期或不存在', 404);
  return { row, object };
}

export async function cleanupExpiredMedia(env, nowIso = utcNow()) {
  const rows = await all(env.DB, `SELECT id,r2_key FROM facebook_event_media WHERE expires_at <= ? LIMIT 500`, [nowIso]);
  for (const row of rows) {
    try { await env.MEDIA.delete(row.r2_key); }
    catch (error) {
      console.error(JSON.stringify({ level: 'error', component: 'facebook-worker', operation: 'cleanupExpiredMedia.r2Delete', accountId: '', conversationId: '', reasonCode: 'FACEBOOK_MEDIA_R2_DELETE_FAILED', httpStatus: 0, attempt: 1, nextRetryAt: '', mediaId: clean(row.id), error: clean(error?.message) }));
      continue;
    }
    await run(env.DB, `DELETE FROM facebook_event_media WHERE id=?`, [row.id]);
  }
  return rows.length;
}
