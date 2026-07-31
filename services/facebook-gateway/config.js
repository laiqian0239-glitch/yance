'use strict';

const path = require('node:path');

const DEFAULT_GRAPH_VERSION = 'v25.0';
const MIN_GRAPH_MAJOR = 24;

function clean(value) { return String(value == null ? '' : value).trim(); }
function required(name, value) {
  const normalized = clean(value);
  if (!normalized) throw Object.assign(new Error(`${name} is required`), { code: 'FACEBOOK_GATEWAY_CONFIG_REQUIRED', field: name });
  return normalized;
}
function secureUrl(name, value, { allowHttp = false } = {}) {
  let url;
  try { url = new URL(required(name, value)); }
  catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error(`${name} must be a valid URL`), { code: 'FACEBOOK_GATEWAY_URL_INVALID', field: name });
  }
  if (url.username || url.password) throw Object.assign(new Error(`${name} must not contain embedded credentials`), { code: 'FACEBOOK_GATEWAY_URL_CREDENTIALS_FORBIDDEN', field: name });
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw Object.assign(new Error(`${name} must use HTTPS`), { code: 'FACEBOOK_GATEWAY_HTTPS_REQUIRED', field: name });
  }
  return url.toString().replace(/\/$/, '');
}
function graphVersion(value) {
  const normalized = clean(value || DEFAULT_GRAPH_VERSION);
  const match = /^v(\d+)\.(\d+)$/.exec(normalized);
  if (!match || Number(match[1]) < MIN_GRAPH_MAJOR) {
    throw Object.assign(new Error(`Graph API version must be v${MIN_GRAPH_MAJOR}.0 or newer`), { code: 'FACEBOOK_GATEWAY_GRAPH_VERSION_UNSUPPORTED' });
  }
  return normalized;
}
function masterKey(value) {
  const raw = required('YANCE_FACEBOOK_GATEWAY_MASTER_KEY', value);
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else {
    try { key = Buffer.from(raw, 'base64'); } catch (_) { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) throw Object.assign(new Error('YANCE_FACEBOOK_GATEWAY_MASTER_KEY must decode to exactly 32 bytes'), { code: 'FACEBOOK_GATEWAY_MASTER_KEY_INVALID' });
  return key;
}

function loadConfig(env = process.env) {
  const allowHttp = clean(env.NODE_ENV).toLowerCase() === 'test';
  const appId = required('YANCE_FACEBOOK_GATEWAY_APP_ID', env.YANCE_FACEBOOK_GATEWAY_APP_ID);
  if (!/^\d{5,32}$/.test(appId)) throw Object.assign(new Error('YANCE_FACEBOOK_GATEWAY_APP_ID is invalid'), { code: 'FACEBOOK_GATEWAY_APP_ID_INVALID' });
  const appSecret = required('YANCE_FACEBOOK_GATEWAY_APP_SECRET', env.YANCE_FACEBOOK_GATEWAY_APP_SECRET);
  if (appSecret.length < 16) throw Object.assign(new Error('YANCE_FACEBOOK_GATEWAY_APP_SECRET is too short'), { code: 'FACEBOOK_GATEWAY_APP_SECRET_INVALID' });
  const publicBaseUrl = secureUrl('YANCE_FACEBOOK_GATEWAY_PUBLIC_BASE_URL', env.YANCE_FACEBOOK_GATEWAY_PUBLIC_BASE_URL, { allowHttp });
  const redirectUri = secureUrl('YANCE_FACEBOOK_GATEWAY_REDIRECT_URI', env.YANCE_FACEBOOK_GATEWAY_REDIRECT_URI || `${publicBaseUrl}/oauth/facebook/callback`, { allowHttp });
  const verifyToken = required('YANCE_FACEBOOK_GATEWAY_WEBHOOK_VERIFY_TOKEN', env.YANCE_FACEBOOK_GATEWAY_WEBHOOK_VERIFY_TOKEN);
  if (verifyToken.length < 24) throw Object.assign(new Error('YANCE_FACEBOOK_GATEWAY_WEBHOOK_VERIFY_TOKEN must contain at least 24 characters'), { code: 'FACEBOOK_GATEWAY_VERIFY_TOKEN_WEAK' });
  const port = Number(env.YANCE_FACEBOOK_GATEWAY_PORT || 8787);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Object.assign(new Error('YANCE_FACEBOOK_GATEWAY_PORT is invalid'), { code: 'FACEBOOK_GATEWAY_PORT_INVALID' });
  return Object.freeze({
    appId,
    appSecret,
    publicBaseUrl,
    redirectUri,
    verifyToken,
    masterKey: masterKey(env.YANCE_FACEBOOK_GATEWAY_MASTER_KEY),
    graphVersion: graphVersion(env.YANCE_FACEBOOK_GRAPH_VERSION || DEFAULT_GRAPH_VERSION),
    port,
    host: clean(env.YANCE_FACEBOOK_GATEWAY_HOST || '127.0.0.1'),
    dataFile: path.resolve(env.YANCE_FACEBOOK_GATEWAY_DATA_FILE || path.join(process.cwd(), 'data', 'facebook-gateway.enc.json')),
    flowTtlMs: Math.max(60_000, Number(env.YANCE_FACEBOOK_GATEWAY_FLOW_TTL_MS || 10 * 60 * 1000)),
    maxBodyBytes: Math.max(64 * 1024, Number(env.YANCE_FACEBOOK_GATEWAY_MAX_BODY_BYTES || 2 * 1024 * 1024)),
    trustProxy: clean(env.YANCE_FACEBOOK_GATEWAY_TRUST_PROXY).toLowerCase() === 'true'
  });
}

module.exports = { DEFAULT_GRAPH_VERSION, MIN_GRAPH_MAJOR, loadConfig, graphVersion, masterKey, secureUrl };
