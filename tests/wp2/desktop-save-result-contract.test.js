'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const contracts = require(path.join(ROOT, 'frontend/js/r32-desktop-result-contracts.js'));
const electronMain = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const systemCenter = fs.readFileSync(path.join(ROOT, 'frontend/r32-system-center.js'), 'utf8');

test('desktop save dialog normalizer accepts canonical and legacy Electron responses', () => {
  assert.deepEqual(
    contracts.normalizeSaveDialogResult({ ok: true, saved: true, path: 'C:/report.json' }),
    {
      ok: true,
      saved: true,
      cancelled: false,
      canceled: false,
      path: 'C:/report.json',
      filePath: 'C:/report.json',
      raw: { ok: true, saved: true, path: 'C:/report.json' }
    }
  );
  const legacy = contracts.normalizeSaveDialogResult({ saved: true, filePath: 'C:/legacy.json' });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.saved, true);
  assert.equal(legacy.path, 'C:/legacy.json');
  const legacyWithoutPath = contracts.normalizeSaveDialogResult({ ok: true, saved: true });
  assert.equal(legacyWithoutPath.ok, true);
  assert.equal(legacyWithoutPath.saved, true);
  const cancelled = contracts.normalizeSaveDialogResult({ saved: false });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.cancelled, true);
  const directPath = contracts.normalizeSaveDialogResult('C:/direct.json');
  assert.equal(directPath.ok, true);
  assert.equal(directPath.saved, true);
  assert.equal(directPath.path, 'C:/direct.json');
  const legacySuccess = contracts.normalizeSaveDialogResult({ success: true, filePath: 'C:/success.json' });
  assert.equal(legacySuccess.saved, true);
  assert.equal(legacySuccess.path, 'C:/success.json');
});

test('diagnostics export IPC returns one canonical save-result contract', () => {
  const start = electronMain.indexOf("ipcGuardHandle('desktop:export-diagnostics'");
  const end = electronMain.indexOf("ipcGuardHandle('desktop:export-chat'", start);
  assert.ok(start >= 0 && end > start);
  const block = electronMain.slice(start, end);
  for (const token of ['ok: true', 'saved: true', 'cancelled: false', 'path: result.filePath', 'filePath: result.filePath']) {
    assert.ok(block.includes(token), `missing canonical field: ${token}`);
  }
  assert.match(block, /saved:\s*false,\s*cancelled:\s*true/);
});

test('system center normalizes the desktop result before reporting success or failure', () => {
  assert.match(systemCenter, /YanceDesktopResultContracts\?\.normalizeSaveDialogResult/);
  assert.match(systemCenter, /saved\.cancelled/);
  assert.match(systemCenter, /if \(!saved\.ok\) throw new Error\('诊断报告保存失败'\)/);
  assert.doesNotMatch(systemCenter, /rawSuccess/u);
  assert.match(systemCenter, /YanceSystemStatus\?\.clear\?\.\('diagnostics-export-success'\)/);
  assert.match(systemCenter, /clearToast\('leave-system-center'\)/);
  assert.match(systemCenter, /clearToast\('system-center-tab-change'\)/);
});
