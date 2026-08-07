'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const modulePath = path.join(repoRoot, 'tools', 'third-party', 'sbom.js');
const cliPath = path.join(repoRoot, 'tools', 'third-party', 'verify-sbom.js');
const CANONICAL_SBOM_PATH = 'third_party/sbom.cdx.json';

function loadSbom() {
  assert.equal(
    fs.existsSync(modulePath),
    true,
    'OSS-A deterministic SBOM implementation must exist before the contract can pass'
  );
  return require(modulePath);
}

function sri(algorithm, value) {
  return `${algorithm}-${crypto.createHash(algorithm).update(value).digest('base64')}`;
}

function makePackageJson() {
  return {
    name: 'fixture-app',
    version: '1.0.0',
    dependencies: {
      alpha: '1.0.0'
    }
  };
}

function makeLock(packagesOverride) {
  const packages = packagesOverride || {
    '': {
      name: 'fixture-app',
      version: '1.0.0',
      dependencies: {
        alpha: '1.0.0'
      }
    },
    'node_modules/alpha': {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/alpha/-/alpha-1.0.0.tgz',
      integrity: sri('sha512', 'alpha'),
      dependencies: {
        beta: '2.0.0'
      }
    },
    'node_modules/alpha/node_modules/beta': {
      version: '2.0.0',
      resolved: 'https://registry.npmjs.org/beta/-/beta-2.0.0.tgz',
      integrity: sri('sha512', 'beta'),
      optional: true
    }
  };
  return {
    name: 'fixture-app',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages
  };
}

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-sbom-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFixtureRepository(t) {
  const { buildSbom, serializeSbom } = loadSbom();
  const root = makeTempRoot(t);
  const packageJson = makePackageJson();
  const packageLock = makeLock();
  fs.mkdirSync(path.join(root, 'third_party'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`);
  fs.writeFileSync(
    path.join(root, 'third_party', 'sbom.cdx.json'),
    serializeSbom(buildSbom({ packageJson, packageLock })),
    'utf8'
  );
  return root;
}

function runCli(cwd, args = []) {
  assert.equal(fs.existsSync(cliPath), true, 'OSS-A SBOM CLI must exist');
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
}

test('canonical repository SBOM is deterministic CycloneDX 1.7 derived from the committed lockfile', () => {
  const { verifyRepository } = loadSbom();
  const report = verifyRepository(repoRoot);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.errors, []);
  assert.equal(report.sbom.bomFormat, 'CycloneDX');
  assert.equal(report.sbom.specVersion, '1.7');
  assert.equal(Object.hasOwn(report.sbom, 'serialNumber'), false);
  assert.equal(Object.hasOwn(report.sbom.metadata || {}, 'timestamp'), false);
  assert.equal(report.bytes.endsWith('\n'), true);
  assert.equal(report.bytes.endsWith('\n\n'), false);
  assert.equal(
    report.bytes,
    fs.readFileSync(path.join(repoRoot, 'third_party', 'sbom.cdx.json'), 'utf8')
  );
});

test('SBOM bytes are invariant to package object insertion order', () => {
  const { buildSbom, serializeSbom } = loadSbom();
  const packageJson = makePackageJson();
  const original = makeLock();
  const reordered = makeLock(Object.fromEntries(Object.entries(original.packages).reverse()));
  assert.equal(
    serializeSbom(buildSbom({ packageJson, packageLock: original })),
    serializeSbom(buildSbom({ packageJson, packageLock: reordered }))
  );
});

test('SBOM contains unique deterministic refs and sorted dependency edges', () => {
  const { buildSbom } = loadSbom();
  const sbom = buildSbom({ packageJson: makePackageJson(), packageLock: makeLock() });
  const refs = sbom.components.map(component => component['bom-ref']);
  assert.equal(new Set(refs).size, refs.length);
  assert.deepEqual(refs, [...refs].sort());
  const dependencyRefs = sbom.dependencies.map(item => item.ref);
  assert.deepEqual(dependencyRefs, [...dependencyRefs].sort());
  for (const dependency of sbom.dependencies) {
    assert.deepEqual(dependency.dependsOn, [...dependency.dependsOn].sort());
  }
});

test('SBOM validation rejects malformed SRI, unsafe lock paths and unresolved dependency edges', () => {
  const { buildSbom, validateSbom } = loadSbom();
  const malformed = makeLock();
  malformed.packages['node_modules/alpha'].integrity = 'sha512-not base64';
  malformed.packages['node_modules/../escape'] = {
    version: '1.0.0',
    resolved: 'https://registry.npmjs.org/escape/-/escape-1.0.0.tgz',
    integrity: sri('sha512', 'escape')
  };
  malformed.packages['node_modules/alpha'].dependencies.missing = '9.9.9';
  const sbom = buildSbom({ packageJson: makePackageJson(), packageLock: malformed });
  const errors = validateSbom(sbom, {
    packageJson: makePackageJson(),
    packageLock: malformed
  });
  assert.ok(errors.some(error => error.code === 'SRI_INVALID'));
  assert.ok(errors.some(error => error.code === 'LOCK_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'DEPENDENCY_UNRESOLVED'));
});

test('SBOM verifier rejects drift, duplicate refs and non-canonical JSON bytes with the canonical report path', t => {
  const { verifyRepository } = loadSbom();
  const root = writeFixtureRepository(t);
  const sbomPath = path.join(root, 'third_party', 'sbom.cdx.json');
  const parsed = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
  parsed.components.push({ ...parsed.components[0] });
  fs.writeFileSync(sbomPath, JSON.stringify(parsed), 'utf8');
  const report = verifyRepository(root);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(error => error.code === 'BOM_REF_DUPLICATE'));
  assert.ok(report.errors.some(error => error.code === 'SBOM_DRIFT'));
  assert.ok(report.errors.some(error => error.code === 'SBOM_NON_CANONICAL'));
  for (const error of report.errors.filter(error => ['SBOM_DRIFT', 'SBOM_NON_CANONICAL'].includes(error.code))) {
    assert.equal(error.path, CANONICAL_SBOM_PATH);
  }
});

test('strict SBOM CLI succeeds for canonical bytes and fails after manual drift', t => {
  const canonical = runCli(repoRoot, ['--json']);
  assert.equal(canonical.status, 0, canonical.stderr);
  assert.equal(JSON.parse(canonical.stdout).ok, true);

  const root = writeFixtureRepository(t);
  fs.appendFileSync(path.join(root, 'third_party', 'sbom.cdx.json'), ' ');
  const drift = runCli(root, ['--json']);
  assert.equal(drift.status, 1);
  assert.equal(drift.stderr, '');
  assert.equal(JSON.parse(drift.stdout).ok, false);
});
