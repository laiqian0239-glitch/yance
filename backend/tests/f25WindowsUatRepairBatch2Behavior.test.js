'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-f25-batch2-behavior-'));
process.env.YANCE_DATA_DIR = dataRoot;

const accountRepository = require('../repositories/accountRepository');
const { closeStore } = require('../repositories/storeProvider');
const accountManager = require('../services/accountManager');
const whatsapp = require('../services/whatsappAdapter');

const originalStart = whatsapp.start;
const originalStop = whatsapp.stop;
const originalHydration = { ...accountManager.hydration };
accountManager.hydration = {
  phase: 'ready',
  ready: true,
  startedAt: originalHydration.startedAt || new Date().toISOString(),
  completedAt: new Date().toISOString(),
  errorCode: ''
};

function pendingInput(id) {
  return {
    id,
    platform: 'whatsapp',
    adapterAccountId: id,
    displayName: 'WhatsApp 账号',
    identityLabel: '登录后自动识别',
    lifecycleState: 'pending-auth',
    autoReconnect: false,
    isPrimary: false,
    isDefaultSend: false,
    metadata: { authorizationPending: true }
  };
}

test.after(() => {
  whatsapp.start = originalStart;
  whatsapp.stop = originalStop;
  accountManager.hydration = originalHydration;
  closeStore();
  fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

test('manual pending-auth connect reaches the real driver contract with an auditable attempt id', async () => {
  const account = await accountRepository.create(pendingInput('wa-f25-manual-pending'));
  let observedOptions = null;

  whatsapp.start = async (_reference, options = {}) => {
    observedOptions = { ...options };
    return {
      accountId: account.adapterAccountId,
      state: 'connecting',
      qrReady: false,
      attemptId: options.attemptId
    };
  };
  whatsapp.stop = async () => ({ ok: true, state: 'stopped' });

  const result = await accountManager.connect(account.id);

  assert.equal(observedOptions?.manual, true);
  assert.match(observedOptions?.attemptId || '', /^[0-9a-f-]{36}$/i);
  assert.equal(result.authorizationPending, true);
  assert.equal(result.state, 'connecting');
  assert.equal(result.connectionAttemptId, observedOptions.attemptId);
  assert.ok(Date.parse(result.connectionStartedAt) > 0);
  assert.equal(result.canSend, false);
  assert.equal(result.canReceive, false);

  accountManager.onWhatsAppEvent({
    accountId: account.adapterAccountId,
    state: 'offline',
    attemptId: '00000000-0000-4000-8000-000000000000',
    reasonCode: 'STALE_ATTEMPT_SHOULD_BE_IGNORED'
  });
  const afterStaleEvent = accountManager.getLifecycleState(account.id);
  assert.equal(afterStaleEvent.state, 'connecting');
  assert.equal(afterStaleEvent.connectionAttemptId, observedOptions.attemptId);
  assert.equal(accountRepository.getRaw(account.id)?.lifecycleState, 'pending-auth');
});

test('failed pending-auth connect performs one cleanup stop and tombstones the temporary account', async () => {
  const account = await accountRepository.create(pendingInput('wa-f25-failed-pending'));
  let stopCalls = 0;

  whatsapp.start = async () => {
    const error = new Error('二维码启动失败');
    error.code = 'WHATSAPP_QR_START_TIMEOUT';
    throw error;
  };
  whatsapp.stop = async () => {
    stopCalls += 1;
    return { ok: true, state: 'stopped' };
  };

  await assert.rejects(
    () => accountManager.connect(account.id),
    error => error?.code === 'WHATSAPP_QR_START_TIMEOUT'
  );

  assert.equal(accountRepository.list().some(row => row.id === account.id), false, 'tombstoned authorization account must leave the active account projection');
  assert.equal(accountRepository.getRaw(account.id)?.lifecycleState, 'tombstoned', 'temporary authorization evidence must be retained as a tombstone');
  assert.equal(stopCalls, 1, 'pending authorization cleanup must perform exactly one defensive stop');
});

test('disconnect failure persists a paused manual-review saga instead of leaving the account apparently healthy', async () => {
  const account = await accountRepository.create({
    id: 'wa-f25-disconnect-manual-review',
    platform: 'whatsapp',
    adapterAccountId: 'wa-f25-disconnect-manual-review',
    displayName: 'WhatsApp Active',
    identityLabel: 'WhatsApp Active',
    lifecycleState: 'active',
    autoReconnect: true,
    isPrimary: false,
    isDefaultSend: false,
    metadata: {}
  });
  whatsapp.stop = async () => {
    const error = new Error('simulated adapter stop failure');
    error.code = 'SIMULATED_ADAPTER_STOP_FAILURE';
    throw error;
  };

  await assert.rejects(
    () => accountManager.disconnect(account.id, { logout: false }),
    error => error?.code === 'SIMULATED_ADAPTER_STOP_FAILURE'
  );

  const raw = accountRepository.getRaw(account.id);
  assert.equal(raw.paused, true);
  assert.equal(raw.metadata.lifecyclePending, true);
  const saga = require('../services/accountLifecycleSagaService').singleton.latest(account.id, 'disconnect');
  assert.equal(saga.state, 'manual_review');
  const projected = accountManager.list().accounts.find(row => row.id === account.id);
  assert.equal(projected.authorityPending, true);
  assert.equal(projected.canAttemptSend, false);
  assert.equal(projected.stateLabel, '账号状态需要人工恢复');
});
