'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  evaluateWindowsExplorerPaths,
  assertWindowsExplorerSafe,
} = require('../../tools/runtime-delivery/windows-explorer-path-authority');

const LONG_ENTRY = 'implementation/wp4-desktop-credential-application-lifecycle-rejected-owner-containment-review-rejection.json';

test('long release folder names are rejected before Windows Explorer delivery', () => {
  const result = evaluateWindowsExplorerPaths({
    archiveRootName: 'YANCE_BATCH40_FIX6G_AI_BRAIN_ROLE_LIFECYCLE_AUTHORITY_V2_SOURCE',
    entries: [LONG_ENTRY],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'WINDOWS_EXPLORER_PATH_BUDGET_EXCEEDED');
  assert.throws(() => assertWindowsExplorerSafe({
    archiveRootName: 'YANCE_BATCH40_FIX6G_AI_BRAIN_ROLE_LIFECYCLE_AUTHORITY_V2_SOURCE',
    entries: [LONG_ENTRY],
  }), error => error?.reasonCode === 'WINDOWS_EXPLORER_PATH_BUDGET_EXCEEDED');
});

test('short archive root keeps the same source payload within the Windows Explorer path budget', () => {
  const result = evaluateWindowsExplorerPaths({
    archiveRootName: 'YANCE_FIX6H_SOURCE',
    entries: [LONG_ENTRY, 'frontend/js/r32-ai-workbench-runtime.js'],
  });
  assert.equal(result.ok, true);
  assert.ok(result.maxExpandedPathLength <= result.maxAllowedPathLength);
  assert.equal(result.archiveRootName, 'YANCE_FIX6H_SOURCE');
});

test('unsafe archive paths and oversized path components fail closed', () => {
  assert.throws(() => assertWindowsExplorerSafe({ archiveRootName: 'YANCE_FIX6H_SOURCE', entries: ['../escape.txt'] }), /unsafe archive path/u);
  assert.throws(() => assertWindowsExplorerSafe({ archiveRootName: 'YANCE_FIX6H_SOURCE', entries: [`implementation/${'x'.repeat(256)}.json`] }), /path component/u);
});

test('source delivery exposes a fail-closed Windows Explorer path gate command', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const command = fs.readFileSync(path.join(root, 'tools/runtime-delivery/verify-windows-explorer-source-paths.js'), 'utf8');
  assert.match(packageJson.scripts['verify:windows-explorer-source-paths'] || '', /verify-windows-explorer-source-paths/u);
  assert.match(command, /sourcePayloadRecords/u);
  assert.match(command, /assertWindowsExplorerSafe/u);
  assert.match(command, /WINDOWS_EXPLORER_PATH_BUDGET/u);
});
