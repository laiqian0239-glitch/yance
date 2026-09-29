import { OAUTH_AUTHORIZATION_MODE, OAUTH_CONTRACT_VERSION, OPTIONAL_PERMISSIONS, REQUIRED_PERMISSIONS, workerConfig } from './config.js';
import { cleanup } from './cleanup.js';
import { errorResponse, html, json, text, withSecurityHeaders } from './response.js';
import { GatewayError } from './errors.js';
import { beginOAuth, cancelOAuthResult, handleOAuthCallback, pollOAuthResult, selectOAuthPage } from './oauth.js';
import { clean, randomId, sha256Base64Url } from './utils.js';
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
    const [accountColumns, oauthColumns] = await Promise.all([
      all(env.DB, `PRAGMA table_info(facebook_accounts)`),
      all(env.DB, `PRAGMA table_info(facebook_oauth_states)`)
    ]);
    const accountNames = accountColumns.map(row => clean(row.name)).filter(Boolean);
    const oauthNames = oauthColumns.map(row => clean(row.name)).filter(Boolean);
    const pagePictureColumn = accountNames.includes('page_picture_url');
    const permissionAuthorityColumns = ['granted_scopes','missing_permissions','history_sync_available','history_sync_reason','last_permission_check_at','permission_source'].every(name => accountNames.includes(name));
    const personalIdentityOauthColumns = ['flow_mode','identity_json'].every(name => oauthNames.includes(name));
    return {
      version: personalIdentityOauthColumns ? 7 : (permissionAuthorityColumns ? 6 : (pagePictureColumn ? 5 : 4)),
      latestRequiredMigration: '0007_personal_identity_oauth.sql',
      ready: pagePictureColumn && permissionAuthorityColumns && personalIdentityOauthColumns,
      pagePictureColumn,
      permissionAuthorityColumns,
      personalIdentityOauthColumns,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      version: 0,
      latestRequiredMigration: '0007_personal_identity_oauth.sql',
      ready: false,
      pagePictureColumn: false,
      permissionAuthorityColumns: false,
      personalIdentityOauthColumns: false,
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

  if (path === '/healthz' && request.method === 'GET') return json({
    ok: true,
    service: 'yance-facebook-gateway',
    time: new Date().toISOString(),
    graphVersion: config.graphVersion,
    d1Schema: await d1SchemaStatus(env),
    oauthContract: {
      version: OAUTH_CONTRACT_VERSION,
      supportedModes: ['page', 'identity'],
      personalIdentity: { profileFields: ['id','name','picture'], messagingSupported: false, tokenReturnedToDesktop: false },
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
    const signedRequestId = clean(request.headers.get('x-yance-request-id'));
    try {
      const response = await route(request, env, ctx);
      if (!signedRequestId) return response;
      const headers = new Headers(response.headers);
      headers.set('x-yance-request-id', signedRequestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    catch (error) {
      console.error(JSON.stringify({ level: 'error', component: 'facebook-worker', requestId, code: clean(error.code, 'FACEBOOK_GATEWAY_INTERNAL'), status: Number(error.status || 500) }));
      const response = errorResponse(error, requestId);
      if (!signedRequestId) return response;
      const headers = new Headers(response.headers);
      headers.set('x-yance-request-id', signedRequestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(cleanup(env)); }
};

export { route };
