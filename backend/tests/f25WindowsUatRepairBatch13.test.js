'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareClone, MARKER_FILE } = require('../../tools/runtime-delivery/prepare-windows-uat-data-clone');
const { evaluateSourceUatCloneReset } = require('../runtime/sourceUatClonePolicy');

const repoRoot = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-b13-')); }

test('Batch13 source UAT data clone preserves credentials and leaves source untouched', () => {
  const root = tempRoot();
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(source, 'store'), { recursive: true });
  fs.mkdirSync(path.join(source, 'secure'), { recursive: true });
  fs.mkdirSync(path.join(source, 'whatsapp-auth', 'account-1'), { recursive: true });
  fs.writeFileSync(path.join(source, 'store', 'yance-r32.db'), 'sqlite-authority');
  fs.writeFileSync(path.join(source, 'store', 'yance-r32.db-wal'), 'sqlite-wal');
  fs.mkdirSync(path.join(source, 'store', 'yance-r32.db.lock'));
  fs.writeFileSync(path.join(source, 'store', 'yance-r32.db.lock', 'owner'), 'ephemeral-runtime-lock');
  fs.writeFileSync(path.join(source, 'secure', 'credentials.safe.json'), '{"cipher":"bound-to-user"}');
  fs.writeFileSync(path.join(source, 'whatsapp-auth', 'account-1', 'creds.json'), '{"registered":true}');
  fs.mkdirSync(path.join(source, 'preferences'), { recursive: true });
  fs.writeFileSync(path.join(source, 'preferences', 'ui.json'), '{"density":"compact"}');
  fs.writeFileSync(path.join(source, MARKER_FILE), '{"stale":true}');
  fs.writeFileSync(path.join(source, 'YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT.json'), '{"stale":true}');
  const before = fs.readFileSync(path.join(source, 'store', 'yance-r32.db'), 'utf8');

  const receipt = prepareClone({ source, target });

  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.sourceUntouched, true);
  assert.equal(receipt.criticalFilesMatch, true);
  assert.equal(receipt.baseTreeMatch, true);
  assert.deepEqual(receipt.sourceTreeDigest, receipt.targetBaseTreeDigest);
  assert.equal(fs.existsSync(path.join(source, 'store', 'yance-r32.db.lock')), true);
  assert.equal(fs.existsSync(path.join(target, 'store', 'yance-r32.db.lock')), false);
  assert.equal(fs.readFileSync(path.join(target, 'preferences', 'ui.json'), 'utf8'), '{"density":"compact"}');
  assert.equal(fs.readFileSync(path.join(source, 'store', 'yance-r32.db'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(target, 'secure', 'credentials.safe.json'), 'utf8'), '{"cipher":"bound-to-user"}');
  assert.equal(fs.existsSync(path.join(target, 'whatsapp-auth', 'account-1', 'creds.json')), true);
  const marker = JSON.parse(fs.readFileSync(path.join(target, MARKER_FILE), 'utf8'));
  assert.equal(marker.sourceUntouched, true);
  assert.equal(marker.stale, undefined);
  assert.equal(marker.realDataMutationAllowed, false);
  assert.equal(marker.resetSafeModeInClone, true);
});

test('Batch13 clone-only safe-mode reset requires explicit flags and exact marker target', () => {
  const root = tempRoot();
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  fs.mkdirSync(path.join(source, 'store'), { recursive: true });
  fs.writeFileSync(path.join(source, 'store', 'yance-r32.db'), 'db');
  const receipt = prepareClone({ source, target });

  const allowed = evaluateSourceUatCloneReset({ dataRoot: target, env: {
    YANCE_SOURCE_UAT: '1',
    YANCE_SOURCE_UAT_RESET_SAFE_MODE: '1',
    YANCE_SOURCE_UAT_DATA_CLONE_MARKER: receipt.markerPath
  }});
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reasonCode, 'SOURCE_UAT_CLONE_SAFE_MODE_RESET_ALLOWED');

  const denied = evaluateSourceUatCloneReset({ dataRoot: source, env: {
    YANCE_SOURCE_UAT: '1',
    YANCE_SOURCE_UAT_RESET_SAFE_MODE: '1',
    YANCE_SOURCE_UAT_DATA_CLONE_MARKER: receipt.markerPath
  }});
  assert.equal(denied.allowed, false);
  assert.equal(denied.reasonCode, 'SOURCE_UAT_CLONE_TARGET_MISMATCH');
});



test('Batch13 data clone rejects nested targets and symbolic links', () => {
  const root = tempRoot();
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'store'), { recursive: true });
  fs.writeFileSync(path.join(source, 'store', 'yance-r32.db'), 'db');
  assert.throws(
    () => prepareClone({ source, target: path.join(source, 'nested-clone') }),
    error => error?.reasonCode === 'SOURCE_UAT_DATA_CLONE_NESTED_TARGET'
  );
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(source, 'store', 'yance-r32.db'), path.join(source, 'linked-db'));
    assert.throws(
      () => prepareClone({ source, target: path.join(root, 'target') }),
      error => error?.reasonCode === 'SOURCE_UAT_DATA_CLONE_SYMLINK_REJECTED'
    );
  }
});

test('Batch13 screenshot defects are wired to production UI behavior', () => {
  const productNav = read('frontend/js/r32-product-area-navigation.js');
  const account = read('frontend/r32-account-center.js');
  const accountCss = read('frontend/r32-account-center.css');
  const themeCss = read('frontend/r32-theme-authority.css');
  const safeMode = read('frontend/js/r32-safe-mode-runtime.js');
  const server = read('backend/server.js');

  assert.match(productNav, /\.aiw30-business-mode \.aiw30-tabs\{grid-template-columns:minmax\(0,1fr\)\}/u);
  assert.doesNotMatch(productNav, /\.aiw30-business-mode \.aiw30-tabs\{grid-template-columns:repeat\(3/u);
  assert.match(account, /id="ac32AccountDialogStatus" role="alert" aria-live="assertive"/u);
  assert.match(account, /ensureAccountAuthAllowed\(existing/u);
  assert.match(account, /ensureAccountAuthAllowed\(account, '发送 Telegram 登录验证码'\)/u);
  assert.match(account, /ensureAccountAuthAllowed\(account, '重新连接平台账号'\)/u);
  assert.match(account, /showQr\(challenge\.dataUrl, accountId, challenge, platform\)/u);
  assert.match(account, /const label = accountPlatform === 'telegram' \? 'Telegram' : 'WhatsApp'/u);
  assert.match(accountCss, /Batch 13 · 账号授权反馈必须留在原生 dialog 顶层/u);
  assert.match(themeCss, /Batch 13 · 阅读与界面密度面板必须是完全不透底的独立浮层/u);
  assert.match(themeCss, /background:color-mix\(in srgb,var\(--panel\) 96%,var\(--bg\) 4%\)!important/u);
  assert.doesNotMatch(themeCss, /Batch 13[\s\S]*background:var\(--theme-panel-bg\)!important/u);
  assert.match(safeMode, /open\?\.\('desktop'\)/u);
  assert.match(server, /source-uat-isolated-data-clone-reset/u);
});
