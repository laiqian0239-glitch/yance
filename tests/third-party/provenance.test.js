'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const modulePath = path.join(repoRoot, 'tools', 'third-party', 'provenance.js');
const cliPath = path.join(repoRoot, 'tools', 'third-party', 'verify-provenance.js');

function loadProvenance() {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'OSS-A provenance implementation must exist before the contract can pass'
  );
  return require(modulePath);
}

function makeRegistry(overrides = {}) {
  return {
    schemaVersion: 1,
    projectLicenseDecision: {
      status: 'UNRESOLVED',
      approvedSpdx: null
    },
    policy: {
      exactCommitRequired: true,
      approvedRecordRequired: true,
      allowedIntegrationModes: [
        'dependency',
        'patched_dependency',
        'sidecar',
        'controlled_fork',
        'source_port',
        'reference_only'
      ]
    },
    projects: [],
    ...overrides
  };
}

function makeProject(id = 'sample') {
  return {
    id,
    name: id.toUpperCase(),
    upstreamRepository: `https://github.com/example/${id}`,
    upstreamCommit: '0123456789abcdef0123456789abcdef01234567',
    upstreamVersion: '1.0.0',
    integrationMode: 'source_port',
    license: {
      spdx: 'MIT',
      evidenceFile: `third_party/licenses/${id}.txt`
    },
    sourcePaths: ['src/index.js'],
    yancePaths: [`backend/${id}.js`],
    modifications: ['Ported into the Yance adapter boundary.'],
    obligations: ['Retain attribution.'],
    review: {
      status: 'APPROVED',
      reviewedAt: '2026-08-06',
      evidence: ['manual-license-review']
    }
  };
}

function makeTempRoot(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeTempRepository(t, registry = makeRegistry({ projects: [makeProject()] })) {
  const { isSafeRepositoryPath, renderNotice } = loadProvenance();
  const root = makeTempRoot(t, 'yance-provenance-');
  fs.mkdirSync(path.join(root, 'third_party', 'licenses'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'third_party', 'provenance.json'),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8'
  );
  for (const project of registry.projects || []) {
    if (project?.license?.evidenceFile && isSafeRepositoryPath(project.license.evidenceFile)) {
      const licensePath = path.join(root, project.license.evidenceFile);
      fs.mkdirSync(path.dirname(licensePath), { recursive: true });
      fs.writeFileSync(licensePath, 'MIT License\n', 'utf8');
    }
    for (const relativePath of project?.yancePaths || []) {
      if (!isSafeRepositoryPath(relativePath)) continue;
      const targetPath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, "'use strict';\n", 'utf8');
    }
  }
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), renderNotice(registry), 'utf8');
  return root;
}

function runCli(cwd, args = []) {
  assert.equal(fs.existsSync(cliPath), true, 'OSS-A provenance CLI must exist');
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('canonical repository provenance binds Baileys and every external GitHub Action', () => {
  const { verifyRepository, renderNotice } = loadProvenance();
  const report = verifyRepository(repoRoot);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.errors, []);
  assert.equal(report.notice, renderNotice(report.registry));
  assert.deepEqual(report.projects, [
    'actions-checkout',
    'actions-setup-node',
    'actions-upload-artifact',
    'baileys-7.0.0-rc13'
  ]);
  assert.equal(report.registry.projectLicenseDecision.status, 'UNRESOLVED');
  assert.equal(report.registry.projectLicenseDecision.approvedSpdx, null);
});

test('registry rejects short SHA, unsafe evidence paths, unsupported modes and unapproved reviews', () => {
  const { validateRegistry } = loadProvenance();
  const invalidProject = makeProject('invalid');
  invalidProject.upstreamCommit = '8053b08';
  invalidProject.license.evidenceFile = '../LICENSE';
  invalidProject.yancePaths = ['../backend/index.js'];
  invalidProject.integrationMode = 'unknown';
  invalidProject.review.status = 'PENDING';
  const errors = validateRegistry(makeRegistry({ projects: [invalidProject] }));
  assert.ok(errors.some(error => error.code === 'UPSTREAM_COMMIT_INVALID'));
  assert.ok(errors.some(error => error.code === 'LICENSE_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'YANCE_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'INTEGRATION_MODE_UNSUPPORTED'));
  assert.ok(errors.some(error => error.code === 'REVIEW_NOT_APPROVED'));
});

test('notice ordering and bytes are deterministic regardless of project input order', () => {
  const { renderNotice } = loadProvenance();
  const zeta = makeProject('zeta');
  const alpha = makeProject('alpha');
  const first = renderNotice(makeRegistry({ projects: [zeta, alpha] }));
  const second = renderNotice(makeRegistry({ projects: [alpha, zeta] }));
  assert.equal(first, second);
  assert.equal(first.endsWith('\n'), true);
  assert.equal(first.endsWith('\n\n'), false);
  assert.ok(first.indexOf('ALPHA') < first.indexOf('ZETA'));
});

test('repository verifier detects missing registry, invalid JSON and manual notice drift', t => {
  const { verifyRepository } = loadProvenance();
  const missingRoot = makeTempRoot(t, 'yance-provenance-missing-');
  const missing = verifyRepository(missingRoot);
  assert.equal(missing.ok, false);
  assert.equal(missing.errors[0].code, 'REGISTRY_MISSING');

  const invalidRoot = makeTempRoot(t, 'yance-provenance-json-');
  fs.mkdirSync(path.join(invalidRoot, 'third_party'), { recursive: true });
  fs.writeFileSync(path.join(invalidRoot, 'third_party', 'provenance.json'), '{', 'utf8');
  const invalid = verifyRepository(invalidRoot);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0].code, 'REGISTRY_JSON_INVALID');

  const driftRoot = writeTempRepository(t);
  fs.appendFileSync(path.join(driftRoot, 'THIRD_PARTY_NOTICES.md'), 'manual change\n', 'utf8');
  const drift = verifyRepository(driftRoot);
  assert.equal(drift.ok, false);
  assert.ok(drift.errors.some(error => error.code === 'NOTICE_DRIFT'));
});

test('repository verifier detects missing license evidence and Yance integration paths', t => {
  const { verifyRepository } = loadProvenance();
  const registry = makeRegistry({ projects: [makeProject()] });
  const root = writeTempRepository(t, registry);
  fs.rmSync(path.join(root, registry.projects[0].license.evidenceFile));
  fs.rmSync(path.join(root, registry.projects[0].yancePaths[0]));
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => error.code === 'LICENSE_EVIDENCE_MISSING'));
  assert.ok(report.errors.some(error => error.code === 'YANCE_PATH_MISSING'));
});

test('strict provenance CLI succeeds for the repository and fails closed for invalid review state', t => {
  const text = runCli(repoRoot);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /OSS provenance verified: 4 project\(s\)\./u);

  const project = makeProject('pending');
  project.review.status = 'PENDING';
  const root = writeTempRepository(t, makeRegistry({ projects: [project] }));
  const json = runCli(root, ['--json']);
  assert.equal(json.status, 1);
  assert.equal(json.stderr, '');
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(error => error.code === 'REVIEW_NOT_APPROVED'));
});
