'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.resolve(__dirname, '../../tools/verification/pvep-trusted-runner.js');

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
    platform: 'linux',
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

function makeTrustedCommandSetRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvep-trusted-command-set-'));
  fs.mkdirSync(path.join(root, 'governance/verification/command-sets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance/verification/command-sets/pvep-linux-selftest-v1.json'), JSON.stringify({
    schemaVersion: 1,
    commandSetId: 'pvep-linux-selftest-v1',
    platform: 'linux',
    commands: [{
      commandId: 'trusted-command',
      executable: 'node',
      argv: ['tests/verification/fixtures/commands/pass.js'],
      expectedExitCode: 0,
      generatedRoots: [],
      artifacts: []
    }]
  }, null, 2) + '\n');
  return root;
}

function runTrusted(candidate, head = candidate.head) {
  const trustedCommandSetRoot = makeTrustedCommandSetRoot();
  const output = path.join(os.tmpdir(), `pvep-evidence-${process.pid}-${Date.now()}.json`);
  const subject = path.join(os.tmpdir(), `pvep-subject-${process.pid}-${Date.now()}.txt`);
  const result = spawnSync(process.execPath, [RUNNER,
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
  ], { encoding: 'utf8' });
  return { result, output, subject };
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
  assert.equal(subjectText, `YANCE_PVEP_SUBJECT_V1\nrepository=laiqian0239-glitch/yance\nhead=${candidate.head}\nplatform=linux\ncommandSetSha256=${evidence.commandSet.sha256}\n`);
});

test('base-owned runner rejects a claimed Head that is not the candidate checkout', () => {
  const candidate = makeCandidate();
  const { result } = runTrusted(candidate, '2'.repeat(40));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EVIDENCE_WORKSPACE_HEAD_MISMATCH/u);
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
