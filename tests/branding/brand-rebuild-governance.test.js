'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'governance', 'branding', 'yance-brand-rebuild-status.json'), 'utf8'));
const matrix = fs.readFileSync(path.join(ROOT, 'governance', 'branding', 'YANCE_BRAND_REBUILD_MATRIX.md'), 'utf8');
const releaseSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'release', 'release-source.json'), 'utf8'));

const REQUIRED_FAMILIES = [
  '公共名称统一',
  '正式 SVG/PNG/ICO 品牌资产',
  '用户可见旧名称清零',
  'resources/app 组装层品牌门禁',
  '安装后最终产物品牌门禁',
  '旧数据目录迁移',
  '旧进程/Mutex/注册表兼容',
  '可迁移备份无编号命名',
  '无服务器内测更新策略',
  '两轮独立 Windows `verify:wp7`',
  'Windows Final Builder',
  'Windows Electron UAT',
  'WhatsApp/Telegram/Ollama/动态人设 UAT'
];

test('brand rebuild governance matrix covers every required source, migration, Windows and account problem family', () => {
  for (const family of REQUIRED_FAMILIES) assert.ok(matrix.replaceAll('`', '').includes(family.replaceAll('`', '')), `missing problem family: ${family}`);
  assert.match(matrix, /任何 `SKIP`、`NOT_APPLICABLE`、`DEFERRED` 或 `BLOCKED` 必须单独计数/);
});

test('machine-readable status cannot overclaim Windows execution or formal release authorization', () => {
  assert.equal(status.baseline.commit, '07d37a4fc088897a7d4ef9f236fc631202b7dfaf');
  assert.equal(status.publicBrand.chinese, '言策');
  assert.equal(status.publicBrand.english, 'Yance');
  assert.equal(status.publicBrand.executable, 'Yance.exe');
  assert.equal(status.costPolicy.newPaidInfrastructureRequired, false);
  assert.equal(status.costPolicy.serverRequiredForLocalInternalTest, false);
  assert.equal(status.costPolicy.paidCodeSigningRequiredForLocalInternalTest, false);
  assert.equal(status.windowsPhase.verifyWp7Round1, 'NOT_EXECUTED');
  assert.equal(status.windowsPhase.verifyWp7Round2, 'NOT_EXECUTED');
  assert.equal(status.windowsPhase.installerBuiltFromNewBrandCommit, false);
  assert.equal(status.windowsPhase.electronUatExecuted, false);
  assert.equal(status.release.formalInstallerAuthorized, false);
  assert.equal(status.release.formalPublicReleaseAuthorized, false);
  assert.equal(status.release.releaseApproved, false);
  assert.match(status.release.releaseStatus, /^BLOCKED_/);
});

test('release source remains zero-cost, local-only and unapproved for public release', () => {
  assert.equal(releaseSource.distributionMode, 'LOCAL_PRIVATE_UNSIGNED');
  assert.equal(releaseSource.releaseChannel, 'INTERNAL_TEST_ONLY');
  assert.equal(releaseSource.onlineUpdatesEnabled, false);
  assert.equal(releaseSource.updateMode, 'MANUAL_INSTALLER_ONLY');
  assert.equal(releaseSource.formalPublicReleaseAuthorized, false);
});
