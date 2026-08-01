'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..', '..');

test('Gate 0 PowerShell launcher isolates stdout and stderr and trusts the child exit code', () => {
  const ps1 = fs.readFileSync(path.join(root, 'RUN_FIX6O_GATE0_WINDOWS_UAT.ps1'), 'utf8');
  assert.match(ps1, /Start-Process/u);
  assert.match(ps1, /-RedirectStandardOutput/u);
  assert.match(ps1, /-RedirectStandardError/u);
  assert.match(ps1, /\.ExitCode/u);
  assert.doesNotMatch(ps1, /2>&1\s*\|\s*Tee-Object/u);
  assert.doesNotMatch(ps1, /--no-sandbox|ELECTRON_DISABLE_SANDBOX/iu);
});

test('source UAT runtime supervisor redirects Electron diagnostics and waits for trusted readiness', () => {
  const supervisor = fs.readFileSync(path.join(root, 'tools/runtime-delivery/source-uat-runtime-supervisor.js'), 'utf8');
  const launcher = fs.readFileSync(path.join(root, 'tools/runtime-delivery/start-source-uat.js'), 'utf8');
  assert.match(supervisor, /detached:\s*true/u);
  assert.match(supervisor, /stdio:\s*\['ignore',\s*stdoutFd,\s*stderrFd\]/u);
  assert.match(supervisor, /\/api\/health/u);
  assert.match(supervisor, /SOURCE_UAT_RUNTIME_READY_TIMEOUT/u);
  assert.match(launcher, /status:\s*'RUNTIME_READY'/u);
  assert.match(launcher, /electronExecutableSha256/u);
  assert.match(launcher, /platform:\s*process\.platform/u);
  assert.doesNotMatch(launcher, /stdio:\s*'inherit'/u);
});
