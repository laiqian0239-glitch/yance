'use strict';

const test = require('node:test');
const assert = require('node:assert');
const sm = require('../../electron/m2/stateMachine');

function withState(patch) {
  return Object.assign(sm.initialState(), patch);
}

test('initial state is BOOTSTRAPPING', () => {
  const s = sm.initialState();
  assert.strictEqual(s.name, 'BOOTSTRAPPING');
  assert.strictEqual(s.backendReady, false);
  assert.strictEqual(s.quitting, false);
});

test('BOOTSTRAPPING -> app.whenReady.resolved -> APP_READY', () => {
  const r = sm.transition(sm.initialState(), 'app.whenReady.resolved');
  assert.strictEqual(r.rejected, false);
  assert.strictEqual(r.toState, 'APP_READY');
  assert.strictEqual(r.reasonCode, 'M2_APP_READY');
  assert.strictEqual(r.next.name, 'APP_READY');
});

test('APP_READY -> backend.launch.requested -> BACKEND_STARTING (guard ok)', () => {
  const s = withState({ name: 'APP_READY' });
  const r = sm.transition(s, 'backend.launch.requested');
  assert.strictEqual(r.rejected, false);
  assert.strictEqual(r.toState, 'BACKEND_STARTING');
});

test('APP_READY -> backend.launch.requested denied when quitting', () => {
  const s = withState({ name: 'APP_READY', quitting: true });
  const r = sm.transition(s, 'backend.launch.requested');
  assert.strictEqual(r.rejected, true);
  assert.strictEqual(r.toState, 'APP_READY');
});

test('BACKEND_OWNER_VALIDATING -> trusted-ready.received -> BACKEND_READY', () => {
  const s = withState({ name: 'BACKEND_OWNER_VALIDATING', startupAttemptId: 'A1' });
  const r = sm.transition(s, 'trusted-ready.received', { startupAttemptId: 'A1', backendPid: 1234, backendReadySource: 'trusted' });
  assert.strictEqual(r.rejected, false);
  assert.strictEqual(r.toState, 'BACKEND_READY');
  assert.strictEqual(r.next.backendReady, true);
  assert.strictEqual(r.next.backendPid, 1234);
});

test('stale trusted-ready is forbidden (NO_CHANGE)', () => {
  const s = withState({ name: 'BACKEND_OWNER_VALIDATING', startupAttemptId: 'A1' });
  const r = sm.transition(s, 'trusted-ready.received', { startupAttemptId: 'STALE' });
  assert.strictEqual(r.forbidden, true);
  assert.strictEqual(r.toState, 'NO_CHANGE');
  assert.strictEqual(r.reasonCode, 'M2_STALE_TRUSTED_READY_REJECTED');
  assert.strictEqual(r.next, s);
});

test('RUNNING -> backend.child.exited (non-intentional) -> FAILED_STARTUP', () => {
  const s = withState({ name: 'RUNNING', backendReady: true });
  const r = sm.transition(s, 'backend.child.exited', { intentionalRestart: false });
  assert.strictEqual(r.toState, 'FAILED_STARTUP');
  assert.strictEqual(r.next.backendReady, false);
});

test('backend.child.exited during intentional restart does NOT go to FAILED_STARTUP', () => {
  const s = withState({ name: 'RUNNING', backendReady: true });
  const r = sm.transition(s, 'backend.child.exited', { intentionalRestart: true });
  assert.strictEqual(r.rejected, true);
  assert.strictEqual(r.toState, 'RUNNING');
});

test('FAILED_STARTUP -> backend-forwarded-ipc.requested is forbidden (NO_CHANGE)', () => {
  const s = withState({ name: 'FAILED_STARTUP' });
  const r = sm.transition(s, 'backend-forwarded-ipc.requested');
  assert.strictEqual(r.forbidden, true);
  assert.strictEqual(r.toState, 'NO_CHANGE');
  assert.strictEqual(r.reasonCode, 'M2_BACKEND_NOT_READY');
});

test('QUITTING -> backend.restart.requested is forbidden', () => {
  // 真实 QUITTING 状态由 applyToState 置 quitting=true，fixture 须反映这一不变量。
  const s = withState({ name: 'QUITTING', quitting: true });
  const r = sm.transition(s, 'backend.restart.requested');
  assert.strictEqual(r.forbidden, true);
  assert.strictEqual(r.reasonCode, 'M2_RESTART_BACKEND_DURING_QUIT_DENIED');
});

test('RUNNING -> window.close.requested (closeToTray) stays RUNNING', () => {
  const s = withState({ name: 'RUNNING', backendReady: true });
  const r = sm.transition(s, 'window.close.requested', { closeToTray: true });
  assert.strictEqual(r.toState, 'RUNNING');
});

test('RUNNING -> window.close.requested (explicit quit) -> QUITTING', () => {
  const s = withState({ name: 'RUNNING', backendReady: true });
  const r = sm.transition(s, 'window.close.requested', { closeToTray: false, appQuit: true });
  assert.strictEqual(r.toState, 'QUITTING');
  assert.strictEqual(r.next.quitting, true);
});

test('second-instance during FAILED_STARTUP keeps FAILED_STARTUP (no auto backend start)', () => {
  const s = withState({ name: 'FAILED_STARTUP' });
  const r = sm.transition(s, 'second-instance');
  assert.strictEqual(r.rejected, false);
  assert.strictEqual(r.toState, 'FAILED_STARTUP');
  assert.strictEqual(r.reasonCode, 'M2_SECOND_INSTANCE_DURING_FAILED_STARTUP');
});

test('BACKEND_RESTARTING -> backend.restart.requested is forbidden (dup restart)', () => {
  const s = withState({ name: 'BACKEND_RESTARTING', backendRestarting: true });
  const r = sm.transition(s, 'backend.restart.requested');
  assert.strictEqual(r.forbidden, true);
  assert.strictEqual(r.reasonCode, 'M2_BACKEND_RESTART_ALREADY_IN_PROGRESS');
});

test('packaged dev-fallback path resolution failure -> FAILED_STARTUP', () => {
  const s = withState({ name: 'RUNNING', backendReady: true });
  const r = sm.transition(s, 'packaged-launch.path-resolution-failed', { isPackaged: true, devFallbackAttempted: true });
  assert.strictEqual(r.toState, 'FAILED_STARTUP');
  assert.strictEqual(r.reasonCode, 'M2_PACKAGED_LAUNCH_DEV_FALLBACK_DENIED');
});

test('unknown event is rejected (NO_CHANGE)', () => {
  const s = sm.initialState();
  const r = sm.transition(s, 'no-such-event');
  assert.strictEqual(r.rejected, true);
  assert.strictEqual(r.reasonCode, 'M2_NO_RULE');
});

test('hard gate: FAILED_STARTUP/QUITTING never revive to RUNNING (whole table invariant)', () => {
  for (const rule of sm.TRANSITIONS) {
    if (rule.from === 'FAILED_STARTUP' || rule.from === 'QUITTING') {
      assert.notStrictEqual(rule.to, 'RUNNING', `rule ${rule.from}/${rule.event} must not revive to RUNNING`);
    }
  }
  assert.strictEqual(sm.isForbiddenRevive('FAILED_STARTUP', 'RUNNING'), true);
  assert.strictEqual(sm.isForbiddenRevive('QUITTING', 'RUNNING'), true);
  assert.strictEqual(sm.isForbiddenRevive('APP_READY', 'BACKEND_STARTING'), false);
});

test('backendForwardedIpcAllowed matches contract table', () => {
  assert.strictEqual(sm.backendForwardedIpcAllowed('BACKEND_READY'), true);
  assert.strictEqual(sm.backendForwardedIpcAllowed('RUNNING'), true);
  assert.strictEqual(sm.backendForwardedIpcAllowed('BOOTSTRAPPING'), false);
  assert.strictEqual(sm.backendForwardedIpcAllowed('QUITTING'), false);
});
