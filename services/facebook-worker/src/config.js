import { GatewayError } from './errors.js';
import { boundedInteger, clean } from './utils.js';

export const OAUTH_CONTRACT_VERSION = 6;
export const OAUTH_AUTHORIZATION_MODE = 'business-login-configuration';
export const REQUIRED_PERMISSIONS = Object.freeze(['pages_show_list', 'pages_messaging', 'pages_manage_metadata']);
export const OPTIONAL_PERMISSIONS = Object.freeze(['pages_read_engagement']);
export const SUBSCRIBED_FIELDS = Object.freeze(['messages', 'message_echoes', 'messaging_postbacks', 'messaging_referrals', 'message_deliveries', 'message_reads']);

function secret(env, name, minimum = 16) {
  const value = clean(env[name]);
  if (value.length < minimum) throw new GatewayError('FACEBOOK_WORKER_SECRET_MISSING', `${name} 未配置`, 503, { field: name });
  return value;
}
export function workerConfig(env) {
  const appId = secret(env, 'META_APP_ID', 5);
  if (!/^\d{5,32}$/.test(appId)) throw new GatewayError('FACEBOOK_APP_ID_INVALID', 'META_APP_ID 格式无效', 503);
  const graphVersion = clean(env.FACEBOOK_GRAPH_VERSION, 'v25.0');
  if (!/^v\d+\.\d+$/.test(graphVersion)) throw new GatewayError('FACEBOOK_GRAPH_VERSION_INVALID', 'Graph API 版本格式无效', 503);
  const businessLoginConfigId = clean(env.META_BUSINESS_LOGIN_CONFIG_ID || env.FACEBOOK_BUSINESS_LOGIN_CONFIG_ID);
  if (!/^\d{5,32}$/.test(businessLoginConfigId)) {
    throw new GatewayError('FACEBOOK_BUSINESS_LOGIN_CONFIG_ID_INVALID', '企业版 Facebook 登录 Configuration ID 未配置或格式无效', 503);
  }
  const workerBaseUrl = clean(env.WORKER_BASE_URL);
  if (!workerBaseUrl) throw new GatewayError('FACEBOOK_WORKER_BASE_URL_MISSING', 'WORKER_BASE_URL 未配置', 503);
  let normalizedWorkerBaseUrl;
  try {
    const url = new URL(workerBaseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid');
    normalizedWorkerBaseUrl = url.toString().replace(/\/$/, '');
  } catch (_) {
    throw new GatewayError('FACEBOOK_WORKER_BASE_URL_INVALID', 'WORKER_BASE_URL 必须是无凭据的 HTTPS 地址', 503);
  }
  return Object.freeze({
    appId,
    businessLoginConfigId,
    appSecret: secret(env, 'META_APP_SECRET', 16),
    verifyToken: secret(env, 'META_VERIFY_TOKEN', 24),
    tokenEncryptionKey: secret(env, 'TOKEN_ENCRYPTION_KEY', 32),
    desktopAuthMasterKey: secret(env, 'DESKTOP_AUTH_MASTER_KEY', 32),
    graphVersion,
    oauthStateTtlSeconds: boundedInteger(env.OAUTH_STATE_TTL_SECONDS, 600, 60, 1800),
    requestWindowSeconds: boundedInteger(env.DESKTOP_REQUEST_WINDOW_SECONDS, 300, 60, 900),
    rateLimitPerMinute: boundedInteger(env.DESKTOP_RATE_LIMIT_PER_MINUTE, 120, 10, 1000),
    maxWebhookBodyBytes: boundedInteger(env.MAX_WEBHOOK_BODY_BYTES, 2 * 1024 * 1024, 64 * 1024, 8 * 1024 * 1024),
    maxDesktopBodyBytes: boundedInteger(env.MAX_DESKTOP_BODY_BYTES, 32 * 1024 * 1024, 1024 * 1024, 40 * 1024 * 1024),
    eventRetentionDays: boundedInteger(env.EVENT_RETENTION_DAYS, 7, 1, 30),
    deadLetterRetentionDays: boundedInteger(env.DEAD_LETTER_RETENTION_DAYS, 30, 7, 90),
    mediaRetentionDays: boundedInteger(env.MEDIA_RETENTION_DAYS, 14, 1, 30),
    mediaRetryMaxAttempts: boundedInteger(env.MEDIA_RETRY_MAX_ATTEMPTS, 6, 1, 12),
    mediaRetryBaseSeconds: boundedInteger(env.MEDIA_RETRY_BASE_SECONDS, 30, 5, 600),
    workerBaseUrl: normalizedWorkerBaseUrl
  });
}
