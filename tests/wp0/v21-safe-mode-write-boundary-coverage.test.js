'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SecurityGuard } = require('../../backend/core/securityGuard');
const { COMMANDS, isWriteCommand } = require('../../shared/core/contracts');

const SAFE_MODE_WRITE_ALLOWLIST = new Set([
  'recovery.enterSafeMode',
  'recovery.clearSafeMode',
  'recovery.createBackup',
  'recovery.stageRestore',
  'recovery.cancelRestore',
  'lifecycle.exitSafeMode',
  'security.deleteCredential'
]);

function guard() {
  const value = new SecurityGuard({
    secureBridge: {},
    systemPolicy: { assertWriteAllowed() {} },
    eventBus: { publish() {} },
    logger: { warn() {} }
  });
  value.setPolicyProviders({
    safeModeProvider: () => true,
    lifecycleStateProvider: () => ''
  });
  return value;
}

test('KF-P1-01 Safe Mode fail-closes every canonical backend write outside the exact recovery allowlist', () => {
  const securityGuard = guard();
  const commands = [...new Set(Object.values(COMMANDS))].sort();
  const writes = commands.filter(isWriteCommand);
  assert.ok(writes.length > SAFE_MODE_WRITE_ALLOWLIST.size);

  for (const command of commands) {
    const write = isWriteCommand(command);
    const allowed = write && SAFE_MODE_WRITE_ALLOWLIST.has(command);
    if (write && !allowed) {
      assert.throws(
        () => securityGuard.authorize(command, { actor: 'test-caller' }),
        error => error?.code === 'SAFE_MODE_WRITE_BLOCKED',
        command
      );
    } else {
      const decision = securityGuard.authorize(command, { actor: 'test-caller' });
      assert.equal(decision.write, write, command);
      assert.equal(decision.allowed, true, command);
    }
  }

  for (const command of SAFE_MODE_WRITE_ALLOWLIST) {
    assert.equal(commands.includes(command), true, `allowlisted command must be canonical: ${command}`);
  }
});

test('KF-P1-01 write classification is command-owned and cannot be spoofed by caller hints or allowlist prefixes', () => {
  const securityGuard = guard();

  const readDecision = securityGuard.authorize(COMMANDS.ACCOUNT_LIST, {
    actor: 'test-caller',
    write: true
  });
  assert.equal(readDecision.write, false);

  assert.throws(
    () => securityGuard.authorize(COMMANDS.ACCOUNT_CREATE, {
      actor: 'test-caller',
      write: false
    }),
    error => error?.code === 'SAFE_MODE_WRITE_BLOCKED'
  );

  assert.equal(isWriteCommand('recovery.createBackup.evil'), true);
  assert.throws(
    () => securityGuard.authorize('recovery.createBackup.evil', { actor: 'test-caller' }),
    error => error?.code === 'SAFE_MODE_WRITE_BLOCKED'
  );
});
