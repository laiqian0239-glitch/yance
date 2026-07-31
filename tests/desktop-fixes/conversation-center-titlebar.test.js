'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/r32-conversation-center-v2.css'), 'utf8');
const runtime = fs.readFileSync(path.join(ROOT, 'frontend/js/r32-ui-runtime.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'electron/preload.js'), 'utf8');

test('desktop window starts dark and uses the native-safe integrated titlebar', () => {
  assert.match(main, /backgroundColor:\s*'#0B1416'/);
  assert.match(main, /titleBarStyle:\s*process\.platform === 'darwin' \? 'hiddenInset' : 'hidden'/);
  assert.match(main, /titleBarOverlay:\s*\{\s*color:\s*'#0B1416',\s*symbolColor:\s*'#E6ECEC',\s*height:\s*40\s*\}/);
  assert.doesNotMatch(main, /frame:\s*false/);
});

test('custom titlebar reserves native controls and only interactive children are non-draggable', () => {
  assert.match(html, /id="desktopTitlebar"/);
  assert.match(css, /-webkit-app-region:drag/);
  assert.match(css, /\.desktop-titlebar button,.desktop-titlebar input,.desktop-titlebar a\{-webkit-app-region:no-drag\}/);
  assert.match(css, /padding:0 150px 0 13px/);
});

test('titlebar change leaves the unified activation controller in place', () => {
  assert.match(main, /const activationController = ensureMainWindowActivationController\(\)/);
  assert.match(main, /activationController\.reset\(createdWindow, 'window-created'\)/);
  assert.match(main, /activationController\.markDidFinishLoad/);
});

test('titlebar service state is honest and accessible', () => {
  assert.match(html, /id="titlebarStatus"[^>]*data-state="connecting"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /\.titlebar-status\[data-state="connecting"\]/);
  assert.match(css, /\.titlebar-status\[data-state="online"\]/);
  assert.match(css, /\.titlebar-status\[data-state="error"\]/);
});


test('titlebar product identity is hydrated from the verified desktop release instead of a stale hardcoded name', () => {
  assert.match(html, /id="titlebarProductIdentity"/);
  assert.match(html, /id="titleProductName">言策</);
  assert.match(html, /id="titleProductVersion">1\.0\.0</);
  assert.doesNotMatch(html, /言策2\.9/);
  assert.match(runtime, /window\.yanceDesktop\?\.getState/);
  assert.match(runtime, /application\.publicVersion/);
  assert.match(runtime, /application\.sourceCommit/);
  assert.match(runtime, /runtime\.electron/);
  assert.match(runtime, /devicePixelRatio/);
});

test('desktop runtime identity and renderer scale are written to the persistent desktop log', () => {
  assert.match(main, /runtime-identity-verified/);
  assert.match(main, /sourceCommit:\s*acceptedRelease\.sourceCommit/);
  assert.match(main, /renderer-runtime-environment/);
  assert.match(main, /visualViewportScale/);
  assert.match(preload, /reportRuntimeEnvironment/);
});

test('Windows runtime verifier reads the live process and supports strict final Commit/Tree comparison', () => {
  const verifier = fs.readFileSync(path.join(ROOT, 'tools/windows/VERIFY_RUNTIME_IDENTITY.ps1'), 'utf8');
  assert.match(verifier, /Get-CimInstance Win32_Process/);
  assert.match(verifier, /runtime-identity-verified/);
  assert.match(verifier, /renderer-runtime-environment/);
  assert.match(verifier, /\$ExpectedCommit/);
  assert.match(verifier, /\$ExpectedTree/);
  assert.match(verifier, /\$ExpectedExecutablePath/);
  assert.match(verifier, /\$ExpectedProcessId/);
  assert.match(verifier, /StringComparison]::OrdinalIgnoreCase/);
  assert.doesNotMatch(verifier, /222e36fc6ff1733c84274f414365dbb920551efb/);
  assert.doesNotMatch(verifier, /a9ecce12d13bb978ae40ee47a686ffce2d8611a1/);
});
