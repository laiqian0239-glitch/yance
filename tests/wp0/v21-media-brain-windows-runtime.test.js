'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

test('Windows/local Media preflight uses upstream ComfyUI runtime and explicit Immich endpoint ownership', () => {
  const scriptPath = path.join(ROOT, 'tools/media-brain/build-windows-runtime.ps1');
  assert.equal(fs.existsSync(scriptPath), true, 'tools/media-brain/build-windows-runtime.ps1 must exist');
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /ComfyUI/iu);
  assert.match(script, /portable|user-managed|endpoint/iu);
  assert.match(script, /Immich/iu);
  assert.match(script, /health|preflight/iu);
  assert.doesNotMatch(script, /pip\s+install.*torch|conda\s+install|docker\s+compose.*yance/iu, 'Yance must not build a second inference or Immich stack');
});

test('runtime manifests preserve OSS provenance and do not claim bundled model weights or Immich database ownership', () => {
  for (const file of [
    'runtime/media-brain/immich/UPSTREAM.json',
    'runtime/media-brain/comfyui/UPSTREAM.json',
    'runtime/media-brain/README.md'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);

  const immich = JSON.parse(read('runtime/media-brain/immich/UPSTREAM.json'));
  const comfy = JSON.parse(read('runtime/media-brain/comfyui/UPSTREAM.json'));
  const readme = read('runtime/media-brain/README.md');

  assert.equal(immich.version, 'v3.1.0');
  assert.equal(immich.commit, '8aa95c67470a02a8ddedf03c2e52963af33065ff');
  assert.equal(comfy.version, 'v0.31.0');
  assert.equal(comfy.commit, '43cb4fffc89bba20ab7bd61467a36d0339338dab');
  assert.match(readme, /model.*not bundled|missing model|user-managed/iu);
  assert.match(readme, /Immich.*database.*not.*Yance|Immich.*owns.*database/iu);
});

test('credential-bearing external Immich preflight requires HTTPS', () => {
  const script = read('tools/media-brain/build-windows-runtime.ps1');
  const readme = read('runtime/media-brain/README.md');

  assert.match(script, /\$Name\s+-eq\s*['"]Immich['"]/u, 'preflight must distinguish Immich from credential-free upstreams');
  assert.match(script, /\$uri\.Scheme\s+-ne\s*['"]https['"]/u, 'external Immich must reject non-HTTPS endpoints');
  assert.match(readme, /external\s+Immich[\s\S]{0,180}HTTPS[\s\S]{0,180}API\s+key/iu, 'runtime boundary must document HTTPS for external Immich API-key traffic');
});
