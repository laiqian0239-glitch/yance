'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.resolve(__dirname, '../../tools/verification/pvep-trusted-runner.js');
const TEST_PLATFORM = process.platform === 'win32' ? 'windows' : 'linux';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function makeCandidate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvep-trusted-runner-'));
  git(root, 'init');
  git(root, 'config', 'user.email', 'pvep-test@example.invalid');
  git(root, 'config', 'user.name', 'PVEP Test');
  fs.mkdirSync(path.join(root, 'governance/verification/command-sets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests/verification/fixtures/commands'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools/verification'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/verification/fixtures/commands/pass.js'), "process.stdout.write('real-command\\n');\n", 'utf8');
  fs.writeFileSync(path.join(root, 'tools/verification/run-command-set.js'), "require('node:fs').writeFileSync('CANDIDATE_RUNNER_WAS_USED','bad'); process.exit(0);\n", 'utf8');
  fs.writeFileSync(path.join(root, 'tests/verification/fixtures/commands/candidate-noop.js'), "require('node:fs').writeFileSync('CANDIDATE_COMMAND_SET_WAS_USED','bad');\n", 'utf8');
  fs.writeFileSync(path.join(root, 'governance/verification/command-sets/pvep-linux-selftest-v1.json'), JSON.stringify({
    schemaVersion: 1,
    commandSetId: 'candidate-controlled-set',
    platform: TEST_PLATFORM,
    commands: [{
      commandId: 'candidate-noop',
      executable: 'node',
      argv: ['tests/verification/fixtures/commands/candidate-noop.js'],
      expectedExitCode: 0,
      generatedRoots: [],
      artifacts: []
    }]
  }, null, 2) + '\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'fixture');
  return { root, head: git(root, 'rev-parse', 'HEAD') };
}

function makeTrustedCommandSetRoot(command = {
  commandId: 'trusted-command',
  executable: 'node',
  argv: ['tests/verification/fixtures/commands/pass.js'],
  expectedExitCode: 0,
  generatedRoots: [],
  artifacts: []
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvep-trusted-command-set-'));
  fs.mkdirSync(path.join(root, 'governance/verification/command-sets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance/verification/command-sets/pvep-linux-selftest-v1.json'), JSON.stringify({
    schemaVersion: 1,
    commandSetId: 'pvep-linux-selftest-v1',
    platform: TEST_PLATFORM,
    commands: [command]
  }, null, 2) + '\n');
  return root;
}

function makeRunRequest(candidate, head = candidate.head, command) {
  const trustedCommandSetRoot = makeTrustedCommandSetRoot(command);
  const output = path.join(os.tmpdir(), `pvep-evidence-${process.pid}-${Date.now()}-${Math.random()}.json`);
  const subject = path.join(os.tmpdir(), `pvep-subject-${process.pid}-${Date.now()}-${Math.random()}.txt`);
  const args = [
    'run',
    '--repo-root', candidate.root,
    '--trusted-command-set-root', trustedCommandSetRoot,
    '--repository', 'laiqian0239-glitch/yance',
    '--work-package', 'PVEP',
    '--gate-id', 'pvep-linux-selftest',
    '--base', '1'.repeat(40),
    '--head', head,
    '--command-set', 'governance/verification/command-sets/pvep-linux-selftest-v1.json',
    '--output', output,
    '--subject-output', subject
  ];
  return { args, output, subject };
}

function runTrusted(candidate, head = candidate.head, command) {
  const request = makeRunRequest(candidate, head, command);
  const result = spawnSync(process.execPath, [RUNNER, ...request.args], { encoding: 'utf8' });
  return { result, output: request.output, subject: request.subject };
}

test('base-owned runner ignores candidate runner and records real command facts', () => {
  const candidate = makeCandidate();
  const { result, output, subject } = runTrusted(candidate);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(candidate.root, 'CANDIDATE_RUNNER_WAS_USED')), false);
  assert.equal(fs.existsSync(path.join(candidate.root, 'CANDIDATE_COMMAND_SET_WAS_USED')), false);
  const evidence = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(evidence.headCommit, candidate.head);
  assert.equal(evidence.verificationStatus, 'VERIFIED_PASS');
  assert.equal(evidence.execution.commands[0].commandId, 'trusted-command');
  assert.equal(evidence.execution.commands[0].exitCode, 0);
  assert.match(evidence.commandSet.sha256, /^[0-9a-f]{64}$/u);
  const subjectText = fs.readFileSync(subject, 'utf8');
  assert.equal(subjectText, `YANCE_PVEP_SUBJECT_V1\nrepository=laiqian0239-glitch/yance\nhead=${candidate.head}\nplatform=${TEST_PLATFORM}\ncommandSetSha256=${evidence.commandSet.sha256}\n`);
});

test('base-owned runner rejects a claimed Head that is not the candidate checkout', () => {
  const candidate = makeCandidate();
  const { result } = runTrusted(candidate, '2'.repeat(40));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EVIDENCE_WORKSPACE_HEAD_MISMATCH/u);
});

test('base-owned runner strips ambient Node controls and arbitrary variables from trusted children', () => {
  const candidate = makeCandidate();
  const command = {
    commandId: 'trusted-env-check',
    executable: 'node',
    argv: ['-e', "const forbidden=['NODE_OPTIONS','NODE_PATH','PVEP_AMBIENT_SHOULD_NOT_LEAK']; if (forbidden.some((name) => Object.hasOwn(process.env, name))) process.exit(23); process.stdout.write('clean-env\\n');"],
    expectedExitCode: 0,
    generatedRoots: [],
    artifacts: []
  };
  const request = makeRunRequest(candidate, candidate.head, command);
  const wrapper = path.join(os.tmpdir(), `pvep-runner-wrapper-${process.pid}-${Date.now()}.js`);
  fs.writeFileSync(wrapper, [
    "process.env.NODE_OPTIONS = '--require=./pvep-does-not-exist.js';",
    "process.env.NODE_PATH = 'pvep-hostile-node-path';",
    "process.env.PVEP_AMBIENT_SHOULD_NOT_LEAK = 'ambient-value';",
    `const { run } = require(${JSON.stringify(RUNNER)});`,
    'run(process.argv.slice(2));',
    ''
  ].join('\n'), 'utf8');

  const result = spawnSync(process.execPath, [wrapper, ...request.args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(fs.readFileSync(request.output, 'utf8'));
  assert.equal(evidence.verificationStatus, 'VERIFIED_PASS');
  assert.equal(evidence.execution.commands[0].exitCode, 0);
});

test('failed trusted child emits digest-only structured diagnostics and keeps fail evidence', () => {
  const candidate = makeCandidate();
  const command = {
    commandId: 'trusted-failure',
    executable: 'node',
    argv: ['-e', "process.stdout.write('PRIVATE_STDOUT'); process.stderr.write('PRIVATE_STDERR'); process.exit(7);"],
    expectedExitCode: 0,
    generatedRoots: [],
    artifacts: []
  };
  const { result, output } = runTrusted(candidate, candidate.head, command);
  assert.equal(result.status, 1);
  const evidence = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(evidence.verificationStatus, 'VERIFIED_FAIL');
  const commandEvidence = evidence.execution.commands[0];
  assert.equal(commandEvidence.commandId, 'trusted-failure');
  assert.equal(commandEvidence.exitCode, 7);

  const prefix = 'EVIDENCE_COMMAND_FAILED ';
  const diagnosticLine = result.stderr.split(/\r?\n/u).find((line) => line.startsWith(prefix));
  assert.ok(diagnosticLine, `missing structured diagnostic in stderr: ${result.stderr}`);
  const diagnostic = JSON.parse(diagnosticLine.slice(prefix.length));
  assert.deepEqual(diagnostic, {
    commandId: 'trusted-failure',
    expectedExitCode: 0,
    exitCode: 7,
    signal: null,
    errorCode: null,
    stdoutSha256: commandEvidence.stdoutSha256,
    stderrSha256: commandEvidence.stderrSha256
  });
  assert.doesNotMatch(result.stderr, /PRIVATE_STDOUT|PRIVATE_STDERR/u);
});

test('attestation workflow keeps candidate execution unprivileged and signing isolated', () => {
  const workflowPath = path.resolve(__dirname, '../../.github/workflows/pvep-attested-evidence.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /^on:\n  pull_request_target:/mu);
  assert.match(workflow, /--trusted-command-set-root "\$GITHUB_WORKSPACE\/trusted"/u);

  const linux = workflow.slice(workflow.indexOf('  verify-linux:'), workflow.indexOf('  verify-windows:'));
  const windows = workflow.slice(workflow.indexOf('  verify-windows:'), workflow.indexOf('  attest-same-head:'));
  const attest = workflow.slice(workflow.indexOf('  attest-same-head:'));
  for (const verifier of [linux, windows]) {
    assert.match(verifier, /permissions:\n      contents: read/u);
    assert.doesNotMatch(verifier, /id-token:\s*write|attestations:\s*write/u);
    assert.match(verifier, /Checkout candidate as untrusted workload/u);
  }
  assert.match(attest, /id-token: write/u);
  assert.match(attest, /attestations: write/u);
  assert.doesNotMatch(attest, /Checkout candidate as untrusted workload|pull_request\.head\.repo\.full_name/u);
  assert.match(attest, /--signer-digest "\$BASE_SHA"/u);
  assert.match(attest, /--source-digest "\$BASE_SHA"/u);
  assert.match(attest, /--deny-self-hosted-runners/u);
});
