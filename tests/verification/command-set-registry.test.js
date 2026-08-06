'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  validateCommandSet,
  commandSetDigest,
  loadCommandSet
} = require('../../shared/verification/commandSetRegistry');

function validSet() {
  return {
    schemaVersion: 1,
    commandSetId: 'pvep-linux-selftest-v1',
    platform: 'linux',
    commands: [{
      commandId: 'pvep-required-tests',
      executable: 'node',
      argv: ['tools/verification/run-required-tests.js'],
      expectedExitCode: 0,
      generatedRoots: ['.pvep-output'],
      artifacts: []
    }]
  };
}

test('valid command sets have deterministic canonical digests and load by ID only', () => {
  const set = validSet();
  assert.equal(validateCommandSet(set).pass, true);
  assert.match(commandSetDigest(set), /^[0-9a-f]{64}$/u);
  assert.equal(commandSetDigest(set), commandSetDigest(structuredClone(set)));
  const loaded = loadCommandSet({ repoRoot: path.resolve(__dirname, '..', '..'), commandSetId: 'pvep-linux-selftest-v1' });
  assert.equal(loaded.commandSetId, set.commandSetId);
  assert.equal(loaded.platform, 'linux');
  assert.throws(() => loadCommandSet({ repoRoot: '.', commandSetId: '../escape' }), /EVIDENCE_COMMAND_SET_UNTRUSTED/u);
});

test('shell command strings and wrapper executables are rejected', () => {
  const commandString = validSet();
  commandString.commands[0] = { command: 'node --test tests/verification/*.test.js' };
  assert.equal(validateCommandSet(commandString).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');

  for (const [executable, argv] of [
    ['sh', ['-c', 'node test.js']],
    ['bash', ['-c', 'node test.js']],
    ['cmd.exe', ['/c', 'node test.js']],
    ['powershell.exe', ['-Command', 'node test.js']],
    ['pwsh', ['-Command', 'node test.js']]
  ]) {
    const set = validSet();
    set.commands[0].executable = executable;
    set.commands[0].argv = argv;
    assert.equal(validateCommandSet(set).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');
  }
});

test('duplicates, traversal, wildcard expansion and controlled-root overlap fail closed', () => {
  const duplicate = validSet();
  duplicate.commands.push(structuredClone(duplicate.commands[0]));
  assert.equal(validateCommandSet(duplicate).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');

  const traversal = validSet();
  traversal.commands[0].argv = ['../escape.js'];
  assert.equal(validateCommandSet(traversal).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');

  const wildcard = validSet();
  wildcard.commands[0].argv = ['tests/verification/*.test.js'];
  assert.equal(validateCommandSet(wildcard).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');

  const overlap = validSet();
  overlap.commands[0].generatedRoots = ['shared/generated'];
  assert.equal(validateCommandSet(overlap).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');

  const wrongPlatform = validSet();
  wrongPlatform.platform = 'darwin';
  assert.equal(validateCommandSet(wrongPlatform).reasonCode, 'EVIDENCE_COMMAND_SET_INVALID');
});
