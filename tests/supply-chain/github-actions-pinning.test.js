'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const modulePath = path.join(repoRoot, 'tools', 'supply-chain', 'github-actions-lock.js');
const cliPath = path.join(repoRoot, 'tools', 'supply-chain', 'verify-github-actions-lock.js');

const LOCKED_REFS = [
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
  'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
];

function loadActionsLock() {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'OSS-A GitHub Actions lock implementation must exist before the contract can pass'
  );
  return require(modulePath);
}

function makeLock(entries = LOCKED_REFS.map(ref => {
  const at = ref.lastIndexOf('@');
  const repository = ref.slice(0, at);
  const commit = ref.slice(at + 1);
  return {
    repository,
    commit,
    reviewedTag: repository === 'actions/checkout' ? 'v4.2.2' : 'v4',
    license: 'MIT',
    licenseEvidence: `third_party/licenses/${repository.replace('/', '-')}-MIT.txt`
  };
})) {
  return {
    schemaVersion: 1,
    documentType: 'YANCE_GITHUB_ACTIONS_LOCK',
    actions: entries
  };
}

function inspect(text, lock = makeLock(), workflowPath = '.github/workflows/fixture.yml') {
  const { inspectWorkflowText } = loadActionsLock();
  return inspectWorkflowText(text, { lock, workflowPath });
}

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-actions-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(cwd, args = []) {
  assert.equal(fs.existsSync(cliPath), true, 'OSS-A GitHub Actions lock CLI must exist');
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('canonical repository uses only the three reviewed exact Action commits', () => {
  const { verifyRepository } = loadActionsLock();
  const report = verifyRepository(repoRoot);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.errors, []);
  assert.deepEqual([...new Set(report.externalReferences)].sort(), [...LOCKED_REFS].sort());
  assert.equal(report.checkoutSteps.every(step => step.persistCredentials === false), true);
});

test('floating tags, branches, expressions and unregistered exact commits fail closed', () => {
  const floating = inspect('steps:\n  - uses: actions/checkout@v4\n');
  assert.ok(floating.errors.some(error => error.code === 'ACTION_REF_NOT_EXACT'));

  const expression = inspect('steps:\n  - uses: actions/checkout@${{ github.ref }}\n');
  assert.ok(expression.errors.some(error => error.code === 'ACTION_REF_NOT_EXACT'));

  const unregistered = inspect(
    'steps:\n  - uses: actions/checkout@0123456789abcdef0123456789abcdef01234567\n'
  );
  assert.ok(unregistered.errors.some(error => error.code === 'ACTION_NOT_LOCKED'));
});

test('checkout must explicitly disable persisted credentials', () => {
  const missing = inspect(`steps:\n  - uses: ${LOCKED_REFS[0]}\n`);
  assert.ok(missing.errors.some(error => error.code === 'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE'));

  const enabled = inspect(`steps:\n  - uses: ${LOCKED_REFS[0]}\n    with:\n      persist-credentials: true\n`);
  assert.ok(enabled.errors.some(error => error.code === 'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE'));

  const disabled = inspect(`steps:\n  - uses: ${LOCKED_REFS[0]}\n    with:\n      persist-credentials: false\n`);
  assert.deepEqual(disabled.errors, []);
});

test('local actions and reusable workflows are allowed while docker actions are rejected', () => {
  const local = inspect('steps:\n  - uses: ./.github/actions/local\n');
  assert.deepEqual(local.errors, []);

  const reusable = inspect('jobs:\n  delegated:\n    uses: ./.github/workflows/local.yml\n');
  assert.deepEqual(reusable.errors, []);

  const docker = inspect('steps:\n  - uses: docker://node:22\n');
  assert.ok(docker.errors.some(error => error.code === 'DOCKER_ACTION_FORBIDDEN'));
});

test('ambiguous uses syntax, duplicate lock identities, unsafe evidence paths and unused entries fail closed', () => {
  const ambiguous = inspect('steps:\n  - uses : actions/checkout@v4\n');
  assert.ok(ambiguous.errors.some(error => error.code === 'USES_SYNTAX_INVALID'));

  const { validateLock } = loadActionsLock();
  const duplicate = makeLock();
  duplicate.actions.push({ ...duplicate.actions[0] });
  duplicate.actions[1].licenseEvidence = '../LICENSE';
  const errors = validateLock(duplicate);
  assert.ok(errors.some(error => error.code === 'ACTION_LOCK_DUPLICATE'));
  assert.ok(errors.some(error => error.code === 'LICENSE_PATH_INVALID'));

  const { verifyRepository } = loadActionsLock();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-actions-lock-unused-'));
  try {
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.mkdirSync(path.join(root, 'third_party', 'licenses'), { recursive: true });
    const lock = makeLock();
    fs.writeFileSync(
      path.join(root, 'third_party', 'github-actions-lock.json'),
      `${JSON.stringify(lock, null, 2)}\n`
    );
    for (const entry of lock.actions) {
      fs.writeFileSync(path.join(root, entry.licenseEvidence), 'MIT License\n');
    }
    fs.writeFileSync(
      path.join(root, '.github', 'workflows', 'checkout-only.yml'),
      `steps:\n  - uses: ${LOCKED_REFS[0]}\n    with:\n      persist-credentials: false\n`
    );
    const unused = verifyRepository(root);
    assert.ok(unused.errors.some(error => error.code === 'ACTION_LOCK_ENTRY_UNUSED'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('repository verifier detects a retained checkout credential and reports the exact workflow path', t => {
  const { verifyRepository } = loadActionsLock();
  const root = makeTempRoot(t);
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'third_party', 'licenses'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'third_party', 'github-actions-lock.json'),
    `${JSON.stringify(makeLock([makeLock().actions[0]]), null, 2)}\n`
  );
  fs.writeFileSync(
    path.join(root, 'third_party', 'licenses', 'actions-checkout-MIT.txt'),
    'MIT License\n'
  );
  fs.writeFileSync(
    path.join(root, '.github', 'workflows', 'unsafe.yml'),
    `steps:\n  - uses: ${LOCKED_REFS[0]}\n`,
    'utf8'
  );
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => (
    error.code === 'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE'
    && error.path === '.github/workflows/unsafe.yml'
  )));
});

test('strict GitHub Actions lock CLI succeeds for the repository', () => {
  const result = runCli(repoRoot, ['--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});
