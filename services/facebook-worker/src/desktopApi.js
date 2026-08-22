import { all, changes, first, run } from './db.js';
import { authenticateDesktop } from './desktopAuth.js';
import { GatewayError, invariant } from './errors.js';
import { getMediaObject } from './media.js';
import { fetchGraphPictureAsset, fetchProfilePictureAsset, fetchTokenDebug, graphPictureReference, listConversationMessages, listConversations, pageProfile, safeMetaFailure, sendOperation, senderIdentityPicture, senderProfile, unsubscribePage } from './metaClient.js';
import { OPTIONAL_PERMISSIONS, REQUIRED_PERMISSIONS } from './config.js';
import { decryptToken } from './tokenVault.js';
import { addDays, addSeconds, base64ToBytes, boundedInteger, bytesToBase64, bytesToBase64Url, clean, randomBase64Url, randomId, safeJsonParse, sha256Base64Url, stableStringify, utcNow, utf8 } from './utils.js';

async function bestEffortDatabaseWrite(operation, accountId, promise) {
  try { return await promise; }
  catch (error) {
    console.error(JSON.stringify({
      level: 'error', component: 'facebook-worker', operation, accountId: clean(accountId),
      reasonCode: clean(error?.code, 'FACEBOOK_DATABASE_WRITE_FAILED'), httpStatus: Number(error?.status || 0),
      attempt: 1, nextRetryAt: ''
    }));
    return null;
  }
}

async function accountContext(env, config, auth) {
  invariant(auth.accountId, 'FACEBOOK_ACCOUNT_NOT_BOUND', '当前设备尚未绑定 Facebook 公共主页', 409);
  const account = await first(env.DB, `SELECT * FROM facebook_accounts WHERE id=? AND disconnected_at IS NULL`, [auth.accountId]);
  invariant(account, 'FACEBOOK_ACCOUNT_DISCONNECTED', 'Facebook 账号已断开', 409);
  const tokenRecord = await first(env.DB, `SELECT * FROM facebook_page_tokens WHERE account_id=? AND token_status='active'`, [auth.accountId]);
  invariant(tokenRecord, 'FACEBOOK_TOKEN_EXPIRED', 'Facebook 授权已失效，请重新授权', 409);
  const pageToken = await decryptToken(tokenRecord, config.tokenEncryptionKey);
  return { account, tokenRecord, pageToken };
}

function accountPermissions(account = {}) {
  return [...new Set(safeJsonParse(account.permissions_json, []).map(clean).filter(Boolean))];
}

function accountCapabilities(account = {}) {
  const permissions = accountPermissions(account);
  const historySyncAvailable = permissions.includes('pages_read_engagement');
  return {
    newMessagingReady: ['pages_show_list', 'pages_manage_metadata', 'pages_messaging'].every(permission => permissions.includes(permission)),
    historySyncAvailable,
    historySyncReason: historySyncAvailable ? '' : 'pages_read_engagement 尚未授权，本轮仅支持新消息收发'
  };
}

function avatarAttemptDetails(error) {
  const detail = safeMetaFailure(error);
  return {
    code: clean(detail.code, 'FACEBOOK_AVATAR_FETCH_FAILED'),
    status: Number(detail.status || 0) || undefined,
    metaCode: Number(detail.metaCode || 0) || undefined,
    metaSubcode: Number(detail.metaSubcode || 0) || undefined,
    metaReason: clean(detail.metaReason) || undefined
  };
}

function contactAvatarFailure(config, account, attempts = {}) {
  const failures = Object.values(attempts).filter(Boolean);
  const accessDenied = failures.some(row => clean(row.metaReason) === 'missing_permission');
  const unsupportedGet = !accessDenied && failures.some(row => ['unsupported_get', 'object_unavailable'].includes(clean(row.metaReason)));
  const code = accessDenied
    ? 'FACEBOOK_CONTACT_PROFILE_ACCESS_DENIED'
    : unsupportedGet
      ? 'FACEBOOK_CONTACT_AVATAR_UNSUPPORTED_GET'
      : 'FACEBOOK_CONTACT_AVATAR_UNAVAILABLE';
  const message = accessDenied
    ? 'Meta 拒绝当前应用或 Page Token 读取该 Facebook 联系人头像'
    : unsupportedGet
      ? 'Meta 当前不支持通过该 Facebook 联系人身份读取头像'
      : 'Facebook 联系人头像当前不可用';
  const deterministic = accessDenied || unsupportedGet;
  return new GatewayError(code, message, deterministic ? 409 : 502, {
    graphVersion: clean(config.graphVersion),
    tokenType: 'page_access_token',
    grantedPermissions: accountPermissions(account),
    permissionStatus: clean(account.permission_status),
    tokenStatus: clean(account.token_status),
    deterministic,
    retryable: !deterministic,
    diagnosis: accessDenied ? 'meta-contact-profile-access-denied' : unsupportedGet ? 'meta-contact-avatar-unsupported-get' : 'contact-avatar-unavailable',
    profileCode: clean(attempts.messengerProfile?.code),
    profileStatus: Number(attempts.messengerProfile?.status || 0) || undefined,
    profileMetaCode: Number(attempts.messengerProfile?.metaCode || 0) || undefined,
    profileMetaSubcode: Number(attempts.messengerProfile?.metaSubcode || 0) || undefined,
    profileMetaReason: clean(attempts.messengerProfile?.metaReason) || undefined,
    identityPictureCode: clean(attempts.identityPicture?.code),
    identityPictureStatus: Number(attempts.identityPicture?.status || 0) || undefined,
    identityPictureMetaCode: Number(attempts.identityPicture?.metaCode || 0) || undefined,
    identityPictureMetaSubcode: Number(attempts.identityPicture?.metaSubcode || 0) || undefined,
    identityPictureMetaReason: clean(attempts.identityPicture?.metaReason) || undefined,
    pictureEdgeCode: clean(attempts.pictureEdge?.code),
    pictureEdgeStatus: Number(attempts.pictureEdge?.status || 0) || undefined,
    pictureEdgeMetaCode: Number(attempts.pictureEdge?.metaCode || 0) || undefined,
    pictureEdgeMetaSubcode: Number(attempts.pictureEdge?.metaSubcode || 0) || undefined,
    pictureEdgeMetaReason: clean(attempts.pictureEdge?.metaReason) || undefined,
    primaryCode: clean(attempts.pictureEdge?.code),
    primaryStatus: Number(attempts.pictureEdge?.status || 0) || undefined,
    messengerProfileCode: clean(attempts.messengerProfile?.code),
    messengerProfileStatus: Number(attempts.messengerProfile?.status || 0) || undefined
  });
}

function assertHistoryCapability(account = {}) {
  const capabilities = accountCapabilities(account);
  invariant(capabilities.historySyncAvailable, 'FACEBOOK_HISTORY_PERMISSION_MISSING', capabilities.historySyncReason, 409, { missingPermission: 'pages_read_engagement' });
  return capabilities;
}

async function recordAuthorizationFailure(env, accountId, error) {
  const code = clean(error?.code);
  if (!['FACEBOOK_TOKEN_EXPIRED', 'FACEBOOK_PERMISSION_REVOKED'].includes(code) || !accountId) return;
  const now = utcNow();
  const tokenStatus = code === 'FACEBOOK_TOKEN_EXPIRED' ? 'expired' : 'permission-revoked';
  const permissionStatus = code === 'FACEBOOK_PERMISSION_REVOKED' ? 'revoked' : 'reauthorize';
  await bestEffortDatabaseWrite('recordAuthorizationFailure.facebook_accounts', accountId, run(env.DB, `UPDATE facebook_accounts SET token_status=?,permission_status=?,updated_at=? WHERE id=?`, [tokenStatus, permissionStatus, now, accountId]));
  await bestEffortDatabaseWrite('recordAuthorizationFailure.facebook_page_tokens', accountId, run(env.DB, `UPDATE facebook_page_tokens SET token_status=?,revoked_at=?,updated_at=? WHERE account_id=?`, [tokenStatus, now, now, accountId]));
}

function encodeCursor(row) {
  if (!row) return '';
  return bytesToBase64Url(utf8(JSON.stringify({ at: row.created_at, id: row.id })));
}
function decodeCursor(value) {
  try {
    const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
    const text = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
    const row = JSON.parse(text);
    return clean(row.at) && clean(row.id) ? row : null;
  } catch (_) { return null; }
}

async function expireLeases(env, deviceId) {
  const now = utcNow();
  await run(env.DB, `UPDATE facebook_event_deliveries SET status=CASE WHEN attempt_count>=12 THEN 'dead-letter' ELSE 'pending' END,lease_token=NULL,lease_expires_at=NULL,dead_letter_at=CASE WHEN attempt_count>=12 THEN ? ELSE dead_letter_at END,last_error_code=CASE WHEN attempt_count>=12 THEN 'FACEBOOK_DELIVERY_RETRY_EXHAUSTED' ELSE last_error_code END,updated_at=? WHERE device_id=? AND status='leased' AND lease_expires_at<=?`, [now, now, deviceId, now]);
}

async function pendingRows(env, deviceId, limit, cursor = null) {
  const baseSql = `SELECT d.id,d.event_id,d.account_id,d.device_id,d.status,d.attempt_count,d.created_at,e.page_id,e.event_type,e.event_timestamp,e.normalized_payload_json,e.media_status FROM facebook_event_deliveries d JOIN facebook_webhook_events e ON e.id=d.event_id WHERE d.device_id=? AND d.status='pending' AND e.media_status IN ('none','ready','failed')`;
  const order = ` ORDER BY e.event_timestamp ASC,d.created_at ASC,d.id ASC LIMIT ?`;
  if (cursor) return all(env.DB, `${baseSql} AND (d.created_at>? OR (d.created_at=? AND d.id>?))${order}`, [deviceId, cursor.at, cursor.at, cursor.id, limit]);
  return all(env.DB, `${baseSql}${order}`, [deviceId, limit]);
}

export async function pullEvents(request, env, config, bodyBytes = new Uint8Array()) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  await expireLeases(env, auth.deviceId);
  const url = new URL(request.url);
  const limit = boundedInteger(url.searchParams.get('limit'), 50, 1, 100);
  const leaseSeconds = boundedInteger(url.searchParams.get('lease_seconds'), 120, 30, 600);
  const rows = await pendingRows(env, auth.deviceId, limit + 1, decodeCursor(url.searchParams.get('cursor')));
  const selected = rows.slice(0, limit);
  const events = [];
  for (const row of selected) {
    const leaseToken = randomBase64Url(24);
    const leasedAt = utcNow();
    const result = await run(env.DB, `UPDATE facebook_event_deliveries SET status='leased',lease_token=?,lease_expires_at=?,attempt_count=attempt_count+1,last_delivered_at=?,updated_at=? WHERE id=? AND device_id=? AND status='pending'`, [
      leaseToken, addSeconds(leasedAt, leaseSeconds), leasedAt, leasedAt, row.id, auth.deviceId
    ]);
    if (changes(result) !== 1) continue;
    events.push({
      delivery_id: row.id,
      event_id: row.event_id,
      lease_token: leaseToken,
      lease_expires_at: addSeconds(leasedAt, leaseSeconds),
      account_id: row.account_id,
      page_id: row.page_id,
      event_type: row.event_type,
      event_timestamp: row.event_timestamp,
      media_status: row.media_status,
      payload: safeJsonParse(row.normalized_payload_json, {})
    });
  }
  return { events, next_cursor: encodeCursor(selected.at(-1)), has_more: rows.length > limit, server_time: utcNow() };
}

export async function acknowledgeEvents(request, env, config, bodyBytes, body) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const acknowledgements = Array.isArray(body?.acknowledgements) ? body.acknowledgements.slice(0, 100) : [];
  invariant(acknowledgements.length, 'FACEBOOK_ACK_EMPTY', 'ACK 列表不能为空', 400);
  const acked = []; const failed = [];
  for (const item of acknowledgements) {
    const deliveryId = clean(item.delivery_id);
    const leaseToken = clean(item.lease_token);
    if (!deliveryId || !leaseToken) { failed.push({ delivery_id: deliveryId, code: 'FACEBOOK_ACK_INVALID' }); continue; }
    const now = utcNow();
    const result = await run(env.DB, `UPDATE facebook_event_deliveries SET status='acked',acked_at=?,lease_token=NULL,lease_expires_at=NULL,last_error_code='',updated_at=? WHERE id=? AND device_id=? AND status='leased' AND lease_token=?`, [now, now, deliveryId, auth.deviceId, leaseToken]);
    if (changes(result) !== 1) { failed.push({ delivery_id: deliveryId, code: 'FACEBOOK_ACK_LEASE_MISMATCH' }); continue; }
    const delivery = await first(env.DB, `SELECT event_id FROM facebook_event_deliveries WHERE id=?`, [deliveryId]);
    const remaining = await first(env.DB, `SELECT COUNT(*) AS count FROM facebook_event_deliveries WHERE event_id=? AND status!='acked'`, [delivery.event_id]);
    if (Number(remaining?.count || 0) === 0) await run(env.DB, `UPDATE facebook_webhook_events SET processing_status='acked',updated_at=? WHERE id=?`, [now, delivery.event_id]);
    acked.push(deliveryId);
  }
  return { acked, failed, ok: failed.length === 0 };
}

export async function renewEvents(request, env, config, bodyBytes, body) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const renewals = Array.isArray(body?.renewals) ? body.renewals.slice(0, 100) : [];
  invariant(renewals.length, 'FACEBOOK_RENEW_EMPTY', '续租列表不能为空', 400);
  const renewed = []; const failed = [];
  for (const item of renewals) {
    const deliveryId = clean(item?.delivery_id);
    const leaseToken = clean(item?.lease_token);
    const leaseSeconds = boundedInteger(item?.lease_seconds, 120, 30, 600);
    if (!deliveryId || !leaseToken) { failed.push({ delivery_id: deliveryId, code: 'FACEBOOK_RENEW_INVALID' }); continue; }

    const now = utcNow();
    const current = await first(env.DB, `SELECT status,lease_token,lease_expires_at FROM facebook_event_deliveries WHERE id=? AND device_id=?`, [deliveryId, auth.deviceId]);
    if (!current || clean(current.status) !== 'leased' || clean(current.lease_token) !== leaseToken) {
      failed.push({ delivery_id: deliveryId, code: 'FACEBOOK_RENEW_LEASE_MISMATCH' });
      continue;
    }
    const currentExpiry = Date.parse(clean(current.lease_expires_at));
    if (!Number.isFinite(currentExpiry) || currentExpiry <= Date.now()) {
      failed.push({ delivery_id: deliveryId, code: 'FACEBOOK_RENEW_LEASE_EXPIRED' });
      continue;
    }

    const leaseExpiresAt = addSeconds(now, leaseSeconds);
    const result = await run(env.DB, `UPDATE facebook_event_deliveries SET lease_expires_at=?,updated_at=? WHERE id=? AND device_id=? AND status='leased' AND lease_token=? AND lease_expires_at>?`, [
      leaseExpiresAt, now, deliveryId, auth.deviceId, leaseToken, now
    ]);
    if (changes(result) !== 1) {
      const latest = await first(env.DB, `SELECT status,lease_token,lease_expires_at FROM facebook_event_deliveries WHERE id=? AND device_id=?`, [deliveryId, auth.deviceId]);
      const latestExpiry = Date.parse(clean(latest?.lease_expires_at));
      const code = latest
        && clean(latest.status) === 'leased'
        && clean(latest.lease_token) === leaseToken
        && (!Number.isFinite(latestExpiry) || latestExpiry <= Date.now())
        ? 'FACEBOOK_RENEW_LEASE_EXPIRED'
        : 'FACEBOOK_RENEW_LEASE_MISMATCH';
      failed.push({ delivery_id: deliveryId, code });
      continue;
    }
    renewed.push(deliveryId);
  }
  return { renewed, failed, ok: failed.length === 0 };
}

function normalizeSend(body) {
  const kind = clean(body?.kind).toLowerCase();
  invariant(['text','media','typing_on','typing_off','mark_seen'].includes(kind), 'FACEBOOK_SEND_OPERATION_UNSUPPORTED', '不支持的 Facebook 发送操作', 400);
  const recipientId = clean(body?.recipientId).replace(/^facebook:/i, '');
  invariant(/^\d{3,64}$/.test(recipientId), 'FACEBOOK_RECIPIENT_INVALID', 'Facebook 收件人标识无效', 400);
  if (kind === 'text') {
    const text = String(body?.text || '');
    invariant(text.trim() && text.length <= 2000, 'FACEBOOK_TEXT_INVALID', 'Facebook 文本消息为空或过长', 400);
    return { kind, recipientId, text, replyToMessageId: clean(body?.replyToMessageId) };
  }
  if (kind === 'media') {
    const media = body?.media || {};
    const dataBase64 = clean(media.dataBase64);
    const bytes = base64ToBytes(dataBase64);
    invariant(bytes.length > 0 && bytes.length <= 20 * 1024 * 1024, 'FACEBOOK_MEDIA_SIZE_INVALID', 'Facebook 附件为空或超过 20MB', 413);
    const attachmentType = clean(media.attachmentType).toLowerCase();
    invariant(['image','video','audio','file'].includes(attachmentType), 'FACEBOOK_MEDIA_UNSUPPORTED', 'Facebook 不支持此附件类型', 400);
    return {
      kind,
      recipientId,
      replyToMessageId: clean(body?.replyToMessageId),
      media: {
        dataBase64,
        attachmentType,
        mimeType: clean(media.mimeType, 'application/octet-stream').slice(0, 200),
        filename: clean(media.filename, 'attachment').slice(0, 240)
      }
    };
  }
  return { kind, recipientId };
}

export async function sendMessage(request, env, config, ctx, bodyBytes, body, fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const idempotencyKey = clean(auth.idempotencyKey || body?.idempotencyKey);
  invariant(idempotencyKey && idempotencyKey.length <= 200, 'FACEBOOK_SEND_IDEMPOTENCY_REQUIRED', '发送消息必须提供幂等键', 400);
  const operation = normalizeSend(body);
  const requestHash = await sha256Base64Url(stableStringify(operation));
  const existing = await first(env.DB, `SELECT * FROM facebook_send_idempotency WHERE account_id=? AND device_id=? AND idempotency_key=?`, [auth.accountId, auth.deviceId, idempotencyKey]);
  if (existing) {
    invariant(existing.request_hash === requestHash, 'FACEBOOK_IDEMPOTENCY_CONFLICT', '相同幂等键对应不同发送内容', 409);
    if (existing.status === 'completed') return safeJsonParse(existing.response_json, {});
    if (existing.status === 'failed') throw new GatewayError(existing.error_code || 'FACEBOOK_SEND_FAILED', 'Facebook 消息发送未完成', 409);
    throw new GatewayError('FACEBOOK_SEND_IN_PROGRESS', '相同消息正在发送', 409);
  }
  const now = utcNow();
  await run(env.DB, `INSERT INTO facebook_send_idempotency(id,account_id,device_id,idempotency_key,request_hash,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,'processing',?,?,?)`, [
    randomId('fbsend_'), auth.accountId, auth.deviceId, idempotencyKey, requestHash, now, now, addDays(now, 7)
  ]);
  let outgoingKey = '';
  try {
    const context = await accountContext(env, config, auth);
    if (operation.kind === 'media') {
      outgoingKey = `facebook/outgoing/${auth.accountId}/${randomId()}`;
      const bytes = base64ToBytes(operation.media.dataBase64);
      await env.MEDIA.put(outgoingKey, bytes, { httpMetadata: { contentType: operation.media.mimeType }, customMetadata: { purpose: 'outgoing', deviceId: auth.deviceId } });
      const staged = await env.MEDIA.get(outgoingKey);
      invariant(staged, 'FACEBOOK_MEDIA_STAGE_FAILED', 'Facebook 附件暂存失败', 503);
      const stagedBytes = new Uint8Array(await staged.arrayBuffer());
      operation.media.dataBase64 = bytesToBase64(stagedBytes);
    }
    const result = await sendOperation(config, context.pageToken, operation, fetchImpl);
    const response = { messageId: clean(result.message_id), recipientId: clean(result.recipient_id || operation.recipientId), kind: operation.kind, sentAt: utcNow() };
    await run(env.DB, `UPDATE facebook_send_idempotency SET status='completed',response_json=?,error_code='',updated_at=? WHERE account_id=? AND device_id=? AND idempotency_key=?`, [
      JSON.stringify(response), utcNow(), auth.accountId, auth.deviceId, idempotencyKey
    ]);
    return response;
  } catch (error) {
    await recordAuthorizationFailure(env, auth.accountId, error);
    await bestEffortDatabaseWrite('sendMessage.markFailed', auth.accountId, run(env.DB, `UPDATE facebook_send_idempotency SET status='failed',error_code=?,updated_at=? WHERE account_id=? AND device_id=? AND idempotency_key=?`, [
      clean(error.code, 'FACEBOOK_SEND_FAILED'), utcNow(), auth.accountId, auth.deviceId, idempotencyKey
    ]));
    throw error;
  } finally {
    if (outgoingKey) ctx.waitUntil(env.MEDIA.delete(outgoingKey));
  }
}

export async function listAccounts(request, env, config, bodyBytes = new Uint8Array()) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const rows = await all(env.DB, `SELECT a.id,a.page_id,a.page_name,a.page_username,a.page_picture_url,a.permission_status,a.permissions_json,a.granted_scopes,a.missing_permissions,a.history_sync_available,a.history_sync_reason,a.last_permission_check_at,a.permission_source,a.webhook_status,a.token_status,a.updated_at,d.status AS device_status,d.last_seen_at FROM facebook_accounts a JOIN facebook_desktop_devices d ON d.account_id=a.id WHERE d.id=?`, [auth.deviceId]);
  const pending = await first(env.DB, `SELECT COUNT(*) AS count FROM facebook_event_deliveries WHERE device_id=? AND status IN ('pending','leased')`, [auth.deviceId]);
  return {
    accounts: rows.map(row => ({
      cloudAccountId: row.id,
      pageId: row.page_id,
      pageName: row.page_name,
      pageUsername: row.page_username,
      pagePicture: clean(row.page_picture_url),
      permissionStatus: row.permission_status,
      permissions: safeJsonParse(row.permissions_json, []),
      grantedScopes: safeJsonParse(row.granted_scopes, safeJsonParse(row.permissions_json, [])),
      missingPermissions: safeJsonParse(row.missing_permissions, []),
      historySyncAvailable: Number(row.history_sync_available) === 1,
      historySyncReason: clean(row.history_sync_reason),
      lastPermissionCheckAt: clean(row.last_permission_check_at),
      permissionSource: clean(row.permission_source),
      capabilities: accountCapabilities(row),
      webhookStatus: row.webhook_status,
      tokenStatus: row.token_status,
      deviceStatus: row.device_status,
      lastSeenAt: clean(row.last_seen_at),
      updatedAt: row.updated_at
    })),
    pendingEvents: Number(pending?.count || 0)
  };
}

export async function refreshPermissions(request, env, config, bodyBytes = new Uint8Array(), fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const { account, pageToken } = await accountContext(env, config, auth);
  const debug = await fetchTokenDebug(config, pageToken, fetchImpl);
  const grantedScopes = [...new Set((Array.isArray(debug.scopes) ? debug.scopes : []).map(clean).filter(Boolean))];
  const missingRequired = REQUIRED_PERMISSIONS.filter(permission => !grantedScopes.includes(permission));
  const missingOptional = OPTIONAL_PERMISSIONS.filter(permission => !grantedScopes.includes(permission));
  const historySyncAvailable = missingOptional.length === 0;
  const historySyncReason = historySyncAvailable ? '' : 'pages_read_engagement 尚未授权；新消息收发可用，Business Suite 历史会话对账受限';
  const checkedAt = utcNow();
  await run(env.DB, `UPDATE facebook_accounts SET permission_status=?,permissions_json=?,granted_scopes=?,missing_permissions=?,history_sync_available=?,history_sync_reason=?,last_permission_check_at=?,permission_source=?,updated_at=? WHERE id=?`, [
    missingRequired.length ? 'reauthorize' : (historySyncAvailable ? 'ready' : 'limited'), JSON.stringify(grantedScopes), JSON.stringify(grantedScopes), JSON.stringify([...missingRequired, ...missingOptional]), historySyncAvailable ? 1 : 0, historySyncReason, checkedAt, 'meta:debug_token(page-token)', checkedAt, account.id
  ]);
  return { grantedScopes, missingRequiredPermissions: missingRequired, missingOptionalPermissions: missingOptional, historySyncAvailable, historySyncReason, lastPermissionCheckAt: checkedAt, permissionSource: 'meta:debug_token(page-token)' };
}

export async function health(request, env, config, bodyBytes = new Uint8Array()) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const account = auth.accountId ? await first(env.DB, `SELECT permission_status,permissions_json,webhook_status,token_status,updated_at FROM facebook_accounts WHERE id=?`, [auth.accountId]) : null;
  const queue = await first(env.DB, `SELECT SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='leased' THEN 1 ELSE 0 END) AS leased,SUM(CASE WHEN status='dead-letter' THEN 1 ELSE 0 END) AS dead_letter,MAX(acked_at) AS last_ack_at,MAX(last_delivered_at) AS last_delivery_at FROM facebook_event_deliveries WHERE device_id=?`, [auth.deviceId]);
  return {
    status: account ? 'ready' : 'unbound',
    serverTime: utcNow(),
    account: account ? {
      permissionStatus: account.permission_status,
      webhookStatus: account.webhook_status,
      tokenStatus: account.token_status,
      capabilities: accountCapabilities(account),
      updatedAt: account.updated_at
    } : null,
    queue: {
      pending: Number(queue?.pending || 0),
      leased: Number(queue?.leased || 0),
      deadLetter: Number(queue?.dead_letter || 0),
      lastAckAt: clean(queue?.last_ack_at),
      lastDeliveryAt: clean(queue?.last_delivery_at)
    }
  };
}

export async function disconnectAccount(request, env, config, bodyBytes, body, fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const requestedWholeAccount = body?.disconnectAccount === true;
  const now = utcNow();

  // A normal desktop logout is device-local while another active Yance device remains.
  // The last active device automatically closes the cloud account so an orphaned Page
  // subscription cannot continue collecting customer events indefinitely.
  await run(env.DB, `UPDATE facebook_desktop_devices SET status='disabled',disabled_at=?,updated_at=? WHERE id=?`, [now, now, auth.deviceId]);
  const activeDevices = await first(env.DB, `SELECT COUNT(*) AS count FROM facebook_desktop_devices WHERE account_id=? AND status='active'`, [auth.accountId]);
  const remainingDevices = Number(activeDevices?.count || 0);
  const disconnectWholeAccount = requestedWholeAccount || remainingDevices === 0;
  const unsubscribe = disconnectWholeAccount && body?.unsubscribe !== false;

  if (disconnectWholeAccount) {
    let unsubscribeError = null;
    if (unsubscribe) {
      try {
        const context = await accountContext(env, config, auth);
        await unsubscribePage(config, context.account.page_id, context.pageToken, fetchImpl);
      } catch (error) {
        unsubscribeError = error;
      }
    }
    await run(env.DB, `UPDATE facebook_desktop_devices SET status='disabled',disabled_at=COALESCE(disabled_at,?),updated_at=? WHERE account_id=?`, [now, now, auth.accountId]);
    await run(env.DB, `UPDATE facebook_accounts SET webhook_status=?,token_status='revoked',disconnected_at=?,updated_at=? WHERE id=?`, [unsubscribeError ? 'unsubscribe-pending' : (unsubscribe ? 'unsubscribed' : 'disconnected'), now, now, auth.accountId]);
    await run(env.DB, `UPDATE facebook_page_tokens SET token_status='revoked',revoked_at=?,updated_at=? WHERE account_id=?`, [now, now, auth.accountId]);
    if (unsubscribeError) {
      throw new GatewayError('FACEBOOK_REMOTE_UNSUBSCRIBE_FAILED', 'Facebook 账号已在言策云端断开，但 Meta Webhook 退订暂未完成', 502, { accountDisconnected: true, retryable: true, remainingDevices });
    }
  }
  return { disconnected: true, accountDisconnected: disconnectWholeAccount, deviceId: auth.deviceId, remainingDevices };
}

export async function history(request, env, config, bodyBytes = new Uint8Array(), fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const context = await accountContext(env, config, auth);
  assertHistoryCapability(context.account);
  const url = new URL(request.url);
  try {
    const result = await listConversations(config, context.account.page_id, context.pageToken, {
      limit: boundedInteger(url.searchParams.get('limit'), 50, 1, 100),
      messagesLimit: boundedInteger(url.searchParams.get('messages_limit'), 50, 1, 100),
      after: clean(url.searchParams.get('after'))
    }, fetchImpl);
    return { data: Array.isArray(result.data) ? result.data : [], paging: { cursors: result.paging?.cursors || {}, next: result.paging?.next ? 'available' : '' } };
  } catch (error) {
    await recordAuthorizationFailure(env, auth.accountId, error);
    throw error;
  }
}

export async function historyMessages(request, env, config, bodyBytes = new Uint8Array(), fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const context = await accountContext(env, config, auth);
  assertHistoryCapability(context.account);
  const url = new URL(request.url);
  const conversationId = clean(url.searchParams.get('conversation_id'));
  invariant(/^t_[A-Za-z0-9_-]{3,200}$/.test(conversationId) || /^[A-Za-z0-9_-]{3,200}$/.test(conversationId), 'FACEBOOK_CONVERSATION_ID_INVALID', 'Facebook 会话标识无效', 400);
  try {
    const result = await listConversationMessages(config, conversationId, context.pageToken, {
      limit: boundedInteger(url.searchParams.get('limit'), 50, 1, 100),
      after: clean(url.searchParams.get('after'))
    }, fetchImpl);
    return { data: Array.isArray(result.data) ? result.data : [], paging: { cursors: result.paging?.cursors || {}, next: result.paging?.next ? 'available' : '' } };
  } catch (error) {
    await recordAuthorizationFailure(env, auth.accountId, error);
    throw error;
  }
}

export async function profile(request, env, config, bodyBytes = new Uint8Array(), fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const context = await accountContext(env, config, auth);
  const psid = clean(new URL(request.url).searchParams.get('psid'));
  invariant(/^\d{3,64}$/.test(psid), 'FACEBOOK_PROFILE_ID_INVALID', 'Facebook 联系人标识无效', 400);
  try {
    const row = await senderProfile(config, psid, context.pageToken, fetchImpl);
    return { id: psid, firstName: clean(row.first_name), lastName: clean(row.last_name), profilePicture: clean(row.profile_pic) };
  } catch (error) {
    await recordAuthorizationFailure(env, auth.accountId, error);
    throw error;
  }
}

export async function avatarResponse(request, env, config, bodyBytes = new Uint8Array(), kind = 'profile', fetchImpl = fetch) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const context = await accountContext(env, config, auth);
  const url = new URL(request.url);
  let reference = '';
  let identity = '';
  const attempts = { messengerProfile: null, identityPicture: null, pictureEdge: null };
  try {
    if (kind === 'page') {
      identity = clean(context.account.page_id);
      reference = clean(context.account.page_picture_url);
      if (!reference) {
        try {
          const row = await pageProfile(config, identity, context.pageToken, fetchImpl);
          reference = clean(row?.picture?.data?.url || row?.picture);
        } catch (error) {
          attempts.messengerProfile = avatarAttemptDetails(error);
        }
      }
    } else {
      identity = clean(url.searchParams.get('psid'));
      invariant(/^\d{3,64}$/.test(identity), 'FACEBOOK_PROFILE_ID_INVALID', 'Facebook 联系人标识无效', 400);
      try {
        const row = await senderProfile(config, identity, context.pageToken, fetchImpl);
        reference = clean(row.profile_pic);
      } catch (error) {
        attempts.messengerProfile = avatarAttemptDetails(error);
      }
      if (!reference) {
        try {
          const row = await senderIdentityPicture(config, identity, context.pageToken, fetchImpl);
          reference = clean(row?.picture?.data?.url || row?.picture?.url || row?.picture);
        } catch (error) {
          attempts.identityPicture = avatarAttemptDetails(error);
        }
      }
    }

    let response = null;
    if (reference) {
      try { response = await fetchProfilePictureAsset(reference, context.pageToken, fetchImpl); }
      catch (error) {
        const detail = avatarAttemptDetails(error);
        if (kind === 'page') attempts.messengerProfile ||= detail;
        else attempts.identityPicture ||= detail;
      }
    }
    if (!response) {
      try {
        response = await fetchGraphPictureAsset(config, identity, context.pageToken, fetchImpl);
        if (kind === 'page') {
          const stableReference = graphPictureReference(config, identity);
          await bestEffortDatabaseWrite('avatarResponse.persistPagePicture', auth.accountId, run(env.DB, `UPDATE facebook_accounts SET page_picture_url=?,updated_at=? WHERE id=?`, [stableReference, utcNow(), auth.accountId]));
        }
      } catch (error) {
        attempts.pictureEdge = avatarAttemptDetails(error);
        if (kind === 'profile') throw contactAvatarFailure(config, context.account, attempts);
        throw error;
      }
    }
    const headers = new Headers();
    headers.set('content-type', clean(response.headers.get('content-type'), 'image/jpeg'));
    headers.set('cache-control', 'private, max-age=900');
    headers.set('content-disposition', `inline; filename="facebook-${kind}-${identity}.img"`);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('x-yance-facebook-avatar-source', reference ? 'profile-reference' : 'picture-edge');
    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    await recordAuthorizationFailure(env, auth.accountId, error);
    throw error;
  }
}

export async function mediaResponse(request, env, config, bodyBytes, eventId, index) {
  const auth = await authenticateDesktop(request, env, config, bodyBytes);
  const { row, object } = await getMediaObject(env, eventId, index, auth.device);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('cache-control', 'private, max-age=300');
  headers.set('content-disposition', `attachment; filename="${clean(row.filename, 'facebook-media').replace(/["\\\r\n]/g, '_')}"`);
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}
