'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_PINNED_ELEMENT_LOCK_BLOB = '7e1974c8c30a7f92bdd89bf3562fbb74979e1dbc';
const POST_NX_ELEMENT_LOCK_BLOB = 'f13b569df10a63311d7bba874c452b568617e5d0';

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

function addedYanceImporter(patch) {
  const match = patch.match(/\+  modules\/yance:\n(?:(?:\+.*)\n)+/u);
  assert.ok(match, '0011 must add the modules/yance lock importer');
  return match[0];
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

test('Product dependency replay mutation semantics remain exact across root manifest and lock', () => {
  const patch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
  const importer = addedYanceImporter(patch);
  const patched = [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gmu)].map((match) => {
    assert.equal(match[1], match[2], '0011 may not rename Element files');
    return match[1];
  }).sort();

  assert.deepEqual(patched, ['package.json', 'pnpm-lock.yaml'], '0011 must atomically bind Element root manifest ownership to its frozen lock replay');
  const packageMarker = 'diff --git a/package.json b/package.json';
  const lockMarker = 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml';
  const packageStart = patch.indexOf(packageMarker);
  const lockStart = patch.indexOf(lockMarker);
  assert.ok(packageStart >= 0 && lockStart > packageStart, '0011 must patch root package.json before pnpm-lock.yaml');
  const packagePatch = patch.slice(packageStart, lockStart);
  assert.match(packagePatch, /^\+\s+"lucide-react": "0\.563\.0",$/mu);
  assert.equal((packagePatch.match(/lucide-react/gu) || []).length, 1, 'root host must gain exactly one lucide-react manifest ownership mutation');

  for (const exactImporterMutation of [
    "+      '@base-ui/react':\n+        specifier: 1.7.0\n+        version: 1.7.0(",
    "+      '@element-hq/element-web-module-api':\n+        specifier: workspace:*\n+        version: link:../../packages/module-api",
    "+      '@rive-app/react-canvas':\n+        specifier: 4.31.0\n+        version: 4.31.0(react@19.2.7)",
    "+      howler:\n+        specifier: 2.2.4\n+        version: 2.2.4",
    "+      livekit-client:\n+        specifier: 2.21.0\n+        version: 2.21.0(",
    "+      motion:\n+        specifier: 12.42.2\n+        version: 12.42.2(",
    "+      react:\n+        specifier: '>=18'\n+        version: 19.2.7",
    "+      '@types/howler':\n+        specifier: 2.2.13\n+        version: 2.2.13",
    "+      typescript:\n+        specifier: 'catalog:'\n+        version: 7.0.2",
    "+      vite:\n+        specifier: 'catalog:'\n+        version: 8.1.5("
  ]) {
    assert.ok(importer.includes(exactImporterMutation), `missing frozen importer mutation ${exactImporterMutation}`);
  }

  assert.ok(patch.includes("+  '@rive-app/canvas@2.39.2':"), '0011 must carry the exact frozen Rive backing runtime');
});

test('Product dependency lock replay remains canonical and uses strict ordinary git apply', () => {
  const patch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
  const bootstrap = read('tools/matrix/bootstrap.js');
  lockIndex(patch, '0011 Product dependency lock patch');

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
test('Product dependency replay binds governed tool-ui React to the Element root without changing existing identities', () => {
  const patch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
  const importer = addedYanceImporter(patch);

  const packageMarker = 'diff --git a/package.json b/package.json';
  const lockMarker = 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml';
  const packageStart = patch.indexOf(packageMarker);
  const lockStart = patch.indexOf(lockMarker);
  assert.ok(packageStart >= 0 && lockStart > packageStart);

  const packagePatch = patch.slice(packageStart, lockStart);
  assert.match(packagePatch, /^\+[ \t]+"lucide-react": "0\.563\.0",$/mu);
  assert.match(packagePatch, /^\+[ \t]+"react": "catalog:",$/mu);

  const lockPatch = patch.slice(lockStart);
  const moduleImporterIndex = lockPatch.indexOf('+  modules/yance:');
  assert.ok(moduleImporterIndex >= 0);

  const rootImporterPatch = lockPatch.slice(0, moduleImporterIndex);
  assert.match(
    rootImporterPatch,
    /^\+[ \t]+react:\n\+[ \t]+specifier: 'catalog:'\n\+[ \t]+version: 19\.2\.7$/mu
  );

  assert.ok(
    importer.includes("+      react:\n+        specifier: '>=18'\n+        version: 19.2.7"),
    'modules/yance React identity must remain unchanged'
  );
  assert.ok(
    importer.includes("+      lucide-react:\n+        specifier: 0.563.0\n+        version: 0.563.0(react@19.2.7)"),
    'modules/yance lucide-react identity must remain unchanged'
  );

  assert.doesNotMatch(
    patch,
    /external(?:ize|ization)|shamefully-hoist|public-hoist-pattern|NODE_PATH|--no-frozen-lockfile|--lockfile-only/iu
  );
});

test('Product dependency replay gives governed tool-ui direct Element-root type and schema ownership', () => {
  const patch = read('upstream-patches/element-web/0011-yance-product-experience-dependency-lock.patch');
  const importer = addedYanceImporter(patch);
  const packageMarker = 'diff --git a/package.json b/package.json';
  const lockMarker = 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml';
  const packageStart = patch.indexOf(packageMarker);
  const lockStart = patch.indexOf(lockMarker);
  assert.ok(packageStart >= 0 && lockStart > packageStart);

  const packagePatch = patch.slice(packageStart, lockStart);
  assert.match(packagePatch, /^\+[ \t]+"@types\/react": "\^19\.2\.10",$/mu);
  assert.match(packagePatch, /^\+[ \t]+"zod": "4\.4\.3",$/mu);

  const lockPatch = patch.slice(lockStart);
  const moduleImporterIndex = lockPatch.indexOf('+  modules/yance:');
  assert.ok(moduleImporterIndex >= 0);
  const rootImporterPatch = lockPatch.slice(0, moduleImporterIndex);
  assert.match(
    rootImporterPatch,
    /^\+[ \t]+'@types\/react':\n\+[ \t]+specifier: \^19\.2\.10\n\+[ \t]+version: 19\.2\.17$/mu
  );
  assert.match(
    rootImporterPatch,
    /^\+[ \t]+zod:\n\+[ \t]+specifier: 4\.4\.3\n\+[ \t]+version: 4\.4\.3$/mu
  );
  assert.ok(importer.includes("+      '@types/react':\n+        specifier: ^19.2.10\n+        version: 19.2.17"));
  assert.ok(importer.includes("+      zod:\n+        specifier: 4.4.3\n+        version: 4.4.3"));
});
