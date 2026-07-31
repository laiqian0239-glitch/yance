'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = 'platform-auth.json';
const HASH_FILE = 'platform-auth.sha256';
const DEFAULT_FACEBOOK_GRAPH_VERSION = 'v25.0';
const MINIMUM_FACEBOOK_GRAPH_MAJOR = 24;

function clean(value) { return value == null ? '' : String(value).trim(); }

function releaseConfigError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function secureReleaseUrl(value, protocols) {
  const raw = clean(value);
  if (!raw) return '';
  let url;
  try { url = new URL(raw); }
  catch (_) { throw releaseConfigError('PLATFORM_AUTH_URL_INVALID', '平台发行服务地址格式无效'); }
  if (!protocols.includes(url.protocol) && !(process.env.NODE_ENV === 'test' && ['http:','ws:'].includes(url.protocol))) {
    throw releaseConfigError('PLATFORM_AUTH_HTTPS_REQUIRED', '平台发行服务必须使用 HTTPS/WSS', { protocol: url.protocol });
  }
  if (url.username || url.password) throw releaseConfigError('PLATFORM_AUTH_URL_CREDENTIALS_FORBIDDEN', '平台发行服务地址不能包含用户名或密码');
  return url.toString().replace(/\/$/, '');
}

function hasConfiguredValue(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).some(item => clean(item)));
}

function validateReleaseDocument(document = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw releaseConfigError('PLATFORM_AUTH_SCHEMA_INVALID', '平台发行配置必须是 JSON 对象');
  }
  if (Number(document.schemaVersion) !== 1 || document.releaseManaged !== true) {
    throw releaseConfigError('PLATFORM_AUTH_SCHEMA_INVALID', '平台发行配置版本或管理模式无效');
  }

  let telegram = {};
  let facebook = {};
  const telegramPresent = hasConfiguredValue(document.telegram);
  const facebookPresent = hasConfiguredValue(document.facebook);

  if (telegramPresent) {
    const apiId = Number(document.telegram?.apiId);
    const apiHash = clean(document.telegram?.apiHash).toLowerCase();
    if (!Number.isSafeInteger(apiId) || apiId <= 0) throw releaseConfigError('TELEGRAM_API_ID_INVALID', 'Telegram 发行应用标识无效');
    if (!/^[a-f0-9]{32}$/.test(apiHash)) throw releaseConfigError('TELEGRAM_API_HASH_INVALID', 'Telegram 发行应用凭据无效');
    telegram = { apiId, apiHash };
  }

  if (facebookPresent) {
    const workerBaseUrl = secureReleaseUrl(document.facebook?.workerBaseUrl || document.facebook?.oauthBrokerUrl, ['https:']);
    if (!workerBaseUrl) throw releaseConfigError('FACEBOOK_WORKER_REQUIRED', 'Facebook 云端同步服务不可用');
    const graphVersion = clean(document.facebook?.graphVersion || DEFAULT_FACEBOOK_GRAPH_VERSION);
    const graphMatch = /^v(\d+)\.(\d+)$/.exec(graphVersion);
    if (!graphMatch || Number(graphMatch[1]) < MINIMUM_FACEBOOK_GRAPH_MAJOR) {
      throw releaseConfigError('FACEBOOK_GRAPH_VERSION_UNSUPPORTED', 'Facebook 平台协议版本不受支持');
    }
    facebook = { workerBaseUrl, graphVersion };
  }

  if (!telegramPresent && !facebookPresent) {
    throw releaseConfigError('PLATFORM_AUTH_NO_PLATFORM_CONFIGURED', '平台发行配置至少必须启用 Telegram 或 Facebook 中的一项');
  }

  return {
    schemaVersion: 1,
    releaseManaged: true,
    telegram,
    facebook
  };
}

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function parseDetachedHash(text, expectedFileName = CONFIG_FILE) {
  const match = String(text || '').match(/^([0-9a-f]{64})\s+\*?([^\r\n]+)\r?\n?$/i);
  if (!match || match[2].trim() !== expectedFileName) {
    throw Object.assign(new Error('平台发行配置校验文件格式无效'), { code: 'PLATFORM_AUTH_HASH_FORMAT_INVALID' });
  }
  return match[1].toLowerCase();
}

function candidatePaths(options = {}) {
  const values = [];
  const explicit = clean(options.configPath || process.env.YANCE_PLATFORM_AUTH_CONFIG_PATH);
  if (explicit) values.push(path.resolve(explicit));
  const resourcesPath = clean(options.resourcesPath);
  if (resourcesPath) values.push(path.join(path.resolve(resourcesPath), CONFIG_FILE));
  if (process.env.NODE_ENV === 'test' || process.env.YANCE_INTERNAL_PLATFORM_AUTH_ADMIN === '1') {
    values.push(path.resolve(__dirname, '..', '..', 'release', 'platform-auth.local.json'));
  }
  return Array.from(new Set(values));
}

function readSealedFile(configPath, options = {}) {
  const hashPath = path.resolve(options.hashPath || process.env.YANCE_PLATFORM_AUTH_CONFIG_SHA256_PATH || path.join(path.dirname(configPath), HASH_FILE));
  if (!fs.existsSync(configPath)) return null;
  if (!fs.existsSync(hashPath)) {
    throw Object.assign(new Error('平台发行配置缺少独立 SHA-256 校验文件'), {
      code: 'PLATFORM_AUTH_HASH_MISSING',
      details: { configFile: path.basename(configPath), hashFile: path.basename(hashPath) }
    });
  }
  const bytes = fs.readFileSync(configPath);
  const expected = parseDetachedHash(fs.readFileSync(hashPath, 'utf8'), path.basename(configPath));
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw Object.assign(new Error('平台发行配置 SHA-256 校验失败'), {
      code: 'PLATFORM_AUTH_HASH_MISMATCH',
      details: { expected, actual }
    });
  }
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); }
  catch (_) { throw Object.assign(new Error('平台发行配置不是有效 JSON'), { code: 'PLATFORM_AUTH_JSON_INVALID' }); }
  const normalized = validateReleaseDocument(document);
  return {
    source: 'sealed-release-file',
    sealed: true,
    configPath,
    hashPath,
    telegram: normalized.telegram,
    facebook: normalized.facebook
  };
}

function environmentConfig(env = process.env) {
  const telegram = {
    apiId: clean(env.YANCE_TELEGRAM_API_ID),
    apiHash: clean(env.YANCE_TELEGRAM_API_HASH)
  };
  const facebook = {
    workerBaseUrl: clean(env.YANCE_FACEBOOK_WORKER_URL || env.YANCE_FACEBOOK_OAUTH_BROKER_URL),
    graphVersion: clean(env.YANCE_FACEBOOK_GRAPH_VERSION)
  };
  const present = Object.values(telegram).some(Boolean) || Object.values(facebook).some(Boolean);
  return present ? { source: 'release-environment', sealed: false, telegram, facebook } : null;
}

function mergePlatform(base = {}, override = {}) {
  return Object.fromEntries(Object.entries({ ...base, ...override }).filter(([, value]) => clean(value)));
}

function loadReleasePlatformAuth(options = {}) {
  let fileConfig = null;
  let loadError = null;
  for (const configPath of candidatePaths(options)) {
    if (!fs.existsSync(configPath)) continue;
    try { fileConfig = readSealedFile(configPath, options); }
    catch (error) { loadError = error; }
    break;
  }
  const envConfig = environmentConfig(options.env || process.env);
  if (loadError && !envConfig) {
    return {
      source: 'invalid-release-config',
      sealed: false,
      telegram: {},
      facebook: {},
      error: { code: loadError.code || 'PLATFORM_AUTH_LOAD_FAILED', message: loadError.message, details: loadError.details || {} }
    };
  }
  if (!fileConfig && !envConfig) return { source: 'missing', sealed: false, telegram: {}, facebook: {}, error: null };
  if (!fileConfig) return { ...envConfig, error: null };
  if (!envConfig) return { ...fileConfig, error: null };
  return {
    source: 'release-environment+sealed-file',
    sealed: fileConfig.sealed,
    configPath: fileConfig.configPath,
    hashPath: fileConfig.hashPath,
    telegram: mergePlatform(fileConfig.telegram, envConfig.telegram),
    facebook: mergePlatform(fileConfig.facebook, envConfig.facebook),
    error: null
  };
}

module.exports = {
  CONFIG_FILE,
  HASH_FILE,
  DEFAULT_FACEBOOK_GRAPH_VERSION,
  MINIMUM_FACEBOOK_GRAPH_MAJOR,
  candidatePaths,
  environmentConfig,
  loadReleasePlatformAuth,
  parseDetachedHash,
  readSealedFile,
  secureReleaseUrl,
  sha256,
  validateReleaseDocument
};
