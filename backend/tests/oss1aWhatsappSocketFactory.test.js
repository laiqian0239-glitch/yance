'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  SEALED_COMPATIBLE_VERSION,
  createRedactedBaileysLogger,
  createWhatsAppSocketFactory
} = require('../services/whatsappSocketFactory');

function appLogger(logs) {
  return {
    info(channel, message, detail) { logs.push({ level: 'info', channel, message, detail }); },
    warn(channel, message, detail) { logs.push({ level: 'warn', channel, message, detail }); },
    error(channel, message, detail) { logs.push({ level: 'error', channel, message, detail }); }
  };
}

test('socket factory assembles the complete authoritative Baileys socket contract', async () => {
  const calls = [];
  const logs = [];
  const creds = Object.freeze({ registered: true, me: { id: '15550001111:1@s.whatsapp.net' } });
  const keys = Object.freeze({ get() {}, set() {} });
  const cachedKeys = Object.freeze({ get() {}, set() {} });
  const retryStore = Object.freeze({ get() {}, set() {}, del() {}, flushAll() {} });
  const getMessage = async () => ({ conversation: 'restored' });
  const browser = Object.freeze(['言策', 'Desktop', '0.0.0-development']);
  let keyLogger = null;
  const baileys = {
    makeCacheableSignalKeyStore(input, logger) {
      assert.equal(input, keys);
      keyLogger = logger;
      return cachedKeys;
    },
    default(options) {
      calls.push(options);
      return Object.freeze({ id: 'socket-1', ev: Object.freeze({}) });
    }
  };
  const factory = createWhatsAppSocketFactory({ baileys, logger: appLogger(logs) });
  const result = await factory.create({
    authState: { creds, keys },
    msgRetryCounterCache: retryStore,
    getMessage,
    versionInfo: { version: [2, 3000, 1027934701], isLatest: true },
    browser
  });

  assert.equal(result.socket.id, 'socket-1');
  assert.equal(calls.length, 1);
  const options = calls[0];
  assert.equal(options.auth.creds, creds);
  assert.equal(options.auth.keys, cachedKeys);
  assert.equal(options.msgRetryCounterCache, retryStore);
  assert.equal(options.getMessage, getMessage);
  assert.deepEqual(options.version, [2, 3000, 1027934701]);
  assert.equal(options.browser, browser);
  assert.equal(options.syncFullHistory, true);
  assert.equal(options.shouldSyncHistoryMessage({}), true);
  assert.equal(options.generateHighQualityLinkPreview, true);
  assert.equal(options.markOnlineOnConnect, false);
  assert.equal(options.printQRInTerminal, false);
  assert.equal('reconnect' in options, false);
  assert.equal('reconnectDelayMs' in options, false);
  assert.equal(Object.isFrozen(result.versionDecision), true);
  assert.equal(result.versionDecision.source, 'DISCOVERED');

  assert.ok(keyLogger);
  keyLogger.warn({
    jid: '15550001111@s.whatsapp.net',
    authKey: 'TOP_SECRET_AUTH_KEY',
    message: { conversation: 'TOP_SECRET_MESSAGE_PAYLOAD' }
  }, 'signal key update');
  const serialized = JSON.stringify(logs);
  assert.equal(serialized.includes('15550001111'), false);
  assert.equal(serialized.includes('TOP_SECRET_AUTH_KEY'), false);
  assert.equal(serialized.includes('TOP_SECRET_MESSAGE_PAYLOAD'), false);
});

test('version discovery failure uses the sealed compatible version with an explicit receipt', async () => {
  const calls = [];
  const factory = createWhatsAppSocketFactory({
    baileys: {
      makeCacheableSignalKeyStore: keys => keys,
      default(options) { calls.push(options); return { ev: {} }; }
    },
    logger: appLogger([])
  });
  const result = await factory.create({
    authState: { creds: {}, keys: {} },
    getMessage: async () => undefined,
    browser: ['言策', 'Desktop', '0.0.0-development'],
    versionInfo: { version: null, timedOut: true, error: null }
  });
  assert.deepEqual(calls[0].version, [...SEALED_COMPATIBLE_VERSION]);
  assert.equal(result.versionDecision.source, 'SEALED_COMPATIBLE_FALLBACK');
  assert.equal(result.versionDecision.reasonCode, 'VERSION_DISCOVERY_TIMEOUT');
  assert.equal(result.versionDecision.diagnosticRequired, true);
});

test('socket creation failure closes the logical auth lease before propagating', async () => {
  const closeCalls = [];
  const failure = Object.assign(new Error('socket construction failed'), { code: 'SOCKET_CONSTRUCTION_FAILED' });
  const factory = createWhatsAppSocketFactory({
    baileys: {
      makeCacheableSignalKeyStore: keys => keys,
      default() { throw failure; }
    },
    logger: appLogger([])
  });
  await assert.rejects(() => factory.create({
    authState: { creds: {}, keys: {} },
    getMessage: async () => undefined,
    browser: ['言策', 'Desktop', '0.0.0-development'],
    authLease: {
      async close(receipt) { closeCalls.push(receipt); }
    }
  }), error => error === failure);
  assert.equal(closeCalls.length, 1);
  assert.equal(closeCalls[0].reasonCode, 'WHATSAPP_SOCKET_CREATE_FAILED');
  assert.equal(closeCalls[0].causeCode, 'SOCKET_CONSTRUCTION_FAILED');
  assert.equal(Object.isFrozen(closeCalls[0]), true);
});

test('redacted Baileys logger never forwards arbitrary objects or identity payloads', () => {
  const logs = [];
  const redacted = createRedactedBaileysLogger(appLogger(logs));
  assert.equal(redacted.child({ accountId: 'secret-account' }), redacted);
  redacted.error({ jid: '15559990000@s.whatsapp.net', key: Buffer.from('secret') }, 'protocol failure');
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].detail, {
    component: 'baileys-signal-key-store',
    reasonCode: 'BAILEYS_INTERNAL_EVENT_REDACTED'
  });
  assert.equal(JSON.stringify(logs).includes('15559990000'), false);
  assert.equal(JSON.stringify(logs).includes('secret'), false);
});

test('adapter delegates construction while retaining sole socket-row and reconnect ownership', () => {
  const root = path.resolve(__dirname, '..', '..');
  const adapter = fs.readFileSync(path.join(root, 'backend/services/whatsappAdapter.js'), 'utf8');
  const factory = fs.readFileSync(path.join(root, 'backend/services/whatsappSocketFactory.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const profilePatch = fs.readFileSync(path.join(root, 'scripts/dependencies/apply-baileys-profile-picture-token-fix.js'), 'utf8');

  assert.match(adapter, /createWhatsAppSocketFactory/);
  assert.match(adapter, /socketFactory\.create/);
  assert.doesNotMatch(adapter, /const socketOptions = \{/);
  assert.doesNotMatch(adapter, /baileys\.default\(socketOptions\)/);
  assert.match(adapter, /row\.socket = socket/);
  assert.match(adapter, /this\.reconnectTimers/);
  assert.doesNotMatch(factory, /reconnectTimers|classifyDisconnect|shouldExecuteReconnect|setTimeout/u);
  assert.equal(packageJson.dependencies['@whiskeysockets/baileys'], '7.0.0-rc13');
  assert.match(profilePatch, /TARGET_VERSION = '7\.0\.0-rc13'/);
  assert.match(profilePatch, /YANCE_BAILEYS_PROFILE_PICTURE_TCTOKEN_20260626/);
});
