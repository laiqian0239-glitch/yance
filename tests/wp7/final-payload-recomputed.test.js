'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const wp1 = require('../../tools/wp1/lib');
const { readJson, sha256File } = require('../../tools/wp7/lib');
const { compareElectronDistributionTree } = require('../../tools/wp7/packaged-product-trust');
const { temp } = require('./helpers');
const { isFinalExecution, finalContext } = require('./final-phase-helpers');

test('final-payload-recomputed.test', () => {
  if (isFinalExecution()) {
    const context = finalContext();
    const release = readJson(context.finalReleaseEvidencePath);
    assert.equal(sha256File(context.payloadFilesPath), release.payloadFilesSha256);
    const records = wp1.generatePayloadRecords(context.payloadRoot);
    assert.equal(wp1.applicationPayloadSha256(records), release.applicationPayloadSha256);
    return;
  }
  const dir = temp('wp7-payload-');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  const a = wp1.applicationPayloadSha256(wp1.generatePayloadRecords(dir));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'b');
  const b = wp1.applicationPayloadSha256(wp1.generatePayloadRecords(dir));
  assert.notEqual(a, b);
});

test('final-payload Electron trust accepts sealed Matrix runtime as an explicit Product projection only', () => {
  const dir = temp('wp7-electron-matrix-projection-');
  const matrixManifest = path.join(dir, 'resources', 'matrix-runtime', 'PRODUCT_EXPERIENCE_MATERIALIZED_UAT_MANIFEST.json');
  fs.mkdirSync(path.dirname(matrixManifest), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Yance.exe'), 'electron');
  fs.writeFileSync(path.join(dir, 'resources.pak'), 'resource');
  fs.writeFileSync(matrixManifest, '{}');
  const hash = value => crypto.createHash('sha256').update(value).digest('hex');
  const official = [
    { path: 'electron.exe', sizeBytes: 8, sha256: hash('electron'), unixMode: 0 },
    { path: 'resources.pak', sizeBytes: 8, sha256: hash('resource'), unixMode: 0 }
  ];
  const accepted = compareElectronDistributionTree({
    payloadRoot: dir,
    archiveExecutableEntry: 'electron.exe',
    productExecutableName: 'Yance.exe',
    officialRecords: official,
    platform: 'win32'
  });
  assert.ok(accepted.allowedProductAdditions.includes('resources/matrix-runtime/**'));

  const rogue = path.join(dir, 'resources', 'unexpected', 'rogue.bin');
  fs.mkdirSync(path.dirname(rogue), { recursive: true });
  fs.writeFileSync(rogue, 'rogue');
  assert.throws(
    () => compareElectronDistributionTree({
      payloadRoot: dir,
      archiveExecutableEntry: 'electron.exe',
      productExecutableName: 'Yance.exe',
      officialRecords: official,
      platform: 'win32'
    }),
    error => error?.reasonCode === 'WP7_ELECTRON_DISTRIBUTION_TREE_TRUST_NOT_ENFORCED'
      && error?.details?.extra?.includes('resources/unexpected/rogue.bin')
  );
});
