'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const EXPECTED = Object.freeze({
  packageName: 'xstate',
  version: '5.32.5',
  resolved: 'https://registry.npmjs.org/xstate/-/xstate-5.32.5.tgz',
  integrity: 'sha512-ULazi1oe6wGrXl0Frb6otSlkm5HLifbbVTkMk5kkSKqz4TkxJaVpnl6jOJwKeid3ORPxYyZQgNLUSYX9q65SIA==',
  shasum: '0594075f9fb7d5a12791296c5c798c394b66e823',
  license: 'MIT',
  upstreamCommit: 'c25dba07a2b68565edbe83d83c5d679dd85e00b2',
  licenseTextSha256: '542d926d7bbb099785e322d1d5574c539d51942e52ec8adce2be4629ba81fc7f',
  packageFileCount: 132,
  runtimeDependencyCount: 0
});

function json(relativePath) {
  return require(path.join(REPO_ROOT, relativePath));
}

test('XState physical npm artifact is bound exactly across lock, registry and evidence', () => {
  const packageJson = json('package.json');
  const packageLock = json('package-lock.json');
  const registry = json('governance/architecture-closure-v2/wp-b-open-source-adoption-registry.json');
  const evidence = json('governance/architecture-closure-v2/wp-b-open-source-adoption-evidence-xstate-5.32.5.json');
  const xstate = registry.candidates.find(candidate => candidate.project === 'XState');
  const lockEntry = packageLock.packages['node_modules/xstate'];

  assert.equal(packageJson.dependencies.xstate, EXPECTED.version);
  assert.equal(packageLock.packages[''].dependencies.xstate, EXPECTED.version);
  assert.deepEqual(lockEntry, {
    version: EXPECTED.version,
    resolved: EXPECTED.resolved,
    integrity: EXPECTED.integrity,
    license: EXPECTED.license
  });

  assert.equal(xstate.exactVersion, EXPECTED.version);
  assert.equal(xstate.license, EXPECTED.license);
  assert.equal(xstate.runtimeDependencyCount, EXPECTED.runtimeDependencyCount);
  assert.equal(xstate.verifiedPackageEvidence.distIntegrity, EXPECTED.integrity);
  assert.equal(xstate.verifiedPackageEvidence.distShasum, EXPECTED.shasum);
  assert.equal(xstate.verifiedPackageEvidence.upstreamCommit, EXPECTED.upstreamCommit);
  assert.equal(xstate.verifiedPackageEvidence.licenseTextSha256, EXPECTED.licenseTextSha256);

  assert.equal(evidence.exactVersionAndLicenseReview.exactVersion, EXPECTED.version);
  assert.equal(evidence.exactVersionAndLicenseReview.license, EXPECTED.license);
  assert.equal(evidence.exactVersionAndLicenseReview.upstreamCommit, EXPECTED.upstreamCommit);
  assert.equal(evidence.exactVersionAndLicenseReview.licenseTextSha256, EXPECTED.licenseTextSha256);
  assert.equal(evidence.dependencyAndSecurityScan.runtimeDependencyCount, EXPECTED.runtimeDependencyCount);
  assert.equal(evidence.dependencyAndSecurityScan.packageFileCount, EXPECTED.packageFileCount);
  assert.equal(evidence.dependencyAndSecurityScan.distIntegrity, EXPECTED.integrity);
  assert.equal(evidence.dependencyAndSecurityScan.distShasum, EXPECTED.shasum);
});

const VULNERABILITY_EVIDENCE_RELATIVE =
  'governance/architecture-closure-v2/wp-b-xstate-vulnerability-evidence.json';
const vulnerabilityVerifier = require(path.join(
  REPO_ROOT,
  'tools/architecture-closure-v2/verify-wp-b-xstate-vulnerability-evidence.js'
));

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function replaceExactString(value, needle, replacement) {
  let replacements = 0;

  function visit(current) {
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length; index += 1) {
        if (current[index] === needle) {
          current[index] = replacement;
          replacements += 1;
        } else if (current[index] && typeof current[index] === 'object') {
          visit(current[index]);
        }
      }
      return;
    }

    if (!current || typeof current !== 'object') return;

    for (const key of Object.keys(current)) {
      if (current[key] === needle) {
        current[key] = replacement;
        replacements += 1;
      } else if (current[key] && typeof current[key] === 'object') {
        visit(current[key]);
      }
    }
  }

  visit(value);
  return replacements;
}

function resealReceipt(document) {
  const digestInput = cloneJson(document);
  delete digestInput.receiptDigestSha256;
  document.receiptDigestSha256 =
    vulnerabilityVerifier.computeReceiptDigest(digestInput);
  return document;
}

function verifyReceiptAtCaptureTime(evidencePath, document) {
  const capturedAtMs = Date.parse(document.source.capturedAt);
  assert.ok(Number.isFinite(capturedAtMs), 'receipt capturedAt must parse');
  return vulnerabilityVerifier.verifyEvidence({
    evidencePath,
    nowMs: capturedAtMs + 1
  });
}

function assertResealedIdentityDriftFails(baseReceipt, needle, replacement) {
  const variant = cloneJson(baseReceipt);
  const replacementCount =
    replaceExactString(variant, needle, replacement);

  assert.ok(
    replacementCount > 0,
    'sealed receipt must carry the exact XState identity being tested'
  );

  resealReceipt(variant);

  const tempRoot =
    fs.mkdtempSync(path.join(os.tmpdir(), 'yance-xstate-v11-binding-'));
  const tempEvidence =
    path.join(tempRoot, 'wp-b-xstate-vulnerability-evidence.json');

  try {
    fs.writeFileSync(
      tempEvidence,
      JSON.stringify(variant, null, 2) + '\n',
      'utf8'
    );

    assert.throws(() => {
      verifyReceiptAtCaptureTime(tempEvidence, variant);
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('XState sealed vulnerability receipt is bound to the current repository identity', () => {
  const receiptPath = path.join(REPO_ROOT, VULNERABILITY_EVIDENCE_RELATIVE);
  const receipt = json(VULNERABILITY_EVIDENCE_RELATIVE);

  const report = verifyReceiptAtCaptureTime(receiptPath, receipt);

  assert.equal(
    report.evidenceMode,
    'SEALED_REPOSITORY_VULNERABILITY_EVIDENCE'
  );
  assert.equal(report.capturedAt, receipt.source.capturedAt);
  assert.equal(report.expiresAt, receipt.source.expiresAt);
  assert.equal(
    report.receiptDigestSha256,
    receipt.receiptDigestSha256
  );

  assert.equal(report.vulnerabilities.high, 0);
  assert.equal(report.vulnerabilities.critical, 0);

  assertResealedIdentityDriftFails(
    receipt,
    EXPECTED.version,
    '5.32.4'
  );

  assertResealedIdentityDriftFails(
    receipt,
    EXPECTED.integrity,
    'sha512-YANCE-V11-INTENTIONAL-IDENTITY-MISMATCH'
  );
});
