'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sha256Hex } = require('../../shared/verification/jcs');
const { validateUnsignedCandidate } = require('../../shared/verification/canonicalEvidenceReceipt');
const { runRegisteredCommandSet } = require('../../shared/verification/commandSetRunner');

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, shell: false, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvep-runner-'));
  fs.mkdirSync(path.join(root, 'tests/verification/fixtures/commands'), { recursive: true });
  const source = path.resolve(__dirname, 'fixtures/commands');
  for (const name of fs.readdirSync(source)) fs.copyFileSync(path.join(source, name), path.join(root, 'tests/verification/fixtures/commands', name));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'clean\n');
  git(root, ['init']); git(root, ['config', 'user.email', 'pvep@example.invalid']); git(root, ['config', 'user.name', 'PVEP Test']); git(root, ['add', '.']); git(root, ['commit', '-m', 'fixture']);
  return { root, head: git(root, ['rev-parse', 'HEAD']) };
}
function producer() { return { executorId: 'linux-executor-01', platform: 'linux', architecture: process.arch, nodeVersion: process.versions.node, npmVersion: '10.9.2', keyGeneration: 1 }; }
function commandSet(script, { expectedExitCode = 0, artifacts = [] } = {}) {
  return { schemaVersion: 1, commandSetId: 'pvep-linux-runner-fixture-v1', platform: 'linux', commands: [{ commandId: 'fixture-command', executable: 'node', argv: [`tests/verification/fixtures/commands/${script}`], expectedExitCode, generatedRoots: ['.pvep-output'], artifacts }] };
}
function run(repo, set) {
  return runRegisteredCommandSet({ repoRoot: repo.root, repository: 'laiqian0239-glitch/yance', workPackage: 'PVEP', gateId: 'runner-fixture', baseCommit: repo.head, headCommit: repo.head, commandSet: set, producer: producer(), outputPath: '.pvep-output/unsigned.json' });
}

test('safe runner records direct argv output digests and emits only an unsigned candidate', () => {
  const repo = setupRepo(); const candidate = run(repo, commandSet('pass.js'));
  assert.equal(validateUnsignedCandidate(candidate).pass, true); assert.equal(candidate.authenticity, null); assert.equal(candidate.receiptSha256, null);
  assert.equal(candidate.execution.commands[0].exitCode, 0);
  assert.equal(candidate.execution.commands[0].stdoutSha256, sha256Hex(Buffer.from('pass-output\n')));
  assert.equal(candidate.execution.commands[0].stderrSha256, sha256Hex(Buffer.from('pass-stderr\n')));
});

test('exact head, clean tracked state and unexpected untracked paths are enforced', () => {
  const wrongHead = setupRepo();
  assert.throws(() => runRegisteredCommandSet({ repoRoot: wrongHead.root, repository: 'laiqian0239-glitch/yance', workPackage: 'PVEP', gateId: 'runner-fixture', baseCommit: wrongHead.head, headCommit: 'f'.repeat(40), commandSet: commandSet('pass.js'), producer: producer(), outputPath: '.pvep-output/unsigned.json' }), (error) => error.code === 'EVIDENCE_WORKSPACE_HEAD_MISMATCH');
  const dirty = setupRepo(); fs.appendFileSync(path.join(dirty.root, 'tracked.txt'), 'dirty\n');
  assert.throws(() => run(dirty, commandSet('pass.js')), (error) => error.code === 'EVIDENCE_WORKSPACE_DIRTY');
  const untracked = setupRepo(); fs.writeFileSync(path.join(untracked.root, 'unexpected.txt'), 'unexpected');
  assert.throws(() => run(untracked, commandSet('pass.js')), (error) => error.code === 'EVIDENCE_UNEXPECTED_UNTRACKED_PATHS');
  const allowed = setupRepo(); fs.mkdirSync(path.join(allowed.root, '.pvep-output'), { recursive: true }); fs.writeFileSync(path.join(allowed.root, '.pvep-output/preexisting.txt'), 'allowed');
  assert.equal(validateUnsignedCandidate(run(allowed, commandSet('pass.js'))).pass, true);
});

test('non-zero exits remain signed facts, artifacts are digested, and post-run source mutation is rejected', () => {
  const failed = setupRepo(); const failureCandidate = run(failed, commandSet('fail.js'));
  assert.equal(failureCandidate.execution.commands[0].exitCode, 7); assert.equal(failureCandidate.results[0].passed, false);
  const artifact = setupRepo(); const artifactCandidate = run(artifact, commandSet('write-artifact.js', { artifacts: ['.pvep-output/report.json'] }));
  const bytes = fs.readFileSync(path.join(artifact.root, '.pvep-output/report.json'));
  assert.equal(artifactCandidate.artifacts[0].sha256, sha256Hex(bytes)); assert.equal(artifactCandidate.artifacts[0].sizeBytes, bytes.length);
  const mutation = setupRepo(); assert.throws(() => run(mutation, commandSet('mutate-tracked.js')), (error) => error.code === 'EVIDENCE_WORKSPACE_DIRTY');
});

test('production CLI rejects arbitrary commands, registry paths and unknown flags', () => {
  const cli = path.resolve(__dirname, '../../tools/verification/run-command-set.js');
  for (const args of [['--command', 'node test.js'], ['--registry', 'other.json'], ['--shell'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { shell: false, encoding: 'utf8' });
    assert.notEqual(result.status, 0); assert.match(`${result.stdout}${result.stderr}`, /EVIDENCE_CLI_ARGUMENT_INVALID/u);
  }
});


test('production CLI can emit an explicitly unenrolled unsigned portability candidate when registry is empty', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pvep-cli-unenrolled-'));
  fs.mkdirSync(path.join(root, 'governance/verification/command-sets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'governance/verification/trusted-executors.json'), '{"schemaVersion":1,"executors":[]}\n');
  fs.writeFileSync(path.join(root, 'governance/verification/command-sets/pvep-linux-fixture-v1.json'), JSON.stringify({
    schemaVersion: 1,
    commandSetId: 'pvep-linux-fixture-v1',
    platform: 'linux',
    commands: [{ commandId: 'fixture-command', executable: 'node', argv: ['pass.js'], expectedExitCode: 0, generatedRoots: ['.pvep-output'], artifacts: [] }]
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'pass.js'), "process.stdout.write('ok\\n');\n");
  git(root, ['init']); git(root, ['config', 'user.email', 'pvep@example.invalid']); git(root, ['config', 'user.name', 'PVEP Test']); git(root, ['add', '.']); git(root, ['commit', '-m', 'fixture']);
  const head = git(root, ['rev-parse', 'HEAD']);
  const { main } = require('../../tools/verification/run-command-set');
  const candidate = main(['--command-set-id', 'pvep-linux-fixture-v1', '--base', head, '--head', head, '--output', '.pvep-output/unsigned.json'], root);
  assert.equal(candidate.authenticity, null);
  assert.equal(candidate.receiptSha256, null);
  assert.match(candidate.producer.executorId, /^pvep-unenrolled-linux-/u);
  assert.equal(validateUnsignedCandidate(candidate).pass, true);
});
