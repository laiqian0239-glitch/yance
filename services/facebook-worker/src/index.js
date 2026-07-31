import { OAUTH_AUTHORIZATION_MODE, OAUTH_CONTRACT_VERSION, OPTIONAL_PERMISSIONS, REQUIRED_PERMISSIONS, workerConfig } from './config.js';
import { cleanup } from './cleanup.js';
import { errorResponse, html, json, text, withSecurityHeaders } from './response.js';
import { GatewayError } from './errors.js';
import { beginOAuth, cancelOAuthResult, handleOAuthCallback, pollOAuthResult, selectOAuthPage } from './oauth.js';
import { ingestWebhook, verifyWebhookChallenge } from './webhook.js';
import { acknowledgeEvents, avatarResponse, disconnectAccount, health, history, historyMessages, listAccounts, mediaResponse, profile, pullEvents, refreshPermissions, sendMessage } from './desktopApi.js';
import { clean, randomId } from './utils.js';
import { all } from './db.js';

async function readBody(request, maximumBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maximumBytes) throw new GatewayError('FACEBOOK_REQUEST_BODY_TOO_LARGE', '请求正文超过大小限制', 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new GatewayError('FACEBOOK_REQUEST_BODY_TOO_LARGE', '请求正文超过大小限制', 413);
  return bytes;
}
function parseJson(bytes) {
  if (!bytes.byteLength) return {};
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch (_) { throw new GatewayError('FACEBOOK_REQUEST_JSON_INVALID', '请求正文不是有效 JSON', 400); }
}
async function d1SchemaStatus(env) {
  try {
    const columns = await all(env.DB, `PRAGMA table_info(facebook_accounts)`);
    const names = columns.map(row => clean(row.name)).filter(Boolean);
    const pagePictureColumn = names.includes('page_picture_url');
    const permissionAuthorityColumns = ['granted_scopes','missing_permissions','history_sync_available','history_sync_reason','last_permission_check_at','permission_source'].every(name => names.includes(name));
    return {
      version: permissionAuthorityColumns ? 6 : (pagePictureColumn ? 5 : 4),
      latestRequiredMigration: '0006_permission_authority.sql',
      ready: pagePictureColumn && permissionAuthorityColumns,
      pagePictureColumn,
      permissionAuthorityColumns,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      version: 0,
      latestRequiredMigration: '0006_permission_authority.sql',
      ready: false,
      pagePictureColumn: false,
      reasonCode: 'FACEBOOK_D1_SCHEMA_PROBE_FAILED',
      checkedAt: new Date().toISOString()
    };
  }
}

function noCorsPreflight(request) {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 405, headers: withSecurityHeaders({ allow: 'GET, POST, DELETE' }) });
}

function oauthCallbackErrorMessage(error) {
  if (clean(error?.code) !== 'FACEBOOK_NO_MANAGED_PAGES') return clean(error?.message, 'Facebook 授权未完成');
  const diagnostics = error?.details?.diagnostics && typeof error.details.diagnostics === 'object' ? error.details.diagnostics : {};
  const targetIds = Array.isArray(diagnostics?.debugToken?.targetIds) ? diagnostics.debugToken.targetIds : [];
  const directChecks = Array.isArray(diagnostics?.directPageChecks) ? diagnostics.directPageChecks : [];
  const directTokenChecks = Array.isArray(diagnostics?.directPageTokenChecks) ? diagnostics.directPageTokenChecks : [];
  const recovered = Number(diagnostics?.recoveredCount || 0);
  const primaryCount = Number(diagnostics?.primaryCount || 0);
  const explicitCount = Number(diagnostics?.explicitUserAccounts?.count || 0);
  const explicitSelected = Number(diagnostics?.explicitUserAccounts?.selectedCount || 0);
  const targetLabel = targetIds.length ? targetIds.join(', ') : '无';
  const profileVisible = directChecks.filter(row => row?.status === 'profile_visible_page_token_unavailable').length;
  const metaErrors = directChecks.filter(row => row?.status === 'meta_error').map(row => clean(row?.error?.metaCode || row?.error?.code)).filter(Boolean);
  const profileLabel = profileVisible ? `可见${profileVisible}个但无Page Token` : (metaErrors.length ? `Meta错误:${metaErrors.join(',')}` : '未恢复');
  const directTokenAvailable = directTokenChecks.filter(item => item?.tokenAvailable === true).length;
  const directTokenErrors = directTokenChecks
    .flatMap(item => Array.isArray(item?.attempts) ? item.attempts : [])
    .filter(item => item?.status === 'meta_error')
    .map(item => clean(item?.error?.metaReason || (item?.error?.metaCode ? `Meta错误:${item.error.metaCode}` : item?.error?.code)))
    .filter(Boolean);
  const directTokenLabel = directTokenChecks.length
    ? `${directTokenAvailable}/${directTokenChecks.length}${directTokenErrors.length ? `（${[...new Set(directTokenErrors)].join(',')}）` : ''}`
    : '未执行';
  return `授权完成，但 Meta 没有返回可连接的 Facebook 公共主页。安全证据：/me/accounts=${primaryCount}；显式用户accounts=${explicitCount}（已选=${explicitSelected}）；granular target_ids=${targetLabel}；定向Page Token=${directTokenLabel}；主页资料探针=${profileLabel}；可用Page Token=${recovered}。请返回言策查看诊断。`;
}

async function route(request, env, ctx, dependencies = {}) {
  const preflight = noCorsPreflight(request);
  if (preflight) return preflight;
  const config = workerConfig(env);
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'GET' && path === '/webhooks/facebook') return text(verifyWebhookChallenge(url, config.verifyToken));
  if (request.method === 'POST' && path === '/webhooks/facebook') {
    const rawBody = await readBody(request, config.maxWebhookBodyBytes);
    const result = await ingestWebhook(rawBody, request.headers.get('x-hub-signature-256'), env, config, ctx);
    return json({ ok: true, ...result });
  }

  if (request.method === 'GET' && path === '/oauth/facebook/start') return beginOAuth(request, env, config);
  if (request.method === 'GET' && path === '/oauth/facebook/callback') {
    try {
      const result = await handleOAuthCallback(request, env, config, dependencies.fetch || fetch);
      return html('Facebook 授权成功', `已读取可管理主页。请返回言策选择需要连接的公共主页。流程：${result.flowId}`);
    } catch (error) {
      return html('Facebook 授权未完成', oauthCallbackErrorMessage(error), error.status || 400);
    }
  }
  const resultMatch = path.match(/^\/oauth\/facebook\/result\/([^/]+)$/);
  if (resultMatch && request.method === 'GET') return json({ ok: true, ...(await pollOAuthResult(request, env, decodeURIComponent(resultMatch[1]))) });
  if (resultMatch && request.method === 'DELETE') return json({ ok: true, ...(await cancelOAuthResult(request, env, decodeURIComponent(resultMatch[1]))) });
  const selectMatch = path.match(/^\/oauth\/facebook\/result\/([^/]+)\/select$/);
  if (selectMatch && request.method === 'POST') {
    const bytes = await readBody(request, 64 * 1024);
    return json({ ok: true, ...(await selectOAuthPage(request, env, config, decodeURIComponent(selectMatch[1]), parseJson(bytes))) });
  }

  if (path === '/api/desktop/events' && request.method === 'GET') return json({ ok: true, ...(await pullEvents(request, env, config)) });
  if (path === '/api/desktop/ack' && request.method === 'POST') {
    const bytes = await readBody(request, 256 * 1024);
    return json({ ok: true, ...(await acknowledgeEvents(request, env, config, bytes, parseJson(bytes))) });
  }
  if (path === '/api/desktop/send' && request.method === 'POST') {
    const bytes = await readBody(request, config.maxDesktopBodyBytes);
    return json({ ok: true, ...(await sendMessage(request, env, config, ctx, bytes, parseJson(bytes))) });
  }
  if (path === '/api/desktop/accounts' && request.method === 'GET') return json({ ok: true, ...(await listAccounts(request, env, config)) });
  if (path === '/api/desktop/permissions/refresh' && request.method === 'POST') {
    const bytes = await readBody(request, 1024);
    return json({ ok: true, ...(await refreshPermissions(request, env, config, bytes, dependencies.fetch || fetch)) });
  }
  if (path === '/api/desktop/disconnect' && request.method === 'POST') {
    const bytes = await readBody(request, 64 * 1024);
    return json({ ok: true, ...(await disconnectAccount(request, env, config, bytes, parseJson(bytes))) });
  }
  if (path === '/api/desktop/health' && request.method === 'GET') return json({ ok: true, ...(await health(request, env, config)) });
  if (path === '/api/desktop/history' && request.method === 'GET') return json({ ok: true, ...(await history(request, env, config)) });
  if (path === '/api/desktop/history/messages' && request.method === 'GET') return json({ ok: true, ...(await historyMessages(request, env, config)) });
  if (path === '/api/desktop/profile' && request.method === 'GET') return json({ ok: true, ...(await profile(request, env, config)) });
  if (path === '/api/desktop/avatar/page' && request.method === 'GET') return avatarResponse(request, env, config, new Uint8Array(), 'page');
  if (path === '/api/desktop/avatar/profile' && request.method === 'GET') return avatarResponse(request, env, config, new Uint8Array(), 'profile');
  const mediaMatch = path.match(/^\/api\/desktop\/media\/([^/]+)\/(\d+)$/);
  if (mediaMatch && request.method === 'GET') return mediaResponse(request, env, config, new Uint8Array(), decodeURIComponent(mediaMatch[1]), Number(mediaMatch[2]));

  if (path === '/healthz' && request.method === 'GET') return json({
    ok: true,
    service: 'yance-facebook-gateway',
    time: new Date().toISOString(),
    graphVersion: config.graphVersion,
    d1Schema: await d1SchemaStatus(env),
    avatarProxyContract: {
      version: 11,
      authentication: 'desktop-device-signature',
      pageRoute: '/api/desktop/avatar/page',
      profileRoute: '/api/desktop/avatar/profile',
      contactAvatarStrategy: 'messenger-profile-then-generic-picture-then-picture-edge',
      messengerProfileFallback: true,
      identityPictureFallback: true,
      pictureEdgeFallback: true,
      persistentPageReference: true,
      deterministicPermissionClassification: true,
      deterministicUnsupportedGetClassification: true,
      preserveHistoricalAvatarOnDeterministicFailure: true,
      accountHealthSeparatedFromContactAvatarAccess: true,
      evidenceContractVersion: 6,
      deploymentMarker: 'facebook-avatar-translation-persistence-fix13-20260724',
      maximumBytes: 8 * 1024 * 1024,
      contentTypes: ['image/*']
    },
    oauthContract: {
      version: OAUTH_CONTRACT_VERSION,
      authorizationMode: OAUTH_AUTHORIZATION_MODE,
      legacyScopeParameter: false,
      callbackUrl: `${config.workerBaseUrl}/oauth/facebook/callback`,
      requiredPermissions: REQUIRED_PERMISSIONS,
      optionalPermissions: OPTIONAL_PERMISSIONS,
      pageDiscovery: {
        primary: '/me/accounts',
        tokenRecovery: ['/{debug_token.user_id}/accounts', '/{granular_target_id}?fields=access_token'],
        selectionEvidence: 'debug_token.granular_scopes.target_ids',
        directPageProfileProbe: true,
        directPageTokenRecovery: true,
        directPageTokenFields: ['id,access_token', 'access_token'],
        profileHydration: 'page-access-token',
        diagnosticsPersistedWithoutTokens: true
      }
    }
  });
  throw new GatewayError('FACEBOOK_ROUTE_NOT_FOUND', '接口不存在', 404);
}

export default {
  async fetch(request, env, ctx) {
    const requestId = clean(request.headers.get('x-request-id'), randomId('req_'));
    try { return await route(request, env, ctx); }
    catch (error) {
      console.error(JSON.stringify({ level: 'error', component: 'facebook-worker', requestId, code: clean(error.code, 'FACEBOOK_GATEWAY_INTERNAL'), status: Number(error.status || 500) }));
      return errorResponse(error, requestId);
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(cleanup(env, { config: workerConfig(env) })); }
};

export { route };
