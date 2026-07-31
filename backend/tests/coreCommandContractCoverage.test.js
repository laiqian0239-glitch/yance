'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { COMMANDS, assertCommandEnvelope } = require('../../shared/core/contracts');
const { TelegramAdapter } = require('../services/telegramAdapter');

const ROOT = path.resolve(__dirname, '..', '..');

function accountContextBusinessCommands() {
  const source = fs.readFileSync(path.join(ROOT, 'backend/core/accountContext.js'), 'utf8');
  return [...source.matchAll(/case\s+'((?:account|message)\.[^']+)'\s*:/g)].map(match => match[1]);
}

test('every AccountContext account/message command is registered in the shared command contract', () => {
  const registered = new Set(Object.values(COMMANDS));
  const missing = accountContextBusinessCommands().filter(command => !registered.has(command));
  assert.deepEqual(missing, []);
});

test('dedicated authentication challenge command passes the shared command envelope gate', () => {
  const envelope = assertCommandEnvelope({
    command: 'account.getAuthChallenge',
    payload: { id: 'account-a' },
    context: { actor: 'desktop-renderer' }
  });
  assert.equal(envelope.command, 'account.getAuthChallenge');
  assert.equal(envelope.payload.id, 'account-a');
});

test('repeated Telegram QR start reuses the active QR flow instead of disconnecting it', async () => {
  const adapter = new TelegramAdapter();
  const account = { id: 'telegram-a', credentialRef: 'credential:telegram-a' };
  const existing = {
    account,
    client: {},
    authMode: 'qr',
    state: 'waiting-verification',
    step: 'qr',
    lastError: '',
    connectedAt: '',
    user: null,
    floodWaitSeconds: 0,
    phoneHint: ''
  };
  adapter.sessions.set(account.id, existing);
  adapter.credentials = () => ({ appCredentials: { apiId: 1, apiHash: 'a'.repeat(32) }, secret: {} });
  let disconnected = false;
  adapter.disconnect = async () => { disconnected = true; };
  adapter.createClient = () => { throw new Error('new client must not be created for a duplicate QR start'); };

  const result = await adapter.beginQrLogin(account);

  assert.equal(disconnected, false);
  assert.equal(adapter.sessions.get(account.id), existing);
  assert.equal(result.state, 'waiting-verification');
  assert.equal(result.step, 'qr');
});

test('stale Telegram login completion cannot replace the current account session', async () => {
  const adapter = new TelegramAdapter();
  const account = { id: 'telegram-b', credentialRef: 'credential:telegram-b' };
  const stale = {
    account,
    client: { getMe: async () => ({ id: 'stale-user' }), session: { save: () => 'stale-session' } },
    authMode: 'qr',
    state: 'waiting-verification',
    step: 'qr',
    lastError: '',
    connectedAt: '',
    user: null,
    floodWaitSeconds: 0,
    phoneHint: ''
  };
  const current = { ...stale, client: {}, state: 'waiting-verification' };
  adapter.sessions.set(account.id, current);

  const result = await adapter.completeLogin(account, stale, {}, { id: 'stale-user' });

  assert.equal(adapter.sessions.get(account.id), current);
  assert.equal(current.state, 'waiting-verification');
  assert.equal(stale.state, 'waiting-verification');
  assert.equal(result.state, 'waiting-verification');
});
