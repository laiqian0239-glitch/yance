'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(ROOT, 'tools', 'release-closure', 'START_YANCE_VALIDATION.cmd'), 'utf8');

test('one-click launcher self-elevates without embedding a possibly spaced pipeline path in PowerShell argument text', () => {
  assert.match(source, /fltmc\.exe/);
  assert.match(source, /YANCE_LAUNCHER=%~f0/);
  assert.match(source, /Start-Process -FilePath \$env:YANCE_LAUNCHER/);
  assert.match(source, /-Verb RunAs/);
  assert.match(source, /--elevated/);
  assert.doesNotMatch(source, /Start-Process[^\r\n]+RUN_WINDOWS_ASSISTED_PIPELINE/);
});

test('one-click launcher finds exactly one reviewed pipeline and invokes its quoted path directly', () => {
  assert.match(source, /RUN_WINDOWS_ASSISTED_PIPELINE_\*\.ps1/);
  assert.match(source, /PIPELINE_COUNT/);
  assert.match(source, /-File "%PIPELINE%"/);
  assert.match(source, /set "RC=%ERRORLEVEL%"/);
});

test('one-click launcher stays open, explains heartbeats and does not ask for pasted PowerShell', () => {
  assert.match(source, /heartbeat every 10 seconds/);
  assert.match(source, /Do not close/);
  assert.match(source, /FINAL STATUS/);
  assert.match(source, /RESULT ZIP/);
  assert.match(source, /pause/);
  assert.doesNotMatch(source, /Set-ExecutionPolicy -Scope Process/);
});
