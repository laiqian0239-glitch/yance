import { all, changes, first, run } from './db.js';
import { GatewayError, invariant } from './errors.js';
import { signEnrollment, verifyEnrollment } from './desktopAuth.js';
import { authorizationUrl, discoverManagedPages, exchangeCode, fetchGrantedPermissions, subscribePage } from './metaClient.js';
import { decryptToken, encryptToken } from './tokenVault.js';
import { addSeconds, clean, randomBase64Url, randomId, sha256Base64Url, timingSafeEqualBytes, utcNow, utf8 } from './utils.js';
import { OPTIONAL_PERMISSIONS, REQUIRED_PERMISSIONS, SUBSCRIBED_FIELDS } from './config.js';


async function ensureOAuthDiagnosticsTable(env) {
  await run(env.DB, `CREATE TABLE IF NOT EXISTS facebook_oauth_diagnostics (
    flow_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT '',
    diagnostics_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function safeDiagnostics(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function persistOAuthDiagnostics(env, flowId, status, diagnostics = {}) {
  const safe = safeDiagnostics(diagnostics);
  await ensureOAuthDiagnosticsTable(env);
  const now = utcNow();
  await run(env.DB, `INSERT INTO facebook_oauth_diagnostics(flow_id,status,diagnostics_json,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(flow_id) DO UPDATE SET status=excluded.status,diagnostics_json=excluded.diagnostics_json,updated_at=excluded.updated_at`, [
    clean(flowId), clean(status), JSON.stringify(safe), now, now
  ]);
  console.info(JSON.stringify({
    level: 'info', component: 'facebook-worker', event: 'oauth-page-discovery',
    flowId: clean(flowId), status: clean(status), diagnostics: safe
  }));
}

async function readOAuthDiagnostics(env, flowId) {
  try {
    await ensureOAuthDiagnosticsTable(env);
    const row = await first(env.DB, `SELECT status,diagnostics_json,updated_at FROM facebook_oauth_diagnostics WHERE flow_id=?`, [clean(flowId)]);
    if (!row) return null;
    let diagnostics = {};
    try { diagnostics = JSON.parse(row.diagnostics_json || '{}'); } catch (_) {}
    return { status: clean(row.status), updatedAt: clean(row.updated_at), ...safeDiagnostics(diagnostics) };
  } catch (_) {
    return null;
  }
}

async function validateDevicePublicKey(value) {
  try {
    const normalized = clean(value).replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)), character => character.charCodeAt(0));
    await crypto.subtle.importKey('spki', bytes, { name: 'Ed25519' }, false, ['verify']);
    return clean(value);
  } catch (_) {
    throw new GatewayError('FACEBOOK_DEVICE_PUBLIC_KEY_INVALID', '设备公钥格式无效', 400);
  }
}

function callbackUrl(request, config) {
  const origin = config.workerBaseUrl || new URL(request.url).origin;
  return new URL('/oauth/facebook/callback', origin).toString();
}

function flowBearer(request) {
  const header = clean(request.headers.get('authorization'));
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '').trim() : '';
}

async function assertFlowClient(request, env, flowId) {
  const row = await first(env.DB, `SELECT * FROM facebook_oauth_states WHERE flow_id=?`, [clean(flowId)]);
  invariant(row, 'FACEBOOK_OAUTH_FLOW_NOT_FOUND', 'Facebook 授权流程不存在或已过期', 404);
  const secret = flowBearer(request);
  invariant(secret, 'FACEBOOK_OAUTH_CLIENT_AUTH_REQUIRED', 'Facebook 授权结果读取凭证缺失', 401);
  const proof = await sha256Base64Url(secret);
  invariant(timingSafeEqualBytes(utf8(proof), utf8(row.client_proof)), 'FACEBOOK_OAUTH_CLIENT_AUTH_INVALID', 'Facebook 授权结果读取凭证无效', 401);
  invariant(Date.parse(row.expires_at) > Date.now(), 'FACEBOOK_OAUTH_FLOW_EXPIRED', 'Facebook 授权流程已过期', 410);
  return row;
}

export async function beginOAuth(request, env, config) {
  const url = new URL(request.url);
  const flowId = clean(url.searchParams.get('flow_id'));
  const clientProof = clean(url.searchParams.get('client_proof'));
  const deviceId = clean(url.searchParams.get('device_id'));
  const devicePublicKey = await validateDevicePublicKey(url.searchParams.get('public_key'));
  const deviceDisplayName = clean(url.searchParams.get('device_name'), 'Yance Windows').slice(0, 120);
  invariant(flowId && flowId.length <= 128 && /^[A-Za-z0-9._-]+$/.test(flowId), 'FACEBOOK_OAUTH_FLOW_ID_INVALID', 'Facebook 授权流程标识无效', 400);
  invariant(/^[A-Za-z0-9_-]{40,64}$/.test(clientProof), 'FACEBOOK_OAUTH_CLIENT_PROOF_INVALID', 'Facebook 授权流程证明无效', 400);
  invariant(deviceId && deviceId.length <= 128, 'FACEBOOK_DEVICE_ID_INVALID', '设备标识无效', 400);
  const existing = await first(env.DB, `SELECT flow_id FROM facebook_oauth_states WHERE flow_id=?`, [flowId]);
  invariant(!existing, 'FACEBOOK_OAUTH_FLOW_REPLAYED', 'Facebook 授权流程已存在', 409);

  const state = randomBase64Url(32);
  const stateHash = await sha256Base64Url(state);
  const now = utcNow();
  const enrollmentValue = `${flowId}.${deviceId}.${devicePublicKey}.${clientProof}`;
  const enrollmentMac = await signEnrollment(config.desktopAuthMasterKey, enrollmentValue);
  await run(env.DB, `INSERT INTO facebook_oauth_states(id,flow_id,state_hash,client_proof,device_id,device_public_key_spki,device_display_name,enrollment_mac,status,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [
    randomId('fboauth_'), flowId, stateHash, clientProof, deviceId, devicePublicKey, deviceDisplayName, enrollmentMac, 'pending', now, addSeconds(now, config.oauthStateTtlSeconds), now
  ]);
  return Response.redirect(authorizationUrl(config, callbackUrl(request, config), state), 302);
}

export async function handleOAuthCallback(request, env, config, fetchImpl = fetch) {
  const url = new URL(request.url);
  const state = clean(url.searchParams.get('state'));
  const stateHash = await sha256Base64Url(state);
  const flow = await first(env.DB, `SELECT * FROM facebook_oauth_states WHERE state_hash=?`, [stateHash]);
  invariant(flow, 'FACEBOOK_OAUTH_STATE_INVALID', 'Facebook OAuth state 无效', 400);
  invariant(flow.status === 'pending' && Date.parse(flow.expires_at) > Date.now(), 'FACEBOOK_OAUTH_STATE_REPLAYED', 'Facebook OAuth state 已使用或过期', 409);
  const claimed = await run(env.DB, `UPDATE facebook_oauth_states SET status='callback-processing',consumed_at=?,updated_at=? WHERE id=? AND status='pending'`, [utcNow(), utcNow(), flow.id]);
  invariant(changes(claimed) === 1, 'FACEBOOK_OAUTH_STATE_REPLAYED', 'Facebook OAuth state 已被使用', 409);

  if (url.searchParams.get('error')) {
    await run(env.DB, `UPDATE facebook_oauth_states SET status='denied',error_code='FACEBOOK_OAUTH_DENIED',updated_at=? WHERE id=?`, [utcNow(), flow.id]);
    throw new GatewayError('FACEBOOK_OAUTH_DENIED', 'Facebook 授权已取消', 400);
  }

  try {
    const code = clean(url.searchParams.get('code'));
    invariant(code, 'FACEBOOK_OAUTH_CODE_MISSING', 'Facebook OAuth 回调缺少授权码', 400);
    const token = await exchangeCode(config, callbackUrl(request, config), code, fetchImpl);
    const grantedPermissions = await fetchGrantedPermissions(config, token.access_token, fetchImpl);
    const missingRequiredPermissions = REQUIRED_PERMISSIONS.filter(permission => !grantedPermissions.includes(permission));
    const missingOptionalPermissions = OPTIONAL_PERMISSIONS.filter(permission => !grantedPermissions.includes(permission));
    if (missingRequiredPermissions.length) {
      const permissionDiagnostics = {
        schemaVersion: 1,
        stage: 'permissions',
        grantedPermissions,
        missingRequiredPermissions,
        missingOptionalPermissions
      };
      await persistOAuthDiagnostics(env, flow.flow_id, 'required_permissions_missing', permissionDiagnostics);
      await run(env.DB, `UPDATE facebook_oauth_states SET status='error',error_code='FACEBOOK_REQUIRED_PERMISSIONS_MISSING',updated_at=? WHERE id=?`, [utcNow(), flow.id]);
      throw new GatewayError('FACEBOOK_REQUIRED_PERMISSIONS_MISSING', 'Facebook 授权缺少新消息收发所需权限', 409, { missingPermissions: missingRequiredPermissions, diagnostics: permissionDiagnostics });
    }
    const discovery = await discoverManagedPages(config, token.access_token, REQUIRED_PERMISSIONS, fetchImpl);
    const pages = discovery.pages;
    const pageDiagnostics = {
      ...discovery.evidence,
      stage: 'page-discovery',
      grantedPermissions,
      missingRequiredPermissions,
      missingOptionalPermissions
    };
    await persistOAuthDiagnostics(env, flow.flow_id, pages.length ? 'pages_resolved' : 'no_managed_pages', pageDiagnostics);
    if (!pages.length) {
      throw new GatewayError('FACEBOOK_NO_MANAGED_PAGES', '授权完成，但 Meta 没有返回可连接的 Facebook 公共主页', 409, { diagnostics: pageDiagnostics });
    }
    for (const page of pages) {
      const pageId = clean(page.id);
      const pageToken = clean(page.access_token);
      if (!pageId || !pageToken) continue;
      const encrypted = await encryptToken(pageToken, pageId, config.tokenEncryptionKey);
      const permissionCheckedAt = utcNow();
      await run(env.DB, `INSERT INTO facebook_oauth_page_candidates(id,flow_id,page_id,page_name,page_username,picture_url,permissions_json,missing_permissions_json,token_version,token_key_id,token_ciphertext,token_iv,token_auth_tag,token_expires_at,created_at,permission_checked_at,permission_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(flow_id,page_id) DO UPDATE SET page_name=excluded.page_name,page_username=excluded.page_username,picture_url=excluded.picture_url,permissions_json=excluded.permissions_json,missing_permissions_json=excluded.missing_permissions_json,token_version=excluded.token_version,token_key_id=excluded.token_key_id,token_ciphertext=excluded.token_ciphertext,token_iv=excluded.token_iv,token_auth_tag=excluded.token_auth_tag,token_expires_at=excluded.token_expires_at,permission_checked_at=excluded.permission_checked_at,permission_source=excluded.permission_source`, [
        randomId('fbpage_'), flow.flow_id, pageId, clean(page.name, 'Facebook 公共主页'), clean(page.username), clean(page.picture?.data?.url), JSON.stringify(grantedPermissions), JSON.stringify(missingOptionalPermissions), encrypted.version, encrypted.key_id, encrypted.ciphertext, encrypted.iv, encrypted.auth_tag, clean(token.expires_in ? addSeconds(permissionCheckedAt, token.expires_in) : ''), permissionCheckedAt, permissionCheckedAt, 'meta:/me/permissions'
      ]);
    }
    await run(env.DB, `UPDATE facebook_oauth_states SET status='authorized',error_code='',updated_at=? WHERE id=?`, [utcNow(), flow.id]);
    return { flowId: flow.flow_id, status: 'authorized' };
  } catch (error) {
    if (error.code !== 'FACEBOOK_REQUIRED_PERMISSIONS_MISSING') {
      await run(env.DB, `UPDATE facebook_oauth_states SET status='error',error_code=?,updated_at=? WHERE id=?`, [clean(error.code, 'FACEBOOK_OAUTH_CALLBACK_FAILED'), utcNow(), flow.id]);
    }
    throw error;
  }
}

export async function pollOAuthResult(request, env, flowId) {
  const flow = await assertFlowClient(request, env, flowId);
  const pages = flow.status === 'authorized' ? await all(env.DB, `SELECT page_id,page_name,page_username,picture_url,permissions_json,missing_permissions_json,token_expires_at,permission_checked_at,permission_source FROM facebook_oauth_page_candidates WHERE flow_id=? ORDER BY page_name,page_id`, [flow.flow_id]) : [];
  const diagnostics = await readOAuthDiagnostics(env, flow.flow_id);
  return {
    flowId: flow.flow_id,
    status: flow.status,
    errorCode: clean(flow.error_code),
    expiresAt: flow.expires_at,
    diagnostics,
    pages: pages.map(page => {
      const permissions = JSON.parse(page.permissions_json || '[]');
      const missingOptionalPermissions = JSON.parse(page.missing_permissions_json || '[]');
      return {
        id: page.page_id,
        name: page.page_name,
        username: page.page_username,
        picture: page.picture_url,
        permissions,
        missingPermissions: [],
        missingOptionalPermissions,
        permissionReady: true,
        newMessagingReady: true,
        historySyncAvailable: missingOptionalPermissions.length === 0,
        historySyncReason: missingOptionalPermissions.length ? 'pages_read_engagement 尚未授权，本轮仅支持新消息收发' : '',
        tokenExpiresAt: clean(page.token_expires_at),
        permissionCheckedAt: clean(page.permission_checked_at),
        permissionSource: clean(page.permission_source, 'meta:/me/permissions')
      };
    })
  };
}

export async function selectOAuthPage(request, env, config, flowId, body, fetchImpl = fetch) {
  const flow = await assertFlowClient(request, env, flowId);
  invariant(flow.status === 'authorized', 'FACEBOOK_OAUTH_NOT_AUTHORIZED', 'Facebook 授权尚未完成', 409);
  const pageId = clean(body?.pageId);
  const candidate = await first(env.DB, `SELECT * FROM facebook_oauth_page_candidates WHERE flow_id=? AND page_id=?`, [flow.flow_id, pageId]);
  invariant(candidate, 'FACEBOOK_PAGE_NOT_FOUND', '所选 Facebook 公共主页不存在', 404);
  const enrollmentValue = `${flow.flow_id}.${flow.device_id}.${flow.device_public_key_spki}.${flow.client_proof}`;
  invariant(await verifyEnrollment(config.desktopAuthMasterKey, enrollmentValue, flow.enrollment_mac), 'FACEBOOK_DEVICE_ENROLLMENT_INVALID', '设备注册证明无效', 409);
  const pageToken = await decryptToken({
    key_id: candidate.token_key_id,
    ciphertext: candidate.token_ciphertext,
    iv: candidate.token_iv,
    auth_tag: candidate.token_auth_tag,
    page_id: candidate.page_id
  }, config.tokenEncryptionKey);
  await subscribePage(config, pageId, pageToken, SUBSCRIBED_FIELDS, fetchImpl);
  const now = utcNow();
  const existingAccount = await first(env.DB, `SELECT id FROM facebook_accounts WHERE page_id=?`, [pageId]);
  const accountId = existingAccount?.id || randomId('fbacct_');
  const grantedScopes = JSON.parse(candidate.permissions_json || '[]');
  const missingPermissions = JSON.parse(candidate.missing_permissions_json || '[]');
  const historySyncAvailable = missingPermissions.length === 0;
  const historySyncReason = historySyncAvailable ? '' : 'pages_read_engagement 尚未授权；新消息收发可用，Business Suite 历史会话对账受限';
  await run(env.DB, `INSERT INTO facebook_accounts(id,page_id,page_name,page_username,page_picture_url,graph_version,permission_status,permissions_json,webhook_status,token_status,created_at,updated_at,disconnected_at,granted_scopes,missing_permissions,history_sync_available,history_sync_reason,last_permission_check_at,permission_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET page_name=excluded.page_name,page_username=excluded.page_username,page_picture_url=excluded.page_picture_url,graph_version=excluded.graph_version,permission_status=excluded.permission_status,permissions_json=excluded.permissions_json,webhook_status='subscribed',token_status='active',updated_at=excluded.updated_at,disconnected_at=NULL,granted_scopes=excluded.granted_scopes,missing_permissions=excluded.missing_permissions,history_sync_available=excluded.history_sync_available,history_sync_reason=excluded.history_sync_reason,last_permission_check_at=excluded.last_permission_check_at,permission_source=excluded.permission_source`, [
    accountId, pageId, candidate.page_name, candidate.page_username, candidate.picture_url, config.graphVersion, historySyncAvailable ? 'ready' : 'limited', candidate.permissions_json, 'subscribed', 'active', now, now, candidate.permissions_json, candidate.missing_permissions_json, historySyncAvailable ? 1 : 0, historySyncReason, clean(candidate.permission_checked_at, now), clean(candidate.permission_source, 'meta:/me/permissions')
  ]);
  const resolved = await first(env.DB, `SELECT id FROM facebook_accounts WHERE page_id=?`, [pageId]);
  const finalAccountId = resolved.id;
  await run(env.DB, `INSERT INTO facebook_page_tokens(account_id,page_id,version,key_id,ciphertext,iv,auth_tag,token_status,created_at,updated_at,last_validated_at,revoked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(account_id) DO UPDATE SET page_id=excluded.page_id,version=excluded.version,key_id=excluded.key_id,ciphertext=excluded.ciphertext,iv=excluded.iv,auth_tag=excluded.auth_tag,token_status='active',updated_at=excluded.updated_at,last_validated_at=excluded.last_validated_at,revoked_at=NULL`, [
    finalAccountId, pageId, candidate.token_version, candidate.token_key_id, candidate.token_ciphertext, candidate.token_iv, candidate.token_auth_tag, 'active', now, now, now
  ]);
  await run(env.DB, `INSERT INTO facebook_desktop_devices(id,account_id,page_id,public_key_spki,key_algorithm,status,display_name,registration_proof,created_at,updated_at,last_seen_at,disabled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,page_id=excluded.page_id,public_key_spki=excluded.public_key_spki,status='active',display_name=excluded.display_name,registration_proof=excluded.registration_proof,updated_at=excluded.updated_at,disabled_at=NULL`, [
    flow.device_id, finalAccountId, pageId, flow.device_public_key_spki, 'Ed25519', 'active', flow.device_display_name, flow.enrollment_mac, now, now, now
  ]);
  const pendingEvents = await all(env.DB, `SELECT id FROM facebook_webhook_events WHERE page_id=? AND processing_status!='expired'`, [pageId]);
  for (const event of pendingEvents) {
    await run(env.DB, `INSERT OR IGNORE INTO facebook_event_deliveries(id,event_id,account_id,device_id,status,first_available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, [
      randomId('fbdel_'), event.id, finalAccountId, flow.device_id, 'pending', now, now, now
    ]);
  }
  await run(env.DB, `UPDATE facebook_oauth_states SET status='completed',selected_page_id=?,updated_at=? WHERE id=?`, [pageId, now, flow.id]);
  await run(env.DB, `DELETE FROM facebook_oauth_page_candidates WHERE flow_id=?`, [flow.flow_id]);
  return {
    cloudAccountId: finalAccountId,
    deviceId: flow.device_id,
    page: {
      id: pageId,
      name: candidate.page_name,
      username: candidate.page_username,
      picture: candidate.picture_url,
      permissions: grantedScopes,
      missingPermissions: [],
      missingOptionalPermissions: JSON.parse(candidate.missing_permissions_json || '[]'),
      permissionReady: true,
      newMessagingReady: true,
      historySyncAvailable,
      historySyncReason,
      permissionCheckedAt: clean(candidate.permission_checked_at, now),
      permissionSource: clean(candidate.permission_source, 'meta:/me/permissions'),
      tokenStatus: 'active',
      webhookStatus: 'subscribed'
    },
    workerBaseUrl: config.workerBaseUrl || new URL(request.url).origin,
    graphVersion: config.graphVersion
  };
}

export async function cancelOAuthResult(request, env, flowId) {
  const flow = await assertFlowClient(request, env, flowId);
  await run(env.DB, `UPDATE facebook_oauth_states SET status='cancelled',updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')`, [utcNow(), flow.id]);
  await run(env.DB, `DELETE FROM facebook_oauth_page_candidates WHERE flow_id=?`, [flow.flow_id]);
  return { flowId: flow.flow_id, status: 'cancelled' };
}
