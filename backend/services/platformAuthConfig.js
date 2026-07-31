'use strict';

const crypto = require('crypto');
const { loadReleasePlatformAuth } = require('./releasePlatformAuth');

const DEFAULT_FACEBOOK_GRAPH_VERSION = 'v25.0';
const MINIMUM_FACEBOOK_GRAPH_MAJOR = 24;

function clean(value) { return value == null ? '' : String(value).trim(); }
function validFacebookGraphVersion(value) {
  const match = /^v(\d+)\.(\d+)$/.exec(clean(value));
  return Boolean(match && Number(match[1]) >= MINIMUM_FACEBOOK_GRAPH_MAJOR);
}
function configurationError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, status: 400, details });
}
function secureUrl(value, protocols = ['https:']) {
  const raw = clean(value);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); }
  catch (_) { throw configurationError('PLATFORM_AUTH_URL_INVALID', '平台授权服务地址格式无效'); }
  if (!protocols.includes(url.protocol) && !(process.env.NODE_ENV === 'test' && ['http:','ws:'].includes(url.protocol))) {
    throw Object.assign(new Error('平台授权服务必须使用 HTTPS/WSS'), { code: 'PLATFORM_AUTH_HTTPS_REQUIRED', status: 400, details: { protocol: url.protocol } });
  }
  if (url.username || url.password) throw configurationError('PLATFORM_AUTH_URL_CREDENTIALS_FORBIDDEN', '平台授权服务地址不能包含用户名或密码');
  return url.toString().replace(/\/$/, '');
}

function normalizeTelegram(input = {}) {
  const apiId = Number(input.apiId);
  const apiHash = clean(input.apiHash);
  if (!Number.isSafeInteger(apiId) || apiId <= 0) throw configurationError('TELEGRAM_API_ID_INVALID', 'Telegram 发行应用标识无效');
  if (!/^[a-f0-9]{32}$/i.test(apiHash)) throw configurationError('TELEGRAM_API_HASH_INVALID', 'Telegram 发行应用凭据无效');
  return { apiId, apiHash: apiHash.toLowerCase() };
}

function normalizeFacebook(input = {}) {
  const workerBaseUrl = secureUrl(input.workerBaseUrl || input.oauthBrokerUrl, ['https:']);
  if (!workerBaseUrl) throw configurationError('FACEBOOK_WORKER_REQUIRED', 'Facebook 云端同步服务不可用');
  const graphVersion = clean(input.graphVersion || DEFAULT_FACEBOOK_GRAPH_VERSION);
  if (!validFacebookGraphVersion(graphVersion)) {
    throw configurationError('FACEBOOK_GRAPH_VERSION_UNSUPPORTED', 'Facebook 平台协议版本不受支持');
  }
  return { workerBaseUrl, graphVersion };
}

function sourceDocument(options = {}) {
  return options.releaseConfig || loadReleasePlatformAuth(options);
}

function telegramFrom(document = sourceDocument()) {
  try {
    const value = normalizeTelegram(document.telegram || {});
    return {
      configured: true,
      ...value,
      releaseManaged: true,
      sealed: document.sealed === true,
      source: document.source || 'release'
    };
  } catch (error) {
    return {
      configured: false,
      apiId: 0,
      apiHash: '',
      releaseManaged: true,
      sealed: document.sealed === true,
      source: document.source || 'missing',
      reason: document.error?.code || error.code || 'TELEGRAM_RELEASE_SERVICE_UNAVAILABLE'
    };
  }
}

function facebookFrom(document = sourceDocument()) {
  try {
    const value = normalizeFacebook(document.facebook || {});
    return {
      configured: true,
      applicationConfigured: true,
      workerBaseUrl: value.workerBaseUrl,
      brokerUrl: value.workerBaseUrl,
      relayUrl: value.workerBaseUrl,
      graphVersion: value.graphVersion,
      graphVersionValid: true,
      releaseManaged: true,
      sealed: document.sealed === true,
      source: document.source || 'release'
    };
  } catch (error) {
    return {
      configured: false,
      applicationConfigured: false,
      workerBaseUrl: '',
      brokerUrl: '',
      relayUrl: '',
      graphVersion: DEFAULT_FACEBOOK_GRAPH_VERSION,
      graphVersionValid: true,
      releaseManaged: true,
      sealed: document.sealed === true,
      source: document.source || 'missing',
      reason: document.error?.code || error.code || 'FACEBOOK_RELEASE_SERVICE_UNAVAILABLE'
    };
  }
}

function telegram() { return telegramFrom(); }
function facebook() { return facebookFrom(); }

function telegramPublic(config = telegram()) {
  const available = config.configured === true;
  return {
    configured: available,
    available,
    releaseManaged: true,
    status: available ? 'available' : 'release-service-unavailable',
    reason: available ? '' : (config.reason || 'TELEGRAM_RELEASE_SERVICE_UNAVAILABLE'),
    userAction: available ? 'login' : 'install-enabled-release'
  };
}

function facebookPublic(config = facebook()) {
  const available = config.configured === true;
  return {
    configured: available,
    available,
    releaseManaged: true,
    status: available ? 'available' : 'release-service-unavailable',
    reason: available ? '' : (config.reason || 'FACEBOOK_RELEASE_SERVICE_UNAVAILABLE'),
    userAction: available ? 'login' : 'install-enabled-release'
  };
}

function publicState() {
  return {
    whatsapp: { configured: true, available: true, releaseManaged: true, status: 'available', reason: '', userAction: 'login' },
    telegram: telegramPublic(),
    facebook: facebookPublic()
  };
}

async function configure(platform) {
  throw Object.assign(new Error('平台应用配置由正式发行包管理，普通用户不能在软件中修改'), {
    code: 'PLATFORM_AUTH_RELEASE_MANAGED', status: 403, platform: clean(platform).toLowerCase()
  });
}

async function clear(platform) {
  throw Object.assign(new Error('平台应用配置由正式发行包管理，普通用户不能在软件中删除'), {
    code: 'PLATFORM_AUTH_RELEASE_MANAGED', status: 403, platform: clean(platform).toLowerCase()
  });
}

function assertAvailable(platform, operation = 'connect') {
  const normalized = clean(platform).toLowerCase();
  const state = publicState()[normalized];
  if (!state) throw Object.assign(new Error('不支持的平台'), { code: 'UNSUPPORTED_PLATFORM', status: 400, platform: normalized });
  if (!state.available) {
    const label = normalized === 'telegram' ? 'Telegram' : 'Facebook';
    throw Object.assign(new Error(`当前安装包尚未启用 ${label} 登录，请安装包含该平台服务的正式升级包`), {
      code: 'PLATFORM_RELEASE_SERVICE_UNAVAILABLE', status: 409, platform: normalized, operation, reason: state.reason
    });
  }
  return state;
}

function randomSecret(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
function sha256Base64Url(value) { return crypto.createHash('sha256').update(String(value || '')).digest('base64url'); }

module.exports = {
  DEFAULT_FACEBOOK_GRAPH_VERSION,
  MINIMUM_FACEBOOK_GRAPH_MAJOR,
  telegram,
  facebook,
  telegramFrom,
  facebookFrom,
  publicState,
  configure,
  clear,
  normalizeTelegram,
  normalizeFacebook,
  assertAvailable,
  randomSecret,
  sha256Base64Url,
  secureUrl,
  sourceDocument
};
