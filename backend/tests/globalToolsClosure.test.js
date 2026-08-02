'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const index = read('frontend/index.html');
const ui = read('frontend/js/r32-ui-runtime.js');
const capabilities = read('frontend/js/r32-conversation-capabilities.js');
const settings = read('frontend/r32-settings-recovery.js');
const systemCenter = read('frontend/r32-system-center.js');
const notificationPolicy = read('backend/services/notificationPolicy.js');
const systemRoutes = read('backend/routes/system.js');
const preload = read('electron/preload.js');
const main = read('electron/main.js');

test('main workspace diagnostics export the exact current checks through the sanitized backend bundle', () => {
  assert.match(index, /id="exportDiagnostic">导出脱敏诊断</);
  assert.match(index, /r32-diagnostic-summary-authority\.js/);
  assert.match(ui, /YanceDiagnosticSummaryAuthority/);
  assert.match(ui, /apiJson\('\/api\/r32\/system\/diagnostics'/);
  assert.match(ui, /lastDiagnosticSnapshot=\{\.\.\.diagnosticSnapshot\(merged\.rows\)/);
  assert.match(ui, /工作区全绿不能覆盖系统失败/);
  assert.match(ui, /apiJson\('\/api\/r32\/system\/diagnostics\/export'\)/);
  assert.match(ui, /workspaceDiagnostics:lastDiagnosticSnapshot/);
  assert.match(ui, /diagnosticSafeText/);
  assert.match(ui, /privacyMode:true/);
  assert.match(ui, /YanceDesktopResultContracts\?\.normalizeSaveDialogResult/);
  assert.match(ui, /browserDownloadDiagnostics\(bundle\)/);
  assert.match(systemRoutes, /router\.get\('\/diagnostics\/export'/);
  assert.match(preload, /exportDiagnostics: bundle => ipcRenderer\.invoke\('desktop:export-diagnostics', bundle\)/);
  assert.match(main, /ipcGuardHandle\('desktop:export-diagnostics'/);
  assert.match(main, /result\.canceled \|\| !result\.filePath/);
});

test('search and archive remain real independent workspaces and persisted actions', () => {
  assert.match(ui, /function openContactSearchWorkspace\(\)/);
  assert.match(ui, /\$\('navSearch'\)\.onclick=\(\)=>\{openContactSearchWorkspace\(\)/);
  assert.match(index, /data-filter="archived"/);
  assert.match(ui, /async function setConversationArchived\(id,archived,reason=''/);
  assert.match(ui, /\/api\/r32\/workspace\/conversations\/\$\{encodeURIComponent\(id\)\}\/archive/);
});

test('attachment-only send and media viewer operations are connected to real handlers', () => {
  assert.match(ui, /hasSendableContent=hasText\|\|hasAttachment/);
  assert.match(capabilities, /sendButton\.addEventListener\('click',async e=>\{if\(!pending\)return/);
  assert.match(capabilities, /await sendPendingAttachment\(\$\('composerText'\)\.value\.trim\(\)\)/);
  assert.match(capabilities, /X-Yance-Caption/);
  assert.match(capabilities, /openMediaViewer\(source,kind=''/);
  assert.match(capabilities, /saveMediaViewerImage/);
  assert.match(capabilities, /anchor\.download=mediaViewer\.fileName/);
  assert.match(capabilities, /menuButton\('save-media','保存 \/ 下载'\)/);
  assert.match(capabilities, /copyMediaViewerImage/);
});

test('notification settings expose multiple per-event sound choices with real preview', () => {
  assert.match(settings, /open-system-notifications/);
  assert.match(systemCenter, /notificationSoundCatalog/);
  assert.match(systemCenter, /notificationSoundPicker/);
  assert.match(systemCenter, /incomingSoundPattern/);
  assert.match(notificationPolicy, /outgoingSoundPattern/);
  assert.match(notificationPolicy, /failureSoundPattern/);
  assert.match(notificationPolicy, /presenceOnlineSoundPattern/);
  assert.match(notificationPolicy, /presenceOfflineSoundPattern/);
  assert.match(systemCenter, /preview-sound/);
  assert.match(systemCenter, /playSound\(\{ volume, pattern, force: true \}\)/);
});

test('system center diagnostics export remains available as the full recovery path', () => {
  assert.match(systemCenter, /async function exportDiagnostics\(\)/);
  assert.match(systemCenter, /const result = await api\('\/diagnostics\/export'\)/);
  assert.match(systemCenter, /window\.yanceDesktop\?\.exportDiagnostics/);
  assert.match(systemCenter, /已取消保存诊断报告/);
});
