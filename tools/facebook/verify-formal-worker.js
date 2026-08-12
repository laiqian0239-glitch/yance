#!/usr/bin/env node
'use strict';

const WORKER_BASE_URL = 'https://yance-facebook-gateway.wangyi198675.workers.dev';
const EXPECTED_SERVICE = 'yance-facebook-gateway';
const EXPECTED_GRAPH_VERSION = 'v25.0';
const EXPECTED_CALLBACK_URL = `${WORKER_BASE_URL}/oauth/facebook/callback`;
const EXPECTED_OAUTH_CONTRACT_VERSION = 6;
const EXPECTED_D1_SCHEMA_VERSION = 6;
const EXPECTED_SUBSCRIBED_FIELDS = Object.freeze(['messages', 'message_echoes', 'message_reactions']);

async function verify(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(`${WORKER_BASE_URL}/healthz`, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'Yance-Formal-Worker-Probe/1' },
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    const contract = data && typeof data.oauthContract === 'object' ? data.oauthContract : {};
    const webhookContract = data && typeof data.webhookContract === 'object' ? data.webhookContract : {};
    const d1Schema = data && typeof data.d1Schema === 'object' ? data.d1Schema : {};
    const required = Array.isArray(contract.requiredPermissions) ? contract.requiredPermissions : [];
    const subscribedFields = Array.isArray(webhookContract.subscribedFields) ? webhookContract.subscribedFields : [];
    const pageDiscovery = contract.pageDiscovery && typeof contract.pageDiscovery === 'object' ? contract.pageDiscovery : {};
    const optional = Array.isArray(contract.optionalPermissions) ? contract.optionalPermissions : [];
    const validContract = Number(contract.version || 0) >= EXPECTED_OAUTH_CONTRACT_VERSION
      && d1Schema.ready === true
      && Number(d1Schema.version || 0) >= EXPECTED_D1_SCHEMA_VERSION
      && EXPECTED_SUBSCRIBED_FIELDS.every(field => subscribedFields.includes(field))
      && contract.authorizationMode === 'business-login-configuration'
      && contract.legacyScopeParameter === false
      && contract.callbackUrl === EXPECTED_CALLBACK_URL
      && data.graphVersion === EXPECTED_GRAPH_VERSION
      && ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'].every(permission => required.includes(permission))
      && optional.includes('pages_read_engagement')
      && pageDiscovery.primary === '/me/accounts'
      && Array.isArray(pageDiscovery.tokenRecovery)
      && pageDiscovery.tokenRecovery.includes('/{debug_token.user_id}/accounts')
      && pageDiscovery.tokenRecovery.includes('/{granular_target_id}?fields=access_token')
      && pageDiscovery.selectionEvidence === 'debug_token.granular_scopes.target_ids'
      && pageDiscovery.directPageProfileProbe === true
      && pageDiscovery.directPageTokenRecovery === true
      && Array.isArray(pageDiscovery.directPageTokenFields)
      && pageDiscovery.directPageTokenFields.includes('id,access_token')
      && pageDiscovery.directPageTokenFields.includes('access_token')
      && pageDiscovery.profileHydration === 'page-access-token'
      && pageDiscovery.diagnosticsPersistedWithoutTokens === true;
    if (!response.ok || data.ok !== true || data.service !== EXPECTED_SERVICE) {
      throw Object.assign(new Error(`正式 Facebook Worker 健康检查失败（HTTP ${response.status}）`), {
        code: 'FACEBOOK_FORMAL_WORKER_HEALTH_FAILED', status: response.status, response: data
      });
    }
    if (!validContract) {
      throw Object.assign(new Error(`正式 Facebook Worker 运行时合同过旧或不完整（HTTP ${response.status}）`), {
        code: 'FACEBOOK_FORMAL_WORKER_RUNTIME_CONTRACT_STALE', status: response.status, response: data
      });
    }
    return {
      status: 'PASS', workerBaseUrl: WORKER_BASE_URL, service: data.service,
      graphVersion: data.graphVersion, oauthContractVersion: contract.version,
      d1SchemaVersion: d1Schema.version, subscribedFields,
      callbackUrl: contract.callbackUrl, serverTime: data.time || ''
    };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('正式 Facebook Worker 健康检查超时'), { code: 'FACEBOOK_FORMAL_WORKER_TIMEOUT' });
    throw error;
  } finally { clearTimeout(timer); }
}

async function main() {
  try { process.stdout.write(`${JSON.stringify(await verify(), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'FACEBOOK_FORMAL_WORKER_VERIFY_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = {
  WORKER_BASE_URL,
  EXPECTED_SERVICE,
  EXPECTED_GRAPH_VERSION,
  EXPECTED_CALLBACK_URL,
  EXPECTED_OAUTH_CONTRACT_VERSION,
  EXPECTED_D1_SCHEMA_VERSION,
  EXPECTED_SUBSCRIBED_FIELDS,
  verify
};
