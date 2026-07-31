'use strict';
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256File, verifyInstallerHash } = require('../../tools/wp7/lib');
const { temp, expectReason } = require('./helpers');
const { isFinalExecution, finalContext } = require('./final-phase-helpers');

test('wp7-installer-seal-and-external-hash.test', () => {
  if (isFinalExecution()) {
    const context = finalContext();
    assert.equal(verifyInstallerHash(context.installerPath, context.installerSha256).status, 'PASS');
    assert.equal(context.finalReleaseEvidence.installerSha256, context.installerSha256);
    return;
  }
  const file = path.join(temp('wp7-hash-'), 'i.exe');
  fs.writeFileSync(file, 'sealed');
  const hash = sha256File(file);
  assert.equal(verifyInstallerHash(file, hash).status, 'PASS');
  fs.appendFileSync(file, 'x');
  expectReason(assert, () => verifyInstallerHash(file, hash), 'WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH');
});
