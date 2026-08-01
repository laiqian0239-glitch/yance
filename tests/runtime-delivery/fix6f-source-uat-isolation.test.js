'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const delivery = require('../../tools/runtime-delivery/source-uat-delivery');

test('isolated source UAT default data root is scoped by source identity', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local', APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' };
  const first = delivery.resolveDataRoot({ sourceIdentity: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }, env);
  const second = delivery.resolveDataRoot({ sourceIdentity: { commit: 'c'.repeat(40), tree: 'd'.repeat(40) } }, env);
  assert.notEqual(first, second);
  assert.match(first, /Yance-Source-UAT-a{8}-b{8}$/u);
  assert.match(second, /Yance-Source-UAT-c{8}-d{8}$/u);
});

test('explicit existing and custom data roots are not changed by identity scoping', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local', APPDATA: 'C:\\Users\\tester\\AppData\\Roaming' };
  assert.equal(delivery.resolveDataRoot({ useExistingData: true, sourceIdentity: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }, env), path.join(env.APPDATA, 'Yance'));
  assert.equal(delivery.resolveDataRoot({ dataRoot: 'D:\\Yance-Test', sourceIdentity: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }, env), path.resolve('D:\\Yance-Test'));
});

test('derived source identity validates a git-free payload and rejects tampering', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-derived-id-'));
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n');
  fs.writeFileSync(path.join(root, 'backend', 'a.js'), 'module.exports = 1;\n');
  const identity = delivery.createDerivedSourceIdentity(root, {
    derivedVersion: 'FIX6F_FRONTIER_MODEL_AUTHORITY_V1',
    baseCommit: '1'.repeat(40),
    baseTree: '2'.repeat(40)
  });
  assert.equal(identity.payloadFileCount, 3);
  assert.ok(identity.payloadTotalBytes > 0, 'derived identity must preserve the byte count of the sealed payload');
  const descriptor = JSON.parse(fs.readFileSync(path.join(root, delivery.ARTIFACT_DESCRIPTOR_FILE), 'utf8'));
  assert.equal(descriptor.artifactClass, 'BATCH40_FIX6F_FRONTIER_MODEL_AUTHORITY_V1_WINDOWS_SOURCE_UAT');
  assert.equal(descriptor.sourceIdentity.authority, delivery.DERIVED_IDENTITY_FILE);
  assert.equal(descriptor.sourceIdentity.baseCommit, '1'.repeat(40));
  const resolved = delivery.resolveSourceIdentity(root);
  assert.equal(resolved.source, delivery.DERIVED_IDENTITY_FILE);
  assert.equal(resolved.commit, identity.payloadManifestSha256.slice(0, 40));
  assert.equal(resolved.tree, identity.payloadManifestSha256.slice(24, 64));
  fs.writeFileSync(path.join(root, 'backend', 'a.js'), 'module.exports = 2;\n');
  assert.throws(() => delivery.resolveSourceIdentity(root), error => error.reasonCode === 'SOURCE_UAT_DERIVED_IDENTITY_MISMATCH');
});

test('FIX6G derived descriptor declares the AI brain lifecycle and execution evidence authorities', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-fix6g-derived-id-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n');
  delivery.createDerivedSourceIdentity(root, {
    derivedVersion: 'FIX6G_AI_BRAIN_ROLE_LIFECYCLE_AUTHORITY_V2',
    baseCommit: '1'.repeat(40),
    baseTree: '2'.repeat(40)
  });
  const descriptor = JSON.parse(fs.readFileSync(path.join(root, delivery.ARTIFACT_DESCRIPTOR_FILE), 'utf8'));
  assert.equal(descriptor.repairAuthority.aiBrainRoleLifecycleAuthorityV2, true);
  assert.equal(descriptor.repairAuthority.requestedResolvedRouteAuthority, true);
  assert.equal(descriptor.repairAuthority.singleTaskAtomicRouteTesting, true);
  assert.equal(descriptor.repairAuthority.providerFailureDomainAuthority, true);
  assert.equal(descriptor.repairAuthority.modelExecutionEvidenceAuthority, true);
  assert.equal(descriptor.repairAuthority.modelPoolSegmentationAuthority, true);
  assert.equal(descriptor.repairAuthority.offlineBenchmarkPlatformUatSeparation, true);
  assert.equal(descriptor.repairAuthority.trustedDependencyInstallAuthority, true);
  assert.equal(descriptor.repairAuthority.deterministicNpmFailureClassificationAuthority, true);
  assert.equal(descriptor.repairAuthority.cleanWindowsInstallReceiptAuthority, true);
});
