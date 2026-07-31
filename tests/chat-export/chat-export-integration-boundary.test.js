'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCommandPathInventory, collectActualIpc } = require('../../tools/wp2/command-path-inventory');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('one existing conversation menu owns the single export action', () => {
  const frontend = read('frontend/js/r32-conversation-capabilities.js');
  assert.equal((frontend.match(/data-conv="export"/g) || []).length, 2, 'one menu button and one handler selector');
  assert.match(frontend, /exportCurrentConversation\(c\)/);
  assert.match(frontend, /window\.yanceDesktop\?\.exportChat/);
  assert.doesNotMatch(frontend, /rawCredential|apiSessionToken|payload_json/);
});

test('desktop bridge has exactly one chat export IPC and validates size and SHA256 before writing', () => {
  const main = read('electron/main.js');
  const preload = read('electron/preload.js');
  assert.equal((main.match(/(?:ipcMain\.handle|ipcGuardHandle)\('desktop:export-chat'/g) || []).length, 1);
  assert.equal((preload.match(/ipcRenderer\.invoke\('desktop:export-chat'/g) || []).length, 1);
  assert.match(main, /CHAT_EXPORT_SHA256_MISMATCH/);
  assert.match(main, /Buffer\.byteLength\(payload\.content, 'utf8'\)/);
  assert.match(main, /apiRequest\(`\/api\/r32\/workspace\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/export`\)/);
  assert.match(main, /dialog\.showSaveDialog/);
});

test('backend export route is read-only and delegates to one service', () => {
  const route = read('backend/routes/workspace.js');
  assert.equal((route.match(/conversations\/:sessionKey\/export/g) || []).length, 1);
  assert.match(route, /chatExport\.createConversationExport/);
  assert.doesNotMatch(route, /assertWriteAllowed[\s\S]{0,120}sessionKey\/export/);
  const service = read('backend/services/chatExportService.js');
  assert.doesNotMatch(service, /payload_json|SELECT\s+\*/i);
  assert.match(service, /full local paths|完整本地路径/);
});

test('WP2 command inventory classifies the new bridge without duplicate authority', () => {
  const actual = collectActualIpc(ROOT);
  const rows = buildCommandPathInventory(ROOT);
  const exportRows = rows.filter(row => row.channelOrCommandName === 'desktop:export-chat');
  assert.equal(actual.filter(row => row.channel === 'desktop:export-chat').length, 1);
  assert.equal(exportRows.length, 1);
  assert.equal(exportRows[0].forwardingOnly, false);
  assert.equal(exportRows[0].backendRoute, '/api/r32/workspace/conversations/:sessionKey/export');
  assert.equal(exportRows[0].backendExecutionModule, 'backend/services/chatExportService.js');
  assert.equal(exportRows[0].producesBusinessSideEffect, false);
});

test('historical chat-export development baseline preserves its pre-integration governance boundary', () => {
  const status = JSON.parse(read('implementation/chat-export/CHAT_EXPORT_DEVELOPMENT_BASELINE.json'));
  assert.equal(status.documentType, 'CHAT_EXPORT_DEVELOPMENT_BASELINE');
  assert.equal(status.baselineScope, 'PRE_INTEGRATION_DEVELOPMENT_CHECKPOINT');
  assert.equal(status.integrationBranchEntered, false);
  assert.ok(status.status.includes('NOT_A_WP7_FORMAL_REVIEW_CANDIDATE'));
  assert.ok(status.status.includes('WP7_FORMAL_STATUS_UNCHANGED'));
  assert.equal(status.governanceBoundary.productFunctionHealthAssertion, 'NOT_EVALUATED_BY_THIS_DOCUMENT');
});
