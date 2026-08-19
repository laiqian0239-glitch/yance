'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { R32SqliteStore } = require('../lib/r32SqliteStore');
const { RuntimeDomainIsolationAuthority } = require('../services/runtimeDomainIsolationAuthority');
const { RuntimeSafetySupervisor } = require('../services/runtimeSafetySupervisor');

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6o-'));
  const store = new R32SqliteStore({ dbPath: path.join(root, 'store.db') });
  return { root, store, close() { store.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('single-account authentication failure is quarantined without global safe mode', () => {
  const authority = new RuntimeDomainIsolationAuthority({ clock: () => '2026-08-01T12:00:00.000Z' });
  const state = authority.evaluate([{
    code: 'FACEBOOK_REAUTH_REQUIRED', severity: 'high', scopeType: 'account',
    platform: 'facebook', accountId: 'facebook-personal-a', capability: 'authenticate', detail: '登录会话已失效'
  }]);
  assert.equal(state.globalWriteBlocked, false);
  assert.deepEqual(state.globalSafeModeReasons, []);
  assert.equal(state.accounts['facebook-personal-a'].state, 'reauth-required');
  assert.deepEqual(state.accounts['facebook-personal-a'].blockedCapabilities, ['authenticate', 'sync', 'send']);
  assert.equal(state.platforms.facebook.blocked, false);
});

test('platform degradation does not stop unrelated platforms or AI candidate generation', () => {
  const authority = new RuntimeDomainIsolationAuthority({ clock: () => '2026-08-01T12:00:00.000Z' });
  const state = authority.evaluate([{
    code: 'FACEBOOK_WEBHOOK_UNAVAILABLE', severity: 'high', scopeType: 'platform',
    platform: 'facebook', capability: 'receive', detail: 'Webhook 暂不可用'
  }]);
  assert.equal(state.globalWriteBlocked, false);
  assert.equal(state.aiAutomationBlocked, false);
  assert.equal(state.platforms.facebook.state, 'degraded');
  assert.deepEqual(state.platforms.facebook.blockedCapabilities, ['receive']);
  assert.equal(state.platforms.whatsapp, undefined);
});

test('only shared infrastructure failures escalate to global safe mode', () => {
  const authority = new RuntimeDomainIsolationAuthority({ clock: () => '2026-08-01T12:00:00.000Z' });
  const scoped = authority.evaluate([{ code: 'SEND_OUTCOME_UNKNOWN', severity: 'critical', scopeType: 'capability', capability: 'send', detail: '发送结果待人工对账' }]);
  assert.equal(scoped.globalWriteBlocked, false);
  assert.equal(scoped.capabilities.send.blocked, true);
  const global = authority.evaluate([{ code: 'SQLITE_QUICK_CHECK_FAILED', severity: 'critical', scopeType: 'system', detail: 'quick_check failed' }]);
  assert.equal(global.globalWriteBlocked, true);
  assert.deepEqual(global.globalSafeModeReasons, ['SQLITE_QUICK_CHECK_FAILED']);
});

test('runtime safety supervisor does not enter global safe mode for one blocked account', async () => {
  const transitions = [];
  const runtime = { operatingMode: 'normal', async enterSafeMode(reason, metadata) { transitions.push({ reason, metadata }); this.operatingMode = 'safeMode'; } };
  const supervisor = new RuntimeSafetySupervisor({
    runtime,
    domainIsolation: new RuntimeDomainIsolationAuthority(),
    sendQueue: { status: () => ({ resumeBlocked: false, outcomeUnknown: 0 }) },
    modelStatus: { read: () => ({ routeIntegrity: { pass: true, invalidPersistedRouteCount: 0, quarantine: [] } }) },
    backgroundJobs: { snapshot: () => ({ counts: { FAILED_FINAL: 0 }, consistency: { pass: true } }) },
    accountManager: { list: () => ({ accounts: [{ id: 'fb-a', platform: 'facebook', state: 'reauthorize', reasonCode: 'FACEBOOK_REAUTH_REQUIRED', lastError: 'token expired' }] }) },
    platformReadiness: { evaluate: () => ({ summary: { blockedPlatforms: 1 }, platforms: [{ platform: 'facebook', status: 'blocked' }] }) },
    eventBus: { on() {}, off() {}, publish() {} },
    logger: { error() {} }
  });
  await supervisor.evaluate();
  assert.equal(transitions.length, 0);
  const state = supervisor.snapshot();
  assert.equal(state.globalWriteBlocked, false);
  assert.equal(state.accounts['fb-a'].state, 'reauth-required');
});

test('scoped safety issues are persisted with append-only events and resolution receipts', () => {
  const fixture = tempStore();
  try {
    const { ScopedSafetyAuthority } = require('../services/scopedSafetyAuthority');
    const authority = new ScopedSafetyAuthority({ storeProvider: () => fixture.store, clock: () => '2026-08-01T12:00:00.000Z' });
    authority.reconcile([{ code: 'TELEGRAM_REAUTH_REQUIRED', severity: 'high', scopeType: 'account', platform: 'telegram', accountId: 'tg-a', capability: 'authenticate', detail: 'session expired' }]);
    const before = authority.snapshot();
    assert.equal(before.active.length, 1);
    assert.equal(before.active[0].scopeType, 'account');
    const resolved = authority.resolve(before.active[0].issueId, { actor: 'uat', reason: '重新登录成功', healthProbe: { pass: true, reasonCode: 'TELEGRAM_SESSION_READY' } });
    assert.equal(resolved.state, 'resolved');
    assert.equal(authority.snapshot().active.length, 0);
    const events = fixture.store.db.prepare('SELECT event_type FROM scoped_safety_events WHERE issue_id=? ORDER BY sequence').all(before.active[0].issueId);
    assert.deepEqual(events.map(row => row.event_type), ['opened', 'resolved']);
    assert.throws(() => fixture.store.db.prepare('DELETE FROM scoped_safety_events WHERE issue_id=?').run(before.active[0].issueId), /append-only/i);
  } finally { fixture.close(); }
});

test('facebook driver resolution separates Page, personal identity and production mautrix/meta Personal Messenger', () => {
  const registry = require('../services/platformDriverRegistry');
  assert.equal(registry.resolveDriverId({ platform: 'facebook', metadata: { accountKind: 'page' } }), 'facebook-page-official');
  assert.equal(registry.resolveDriverId({ platform: 'facebook', metadata: { accountKind: 'personal-identity' } }), 'facebook-personal-identity-official');
  assert.equal(registry.resolveDriverId({ platform: 'facebook', metadata: { accountKind: 'personal-messenger' } }), 'facebook-personal-messenger-mautrix-meta');
  const page = registry.getForAccount({ platform: 'facebook', metadata: { accountKind: 'page' } });
  const identity = registry.getForAccount({ platform: 'facebook', metadata: { accountKind: 'personal-identity' } });
  const messenger = registry.getForAccount({ platform: 'facebook', metadata: { accountKind: 'personal-messenger' } });
  assert.equal(page.supportLevel, 'production');
  assert.equal(identity.messagingSupported, false);
  assert.equal(messenger.supportLevel, 'production');
  assert.equal(messenger.riskDisclosureRequired, false);
  assert.equal(messenger.protocolAuthority, 'mautrix-meta');
  assert.equal(messenger.isolationModel, 'matrix-application-service');
});

test('official Facebook personal identity driver cannot be misrepresented as Messenger messaging', async () => {
  const registry = require('../services/platformDriverRegistry');
  const driver = registry.getForAccount({ id: 'fb-id-a', platform: 'facebook', metadata: { accountKind: 'personal-identity' } });
  assert.equal(driver.credentialReady({}, { userId: '1001', identityReceipt: 'receipt-1' }), true);
  assert.throws(() => driver.sendText({}, { text: 'hello' }), error => error.code === 'FACEBOOK_PERSONAL_IDENTITY_MESSAGING_UNSUPPORTED');
});

test('Facebook personal Messenger production driver is mautrix/meta-owned and has no browser opt-in authority', () => {
  const registry = require('../services/platformDriverRegistry');
  const driver = registry.getForAccount({ id: 'fb-personal-a', platform: 'facebook', metadata: { accountKind: 'personal-messenger' } });
  assert.equal(driver.driverId, 'facebook-personal-messenger-mautrix-meta');
  assert.equal(driver.supportLevel, 'production');
  assert.equal(driver.protocolAuthority, 'mautrix-meta');
  assert.equal(driver.isolationModel, 'matrix-application-service');
  assert.equal(driver.riskDisclosureRequired, false);
});

test('safe mode exit authorization ignores account-scoped failures but cannot bypass shared infrastructure blockers', async () => {
  const { RecoveryManager } = require('../core/recoveryManager');
  const make = tests => new RecoveryManager({
    safeModeService: { snapshot: () => ({ active: true, operatingMode: 'safeMode' }) },
    backupService: { pendingRestore: () => null, restoreHistory: () => [] },
    diagnosticsService: { snapshot: () => ({ tests }) },
    productionDiagnostics: { snapshot: () => ({}) },
    systemPolicy: { read: () => ({ privacyMode: true }) },
    lifecycleManager: { operatingMode: 'safeMode' },
    securityGuard: { execute: async (_action, _context, operation) => operation() },
    eventBus: { publish() {} }, logger: {},
    scopedSafety: { snapshot: () => ({ active: [], globalBlockers: [] }) }
  });

  const accountOnly = make([{ id: 'account-runtime-readiness', severity: 'critical', pass: false, reasonCode: 'FACEBOOK_REAUTH_REQUIRED', scopeType: 'account' }]);
  const prepared = await accountOnly.execute('recovery.prepareSafeModeExit', { confirmation: 'EXIT_SAFE_MODE', reason: 'account issue is isolated' }, { actor: 'uat' });
  assert.match(prepared.exitAuthorizationId, /^safe-exit-/u);
  assert.equal(accountOnly.consumeSafeModeExitAuthorization(prepared), true);
  assert.throws(() => accountOnly.consumeSafeModeExitAuthorization(prepared), error => error.code === 'SAFE_MODE_EXIT_AUTHORIZATION_INVALID');

  const sharedFailure = make([{ id: 'sqlite-store', severity: 'critical', pass: false, reasonCode: 'SQLITE_QUICK_CHECK_FAILED', scopeType: 'system' }]);
  await assert.rejects(
    () => sharedFailure.execute('recovery.prepareSafeModeExit', { confirmation: 'EXIT_SAFE_MODE', reason: 'force', force: true }, { actor: 'uat' }),
    error => error.code === 'SAFE_MODE_EXIT_BLOCKED_GLOBAL'
  );
});

test('runtime API v2 cannot exit global safe mode without a scoped recovery authorization receipt', async () => {
  const { createRuntimeHarness } = require('../../tests/wp6/helpers');
  const h = await createRuntimeHarness();
  try {
    let accepted = false;
    h.runtime.composition.recoveryManager = {
      consumeSafeModeExitAuthorization(payload) {
        if (payload.exitAuthorizationId === 'safe-exit-1' && payload.exitAuthorizationToken === 'token-1') { accepted = true; return true; }
        const error = new Error('authorization required'); error.code = 'SAFE_MODE_EXIT_AUTHORIZATION_REQUIRED'; throw error;
      }
    };
    const enterState = h.runtime.store.snapshot();
    await h.runtime.executeCommand({
      contractVersion: 2, commandId: '11111111-1111-4111-8111-111111111111', commandType: 'runtime.setOperatingMode',
      expectedStateVersion: enterState.stateVersion, issuedAtUtc: '2026-08-01T12:00:00.000Z', payload: { operatingMode: 'safeMode', reason: 'test' }
    });
    const blockedState = h.runtime.store.snapshot();
    assert.throws(() => h.runtime.executeCommand({
      contractVersion: 2, commandId: '22222222-2222-4222-8222-222222222222', commandType: 'runtime.setOperatingMode',
      expectedStateVersion: blockedState.stateVersion, issuedAtUtc: '2026-08-01T12:00:01.000Z', payload: { operatingMode: 'normal', reason: 'test' }
    }), error => error.code === 'SAFE_MODE_EXIT_AUTHORIZATION_REQUIRED');
    const authorizedState = h.runtime.store.snapshot();
    await h.runtime.executeCommand({
      contractVersion: 2, commandId: '33333333-3333-4333-8333-333333333333', commandType: 'runtime.setOperatingMode',
      expectedStateVersion: authorizedState.stateVersion, issuedAtUtc: '2026-08-01T12:00:02.000Z',
      payload: { operatingMode: 'normal', reason: 'test', exitAuthorizationId: 'safe-exit-1', exitAuthorizationToken: 'token-1' }
    });
    assert.equal(accepted, true);
    assert.equal(h.runtime.operatingMode, 'normal');
  } finally { await h.close(); }
});

test('renderer safe-mode exit uses recovery preflight receipt instead of an unchecked direct mode flip', () => {
  const root = path.join(__dirname, '..', '..');
  const coreClient = fs.readFileSync(path.join(root, 'frontend', 'js', 'core-client.js'), 'utf8');
  const systemCenter = fs.readFileSync(path.join(root, 'frontend', 'r32-system-center.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  assert.match(coreClient, /recovery\.prepareSafeModeExit/u);
  assert.match(coreClient, /exitAuthorizationId/u);
  assert.match(coreClient, /exitAuthorizationToken/u);
  assert.match(systemCenter, /YanceCore\?\.recovery\?\.clearSafeMode/u);
  assert.match(preload, /exitAuthorizationId/u);
});

test('scoped safety issues auto-resolve only after two consecutive clean supervisor evaluations', () => {
  const fixture = tempStore();
  try {
    const { ScopedSafetyAuthority } = require('../services/scopedSafetyAuthority');
    const authority = new ScopedSafetyAuthority({ storeProvider: () => fixture.store, clock: (() => { let n = 0; return () => `2026-08-01T12:00:0${n++}.000Z`; })() });
    authority.reconcile([{ code: 'WHATSAPP_REAUTH_REQUIRED', severity: 'high', scopeType: 'account', platform: 'whatsapp', accountId: 'wa-a', capability: 'authenticate' }]);
    assert.equal(authority.snapshot().active.length, 1);
    authority.reconcile([]);
    assert.equal(authority.snapshot().active.length, 1);
    authority.reconcile([]);
    assert.equal(authority.snapshot().active.length, 0);
    const events = fixture.store.db.prepare('SELECT event_type FROM scoped_safety_events ORDER BY occurred_at,sequence').all().map(row => row.event_type);
    assert.deepEqual(events, ['opened', 'clear-observed', 'auto-resolved']);
  } finally { fixture.close(); }
});

test('system center projects account and platform safety issues without labelling them as global safe mode', () => {
  const root = path.join(__dirname, '..', '..');
  const source = fs.readFileSync(path.join(root, 'backend', 'services', 'systemCenterService.js'), 'utf8');
  assert.match(source, /Object\.entries\(supervisor\.accounts/u);
  assert.match(source, /Object\.entries\(supervisor\.platforms/u);
  assert.match(source, /账号需要重新授权|账号已隔离/u);
  assert.match(source, /平台能力降级/u);
});

test('account API exposes typed Facebook driver contracts and UI cannot confuse identity login with Page or Messenger', () => {
  const root = path.join(__dirname, '..', '..');
  const manager = fs.readFileSync(path.join(root, 'backend', 'services', 'accountManager.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'frontend', 'r32-account-center.js'), 'utf8');
  assert.match(manager, /driverContracts:\s*platformDrivers\.driverContracts\(\)/u);
  const architectureStatus = fs.readFileSync(path.join(root, 'backend', 'services', 'round12ArchitectureStatusService.js'), 'utf8');
  assert.match(architectureStatus, /accountDriverContracts:\s*platformDriverRegistry\.driverContracts\(\)/u);
  assert.match(frontend, /id="ac32FormFacebookKind"/u);
  assert.match(frontend, /facebook-page-official/u);
  assert.match(frontend, /facebook-personal-identity-official/u);
  assert.match(frontend, /facebook-personal-messenger-experimental/u);
  assert.match(frontend, /个人身份登录不提供 Messenger 私信/u);
  assert.match(frontend, /非官方实验能力/u);
  assert.match(frontend, /accountKind/u);
  assert.match(frontend, /driverId/u);
});
