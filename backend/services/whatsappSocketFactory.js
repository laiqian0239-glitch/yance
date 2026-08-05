'use strict';

const defaultLogger = require('./logger');

const SEALED_COMPATIBLE_VERSION = Object.freeze([2, 3000, 1027934701]);
const REDACTED_DETAIL = Object.freeze({
  component: 'baileys-signal-key-store',
  reasonCode: 'BAILEYS_INTERNAL_EVENT_REDACTED'
});

function factoryError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'WhatsAppSocketFactoryError';
  error.code = code;
  error.reasonCode = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function cleanVersion(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every(part => Number.isSafeInteger(part) && part >= 0)
    ? Object.freeze(value.slice(0, 3))
    : null;
}

function resolveVersion(versionInfo = {}, sealedVersion = SEALED_COMPATIBLE_VERSION) {
  const discovered = cleanVersion(versionInfo.version);
  if (discovered) {
    return Object.freeze({
      version: discovered,
      source: versionInfo.skipped === true ? 'CACHED_AUTHORITY' : 'DISCOVERED',
      reasonCode: versionInfo.skipped === true
        ? String(versionInfo.reasonCode || 'VERSION_DISCOVERY_BACKOFF_ACTIVE')
        : 'VERSION_DISCOVERY_SUCCEEDED',
      diagnosticRequired: false
    });
  }
  const fallback = cleanVersion(sealedVersion);
  if (!fallback) {
    throw factoryError(
      'WHATSAPP_SOCKET_SEALED_VERSION_INVALID',
      'The sealed compatible Baileys protocol version is invalid'
    );
  }
  const reasonCode = versionInfo.timedOut === true
    ? 'VERSION_DISCOVERY_TIMEOUT'
    : String(versionInfo.error?.code || versionInfo.reasonCode || 'VERSION_DISCOVERY_FAILED');
  return Object.freeze({
    version: fallback,
    source: 'SEALED_COMPATIBLE_FALLBACK',
    reasonCode,
    diagnosticRequired: true
  });
}

function messageOnly(args = []) {
  return args
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/[\r\n\t]+/gu, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 240);
}

function createRedactedBaileysLogger(appLogger = defaultLogger) {
  const write = (level, args) => {
    if (!['warn', 'error'].includes(level)) return;
    const method = typeof appLogger?.[level] === 'function' ? appLogger[level].bind(appLogger) : null;
    if (!method) return;
    method('whatsapp', messageOnly(args) || 'baileys-internal-event', { ...REDACTED_DETAIL });
  };
  const facade = {
    level: 'silent',
    child() { return facade; },
    trace() {},
    debug() {},
    info() {},
    warn(...args) { write('warn', args); },
    error(...args) { write('error', args); },
    fatal(...args) { write('error', args); }
  };
  return Object.freeze(facade);
}

function validateDependencies(baileys) {
  if (!baileys || typeof baileys.default !== 'function') {
    throw factoryError('WHATSAPP_SOCKET_CONSTRUCTOR_UNAVAILABLE', 'Baileys socket constructor is unavailable');
  }
  if (typeof baileys.makeCacheableSignalKeyStore !== 'function') {
    throw factoryError('WHATSAPP_SIGNAL_KEY_CACHE_UNAVAILABLE', 'Baileys cacheable Signal key store is unavailable');
  }
}

function validateCreateInput(input = {}) {
  const authState = input.auth || input.authState;
  if (!authState || typeof authState !== 'object') {
    throw factoryError('WHATSAPP_SOCKET_AUTH_STATE_INVALID', 'WhatsApp auth state is required');
  }
  if (!authState.creds || typeof authState.creds !== 'object') {
    throw factoryError('WHATSAPP_SOCKET_CREDS_INVALID', 'WhatsApp auth credentials are required');
  }
  if (!authState.keys || typeof authState.keys !== 'object') {
    throw factoryError('WHATSAPP_SOCKET_KEYS_INVALID', 'WhatsApp Signal key capability is required');
  }
  if (input.saveCreds != null && typeof input.saveCreds !== 'function') {
    throw factoryError('WHATSAPP_SOCKET_SAVE_CREDS_INVALID', 'WhatsApp credential persistence capability is invalid');
  }
  if (typeof input.getMessage !== 'function') {
    throw factoryError('WHATSAPP_SOCKET_GET_MESSAGE_INVALID', 'The exact getMessage capability is required');
  }
  if (!Array.isArray(input.browser) || input.browser.length !== 3) {
    throw factoryError('WHATSAPP_SOCKET_BROWSER_INVALID', 'The sealed browser identity is required');
  }
  return authState;
}

function createWhatsAppSocketFactory(options = {}) {
  const baileys = options.baileys;
  const appLogger = options.logger || defaultLogger;
  const sealedVersion = cleanVersion(options.sealedVersion || SEALED_COMPATIBLE_VERSION);
  validateDependencies(baileys);
  if (!sealedVersion) {
    throw factoryError('WHATSAPP_SOCKET_SEALED_VERSION_INVALID', 'The sealed compatible version is invalid');
  }

  return Object.freeze({
    async create(input = {}) {
      const authState = validateCreateInput(input);
      const redactedLogger = createRedactedBaileysLogger(appLogger);
      const versionDecision = resolveVersion(input.versionInfo, sealedVersion);
      const cachedKeys = baileys.makeCacheableSignalKeyStore(authState.keys, redactedLogger);
      const socketOptions = {
        auth: {
          creds: authState.creds,
          keys: cachedKeys
        },
        ...(input.msgRetryCounterCache ? { msgRetryCounterCache: input.msgRetryCounterCache } : {}),
        getMessage: input.getMessage,
        version: [...versionDecision.version],
        browser: input.browser,
        syncFullHistory: input.syncFullHistory !== false,
        shouldSyncHistoryMessage: typeof input.shouldSyncHistoryMessage === 'function'
          ? input.shouldSyncHistoryMessage
          : () => true,
        generateHighQualityLinkPreview: input.generateHighQualityLinkPreview !== false,
        markOnlineOnConnect: false,
        printQRInTerminal: false
      };

      try {
        const socket = baileys.default(socketOptions);
        if (!socket || typeof socket !== 'object') {
          throw factoryError('WHATSAPP_SOCKET_CONSTRUCTOR_INVALID_RESULT', 'Baileys returned an invalid socket');
        }
        return Object.freeze({
          socket,
          versionDecision,
          saveCreds: typeof input.saveCreds === 'function' ? input.saveCreds : null
        });
      } catch (cause) {
        const receipt = Object.freeze({
          reasonCode: 'WHATSAPP_SOCKET_CREATE_FAILED',
          causeCode: String(cause?.code || 'WHATSAPP_SOCKET_CREATE_FAILED')
        });
        try {
          if (typeof input.authLease?.close === 'function') await input.authLease.close(receipt);
        } catch (closeError) {
          Object.defineProperty(cause, 'authLeaseCloseError', {
            value: closeError,
            enumerable: false,
            configurable: false
          });
        }
        throw cause;
      }
    }
  });
}

module.exports = Object.freeze({
  SEALED_COMPATIBLE_VERSION,
  createRedactedBaileysLogger,
  createWhatsAppSocketFactory,
  resolveVersion
});
