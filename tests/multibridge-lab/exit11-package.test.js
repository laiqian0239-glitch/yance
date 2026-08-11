'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(ROOT, 'tools', 'multibridge-lab');
const WRAPPER = path.join(TOOLS, 'RUN_EXIT11_EVIDENCE.cmd');
const COLLECTOR = path.join(TOOLS, 'collect-exit11-evidence.ps1');
const HELPER = path.join(TOOLS, 'native-process.ps1');

function read(file) {
  assert.ok(fs.existsSync(file), `missing package file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

test('final package has exactly one user-facing Windows wrapper over the tested collector/helper', () => {
  const wrapper = read(WRAPPER);
  read(COLLECTOR);
  read(HELPER);

  assert.match(wrapper, /powershell\.exe/i);
  assert.match(wrapper, /-NoExit/i);
  assert.match(wrapper, /collect-exit11-evidence\.ps1/i);
  assert.match(wrapper, /Invoke-LabExit11Collector/);
  assert.match(wrapper, /exit11-evidence\.txt/i);
  assert.match(wrapper, /FINAL_STATE=REAL_RED/);
  assert.match(wrapper, /OUTPUT_PATH=/);

  assert.doesNotMatch(wrapper, /\bpause\b/i);
  assert.doesNotMatch(wrapper, /\bexit\b/i);
  assert.doesNotMatch(wrapper, /\bdocker\b/i);
  assert.doesNotMatch(wrapper, /compose/i);
});

test('final wrapper cannot request, copy, or expose credentials/config/message artifacts', () => {
  const wrapper = read(WRAPPER);
  for (const forbidden of [
    /config\.ya?ml/i,
    /registration\.ya?ml/i,
    /lab-password/i,
    /lab-account/i,
    /as_token/i,
    /hs_token/i,
    /access_token/i,
    /refresh_token/i,
    /password/i,
    /cookie/i,
    /message/i,
    /telegram/i,
    /whatsapp/i
  ]) assert.doesNotMatch(wrapper, forbidden);
});

test('package source remains the exact read-only collector boundary', () => {
  const collector = read(COLLECTOR);
  const helper = read(HELPER);
  assert.match(collector, /Assert-LabDockerReadSuccess/);
  assert.match(collector, /facebook-personal/);
  assert.match(collector, /instagram-dm/);
  assert.match(collector, /google-messages/);
  assert.match(collector, /signal/);
  assert.match(collector, /line/);
  assert.match(helper, /System\.Diagnostics\.ProcessStartInfo/);

  for (const text of [collector, helper]) {
    assert.doesNotMatch(text, /\bdocker\s+(?:compose\s+)?(?:up|start|restart|stop|kill|rm|build|exec)\b/i);
    assert.doesNotMatch(text, /\bdocker\s+network\s+(?:connect|disconnect|create|rm)\b/i);
  }
});
