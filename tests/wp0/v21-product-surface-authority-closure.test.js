'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('V21 Product backend is API/control-only and cannot serve the retired legacy frontend', () => {
  const server = read('backend/server.js');
  assert.doesNotMatch(server, /const\s+frontendRoot\s*=\s*path\.join/u);
  assert.doesNotMatch(server, /express\.static\(frontendRoot/u);
  assert.doesNotMatch(server, /sendFile\(path\.join\(frontendRoot,\s*'index\.html'\)\)/u);
});

test('V21 runtime payload authorities exclude the duplicate frontend and bind canonical assets', () => {
  const wp1 = read('tools/wp1/lib.js');
  const wp6 = read('tools/wp6/common.js');
  const wp7 = read('tools/wp7/packaged-payload-closure.js');

  assert.doesNotMatch(wp1, /source:\s*'frontend'\s*,\s*destination:\s*'frontend'/u);
  assert.match(wp1, /source:\s*'assets'/u);
  assert.doesNotMatch(wp6, /PRODUCTION_ROOTS\s*=\s*\[[^\]]*'frontend'/su);
  assert.match(wp6, /PRODUCTION_ROOTS\s*=\s*\[[^\]]*'assets'/su);
  assert.doesNotMatch(wp7, /PROJECT_ROOTS\s*=\s*Object\.freeze\(\[[^\]]*'frontend'/su);
  assert.match(wp7, /PROJECT_ROOTS\s*=\s*Object\.freeze\(\[[^\]]*'assets'/su);
});

test('V21 branding authority is canonical-only and build/verify cannot recreate frontend copies', () => {
  const build = read('scripts/branding/build-yance-assets.js');
  const verify = read('scripts/branding/verify-yance-assets.js');
  assert.doesNotMatch(build, /path\.join\(root,\s*'frontend',\s*'assets'/u);
  assert.doesNotMatch(build, /copyRuntimeAssets/u);
  assert.doesNotMatch(verify, /path\.join\(ROOT,\s*'frontend',\s*'assets'/u);
  assert.doesNotMatch(verify, /RUNTIME/u);
  assert.match(build, /assets['"],\s*['"]branding['"],\s*['"]yance/u);
  assert.match(verify, /assets['"],\s*['"]branding['"],\s*['"]yance/u);
});

test('V21 official notification sound runtime is independent from legacy frontend assets', () => {
  const player = read('electron/sound-player.js');
  const catalog = read('shared/notificationSoundCatalog.js');
  assert.doesNotMatch(player, /frontend\/assets\/sounds/u);
  assert.match(player, /assets\/sounds/u);
  assert.doesNotMatch(catalog, /notificationSoundLibrary\.json/u);
  assert.doesNotMatch(catalog, /IMPORTED_SOUND_OPTIONS/u);
  assert.match(catalog, /Yance Classic/u);
});

test('V21 executable root-cause governance no longer treats legacy frontend readers as current Product proof', () => {
  const gate = read('tools/uat/rootCauseClosureGate.js');
  for (const legacyCurrentProof of [
    "frontend', 'r32-component-readability.css",
    "frontend', 'index.html",
    "frontend', 'js', 'r32-ui-runtime.js",
    "frontend', 'js', 'r32-ai-workbench-runtime.js"
  ]) {
    assert.equal(gate.includes(legacyCurrentProof), false, legacyCurrentProof);
  }
});
