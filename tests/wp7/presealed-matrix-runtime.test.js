'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const wp7 = require('../../tools/wp7/lib');
const { sealCandidateBundle, BUNDLE_CLASSES } = require('../../tools/product-experience/create-materialized-uat-candidate');

function temp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

const IDENTITY = Object.freeze({
  candidateBranch: 'rebuild/windows-release-closure-20260911-matrix-runtime',
  candidateCommit: '1111111111111111111111111111111111111111',
  candidateTree: '2222222222222222222222222222222222222222'
});

// Build a structurally complete sealed Matrix bundle (fake image bytes are fine
// for the packaging seam — identity is what the WP7 copy path validates).
function buildSealedMatrixBundle(root) {
  fs.mkdirSync(path.join(root, 'matrix-config', 'synapse'), { recursive: true });
  fs.mkdirSync(path.join(root, 'matrix-config', 'mautrix-meta'), { recursive: true });
  fs.writeFileSync(path.join(root, 'matrix-images.tar'), Buffer.from('fake-docker-image-tar'));
  fs.writeFileSync(path.join(root, 'materialized-matrix-compose.yml'), 'services: {}\n');
  fs.writeFileSync(path.join(root, 'matrix-config', 'element-config.json'), JSON.stringify({ brand: 'Yance' }));
  fs.writeFileSync(path.join(root, 'matrix-config', 'synapse', 'homeserver.yaml'), 'server_name: yance.local\n');
  fs.writeFileSync(path.join(root, 'matrix-config', 'mautrix-meta', 'config.yaml'), 'appservice:\n  port: 29319\n');
  return sealCandidateBundle({ root, bundleClass: BUNDLE_CLASSES.MATRIX, ...IDENTITY });
}

test('presealed Matrix runtime validates a sealed candidate bundle and exposes required assets', () => {
  const source = temp('yance-matrix-src-');
  buildSealedMatrixBundle(source);
  const result = wp7.validatePresealedMatrixRuntime(source);
  assert.equal(result.manifest.bundleClass, BUNDLE_CLASSES.MATRIX);
  assert.equal(result.manifest.candidateCommit, IDENTITY.candidateCommit);
  assert.ok(result.imagesTarSha256, 'matrix-images.tar SHA must be recorded');
  assert.ok(result.fileCount >= 5, 'compose, image tar and configs must all be enumerated');
});

test('presealed Matrix runtime copies the full sealed bundle into resources/matrix-runtime', () => {
  const source = temp('yance-matrix-src-');
  buildSealedMatrixBundle(source);
  const payloadResources = temp('yance-matrix-dst-');
  const copied = wp7.copyPresealedMatrixRuntime(source, payloadResources);
  assert.equal(copied.relativeRoot, 'resources/matrix-runtime');
  const dest = path.join(payloadResources, 'matrix-runtime');
  for (const rel of [
    'matrix-images.tar',
    'materialized-matrix-compose.yml',
    'PRODUCT_EXPERIENCE_MATERIALIZED_UAT_MANIFEST.json',
    path.join('matrix-config', 'element-config.json'),
    path.join('matrix-config', 'synapse', 'homeserver.yaml'),
    path.join('matrix-config', 'mautrix-meta', 'config.yaml')
  ]) {
    assert.ok(fs.existsSync(path.join(dest, rel)), `payload must carry ${rel}`);
  }
});

test('presealed Matrix runtime fails closed when matrix-images.tar is missing', () => {
  const source = temp('yance-matrix-noimg-');
  fs.mkdirSync(path.join(source, 'matrix-config'), { recursive: true });
  fs.writeFileSync(path.join(source, 'materialized-matrix-compose.yml'), 'services: {}\n');
  assert.throws(
    () => wp7.validatePresealedMatrixRuntime(source),
    error => error && error.reasonCode === 'WP7_MATRIX_RUNTIME_IMAGES_REQUIRED'
  );
});

test('presealed Matrix runtime fails closed when sealed compose is missing', () => {
  const source = temp('yance-matrix-nocompose-');
  fs.writeFileSync(path.join(source, 'matrix-images.tar'), Buffer.from('x'));
  assert.throws(
    () => wp7.validatePresealedMatrixRuntime(source),
    error => error && error.reasonCode === 'WP7_MATRIX_RUNTIME_COMPOSE_REQUIRED'
  );
});

test('presealed Matrix runtime rejects a candidate whose sealed identity does not match', () => {
  const source = temp('yance-matrix-id-');
  buildSealedMatrixBundle(source);
  assert.throws(
    () => wp7.validatePresealedMatrixRuntime(source, { candidateCommit: '9999999999999999999999999999999999999999' }),
    error => error && error.reasonCode === 'MATERIALIZED_UAT_IDENTITY_MISMATCH'
  );
});

test('presealed Matrix runtime rejects a tampered file against the sealed manifest', () => {
  const source = temp('yance-matrix-tamper-');
  buildSealedMatrixBundle(source);
  // Same-length rewrite so size matches but SHA-256 diverges.
  const composePath = path.join(source, 'materialized-matrix-compose.yml');
  fs.writeFileSync(composePath, 'services: []\n'); // same byte length as 'services: {}\n'
  assert.throws(
    () => wp7.validatePresealedMatrixRuntime(source),
    error => error && (error.reasonCode === 'MATERIALIZED_UAT_SHA256_MISMATCH' || error.reasonCode === 'MATERIALIZED_UAT_SIZE_MISMATCH')
  );
});
