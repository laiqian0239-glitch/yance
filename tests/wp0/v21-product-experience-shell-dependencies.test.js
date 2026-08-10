'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

test('Product Experience exact OSS package identities are pinned in the Element module', () => {
  const pkg = JSON.parse(read('integration/element-module/package.json'));
  assert.equal(pkg.dependencies?.['@base-ui/react'], '1.7.0');
  assert.equal(pkg.dependencies?.motion, '12.42.2');
  assert.equal(pkg.dependencies?.['@rive-app/react-canvas'], '4.31.0');
  assert.equal(pkg.dependencies?.howler, '2.2.4');
  assert.equal(pkg.devDependencies?.['@types/howler'], '2.2.13');

  for (const benchmark of ['signal', 'stoat', 'cinny', 'discord', 'snapchat', 'locket', 'hinge', 'bumble']) {
    assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((name) => name.toLowerCase().includes(benchmark)), false);
  }
});

test('Product Experience immutable upstream identities and Rive backing runtime are recorded', () => {
  const rel = 'config/upstreams/v21-product-experience-shell-p0.json';
  assert.equal(exists(rel), true, `${rel} must exist`);
  const upstreams = JSON.parse(read(rel));

  assert.equal(upstreams.upstreams?.baseUi?.commit, '254f4744f0a241c20697b9eeab33402f4469a081');
  assert.equal(upstreams.upstreams?.baseUi?.packageVersion, '1.7.0');
  assert.equal(upstreams.upstreams?.motion?.commit, '40e8756c63b258c9dd07de9501cb788410eefb02');
  assert.equal(upstreams.upstreams?.motion?.packageVersion, '12.42.2');
  assert.equal(upstreams.upstreams?.riveReact?.commit, 'c05ec1842324a4a61d01f8e49dfd2ac2c37ae72c');
  assert.equal(upstreams.upstreams?.riveReact?.packageVersion, '4.31.0');
  assert.equal(upstreams.upstreams?.riveRuntime?.commit, '68dbf3a775df37fc4a6f128fb685eb9ed4bf149b');
  assert.equal(upstreams.upstreams?.riveRuntime?.packageVersion, '2.39.2');
  assert.equal(upstreams.upstreams?.howler?.commit, '003b917c40cb41cf382ba47ae0ed7a35ca2abe76');
  assert.equal(upstreams.upstreams?.howler?.packageVersion, '2.2.4');
  assert.equal(upstreams.upstreams?.howlerTypes?.packageVersion, '2.2.13');
});

test('Product Experience has exact license receipts and Yance-owned Rive provenance', () => {
  for (const rel of [
    'third_party/licenses/base-ui-MIT.txt',
    'third_party/licenses/motion-MIT.txt',
    'third_party/licenses/rive-react-MIT.txt',
    'third_party/licenses/rive-wasm-MIT.txt',
    'third_party/licenses/howler-MIT.txt',
    'third_party/licenses/types-howler-MIT.txt'
  ]) assert.equal(exists(rel), true, `${rel} must exist`);

  const config = exists('config/upstreams/v21-product-experience-shell-p0.json')
    ? JSON.parse(read('config/upstreams/v21-product-experience-shell-p0.json'))
    : {};
  assert.ok(['YANCE_OWNED', 'EXPLICITLY_REDISTRIBUTABLE'].includes(config.assetProvenance?.riveRelationshipOrb?.ownership));
  assert.equal(config.assetProvenance?.riveRelationshipOrb?.redistributable, true);
  assert.equal(exists('integration/element-module/src/product-experience/assets/yance-relationship-orb.riv'), true);
});

test('Pinned Element dependency lock replay is explicit and frozen', () => {
  const patch = 'upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch';
  assert.equal(exists(patch), true, `${patch} must exist`);
  const bootstrap = read('tools/matrix/bootstrap.js');
  assert.match(bootstrap, /0011-yance-product-experience-dependency-lock\.patch/u);
  assert.match(bootstrap, /apply[^\n]*--check/u);
});
