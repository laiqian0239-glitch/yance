'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const toolPath = path.resolve(__dirname, '..', '..', 'tools', 'runtime-delivery', 'sanitize-windows-ui-uat-diagnostic.js');

test('Windows UI UAT diagnostic sanitizer removes secrets, user content and absolute host paths', () => {
  const { sanitizeDiagnosticFile } = require(toolPath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ui-diagnostic-'));
  const input = path.join(root, 'server.jsonl');
  const output = path.join(root, 'server.sanitized.jsonl');
  fs.writeFileSync(input, [
    JSON.stringify({
      at: '2026-07-30T23:51:00.000Z',
      level: 'error',
      reasonCode: 'BACKEND_STARTUP_FAILED',
      message: 'Cannot open C:\\Users\\Alice\\AppData\\Roaming\\Yance\\store\\yance-r32.db for +8613812345678',
      token: 'sk-secret-token',
      authorization: 'Bearer abc.def.ghi',
      requestBody: { prompt: 'private customer conversation', email: 'alice@example.com' },
      stack: 'Error: fail at C:\\Users\\Alice\\project\\backend\\server.js:10:2'
    }),
    JSON.stringify({ event: 'conversation-message', level: 'info', message: 'private customer conversation must never enter diagnostic archive' }),
    'backend startup error token=sk-another-secret at C:\\Users\\Alice\\private.txt'
  ].join('\n') + '\n', 'utf8');

  const result = sanitizeDiagnosticFile(input, output);
  const text = fs.readFileSync(output, 'utf8');
  assert.equal(result.lineCount, 3);
  assert.equal(result.parseFailureCount, 1);
  assert.equal(result.droppedNonDiagnosticCount, 1);
  assert.match(text, /BACKEND_STARTUP_FAILED/u);
  assert.match(text, /\[REDACTED\]/u);
  assert.match(text, /REDACTED_PATH/u);
  assert.match(text, /REDACTED_PHONE/u);
  assert.doesNotMatch(text, /Alice/u);
  assert.doesNotMatch(text, /private customer conversation/u);
  assert.doesNotMatch(text, /sk-secret/u);
  assert.doesNotMatch(text, /abc\.def\.ghi/u);
  assert.doesNotMatch(text, /alice@example\.com/u);
});

test('diagnostic sanitizer rejects source and destination being the same file', () => {
  const { sanitizeDiagnosticFile } = require(toolPath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ui-diagnostic-same-'));
  const file = path.join(root, 'desktop.jsonl');
  fs.writeFileSync(file, '{}\n', 'utf8');
  assert.throws(() => sanitizeDiagnosticFile(file, file), /different files/u);
});

test('diagnostic sanitizer preserves a structured clone receipt while redacting host paths', () => {
  const { sanitizeDiagnosticFile } = require(toolPath);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-ui-diagnostic-json-'));
  const input = path.join(root, 'YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT.json');
  const output = path.join(root, 'receipt.sanitized.json');
  fs.writeFileSync(input, JSON.stringify({
    documentType: 'YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT',
    status: 'PASS',
    sourceDataRoot: 'C:\\Users\\Alice\\AppData\\Roaming\\Yance',
    targetDataRoot: 'C:\\Users\\Alice\\AppData\\Local\\Yance-UAT-Data\\run',
    sourceUntouched: true,
    criticalFilesMatch: true
  }, null, 2), 'utf8');

  const result = sanitizeDiagnosticFile(input, output);
  const value = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.documentMode, 'whole-json');
  assert.equal(value.documentType, 'YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT');
  assert.equal(value.status, 'PASS');
  assert.equal(value.sourceUntouched, true);
  assert.match(value.sourceDataRoot, /REDACTED_PATH/u);
  assert.match(value.targetDataRoot, /REDACTED_PATH/u);
  assert.doesNotMatch(JSON.stringify(value), /Alice/u);
});
