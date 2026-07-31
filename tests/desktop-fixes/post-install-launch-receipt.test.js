'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writePostInstallLaunchReceipt } = require('../../electron/postInstallLaunchReceipt');
const { removePathWithRetries } = require('../test-support/windows-cleanup');

function fakeWindow(overrides = {}) {
  return {
    id: 29,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
    webContents: { isDestroyed: () => false },
    ...overrides
  };
}

test('successful Finish-page activation writes an atomic visible-window receipt', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-post-install-'));
  t.after(() => removePathWithRetries(root));
  const filePath = path.join(root, 'logs', 'post-install-launch.json');
  const receipt = writePostInstallLaunchReceipt({
    filePath,
    request: { reason: 'post-install', sequence: 4, requestedAt: 123 },
    window: fakeWindow(),
    processId: 88,
    now: () => '2026-07-15T03:00:00.000Z'
  });
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.window.visible, true);
  assert.equal(receipt.window.minimized, false);
  const { markerPath, ...persistedReceipt } = receipt;
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), persistedReceipt);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), '2026-07-15T03:00:00.000Z\t88\n');
  assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['post-install-launch.json', 'post-install-launch.pass']);
});

test('post-install second-instance activation is recorded and hidden/minimized state fails closed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-post-install-'));
  t.after(() => removePathWithRetries(root));
  const receipt = writePostInstallLaunchReceipt({
    filePath: path.join(root, 'receipt.json'),
    request: { reason: 'post-install-second-instance' },
    window: fakeWindow({ isVisible: () => false, isMinimized: () => true })
  });
  assert.equal(receipt.status, 'FAIL');
  assert.equal(receipt.reason, 'post-install-second-instance');
  assert.equal(fs.existsSync(receipt.markerPath), false);
});

test('ordinary tray and initial activations do not write a post-install receipt', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-post-install-'));
  t.after(() => removePathWithRetries(root));
  const filePath = path.join(root, 'receipt.json');
  assert.equal(writePostInstallLaunchReceipt({ filePath, request: { reason: 'tray-click' }, window: fakeWindow() }), null);
  assert.equal(fs.existsSync(filePath), false);
});


test('receipt writer fails closed when its evidence path is missing', () => {
  assert.throws(
    () => writePostInstallLaunchReceipt({ request: { reason: 'post-install' }, window: fakeWindow() }),
    error => error?.reasonCode === 'POST_INSTALL_RECEIPT_PATH_REQUIRED'
  );
});


test('main-process post-install evidence is emitted only inside the unified activation send stage', () => {
  const mainSource = fs.readFileSync(path.resolve(__dirname, '../../electron/main.js'), 'utf8');
  assert.match(mainSource, /sendActivation:\s*\(window, request\)\s*=>\s*\{[\s\S]*isPostInstallReason\(request\.reason\)[\s\S]*writePostInstallLaunchReceipt\([\s\S]*sendToRenderer\('desktop:activation'/);
  assert.match(mainSource, /filePath:\s*path\.join\(PATHS\.logs, 'post-install-launch\.json'\)/);
  assert.equal((mainSource.match(/writePostInstallLaunchReceipt\(/g) || []).length, 1);
});
