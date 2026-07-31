import { GatewayError, mapMetaError } from './errors.js';
import { clean } from './utils.js';

function unique(values = []) {
  return [...new Set(values.map(value => clean(value)).filter(Boolean))];
}

function safeTargetId(value) {
  const id = clean(value).slice(0, 128);
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : '';
}

export function safeMetaFailure(error) {
  return {
    code: clean(error?.code, 'FACEBOOK_META_REQUEST_FAILED'),
    status: Number(error?.status || 0) || undefined,
    metaCode: Number(error?.details?.metaCode || 0) || undefined,
    metaSubcode: Number(error?.details?.metaSubcode || 0) || undefined,
    metaReason: clean(error?.details?.metaReason) || undefined
  };
}

function graphUrl(config, path) {
  return `https://graph.facebook.com/${config.graphVersion}/${String(path || '').replace(/^\//, '')}`;
}

async function metaJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) throw mapMetaError(data, response.status);
  return data;
}

export function authorizationUrl(config, redirectUri, state) {
  const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('config_id', config.businessLoginConfigId);
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

export async function exchangeCode(config, redirectUri, code, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, 'oauth/access_token'));
  url.searchParams.set('client_id', config.appId);
  url.searchParams.set('client_secret', config.appSecret);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code', clean(code));
  const result = await metaJson(url.toString(), { headers: { accept: 'application/json' } }, fetchImpl);
  if (!clean(result.access_token)) throw new GatewayError('FACEBOOK_OAUTH_TOKEN_MISSING', 'Meta 未返回授权凭据', 502);
  return result;
}

export async function fetchGrantedPermissions(config, userAccessToken, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, 'me/permissions'));
  const result = await metaJson(url.toString(), {
    headers: { authorization: `Bearer ${userAccessToken}`, accept: 'application/json' }
  }, fetchImpl);
  return (Array.isArray(result.data) ? result.data : [])
    .filter(row => clean(row.status).toLowerCase() === 'granted')
    .map(row => clean(row.permission))
    .filter(Boolean);
}

async function fetchManagedPagesAtPath(config, path, userAccessToken, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, path));
  url.searchParams.set('fields', 'id,name,username,picture,access_token,tasks');
  url.searchParams.set('limit', '100');
  const result = await metaJson(url.toString(), {
    headers: { authorization: `Bearer ${userAccessToken}`, accept: 'application/json' }
  }, fetchImpl);
  return Array.isArray(result.data) ? result.data : [];
}

export async function fetchManagedPages(config, userAccessToken, fetchImpl = fetch) {
  return fetchManagedPagesAtPath(config, 'me/accounts', userAccessToken, fetchImpl);
}

export async function fetchManagedPagesForUser(config, userId, userAccessToken, fetchImpl = fetch) {
  const normalizedUserId = safeTargetId(userId);
  if (!normalizedUserId) throw new GatewayError('FACEBOOK_USER_ID_INVALID', 'Facebook 用户标识无效', 409);
  return fetchManagedPagesAtPath(config, `${encodeURIComponent(normalizedUserId)}/accounts`, userAccessToken, fetchImpl);
}

export async function fetchTokenDebug(config, userAccessToken, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, 'debug_token'));
  url.searchParams.set('input_token', userAccessToken);
  const appAccessToken = `${config.appId}|${config.appSecret}`;
  const result = await metaJson(url.toString(), {
    headers: { authorization: `Bearer ${appAccessToken}`, accept: 'application/json' }
  }, fetchImpl);
  return result && typeof result.data === 'object' ? result.data : {};
}

export function tokenTargetEvidence(debugData = {}, requiredPermissions = []) {
  const required = new Set(requiredPermissions.map(permission => clean(permission)).filter(Boolean));
  const granularScopes = (Array.isArray(debugData.granular_scopes) ? debugData.granular_scopes : [])
    .map(row => ({
      scope: clean(row?.scope),
      targetIds: unique(Array.isArray(row?.target_ids) ? row.target_ids.map(safeTargetId) : [])
    }))
    .filter(row => row.scope && (!required.size || required.has(row.scope)));
  return {
    valid: debugData.is_valid === true,
    appId: clean(debugData.app_id),
    userId: safeTargetId(debugData.user_id),
    scopes: unique(Array.isArray(debugData.scopes) ? debugData.scopes : []),
    granularScopes,
    targetIds: unique(granularScopes.flatMap(row => row.targetIds)).slice(0, 50)
  };
}

export async function fetchManagedPageById(config, pageId, userAccessToken, fetchImpl = fetch) {
  const normalizedPageId = safeTargetId(pageId);
  if (!normalizedPageId) throw new GatewayError('FACEBOOK_PAGE_TARGET_ID_INVALID', 'Facebook 公共主页目标标识无效', 409);
  const url = new URL(graphUrl(config, encodeURIComponent(normalizedPageId)));
  // This is diagnostics-only. Keep the field set deliberately minimal because
  // Page task and profile fields can have different permission gates than the
  // access_token field and may turn an otherwise useful visibility probe into
  // Graph error 100.
  url.searchParams.set('fields', 'id,name');
  return metaJson(url.toString(), {
    headers: { authorization: `Bearer ${userAccessToken}`, accept: 'application/json' }
  }, fetchImpl);
}

async function fetchPageTokenAtFields(config, pageId, fields, userAccessToken, fetchImpl = fetch) {
  const normalizedPageId = safeTargetId(pageId);
  if (!normalizedPageId) throw new GatewayError('FACEBOOK_PAGE_TARGET_ID_INVALID', 'Facebook 公共主页目标标识无效', 409);
  const url = new URL(graphUrl(config, encodeURIComponent(normalizedPageId)));
  url.searchParams.set('fields', fields);
  return metaJson(url.toString(), {
    headers: { authorization: `Bearer ${userAccessToken}`, accept: 'application/json' }
  }, fetchImpl);
}

export async function fetchPageAccessTokenById(config, pageId, userAccessToken, fetchImpl = fetch) {
  const attempts = [];
  for (const fields of ['id,access_token', 'access_token']) {
    try {
      const page = await fetchPageTokenAtFields(config, pageId, fields, userAccessToken, fetchImpl);
      const tokenAvailable = Boolean(clean(page?.access_token));
      attempts.push({ fields, status: tokenAvailable ? 'token_available' : 'token_missing' });
      if (tokenAvailable) return { page, attempts };
    } catch (error) {
      attempts.push({ fields, status: 'meta_error', error: safeMetaFailure(error) });
      if (Number(error?.details?.metaCode || 0) !== 100) break;
    }
  }
  return { page: null, attempts };
}

export async function fetchPageProfileWithToken(config, pageId, pageAccessToken, fetchImpl = fetch) {
  const normalizedPageId = safeTargetId(pageId);
  if (!normalizedPageId) throw new GatewayError('FACEBOOK_PAGE_TARGET_ID_INVALID', 'Facebook 公共主页目标标识无效', 409);
  const url = new URL(graphUrl(config, encodeURIComponent(normalizedPageId)));
  url.searchParams.set('fields', 'id,name,username,picture');
  return metaJson(url.toString(), {
    headers: { authorization: `Bearer ${pageAccessToken}`, accept: 'application/json' }
  }, fetchImpl);
}

export async function discoverManagedPages(config, userAccessToken, requiredPermissions = [], fetchImpl = fetch) {
  const primaryPages = await fetchManagedPages(config, userAccessToken, fetchImpl);
  const evidence = {
    schemaVersion: 3,
    primaryEndpoint: '/me/accounts',
    primaryCount: primaryPages.length,
    resolutionSource: primaryPages.length ? 'me_accounts' : 'none',
    debugToken: { attempted: false, valid: false, appIdMatches: false, userIdPresent: false, scopes: [], granularScopes: [], targetIds: [], error: null },
    explicitUserAccounts: { attempted: false, endpoint: '', count: 0, selectedCount: 0, error: null },
    directPageChecks: [],
    directPageTokenChecks: [],
    recoveredCount: 0
  };
  if (primaryPages.length) return { pages: primaryPages, evidence };

  let debugData = {};
  let debugUserId = '';
  try {
    debugData = await fetchTokenDebug(config, userAccessToken, fetchImpl);
    const debugEvidence = tokenTargetEvidence(debugData, requiredPermissions);
    debugUserId = debugEvidence.userId;
    evidence.debugToken = {
      attempted: true,
      valid: debugEvidence.valid,
      appIdMatches: debugEvidence.appId === clean(config.appId),
      userIdPresent: Boolean(debugUserId),
      scopes: debugEvidence.scopes,
      granularScopes: debugEvidence.granularScopes,
      targetIds: debugEvidence.targetIds,
      error: null
    };
  } catch (error) {
    evidence.debugToken = {
      attempted: true,
      valid: false,
      appIdMatches: false,
      userIdPresent: false,
      scopes: [],
      granularScopes: [],
      targetIds: [],
      error: safeMetaFailure(error)
    };
    return { pages: [], evidence };
  }

  if (!evidence.debugToken.valid || !evidence.debugToken.appIdMatches) return { pages: [], evidence };

  const targetIds = new Set(evidence.debugToken.targetIds);
  if (debugUserId) {
    evidence.explicitUserAccounts.attempted = true;
    evidence.explicitUserAccounts.endpoint = '/{debug_token.user_id}/accounts';
    try {
      const userPages = await fetchManagedPagesForUser(config, debugUserId, userAccessToken, fetchImpl);
      evidence.explicitUserAccounts.count = userPages.length;
      const selectedPages = targetIds.size
        ? userPages.filter(page => targetIds.has(safeTargetId(page?.id)))
        : userPages;
      evidence.explicitUserAccounts.selectedCount = selectedPages.length;
      const pagesWithTokens = selectedPages.filter(page => safeTargetId(page?.id) && clean(page?.access_token));
      if (pagesWithTokens.length) {
        evidence.recoveredCount = pagesWithTokens.length;
        evidence.resolutionSource = 'debug_user_accounts';
        return { pages: pagesWithTokens, evidence };
      }
    } catch (error) {
      evidence.explicitUserAccounts.error = safeMetaFailure(error);
    }
  }

  const directlyRecovered = [];
  for (const pageId of evidence.debugToken.targetIds.slice(0, 25)) {
    const check = { pageId, endpoint: '/{granular_target_id}?fields=access_token', attempts: [], tokenAvailable: false, profileStatus: 'not_attempted' };
    try {
      const tokenResult = await fetchPageAccessTokenById(config, pageId, userAccessToken, fetchImpl);
      check.attempts = tokenResult.attempts;
      const pageToken = clean(tokenResult.page?.access_token);
      if (!pageToken) {
        evidence.directPageTokenChecks.push(check);
        continue;
      }
      check.tokenAvailable = true;
      let profile = {};
      try {
        profile = await fetchPageProfileWithToken(config, pageId, pageToken, fetchImpl);
        check.profileStatus = 'loaded_with_page_token';
      } catch (error) {
        check.profileStatus = 'profile_unavailable_token_kept';
        check.profileError = safeMetaFailure(error);
      }
      const resolvedId = safeTargetId(profile?.id || tokenResult.page?.id || pageId);
      if (resolvedId) {
        directlyRecovered.push({
          id: resolvedId,
          name: clean(profile?.name, `Facebook 公共主页 ${resolvedId}`),
          username: clean(profile?.username),
          picture: profile?.picture,
          access_token: pageToken
        });
      }
    } catch (error) {
      check.attempts.push({ fields: '', status: 'worker_error', error: safeMetaFailure(error) });
    }
    evidence.directPageTokenChecks.push(check);
  }
  if (directlyRecovered.length) {
    evidence.recoveredCount = directlyRecovered.length;
    evidence.resolutionSource = 'granular_target_direct_page_token';
    return { pages: directlyRecovered, evidence };
  }

  for (const pageId of evidence.debugToken.targetIds.slice(0, 25)) {
    try {
      const page = await fetchManagedPageById(config, pageId, userAccessToken, fetchImpl);
      const resolvedId = safeTargetId(page?.id || pageId);
      evidence.directPageChecks.push({
        pageId: resolvedId || pageId,
        status: resolvedId ? 'profile_visible_page_token_unavailable' : 'profile_unresolved'
      });
    } catch (error) {
      evidence.directPageChecks.push({ pageId, status: 'meta_error', error: safeMetaFailure(error) });
    }
  }
  return { pages: [], evidence };
}

export async function subscribePage(config, pageId, pageToken, subscribedFields, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, `${encodeURIComponent(pageId)}/subscribed_apps`));
  const result = await metaJson(url.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${pageToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ subscribed_fields: subscribedFields.join(',') })
  }, fetchImpl);
  if (result.success !== true) throw new GatewayError('FACEBOOK_WEBHOOK_SUBSCRIBE_FAILED', 'Facebook 公共主页 Webhook 订阅失败', 409);
  return result;
}

export async function unsubscribePage(config, pageId, pageToken, fetchImpl = fetch) {
  return metaJson(graphUrl(config, `${encodeURIComponent(pageId)}/subscribed_apps`), {
    method: 'DELETE', headers: { authorization: `Bearer ${pageToken}`, accept: 'application/json' }
  }, fetchImpl);
}

export async function pageProfile(config, pageId, pageToken, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, encodeURIComponent(pageId)));
  url.searchParams.set('fields', 'id,name,username,picture');
  return metaJson(url.toString(), { headers: { authorization: `Bearer ${pageToken}`, accept: 'application/json' } }, fetchImpl);
}

export async function senderProfile(config, psid, pageToken, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, encodeURIComponent(psid)));
  url.searchParams.set('fields', 'first_name,last_name,profile_pic');
  return metaJson(url.toString(), { headers: { authorization: `Bearer ${pageToken}`, accept: 'application/json' } }, fetchImpl);
}

export async function senderIdentityPicture(config, psid, pageToken, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, encodeURIComponent(psid)));
  url.searchParams.set('fields', 'id,name,picture.type(large){url,is_silhouette}');
  return metaJson(url.toString(), { headers: { authorization: `Bearer ${pageToken}`, accept: 'application/json' } }, fetchImpl);
}

function allowedPictureReference(value) {
  let url;
  try { url = new URL(clean(value)); } catch (_) { throw new GatewayError('FACEBOOK_AVATAR_URL_INVALID', 'Facebook 头像地址无效', 502); }
  const host = url.hostname.toLowerCase();
  const allowed = url.protocol === 'https:' && ['graph.facebook.com', 'facebook.com', 'fbcdn.net', 'fbsbx.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
  if (!allowed) throw new GatewayError('FACEBOOK_AVATAR_URL_BLOCKED', 'Facebook 头像地址不在允许范围内', 502);
  return url;
}

export async function fetchProfilePictureAsset(reference, pageToken, fetchImpl = fetch) {
  let current = allowedPictureReference(reference);
  for (let hop = 0; hop < 5; hop += 1) {
    const graphHost = current.hostname.toLowerCase() === 'graph.facebook.com';
    const response = await fetchImpl(current.toString(), {
      headers: {
        accept: 'image/*',
        ...(graphHost ? { authorization: `Bearer ${pageToken}` } : {})
      },
      redirect: 'manual'
    });
    if (response.status >= 300 && response.status < 400) {
      const location = clean(response.headers.get('location'));
      if (!location) throw new GatewayError('FACEBOOK_AVATAR_REDIRECT_INVALID', 'Facebook 头像重定向无效', 502);
      current = allowedPictureReference(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) {
      const contentType = clean(response.headers.get('content-type')).toLowerCase();
      if (graphHost && contentType.includes('json')) {
        const payload = await response.json().catch(() => ({}));
        throw mapMetaError(payload, response.status);
      }
      throw new GatewayError('FACEBOOK_AVATAR_FETCH_FAILED', `Facebook 头像读取失败（HTTP ${response.status}）`, response.status >= 400 && response.status < 500 ? response.status : 502);
    }
    const contentType = clean(response.headers.get('content-type')).toLowerCase();
    if (!contentType.startsWith('image/')) throw new GatewayError('FACEBOOK_AVATAR_CONTENT_INVALID', 'Facebook 头像响应不是图片', 502);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > 8 * 1024 * 1024) throw new GatewayError('FACEBOOK_AVATAR_TOO_LARGE', 'Facebook 头像文件过大', 413);
    return response;
  }
  throw new GatewayError('FACEBOOK_AVATAR_REDIRECT_LIMIT', 'Facebook 头像重定向次数过多', 502);
}

export function graphPictureReference(config, identity, type = 'large') {
  const normalized = safeTargetId(identity);
  if (!normalized) throw new GatewayError('FACEBOOK_AVATAR_ID_INVALID', 'Facebook 头像身份标识无效', 400);
  const url = new URL(graphUrl(config, `${encodeURIComponent(normalized)}/picture`));
  url.searchParams.set('type', clean(type, 'large'));
  url.searchParams.set('redirect', '1');
  return url.toString();
}

export async function fetchGraphPictureAsset(config, identity, pageToken, fetchImpl = fetch) {
  return fetchProfilePictureAsset(graphPictureReference(config, identity), pageToken, fetchImpl);
}

export async function listConversations(config, pageId, pageToken, { limit = 50, after = '', messagesLimit = 50 } = {}, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, `${encodeURIComponent(pageId)}/conversations`));
  url.searchParams.set('platform', 'messenger');
  url.searchParams.set('fields', `id,updated_time,unread_count,participants,messages.limit(${Math.min(100, messagesLimit)}){id,created_time,from,to,message,attachments}`);
  url.searchParams.set('limit', String(Math.min(100, limit)));
  if (after) url.searchParams.set('after', after);
  return metaJson(url.toString(), { headers: { authorization: `Bearer ${pageToken}`, accept: 'application/json' } }, fetchImpl);
}

export async function listConversationMessages(config, conversationId, pageToken, { limit = 50, after = '' } = {}, fetchImpl = fetch) {
  const url = new URL(graphUrl(config, `${encodeURIComponent(conversationId)}/messages`));
  url.searchParams.set('fields', 'id,created_time,from,to,message,attachments');
  url.searchParams.set('limit', String(Math.min(100, limit)));
  if (after) url.searchParams.set('after', after);
  return metaJson(url.toString(), { headers: { authorization: `Bearer ${pageToken}`, accept: 'application/json' } }, fetchImpl);
}

export async function sendOperation(config, pageToken, operation, fetchImpl = fetch) {
  const url = graphUrl(config, 'me/messages');
  if (operation.kind === 'media') {
    const bytes = Uint8Array.from(atob(operation.media.dataBase64), character => character.charCodeAt(0));
    const form = new FormData();
    form.set('recipient', JSON.stringify({ id: operation.recipientId }));
    form.set('messaging_type', 'RESPONSE');
    const message = { attachment: { type: operation.media.attachmentType, payload: { is_reusable: false } } };
    if (operation.replyToMessageId) message.reply_to = { mid: operation.replyToMessageId };
    form.set('message', JSON.stringify(message));
    form.set('filedata', new Blob([bytes], { type: operation.media.mimeType }), operation.media.filename);
    return metaJson(url, { method: 'POST', headers: { authorization: `Bearer ${pageToken}` }, body: form }, fetchImpl);
  }
  const payload = { recipient: { id: operation.recipientId } };
  if (operation.kind === 'text') {
    payload.messaging_type = 'RESPONSE';
    payload.message = { text: operation.text };
    if (operation.replyToMessageId) payload.message.reply_to = { mid: operation.replyToMessageId };
  } else {
    payload.sender_action = operation.kind;
  }
  return metaJson(url, { method: 'POST', headers: { authorization: `Bearer ${pageToken}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }, fetchImpl);
}
