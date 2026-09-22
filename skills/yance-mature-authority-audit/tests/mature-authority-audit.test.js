'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const skillRoot = path.resolve(__dirname, '..');
const admissionScript = path.join(skillRoot, 'admission.js');
const proofScript = path.join(skillRoot, 'proof.js');

function createRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-mature-authority-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'projection.ts'), 'export const projection = "mature-public-seam";\n');
  fs.writeFileSync(path.join(root, 'vendor', 'owner.ts'), 'export const renderRoomAvatar = () => "owner";\n');
  return root;
}

function manifest(overrides = {}) {
  const value = {
    schemaVersion: 1,
    auditId: 'avatar-owner-batch',
    capability: 'room-avatar-projection',
    authority: {
      productOwner: 'Yance',
      matureOwners: ['Element/Matrix'],
      ownership: Object.fromEntries(
        ['lifecycle', 'state', 'retry', 'recovery', 'resolution', 'materialization'].map((dimension) => [
          dimension,
          { owner: 'Element/Matrix', source: `vendor owner ${dimension} source` },
        ]),
      ),
    },
    integration: {
      role: 'stateless-projection',
      addsSecondOwner: false,
      shadowAuthority: false,
      parallelLifecycle: false,
      mirrorState: false,
      customFallback: false,
      productOwnedCapabilityState: [],
      publicSeam: {
        name: 'renderRoomAvatar',
        owner: 'Element/Matrix',
        kind: 'public',
        narrowest: true,
      },
    },
    mutation: {
      changes: [{ path: 'src/projection.ts', action: 'modify' }],
    },
    pathPolicy: {
      allowedPaths: ['src/**'],
      forbiddenPaths: ['src/generated/**'],
    },
    sourceScan: {
      integrationFiles: ['src/projection.ts'],
      ownerFiles: ['vendor/owner.ts'],
      additionalForbiddenPatterns: [],
    },
    localProof: {
      checks: [{
        id: 'focused-owner-contract',
        command: 'node --test focused-owner-contract.test.js',
        status: 'PASS',
        evidence: 'preserved focused test output',
      }],
    },
  };
  return Object.assign(value, overrides);
}

function writeManifest(root, value) {
  const manifestPath = path.join(root, 'audit-manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  return manifestPath;
}

function run(script, root, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  let evidence;
  try {
    evidence = JSON.parse(result.stdout);
  } catch {
    evidence = null;
  }
  return { ...result, evidence };
}

test('admission and proof expose Windows-safe help', () => {
  for (const script of [admissionScript, proofScript]) {
    const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/u);
  }
});

test('GREEN admission preserves mature ownership and path scope', () => {
  const root = createRepository();
  const manifestPath = writeManifest(root, manifest());
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.evidence.status, 'GREEN');
  assert.equal(result.evidence.violations.length, 0);
  assert.deepEqual(
    result.evidence.scan.files.map((file) => `${file.role}:${file.path}`).sort(),
    ['integration:src/projection.ts', 'owner:vendor/owner.ts'],
  );
});

test('matrixPeerUserByRoomId source is a fail-closed shadow-authority RED', () => {
  const root = createRepository();
  fs.writeFileSync(
    path.join(root, 'src', 'projection.ts'),
    'const matrixPeerUserByRoomId = new Map();\nexport { matrixPeerUserByRoomId };\n',
  );
  const manifestPath = writeManifest(root, manifest());
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 2);
  assert.equal(result.evidence.status, 'RED');
  assert.ok(result.evidence.violations.some((item) => item.code === 'SHADOW_AUTHORITY_SOURCE_PATTERN'));
});

test('equivalent Product-owned room/avatar lookup is also RED', () => {
  const root = createRepository();
  fs.writeFileSync(
    path.join(root, 'src', 'projection.ts'),
    'const roomAvatarByRoomId = Object.create(null);\nexport { roomAvatarByRoomId };\n',
  );
  const manifestPath = writeManifest(root, manifest());
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 2);
  assert.ok(result.evidence.violations.some((item) => item.code === 'SHADOW_AUTHORITY_SOURCE_PATTERN'));
});

test('mature owner internal mapping is not misclassified as Product shadow authority', () => {
  const root = createRepository();
  fs.writeFileSync(
    path.join(root, 'vendor', 'owner.ts'),
    'const matrixPeerUserByRoomId = new Map();\nexport const renderRoomAvatar = () => matrixPeerUserByRoomId;\n',
  );
  const manifestPath = writeManifest(root, manifest());
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.evidence.status, 'GREEN');
});

test('declared public seam must exist in mature-owner source bytes', () => {
  const root = createRepository();
  fs.writeFileSync(path.join(root, 'vendor', 'owner.ts'), 'export const unrelatedOwnerApi = true;\n');
  const manifestPath = writeManifest(root, manifest());
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 2);
  assert.equal(result.evidence.status, 'RED');
  assert.ok(result.evidence.violations.some((item) => item.code === 'PUBLIC_SEAM_NOT_FOUND_IN_OWNER_SOURCE'));
});

test('declarations cannot assign capability state or recovery to Yance', () => {
  const root = createRepository();
  const value = manifest();
  value.authority.ownership.recovery.owner = 'Yance';
  value.integration.productOwnedCapabilityState = ['room-member-avatar-map'];
  const manifestPath = writeManifest(root, value);
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 2);
  const codes = result.evidence.violations.map((item) => item.code);
  assert.ok(codes.includes('MATURE_OWNERSHIP_NOT_PRESERVED'));
  assert.ok(codes.includes('PRODUCT_OWNED_CAPABILITY_STATE'));
});

test('forbidden mutation path is RED even when it also matches an allowed glob', () => {
  const root = createRepository();
  fs.mkdirSync(path.join(root, 'src', 'generated'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'generated', 'shadow.ts'), 'export const value = 1;\n');
  const value = manifest();
  value.mutation.changes = [{ path: 'src/generated/shadow.ts', action: 'modify' }];
  value.sourceScan.integrationFiles.push('src/generated/shadow.ts');
  const manifestPath = writeManifest(root, value);
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 2);
  assert.ok(result.evidence.violations.some((item) => item.code === 'MUTATION_IN_FORBIDDEN_PATH'));
});

test('missing authority fields fail closed instead of being inferred', () => {
  const root = createRepository();
  const value = manifest();
  delete value.integration.shadowAuthority;
  delete value.authority.ownership.materialization;
  const manifestPath = writeManifest(root, value);
  const result = run(admissionScript, root, ['--manifest', manifestPath, '--repo-root', root]);

  assert.equal(result.status, 2);
  assert.ok(result.evidence.checks.some((item) => item.status === 'FAIL'));
});

test('proof binds to unchanged GREEN admission and re-scans materialized source', () => {
  const root = createRepository();
  const manifestPath = writeManifest(root, manifest());
  const admissionPath = path.join(root, 'admission.json');
  const admission = run(admissionScript, root, [
    '--manifest', manifestPath,
    '--repo-root', root,
    '--output', admissionPath,
  ]);
  assert.equal(admission.status, 0, admission.stderr);

  const proof = run(proofScript, root, [
    '--manifest', manifestPath,
    '--admission', admissionPath,
    '--repo-root', root,
  ]);
  assert.equal(proof.status, 0, proof.stderr);
  assert.equal(proof.evidence.status, 'GREEN');
  assert.equal(proof.evidence.kind, 'yance-mature-authority-proof');
  assert.ok(proof.evidence.checks.some((item) => item.id === 'executed-local-proof-receipts'));
});

test('proof rejects a stale admission after manifest mutation', () => {
  const root = createRepository();
  const value = manifest();
  const manifestPath = writeManifest(root, value);
  const admissionPath = path.join(root, 'admission.json');
  const admission = run(admissionScript, root, [
    '--manifest', manifestPath,
    '--repo-root', root,
    '--output', admissionPath,
  ]);
  assert.equal(admission.status, 0, admission.stderr);

  value.auditId = 'mutated-after-admission';
  writeManifest(root, value);
  const proof = run(proofScript, root, [
    '--manifest', manifestPath,
    '--admission', admissionPath,
    '--repo-root', root,
  ]);

  assert.equal(proof.status, 2);
  assert.equal(proof.evidence.status, 'RED');
  assert.ok(proof.evidence.violations.some((item) => item.code === 'ADMISSION_NOT_GREEN_OR_STALE'));
});
