'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const accountStore = require('./accountStore');
const { PATHS } = require('../config');
const { getSecurityGuard } = require('../core/securityGuardSingleton');
const securityGuard = getSecurityGuard();
const platformAuthConfig = require('./platformAuthConfig');
const relayClient = require('./facebookRelayClient');
const logger = require('./logger');

const FLOW_TTL_MS = 30 * 60 * 1000;
const PAGE_WORKER_OAUTH_CONTRACT_VERSION = 5;
const IDENTITY_WORKER_OAUTH_CONTRACT_VERSION = 6;
const WORKER_OAUTH_CONTRACT_VERSION = PAGE_WORKER_OAUTH_CONTRACT_VERSION;
const REQUIRED_PAGE_PERMISSIONS = Object.freeze(['pages_show_list', 'pages_messaging', 'pages_manage_metadata']);
const OPTIONAL_PAGE_PERMISSIONS = Object.freeze(['pages_read_engagement']);
const flows = new Map();
const FLOW_FILE_PREFIX = 'facebook-oauth-flow-';

function clean(value, fallback = '') { const normalized = value == null ? '' : String(value).trim(); return normalized || fallback; }
function operationAbortError(signal, fallbackCode = 'FACEBOOK_OAUTH_ABORTED') {
  const reason = signal?.reason instanceof Error ? signal.reason : Object.assign(new Error('Facebook OAuth operation aborted'), { code: fallbackCode });
  if (!reason.code) reason.code = fallbackCode;
  return reason;
}
function assertOperationActive(signal, fallbackCode = 'FACEBOOK_OAUTH_ABORTED') {
  if (signal?.aborted) throw operationAbortError(signal, fallbackCode);
}
function now() { return new Date().toISOString(); }
function flowFile(flowId) { return path.join(PATHS.tmp, `${FLOW_FILE_PREFIX}${clean(flowId)}.enc`); }
function flowKey(scope) { return crypto.createHash('sha256').update(`yance-facebook-oauth-flow-v1:${process.env.USERNAME || process.env.USER || 'local'}:${String(scope || '')}`).digest(); }
function writeDurableFlow(flow) {
  if (!flow?.clientSecret || !flow?.flowId) return;
  const key = flowKey(flow.accountId);
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(flow), 'utf8'), cipher.final()]);
  const payload = JSON.stringify({ v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), body: body.toString('base64url') });
  fs.mkdirSync(PATHS.tmp, { recursive: true });
  const target = flowFile(flow.flowId); const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, payload, { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temp, target);
}
function readDurableFlow(account, flowId) {
  try {
    const raw = JSON.parse(fs.readFileSync(flowFile(flowId), 'utf8'));
    const key = flowKey(account?.accountId || account?.id || '');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(raw.tag, 'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(raw.body, 'base64url')), decipher.final()]).toString('utf8'));
  } catch (_) { return null; }
}
function findPendingFlow(flowId) {
  for (const ref of securityGuard.credentials.listRefs()) {
    const value = securityGuard.credentials.get(ref) || {};
    if (clean(value.pendingFacebookOAuth?.flowId) === clean(flowId)) return value.pendingFacebookOAuth;
  }
  return null;
}
function findDurableFlow(accountId, flowId) {
  for (const ref of securityGuard.credentials.listRefs()) {
    const account = { credentialRef: ref, accountId };
    const flow = readDurableFlow(account, flowId);
    if (flow) return flow;
  }
  return null;
}
function removeDurableFlow(flowId) {
  try {
    fs.rmSync(flowFile(flowId), { force: true });
    return true;
  } catch (error) {
    logger.warn('facebook', 'oauth-flow-cleanup-failed', {
      operation: 'facebookOAuth.removeDurableFlow',
      accountId: '', conversationId: '',
      reasonCode: error.code || 'FACEBOOK_OAUTH_FLOW_CLEANUP_FAILED',
      httpStatus: 0, attempt: 1, nextRetryAt: '',
      flowId: clean(flowId), error: error.message
    });
    return false;
  }
}
function normalizePermission(value) {
  if (value && typeof value === 'object') {
    const status = clean(value.status).toLowerCase();
    if (status && status !== 'granted') return '';
    return clean(value.permission || value.name || value.id);
  }
  return clean(value);
}
function permissionList(page = {}) {
  return Array.isArray(page.permissions || page.perms) ? [...new Set((page.permissions || page.perms).map(normalizePermission).filter(Boolean))] : [];
}
function missingPagePermissions(page = {}) {
  const granted = new Set(permissionList(page));
  return REQUIRED_PAGE_PERMISSIONS.filter(permission => !granted.has(permission));
}
function missingOptionalPagePermissions(page = {}) {
  const granted = new Set(permissionList(page));
  return OPTIONAL_PAGE_PERMISSIONS.filter(permission => !granted.has(permission));
}
function safePage(page = {}) {
  const permissions = permissionList(page);
  const missingPermissions = missingPagePermissions(page);
  const missingOptionalPermissions = missingOptionalPagePermissions(page);
  return {
    id: clean(page.id), name: clean(page.name, 'Facebook 公共主页'), username: clean(page.username),
    picture: clean(page.picture?.data?.url || page.picture), permissions, permissionReady: missingPermissions.length === 0,
    missingPermissions, missingOptionalPermissions, newMessagingReady: missingPermissions.length === 0,
    historySyncAvailable: missingOptionalPermissions.length === 0,
    historySyncReason: missingOptionalPermissions.length ? 'pages_read_engagement 尚未授权；实时 Webhook 可继续收发，但 Meta Business Suite 最近会话与外部发送消息无法主动补齐' : '',
    tokenExpiresAt: clean(page.tokenExpiresAt), tokenStatus: clean(page.tokenStatus, 'active'), webhookStatus: clean(page.webhookStatus, 'subscribed'),
    permissionCheckedAt: clean(page.permissionCheckedAt), permissionSource: clean(page.permissionSource, 'meta:/me/permissions')
  };
}

function facebookOAuthFailureMessage(errorCode, diagnostics = {}) {
  const code = clean(errorCode);
  if (code !== 'FACEBOOK_NO_MANAGED_PAGES') return code || 'Facebook 授权未完成';
  const primaryCount = Number(diagnostics?.primaryCount || 0);
  const targetIds = Array.isArray(diagnostics?.debugToken?.targetIds) ? diagnostics.debugToken.targetIds : [];
  const recoveredCount = Number(diagnostics?.recoveredCount || 0);
  const explicitCount = Number(diagnostics?.explicitUserAccounts?.count || 0);
  const explicitSelected = Number(diagnostics?.explicitUserAccounts?.selectedCount || 0);
  const directChecks = Array.isArray(diagnostics?.directPageChecks) ? diagnostics.directPageChecks : [];
  const directTokenChecks = Array.isArray(diagnostics?.directPageTokenChecks) ? diagnostics.directPageTokenChecks : [];
  const profileVisible = directChecks.filter(row => row && row.status === 'profile_visible_page_token_unavailable').length;
  const directTokenAvailable = directTokenChecks.filter(row => row && row.tokenAvailable === true).length;
  const directReasons = directTokenChecks
    .flatMap(row => Array.isArray(row?.attempts) ? row.attempts : [])
    .filter(row => row?.status === 'meta_error')
    .map(row => clean(row?.error?.metaReason || row?.error?.metaCode || row?.error?.code))
    .filter(Boolean);
  return `Meta 未返回可连接主页：/me/accounts ${primaryCount} 条，显式用户accounts ${explicitCount} 条（已选 ${explicitSelected}），授权目标 ${targetIds.length} 个，定向Page Token ${directTokenAvailable}/${directTokenChecks.length}${directReasons.length ? `（${[...new Set(directReasons)].join(',')}）` : ''}，主页资料可见但无Page Token ${profileVisible} 个，可用Page Token ${recoveredCount} 个`;
}

function prune() {
  const cutoff = Date.now() - FLOW_TTL_MS;
  for (const [id, flow] of flows) if (flow.createdMs < cutoff || ['cancelled','completed'].includes(flow.status)) flows.delete(id);
}
async function persistPendingFlow(account, flow, options = {}) {
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_PERSIST_ABORTED');
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
  const existing = securityGuard.credentials.get(account.credentialRef) || {};
  await securityGuard.credentials.persist(account.credentialRef, {
    ...existing,
    pendingFacebookOAuth: {
      flowId: flow.flowId, accountId: flow.accountId, clientSecret: flow.clientSecret,
      createdAt: flow.createdAt, createdMs: flow.createdMs, status: flow.status,
      pages: flow.pages, diagnostics: flow.diagnostics || null,
      workerBaseUrl: flow.workerBaseUrl, graphVersion: flow.graphVersion, identity: flow.identity, mode: flow.mode || 'page'
    }
  });
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_PERSIST_ABORTED');
}
async function clearPendingFlow(account, flowId, options = {}) {
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CLEAR_ABORTED');
  if (!account?.credentialRef) return;
  const existing = securityGuard.credentials.get(account.credentialRef) || {};
  if (clean(existing.pendingFacebookOAuth?.flowId) !== clean(flowId)) return;
  const { pendingFacebookOAuth: _discarded, ...next } = existing;
  await securityGuard.credentials.persist(account.credentialRef, next);
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CLEAR_ABORTED');
  removeDurableFlow(flowId);
}
async function getFlow(accountId, flowId) {
  prune(); let flow = flows.get(clean(flowId));
  if (!flow) {
    const account = accountStore.get(accountId);
    const pending = account?.credentialRef ? (securityGuard.credentials.get(account.credentialRef) || {}).pendingFacebookOAuth : null;
    const recoveredPending = pending || findPendingFlow(flowId);
    const durable = readDurableFlow({ ...account, accountId }, flowId) || findDurableFlow(accountId, flowId);
    const candidate = durable || recoveredPending;
    const createdMs = Number(candidate?.createdMs || 0);
    if (clean(candidate?.flowId) === clean(flowId) && createdMs >= Date.now() - FLOW_TTL_MS) {
      flow = { ...candidate, accountId, createdMs, pages: Array.isArray(candidate.pages) ? candidate.pages : [] };
      flows.set(flow.flowId, flow);
      logger.info('facebook', 'oauth-flow-recovered', { accountId, flowId: flow.flowId });
    }
  }
  if (!flow) throw Object.assign(new Error('Facebook 授权流程已过期或不存在'), { code: 'FACEBOOK_OAUTH_FLOW_NOT_FOUND', status: 404 });
  if (clean(flow.accountId) !== clean(accountId)) throw Object.assign(new Error('Facebook OAuth flow account mismatch'), { code: 'FACEBOOK_OAUTH_FLOW_ACCOUNT_MISMATCH', status: 409 });
  return flow;
}
async function workerRequest(url, options = {}, timeoutMs = 15000, operation = {}) {
  assertOperationActive(operation.signal, 'FACEBOOK_OAUTH_WORKER_ABORTED');
  const controller = new AbortController();
  const timeoutError = Object.assign(new Error('Facebook OAuth worker request timed out'), { code: 'FACEBOOK_OAUTH_WORKER_TIMEOUT' });
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  timer.unref?.();
  let onAbort = null;
  if (operation.signal) {
    onAbort = () => controller.abort(operationAbortError(operation.signal, 'FACEBOOK_OAUTH_WORKER_ABORTED'));
    operation.signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { accept: 'application/json', ...(options.headers || {}) } });
    assertOperationActive(operation.signal, 'FACEBOOK_OAUTH_WORKER_ABORTED');
    const data = await response.json().catch(() => ({}));
    assertOperationActive(operation.signal, 'FACEBOOK_OAUTH_WORKER_ABORTED');
    if (!response.ok || data.ok === false) throw Object.assign(new Error(data.message || `Facebook 云端授权服务返回 HTTP ${response.status}`), { code: data.code || 'FACEBOOK_OAUTH_WORKER_ERROR', status: response.status, details: data.details || {} });
    return data;
  } catch (error) {
    if (operation.signal?.aborted) throw operationAbortError(operation.signal, 'FACEBOOK_OAUTH_WORKER_ABORTED');
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    if (onAbort) operation.signal?.removeEventListener?.('abort', onAbort);
  }
}

async function verifyWorkerOAuthContract(workerBaseUrl, graphVersion, mode = 'page', options = {}) {
  const data = await workerRequest(`${workerBaseUrl}/healthz`, {}, 10000, options);
  const contract = data && typeof data.oauthContract === 'object' ? data.oauthContract : {};
  const required = Array.isArray(contract.requiredPermissions) ? contract.requiredPermissions.map(clean) : [];
  const optional = Array.isArray(contract.optionalPermissions) ? contract.optionalPermissions.map(clean) : [];
  const expectedCallback = `${workerBaseUrl}/oauth/facebook/callback`;
  const pageDiscovery = contract.pageDiscovery && typeof contract.pageDiscovery === 'object' ? contract.pageDiscovery : {};
  const valid = data.service === 'yance-facebook-gateway'
    && Number(contract.version || 0) >= (mode === 'identity' ? IDENTITY_WORKER_OAUTH_CONTRACT_VERSION : PAGE_WORKER_OAUTH_CONTRACT_VERSION)
    && contract.authorizationMode === 'business-login-configuration'
    && contract.legacyScopeParameter === false
    && clean(contract.callbackUrl) === expectedCallback
    && clean(data.graphVersion) === clean(graphVersion)
    && REQUIRED_PAGE_PERMISSIONS.every(permission => required.includes(permission))
    && optional.includes('pages_read_engagement')
    && clean(pageDiscovery.primary) === '/me/accounts'
    && Array.isArray(pageDiscovery.tokenRecovery)
    && pageDiscovery.tokenRecovery.includes('/{debug_token.user_id}/accounts')
    && pageDiscovery.tokenRecovery.includes('/{granular_target_id}?fields=access_token')
    && clean(pageDiscovery.selectionEvidence) === 'debug_token.granular_scopes.target_ids'
    && pageDiscovery.directPageProfileProbe === true
    && pageDiscovery.directPageTokenRecovery === true
    && Array.isArray(pageDiscovery.directPageTokenFields)
    && pageDiscovery.directPageTokenFields.includes('id,access_token')
    && pageDiscovery.directPageTokenFields.includes('access_token')
    && clean(pageDiscovery.profileHydration) === 'page-access-token'
    && pageDiscovery.diagnosticsPersistedWithoutTokens === true
    && (mode !== 'identity' || (Array.isArray(contract.supportedModes) && contract.supportedModes.includes('identity') && contract.personalIdentity?.messagingSupported === false && contract.personalIdentity?.tokenReturnedToDesktop === false));
  if (!valid) {
    throw Object.assign(new Error('Facebook 正式 Worker 仍是旧授权合同或配置不完整，请先更新 Meta 回调/权限并重新部署现有 Worker'), {
      code: 'FACEBOOK_WORKER_OAUTH_CONTRACT_STALE',
      status: 409,
      details: {
        expectedContractVersion: mode === 'identity' ? IDENTITY_WORKER_OAUTH_CONTRACT_VERSION : PAGE_WORKER_OAUTH_CONTRACT_VERSION,
        receivedContractVersion: Number(contract.version || 0),
        expectedCallback,
        receivedCallback: clean(contract.callbackUrl),
        expectedGraphVersion: clean(graphVersion),
        receivedGraphVersion: clean(data.graphVersion)
      }
    });
  }
  return { service: data.service, graphVersion: data.graphVersion, oauthContract: contract };
}

async function begin(accountId, options = {}) {
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
  const account = accountStore.get(accountId);
  if (!account || account.platform !== 'facebook') throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
  const config = platformAuthConfig.facebook();
  if (!config.configured) throw Object.assign(new Error('当前安装包尚未启用 Facebook 登录，请安装已启用的正式升级包'), { code: 'FACEBOOK_RELEASE_SERVICE_UNAVAILABLE', status: 409 });
  const boundWorkerBaseUrl = relayClient.assertReleaseWorkerBinding(config.workerBaseUrl);
  const accountKind = clean(account?.metadata?.accountKind || account?.accountKind, 'page').toLowerCase();
  const mode = accountKind === 'personal-identity' ? 'identity' : 'page';
  await verifyWorkerOAuthContract(boundWorkerBaseUrl, config.graphVersion, mode, options);
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
  prune();
  const existing = securityGuard.credentials.get(account.credentialRef) || {};
  const identity = relayClient.generateDeviceIdentity(existing);
  const flowId = `fbflow_${crypto.randomUUID()}`;
  const clientSecret = platformAuthConfig.randomSecret(32);
  const clientProof = platformAuthConfig.sha256Base64Url(clientSecret);
  const url = new URL(`${boundWorkerBaseUrl}/oauth/facebook/start`);
  url.searchParams.set('flow_id', flowId);
  url.searchParams.set('client_proof', clientProof);
  url.searchParams.set('device_id', identity.deviceId);
  url.searchParams.set('public_key', identity.publicKeySpki);
  url.searchParams.set('device_name', clean(process.env.COMPUTERNAME || 'Yance Windows').slice(0, 120));
  url.searchParams.set('mode', mode);
  const flow = { flowId, accountId, clientSecret, createdAt: now(), createdMs: Date.now(), status: 'pending', mode, pages: [], workerBaseUrl: boundWorkerBaseUrl, graphVersion: config.graphVersion, identity };
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
  flows.set(flowId, flow);
  writeDurableFlow(flow);
  await persistPendingFlow(account, flow, options);
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_START_ABORTED');
  logger.info('facebook', 'oauth-flow-started', { accountId, flowId, workerHost: new URL(boundWorkerBaseUrl).host });
  return { flowId, mode, authorizationUrl: url.toString(), status: 'pending', expiresAt: new Date(Date.now() + FLOW_TTL_MS).toISOString() };
}

async function poll(accountId, flowId, options = {}) {
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_STATUS_ABORTED');
  const flow = await getFlow(accountId, flowId);
  if (flow.status === 'authorized') return { flowId, mode: flow.mode || 'page', status: flow.status, identity: flow.personalIdentity || null, pages: flow.pages, expiresAt: new Date(flow.createdMs + FLOW_TTL_MS).toISOString() };
  const data = await workerRequest(`${flow.workerBaseUrl}/oauth/facebook/result/${encodeURIComponent(flow.flowId)}`, { headers: { authorization: `Bearer ${flow.clientSecret}` } }, 15000, options);
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_STATUS_ABORTED');
  const status = clean(data.status, 'pending');
  if (['denied','error','cancelled'].includes(status)) {
    flow.status = status;
    flow.diagnostics = data.diagnostics && typeof data.diagnostics === 'object' ? data.diagnostics : null;
    flow.error = clean(data.message) || facebookOAuthFailureMessage(data.errorCode, flow.diagnostics || {});
    return { flowId, status, error: flow.error, errorCode: clean(data.errorCode), diagnostics: flow.diagnostics };
  }
  if (status !== 'authorized') return { flowId, mode: clean(data.mode, flow.mode || 'page'), status: 'pending', expiresAt: clean(data.expiresAt, new Date(flow.createdMs + FLOW_TTL_MS).toISOString()) };
  const mode = clean(data.mode, flow.mode || 'page');
  if (mode === 'identity') {
    const identity = data.identity && typeof data.identity === 'object' ? data.identity : {};
    const userId = clean(identity.userId);
    if (!userId) throw Object.assign(new Error('Facebook 个人身份授权结果缺失用户标识'), { code: 'FACEBOOK_PERSONAL_IDENTITY_MISSING', status: 502 });
    const account = accountStore.get(accountId);
    if (!account) throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
    const completedAt = now();
    const identityReceipt = crypto.createHash('sha256').update(`${flow.workerBaseUrl}\n${flow.flowId}\n${userId}\n${completedAt}`).digest('hex');
    const existing = securityGuard.credentials.get(account.credentialRef) || {};
    const pendingFacebookOAuth = existing.pendingFacebookOAuth;
    await securityGuard.credentials.persist(account.credentialRef, {
      ...(pendingFacebookOAuth ? { pendingFacebookOAuth } : {}),
      authorizationMode: 'facebook-login-personal-identity',
      userId,
      displayName: clean(identity.displayName, account.displayName),
      avatarUrl: clean(identity.avatarUrl),
      identityReceipt,
      identityCompletedAt: completedAt,
      messagingSupported: false
    });
    await accountStore.update(account.id, {
      displayName: clean(identity.displayName, account.displayName),
      identityLabel: clean(identity.displayName, account.identityLabel),
      lifecycleState: 'ready',
      autoReconnect: false,
      metadata: {
        ...(account.metadata || {}), accountKind: 'personal-identity', driverId: 'facebook-personal-identity-official',
        authorizationPending: false, identityUserId: userId, identityReceipt, avatarUrl: clean(identity.avatarUrl),
        messagingSupported: false, authorizationMode: 'facebook-login-personal-identity'
      }
    });
    flow.status = 'completed'; flow.mode = 'identity'; flow.personalIdentity = { userId, displayName: clean(identity.displayName), avatarUrl: clean(identity.avatarUrl), messagingSupported: false };
    await clearPendingFlow(account, flowId, options);
    flows.delete(flowId);
    return { flowId, mode: 'identity', status: 'completed', identity: flow.personalIdentity, pages: [], expiresAt: clean(data.expiresAt) };
  }
  const pages = Array.isArray(data.pages) ? data.pages.filter(page => clean(page.id)) : [];
  if (!pages.length) throw Object.assign(new Error('授权成功，但没有可管理的 Facebook 公共主页'), { code: 'FACEBOOK_NO_MANAGED_PAGES', status: 409 });
  flow.status = 'authorized'; flow.pages = pages.map(safePage); flow.diagnostics = data.diagnostics || null;
  const account = accountStore.get(accountId);
  if (account) await persistPendingFlow(account, flow, options);
  writeDurableFlow(flow);
  return { flowId, mode: 'page', status: 'authorized', pages: flow.pages, diagnostics: flow.diagnostics, expiresAt: clean(data.expiresAt) };
}

async function selectPage(accountId, flowId, pageId, options = {}) {
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
  const flow = await getFlow(accountId, flowId);
  if (flow.status !== 'authorized') throw Object.assign(new Error('Facebook 授权尚未完成'), { code: 'FACEBOOK_OAUTH_NOT_AUTHORIZED', status: 409 });
  const page = flow.pages.find(item => clean(item.id) === clean(pageId));
  if (!page) throw Object.assign(new Error('所选公共主页不在授权结果中'), { code: 'FACEBOOK_PAGE_NOT_FOUND', status: 404 });
  const missingPermissions = missingPagePermissions(page);
  if (missingPermissions.length) throw Object.assign(new Error(`Facebook 公共主页授权缺少必要权限：${missingPermissions.join(', ')}`), { code: 'FACEBOOK_REQUIRED_PERMISSIONS_MISSING', status: 409, missingPermissions });
  const account = accountStore.get(flow.accountId);
  if (!account) throw Object.assign(new Error('Facebook账号不存在'), { code: 'FACEBOOK_ACCOUNT_NOT_FOUND', status: 404 });
  const data = await workerRequest(`${flow.workerBaseUrl}/oauth/facebook/result/${encodeURIComponent(flow.flowId)}/select`, {
    method: 'POST', headers: { authorization: `Bearer ${flow.clientSecret}`, 'content-type': 'application/json' }, body: JSON.stringify({ pageId: clean(pageId) })
  }, 30000, options);
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
  const responseWorkerBaseUrl = clean(data.workerBaseUrl);
  if (responseWorkerBaseUrl && relayClient.workerBaseUrl(responseWorkerBaseUrl) !== flow.workerBaseUrl) {
    throw Object.assign(new Error('Facebook 授权响应来自非当前正式 Worker'), { code: 'FACEBOOK_WORKER_BINDING_MISMATCH', status: 409 });
  }
  if (clean(data.deviceId) && clean(data.deviceId) !== flow.identity.deviceId) {
    throw Object.assign(new Error('Facebook 设备注册结果与当前设备不一致'), { code: 'FACEBOOK_DEVICE_REGISTRATION_MISMATCH', status: 409 });
  }
  const cloudAccountId = clean(data.cloudAccountId);
  if (!cloudAccountId) throw Object.assign(new Error('Facebook 云端账号注册结果缺失'), { code: 'FACEBOOK_CLOUD_ACCOUNT_ID_MISSING', status: 502 });
  const selected = safePage(data.page || page);
  if (!selected.id || selected.id !== page.id) throw Object.assign(new Error('Facebook 公共主页选择结果不一致'), { code: 'FACEBOOK_PAGE_SELECTION_MISMATCH', status: 409 });
  const responseGraphVersion = clean(data.graphVersion);
  if (responseGraphVersion && responseGraphVersion !== flow.graphVersion) {
    throw Object.assign(new Error('Facebook Graph API 版本与正式发行绑定不一致'), { code: 'FACEBOOK_GRAPH_VERSION_BINDING_MISMATCH', status: 409 });
  }
  const existing = securityGuard.credentials.get(account.credentialRef) || {};
  await securityGuard.credentials.persist(account.credentialRef, {
    ...existing,
    authorizationMode: 'cloudflare-worker',
    cloudAccountId,
    pageId: selected.id,
    permissions: selected.permissions,
    capabilities: { newMessagingReady: selected.newMessagingReady, historySyncAvailable: selected.historySyncAvailable, historySyncReason: selected.historySyncReason },
    permissionCheckedAt: clean(selected.permissionCheckedAt),
    permissionSource: clean(selected.permissionSource, 'meta:/me/permissions'),
    tokenStatus: selected.tokenStatus,
    webhookStatus: selected.webhookStatus,
    workerBaseUrl: flow.workerBaseUrl,
    graphVersion: flow.graphVersion || platformAuthConfig.DEFAULT_FACEBOOK_GRAPH_VERSION,
    workerBindingSha256: platformAuthConfig.sha256Base64Url(`${flow.workerBaseUrl}\n${flow.graphVersion || platformAuthConfig.DEFAULT_FACEBOOK_GRAPH_VERSION}`),
    deviceId: flow.identity.deviceId,
    devicePublicKeySpki: flow.identity.publicKeySpki,
    devicePrivateKeyPkcs8: flow.identity.privateKeyPkcs8
  });
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
  await accountStore.update(account.id, {
    displayName: clean(selected.name, account.displayName), identityLabel: clean(selected.name, account.identityLabel),
    metadata: { ...(account.metadata || {}), pageId: selected.id, username: clean(selected.username), cloudAccountId, authorizationMode: 'cloudflare-worker', permissions: selected.permissions, missingOptionalPermissions: selected.missingOptionalPermissions, historySyncAvailable: selected.historySyncAvailable, historySyncReason: selected.historySyncReason, permissionCheckedAt: clean(selected.permissionCheckedAt), permissionSource: clean(selected.permissionSource, 'meta:/me/permissions') }
  });
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_SELECT_PAGE_ABORTED');
  flow.status = 'completed'; flow.pages = [];
  await clearPendingFlow(account, flowId, options);
  logger.info('facebook', 'oauth-page-selected', { accountId: account.id, flowId, pageId: selected.id, cloudAccountId });
  return { account: accountStore.get(account.id), page: selected };
}

async function cancel(accountId, flowId, options = {}) {
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CANCEL_ABORTED');
  const flow = await getFlow(accountId, flowId);
  await workerRequest(`${flow.workerBaseUrl}/oauth/facebook/result/${encodeURIComponent(flow.flowId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${flow.clientSecret}` } }, 15000, options).catch(error => { if (options.signal?.aborted) throw error; logger.warn('facebook', 'oauth-cancel-worker-failed', { operation: 'facebookOAuth.cancel', accountId: '', conversationId: '', reasonCode: error.code || 'FACEBOOK_OAUTH_CANCEL_FAILED', httpStatus: Number(error.status || 0), attempt: 1, nextRetryAt: '', flowId: flow.flowId, error: error.message }); });
  assertOperationActive(options.signal, 'FACEBOOK_OAUTH_CANCEL_ABORTED');
  flow.status = 'cancelled'; flow.pages = [];
  await clearPendingFlow(accountStore.get(accountId), flowId, options);
  return { flowId: flow.flowId, status: flow.status };
}

module.exports = { REQUIRED_PAGE_PERMISSIONS, OPTIONAL_PAGE_PERMISSIONS, WORKER_OAUTH_CONTRACT_VERSION, PAGE_WORKER_OAUTH_CONTRACT_VERSION, IDENTITY_WORKER_OAUTH_CONTRACT_VERSION, normalizePermission, permissionList, missingPagePermissions, missingOptionalPagePermissions, verifyWorkerOAuthContract, begin, poll, selectPage, cancel, _flows: flows };
