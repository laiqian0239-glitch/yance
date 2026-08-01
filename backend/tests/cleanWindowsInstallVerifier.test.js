'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { verifyCleanWindowsInstall } = require('../../tools/uat/verify-clean-windows-install');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-clean-windows-install-'));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  return root;
}

test('non-Windows verification emits a structural receipt and cannot claim launch or promotion', () => {
  const root = tempRoot();
  const receipt = verifyCleanWindowsInstall(root, { platform: 'linux', arch: 'x64' });
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.documentType, 'YANCE_CLEAN_INSTALL_RECEIPT');
  assert.equal(receipt.status, 'STRUCTURAL_ONLY_NON_WINDOWS');
  assert.equal(receipt.windowsUat, false);
  assert.equal(receipt.readyForPromotion, false);
  assert.equal(receipt.formalRelease, false);
  assert.equal(receipt.electronLaunch.status, 'NOT_EXECUTED');
});

test('Windows install-only verification remains pending until a bound launch receipt proves readiness', () => {
  const root = tempRoot();
  const receipt = verifyCleanWindowsInstall(root, {
    platform: 'win32',
    arch: 'x64',
    installDependencies() {
      return {
        cleanInstallReceipt: {
          schemaVersion: 1,
          documentType: 'YANCE_CLEAN_INSTALL_RECEIPT',
          status: 'SOURCE_INSTALL_VERIFIED',
          lockfile: { sha256: 'a'.repeat(64) },
          dependencySeed: { seedCount: 1 },
          npmCi: { finalStatus: 0 },
          dependencyIntegrity: { ok: true }
        }
      };
    }
  });
  assert.equal(receipt.status, 'WINDOWS_INSTALL_VERIFIED_PENDING_LAUNCH');
  assert.equal(receipt.windowsUat, false);
  assert.equal(receipt.electronLaunch.status, 'NOT_EXECUTED');
  assert.equal(receipt.readyForPromotion, false);
});

test('Windows readiness is accepted only from an identity-bound successful launch receipt', () => {
  const root = tempRoot();
  const launchPath = path.join(root, 'launch.json');
  fs.writeFileSync(launchPath, JSON.stringify({
    schemaVersion: 1,
    documentType: 'YANCE_SOURCE_UAT_LAUNCH',
    platform: 'win32',
    status: 'RUNTIME_READY',
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    electronExecutableSha256: 'b'.repeat(64)
  }));
  const receipt = verifyCleanWindowsInstall(root, {
    platform: 'win32',
    arch: 'x64',
    launchReceiptPath: launchPath,
    expectedCommit: '1'.repeat(40),
    expectedTree: '2'.repeat(40),
    installDependencies() {
      return { cleanInstallReceipt: { schemaVersion: 1, documentType: 'YANCE_CLEAN_INSTALL_RECEIPT', status: 'SOURCE_INSTALL_VERIFIED', dependencyIntegrity: { ok: true } } };
    }
  });
  assert.equal(receipt.status, 'WINDOWS_CLEAN_INSTALL_AND_LAUNCH_VERIFIED');
  assert.equal(receipt.windowsUat, true);
  assert.equal(receipt.electronLaunch.status, 'RUNTIME_READY');
  assert.equal(receipt.readyForPromotion, false);
  assert.equal(receipt.formalRelease, false);
});
