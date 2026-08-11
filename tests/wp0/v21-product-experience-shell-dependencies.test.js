'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_PINNED_ELEMENT_LOCK_BLOB = '7e1974c8c30a7f92bdd89bf3562fbb74979e1dbc';
const POST_NX_ELEMENT_LOCK_BLOB = '9ea9eb20bd2bb2d8af0f811ecf0798262924b8df';

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function lockIndex(patch, label) {
  const match = patch.match(
    /^diff --git a\/pnpm-lock\.yaml b\/pnpm-lock\.yaml\nindex ([0-9a-f]{7,40})\.\.([0-9a-f]{7,40}) 100644$/m
  );
  assert.ok(match, `${label} must expose a standard Git lockfile index line`);
  return { old: match[1], next: match[2] };
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

test('Product dependency lock patch binds the exact post-0003 runtime preimage', () => {
  const nxPatch = read('upstream-patches/element-web/0003-yance-nx-crlf-lockfile.patch');
  const productPatch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
  const nxIndex = lockIndex(nxPatch, '0003 Nx lock patch');
  const productIndex = lockIndex(productPatch, '0011 Product dependency lock patch');

  assert.deepEqual(
    nxIndex,
    { old: RAW_PINNED_ELEMENT_LOCK_BLOB, next: POST_NX_ELEMENT_LOCK_BLOB },
    'frozen 0003 must continue to define the exact raw -> post-Nx lock transition'
  );
  assert.equal(
    productIndex.old,
    nxIndex.next,
    '0011 old-side authority must be the exact post-0003 lock blob, never the raw pinned lock'
  );
  assert.notEqual(productIndex.old, RAW_PINNED_ELEMENT_LOCK_BLOB);
});

test('Product dependency lock mutation semantics remain exact and lock-only', () => {
  const patch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');

  assert.equal([...patch.matchAll(/^diff --git /gm)].length, 1, '0011 must remain one lock-only diff');
  assert.match(patch, /^diff --git a\/pnpm-lock\.yaml b\/pnpm-lock\.yaml$/m);
  assert.doesNotMatch(patch, /^diff --git a\/(?!pnpm-lock\.yaml\b).+$/m);

  for (const exactIdentity of [
    '@base-ui/react@1.7.0',
    '@rive-app/react-canvas@4.31.0',
    '@rive-app/canvas@2.39.2',
    '@types/howler@2.2.13',
    'howler@2.2.4',
    'livekit-client@2.21.0',
    'motion@12.42.2'
  ]) {
    assert.ok(patch.includes(exactIdentity), `missing lock identity ${exactIdentity}`);
  }

  for (const importerAuthority of [
    "specifier: workspace:*",
    "version: link:../../packages/module-api",
    "specifier: 1.7.0",
    "specifier: 4.31.0",
    "specifier: 2.2.4",
    "specifier: 2.21.0",
    "specifier: 12.42.2",
    "specifier: '>=18'",
    'version: 19.2.7',
    'version: 7.0.2',
    'version: 8.1.5'
  ]) {
    assert.ok(patch.includes(importerAuthority), `missing frozen importer authority ${importerAuthority}`);
  }
});

test('Product dependency lock replay remains canonical and uses strict ordinary git apply', () => {
  const patch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
  const bootstrap = read('tools/matrix/bootstrap.js');
  const productIndex = lockIndex(patch, '0011 Product dependency lock patch');

  assert.equal(productIndex.old.length, 40, '0011 must carry the full exact old-side blob identity');
  assert.equal(productIndex.next.length, 40, '0011 must carry the full exact target blob identity');
  assert.match(patch, /^--- a\/pnpm-lock\.yaml$/m);
  assert.match(patch, /^\+\+\+ b\/pnpm-lock\.yaml$/m);
  assert.match(patch, /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m);

  const copyMarker = "fs.cpSync(path.join(ROOT, 'integration/element-module'), moduleTarget, { recursive: true });";
  const applyMarker = "applyPatch(element, PRODUCT_DEPENDENCY_LOCK_PATCH, 'Product Experience dependency lock patch');";
  assert.ok(bootstrap.indexOf(copyMarker) >= 0, 'Product module overlay must remain explicit');
  assert.ok(bootstrap.indexOf(copyMarker) < bootstrap.indexOf(applyMarker), '0011 must remain after the Product module overlay');

  const applyPatchBody = bootstrap.match(/function applyPatch\(repoDir, patchPath, label\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(applyPatchBody, 'bootstrap applyPatch helper must remain explicit');
  assert.match(
    applyPatchBody,
    /run\(repoDir, 'git', \['apply', '--check', patchPath\]\);\s*run\(repoDir, 'git', \['apply', patchPath\]\);/,
    'runtime replay must remain ordinary git apply --check followed by git apply'
  );
  assert.doesNotMatch(
    applyPatchBody,
    /--3way|--reject|--recount|--ignore-whitespace|--ignore-space-change|--unidiff-zero/,
    'runtime replay must not weaken patch application semantics'
  );
});
