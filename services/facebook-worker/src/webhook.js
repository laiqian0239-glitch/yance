import { all, changes, first, run } from './db.js';
import { GatewayError, invariant } from './errors.js';
import { cacheEventMedia } from './media.js';
import { addDays, base64ToBytes, bytesToBase64, clean, randomId, sha256Hex, stableStringify, timingSafeEqualBytes, utcNow, utf8 } from './utils.js';

async function hmacSha256Hex(secret, bytes) {
  const key = await crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  return [...signature].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  const supplied = clean(signatureHeader);
  if (!/^sha256=[0-9a-f]{64}$/i.test(supplied)) return false;
  const expected = `sha256=${await hmacSha256Hex(appSecret, rawBody)}`;
  return timingSafeEqualBytes(utf8(expected.toLowerCase()), utf8(supplied.toLowerCase()));
}

export function verifyWebhookChallenge(url, verifyToken) {
  const mode = clean(url.searchParams.get('hub.mode'));
  const token = clean(url.searchParams.get('hub.verify_token'));
  const challenge = clean(url.searchParams.get('hub.challenge'));
  if (mode !== 'subscribe' || !challenge || !timingSafeEqualBytes(utf8(token), utf8(verifyToken))) {
    throw new GatewayError('FACEBOOK_WEBHOOK_VERIFICATION_REJECTED', 'Webhook 验证失败', 403);
  }
  return challenge;
}

function eventType(event = {}) {
  if (event.message?.is_echo) return 'message_echo';
  if (event.message) return event.message.is_deleted ? 'message_deleted' : 'message';
  if (event.delivery) return 'delivery';
  if (event.read) return 'read';
  if (event.postback) return 'postback';
  if (event.referral) return 'referral';
  if (event.reaction) return 'reaction';
  return 'unsupported';
}

async function dedupKey(pageId, event) {
  const mid = clean(event?.message?.mid);
  if (mid) return `mid:${pageId}:${mid}`;
  const deliveryMids = Array.isArray(event?.delivery?.mids) ? [...event.delivery.mids].map(clean).filter(Boolean).sort() : [];
  if (deliveryMids.length) return `delivery:${pageId}:${await sha256Hex(stableStringify(deliveryMids))}`;
  if (event?.read?.watermark) return `read:${pageId}:${clean(event.sender?.id)}:${Number(event.read.watermark)}`;
  if (event?.postback?.mid) return `postback:${pageId}:${clean(event.postback.mid)}`;
  if (event?.reaction?.mid) return `reaction:${pageId}:${clean(event.reaction.mid)}:${clean(event.reaction.action)}:${clean(event.reaction.emoji)}`;
  const stable = {
    pageId,
    sender: clean(event?.sender?.id),
    recipient: clean(event?.recipient?.id),
    timestamp: Number(event?.timestamp || 0),
    type: eventType(event),
    body: event
  };
  return `digest:${pageId}:${await sha256Hex(stableStringify(stable))}`;
}

function eventPayload(pageId, entry, event) {
  return { object: 'page', entry: [{ id: pageId, time: entry.time || Date.now(), messaging: [event] }] };
}

function hasMedia(event) {
  return Array.isArray(event?.message?.attachments) && event.message.attachments.some(attachment => clean(attachment?.payload?.url));
}

async function ensureDeliveries(env, eventId, accountId, pageId, now) {
  if (!accountId) return 0;
  await run(env.DB, `UPDATE facebook_webhook_events SET account_id=COALESCE(account_id,?),updated_at=? WHERE id=? AND page_id=?`, [accountId, now, eventId, pageId]);
  const devices = await all(env.DB, `SELECT id FROM facebook_desktop_devices WHERE account_id=? AND status='active'`, [accountId]);
  let ensured = 0;
  for (const device of devices) {
    const result = await run(env.DB, `INSERT OR IGNORE INTO facebook_event_deliveries(id,event_id,account_id,device_id,status,first_available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, [
      randomId('fbdel_'), eventId, accountId, device.id, 'pending', now, now, now
    ]);
    ensured += changes(result);
  }
  return ensured;
}

export async function ingestWebhook(rawBody, signatureHeader, env, config, ctx = { waitUntil() {} }) {
  invariant(await verifyMetaSignature(rawBody, signatureHeader, config.appSecret), 'FACEBOOK_WEBHOOK_SIGNATURE_INVALID', 'Webhook 签名无效', 401);
  let body;
  try { body = JSON.parse(new TextDecoder().decode(rawBody)); }
  catch (_) { throw new GatewayError('FACEBOOK_WEBHOOK_JSON_INVALID', 'Webhook 正文不是有效 JSON', 400); }
  invariant(body?.object === 'page' && Array.isArray(body.entry), 'FACEBOOK_WEBHOOK_OBJECT_INVALID', 'Webhook 对象类型无效', 400);
  const rawJson = JSON.stringify(body);
  let inserted = 0; let duplicates = 0; const mediaEvents = new Set();
  for (const entry of body.entry) {
    const pageId = clean(entry?.id);
    if (!pageId) continue;
    const account = await first(env.DB, `SELECT id FROM facebook_accounts WHERE page_id=? AND disconnected_at IS NULL`, [pageId]);
    for (const event of Array.isArray(entry.messaging) ? entry.messaging : []) {
      const now = utcNow();
      const proposedId = randomId('fbevt_');
      const key = await dedupKey(pageId, event);
      const type = eventType(event);
      const timestampMs = Number(event.timestamp || entry.time || Date.now());
      const timestamp = new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString();
      const normalized = eventPayload(pageId, entry, event);
      const mediaStatus = hasMedia(event) ? 'pending' : 'none';
      let eventRow = null;
      try {
        const result = await run(env.DB, `INSERT INTO facebook_webhook_events(id,account_id,page_id,dedup_key,event_type,meta_message_id,event_timestamp,raw_payload_json,normalized_payload_json,media_status,processing_status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
          proposedId, account?.id || null, pageId, key, type, clean(event?.message?.mid) || null, timestamp, rawJson, JSON.stringify(normalized), mediaStatus, 'pending', now, now, addDays(now, config.eventRetentionDays)
        ]);
        if (changes(result) === 1) {
          inserted += 1;
          eventRow = { id: proposedId, media_status: mediaStatus };
        }
      } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (!message.includes('unique') && !message.includes('constraint')) throw error;
        eventRow = await first(env.DB, `SELECT id,media_status FROM facebook_webhook_events WHERE dedup_key=?`, [key]);
        if (!eventRow) throw error;
        duplicates += 1;
      }
      if (!eventRow) continue;

      // Delivery creation is idempotent and also runs on Meta retries. If D1
      // accepted the event but a later delivery insert failed, the retry repairs
      // the missing delivery instead of treating the duplicate as complete.
      await ensureDeliveries(env, eventRow.id, account?.id || null, pageId, now);
      if (hasMedia(event) && clean(eventRow.media_status, mediaStatus) === 'pending') mediaEvents.add(eventRow.id);
    }
  }
  for (const eventId of mediaEvents) ctx.waitUntil(cacheEventMedia(env, config, eventId));
  return { accepted: inserted, duplicates };
}
