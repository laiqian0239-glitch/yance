'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  verifyRepository,
  validateRegistry,
  renderNotice,
  isSafeRepositoryPath
} = require('../../tools/third-party/provenance');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'tools', 'third-party', 'verify-provenance.js');

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
      reviewedAt: '2026-08-04',
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
  const root = makeTempRoot(t, 'yance-provenance-');
  fs.mkdirSync(path.join(root, 'third_party', 'licenses'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'third_party', 'provenance.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  for (const project of registry.projects || []) {
    if (project?.license?.evidenceFile && isSafeRepositoryPath(project.license.evidenceFile)) {
      const licensePath = path.join(root, project.license.evidenceFile);
      fs.mkdirSync(path.dirname(licensePath), { recursive: true });
      fs.writeFileSync(licensePath, 'MIT License\n', 'utf8');
    }
    for (const relativePath of project?.yancePaths || []) {
      if (isSafeRepositoryPath(relativePath)) {
        const targetPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, "'use strict';\n", 'utf8');
      }
    }
  }
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), renderNotice(registry), 'utf8');
  return root;
}

function runCli(cwd, args = []) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('canonical repository provenance is valid and notice is deterministic', () => {
  const report = verifyRepository(repoRoot);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.errors, []);
  assert.equal(report.notice, renderNotice(report.registry));
  assert.deepEqual(report.projects, ['baileys-7.0.0-rc13']);
});

test('registry rejects short SHA, missing license evidence path, unapproved review, and traversal paths', () => {
  const invalidProject = makeProject('invalid');
  invalidProject.upstreamCommit = '8053b08';
  invalidProject.license.evidenceFile = '../LICENSE';
  invalidProject.yancePaths = ['../backend/index.js'];
  invalidProject.review.status = 'PENDING';
  const errors = validateRegistry(makeRegistry({ projects: [invalidProject] }));
  assert.ok(errors.some(error => error.code === 'UPSTREAM_COMMIT_INVALID'));
  assert.ok(errors.some(error => error.code === 'LICENSE_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'YANCE_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'REVIEW_NOT_APPROVED'));
});

test('notice ordering is stable regardless of project input order', () => {
  const zeta = makeProject('zeta');
  const alpha = makeProject('alpha');
  const first = renderNotice(makeRegistry({ projects: [zeta, alpha] }));
  const second = renderNotice(makeRegistry({ projects: [alpha, zeta] }));
  assert.equal(first, second);
  assert.ok(first.indexOf('ALPHA') < first.indexOf('ZETA'));
});

test('empty registry notice remains a deterministic newline-terminated file', t => {
  const registry = makeRegistry();
  const root = writeTempRepository(t, registry);
  const report = verifyRepository(root);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.equal(report.notice, renderNotice(registry));
  assert.equal(report.notice.endsWith('\n'), true);
  assert.equal(report.notice.endsWith('\n\n'), false);
});

test('safe repository path rejects absolute, traversal, drive-letter, control-character, empty-segment and dot paths', () => {
  assert.equal(isSafeRepositoryPath('backend/example.js'), true);
  assert.equal(isSafeRepositoryPath('../backend/example.js'), false);
  assert.equal(isSafeRepositoryPath('/backend/example.js'), false);
  assert.equal(isSafeRepositoryPath('C:/Windows/system32/example.js'), false);
  assert.equal(isSafeRepositoryPath('C:\\Windows\\system32\\example.js'), false);
  assert.equal(isSafeRepositoryPath('backend/example\nfile.js'), false);
  assert.equal(isSafeRepositoryPath('backend//example.js'), false);
  assert.equal(isSafeRepositoryPath('.'), false);
});

test('repository verifier reports missing registry without throwing', t => {
  const root = makeTempRoot(t, 'yance-provenance-missing-');
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'REGISTRY_MISSING');
});

test('repository verifier reports invalid JSON without throwing', t => {
  const root = makeTempRoot(t, 'yance-provenance-json-');
  fs.mkdirSync(path.join(root, 'third_party'), { recursive: true });
  fs.writeFileSync(path.join(root, 'third_party', 'provenance.json'), '{', 'utf8');
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'REGISTRY_JSON_INVALID');
});

test('repository verifier detects notice drift', t => {
  const root = writeTempRepository(t);
  fs.appendFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'manual change\n', 'utf8');
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => error.code === 'NOTICE_DRIFT'));
});

test('repository verifier detects missing license evidence and Yance path', t => {
  const registry = makeRegistry({ projects: [makeProject()] });
  const root = writeTempRepository(t, registry);
  fs.rmSync(path.join(root, registry.projects[0].license.evidenceFile));
  fs.rmSync(path.join(root, registry.projects[0].yancePaths[0]));
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => error.code === 'LICENSE_EVIDENCE_MISSING'));
  assert.ok(report.errors.some(error => error.code === 'YANCE_PATH_MISSING'));
});

test('registry rejects duplicate project IDs and unsupported integration mode', () => {
  const first = makeProject('duplicate');
  const second = makeProject('duplicate');
  second.integrationMode = 'unknown_mode';
  const errors = validateRegistry(makeRegistry({ projects: [first, second] }));
  assert.ok(errors.some(error => error.code === 'PROJECT_ID_DUPLICATE'));
  assert.ok(errors.some(error => error.code === 'INTEGRATION_MODE_UNSUPPORTED'));
});

test('strict CLI exits zero for canonical repository and supports JSON output', () => {
  const text = runCli(repoRoot);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /OSS provenance verified: 1 project\(s\)\./u);

  const json = runCli(repoRoot, ['--json']);
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.errors, []);
});

test('strict CLI exits non-zero in text and JSON modes for a structurally invalid registry', t => {
  const project = makeProject('pending');
  project.review.status = 'PENDING';
  const root = writeTempRepository(t, makeRegistry({ projects: [project] }));

  const text = runCli(root);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /\[REVIEW_NOT_APPROVED\]/u);

  const json = runCli(root, ['--json']);
  assert.equal(json.status, 1);
  assert.equal(json.stderr, '');
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some(error => error.code === 'REVIEW_NOT_APPROVED'));
});
