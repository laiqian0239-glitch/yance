'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectDataRoot, backupCoveragePresentation } = require('../../backend/services/dataProtectionAuthority');

test('business label and byte label cannot overwrite one another', () => {
  const root = projectDataRoot(
    { id: 'media', label: '媒体缓存', path: 'D:/Yance/media', backupIncluded: false },
    { files: 12, bytes: 10_380_000, sizeLabel: '9.9 MB', label: 'legacy-size-label-must-not-win' }
  );
  assert.equal(root.label, '媒体缓存');
  assert.equal(root.sizeLabel, '9.9 MB');
  const view = backupCoveragePresentation(root);
  assert.equal(view.label, '媒体缓存');
  assert.equal(view.status, '9.9 MB · 不纳入');
  assert.doesNotMatch(JSON.stringify(view), /undefined/u);
});

test('missing legacy fields produce explicit safe fallbacks instead of undefined', () => {
  const root = projectDataRoot({ id: 'unknown', backupIncluded: false }, {}, { formatBytes: () => '0 B' });
  const view = backupCoveragePresentation(root);
  assert.equal(view.label, '数据目录');
  assert.equal(view.status, '0 B · 不纳入');
  assert.match(view.detail, /路径已隐藏/u);
});

test('system center consumes sizeLabel and has a render fallback', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const service = fs.readFileSync(path.join(repoRoot, 'backend/services/systemCenterService.js'), 'utf8');
  const ui = fs.readFileSync(path.join(repoRoot, 'frontend/r32-system-center.js'), 'utf8');
  assert.match(service, /dataProtectionAuthority\.projectDataRoot/u);
  assert.match(service, /sizeLabel: bytes\(total\)/u);
  assert.doesNotMatch(service, /files, label: bytes\(total\)/u);
  assert.match(ui, /root\.sizeLabel \|\| fmtBytes\(root\.bytes \|\| 0\)/u);
  assert.doesNotMatch(ui, /`\$\{root\.sizeLabel\} · 不纳入`/u);
});
