'use strict';

const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, source) {
  fs.writeFileSync(file, source);
}

function replaceCount(source, before, after, expected, label) {
  const actual = source.split(before).length - 1;
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected} replacements, found ${actual}`);
  }
  return source.split(before).join(after);
}

const successor = 'fix/v21-electron-supported-runtime-p0-production-amendment-3';
const predecessor = 'fix/v21-electron-supported-runtime-p0-production-amendment-1';

{
  const file = '.github/workflows/v21-product-experience-shell-p0-final-validation.yml';
  let source = read(file);
  source = replaceCount(
    source,
    `github.event.pull_request.head.ref == '${predecessor}'`,
    `github.event.pull_request.head.ref == '${successor}'`,
    3,
    'Product Final exact branch admission'
  );
  write(file, source);
}

{
  const file = 'tests/layered-ci/v21-product-experience-shell-p0-final-validation.test.js';
  let source = read(file);
  const assertAnchor = "  assert.match(source, /github\\.event\\.pull_request\\.head\\.ref\\s*==\\s*'product\\/v21-product-system-settings-reachability-p1-successor-v2-amendment-1'/u);";
  const successorAssert = "  assert.match(source, /github\\.event\\.pull_request\\.head\\.ref\\s*==\\s*'fix\\/v21-electron-supported-runtime-p0-production-amendment-3'/u);";
  source = replaceCount(
    source,
    assertAnchor,
    `${assertAnchor}\n${successorAssert}`,
    1,
    'Product Final permanent successor assertion'
  );

  const listAnchor = "    'product/v21-product-system-settings-reachability-p1-successor-v2-amendment-1',\n    'fix/v21-product-experience-windows-uat-startup-p0',";
  const listReplacement = "    'product/v21-product-system-settings-reachability-p1-successor-v2-amendment-1',\n    'fix/v21-electron-supported-runtime-p0-production-amendment-3',\n    'fix/v21-product-experience-windows-uat-startup-p0',";
  source = replaceCount(source, listAnchor, listReplacement, 1, 'Product Final exact allowlist');
  write(file, source);
}

const seedPaths = [
  'vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz',
  'vendor/npm/_at_electron__get-5.0.0.tgz',
  'vendor/npm/_at_types__node-24.10.13.tgz',
  'vendor/npm/env-paths-3.0.0.tgz',
  'vendor/npm/undici-7.25.0.tgz',
  'vendor/npm/undici-types-7.16.0.tgz'
];

{
  const file = 'governance/layered-ci/risk-policy.json';
  const policy = JSON.parse(read(file));
  for (const seed of seedPaths) {
    if (!policy.l2ExactPaths.includes(seed)) {
      policy.l2ExactPaths.push(seed);
    }
  }
  policy.l2ExactPaths.sort();
  if (policy.l2Prefixes.includes('vendor/') || policy.l2Prefixes.includes('vendor/npm/')) {
    throw new Error('broad vendor risk prefix is forbidden');
  }
  write(file, `${JSON.stringify(policy, null, 2)}\n`);
}

{
  const file = 'tests/layered-ci/governance-policy.test.js';
  let source = read(file);
  const before = "    'vendor/electron/electron-v39.8.5-win32-x64.zip',\n    'vendor/npm/electron-43.4.1.tgz'";
  const after = [
    "    'vendor/electron/electron-v39.8.5-win32-x64.zip',",
    "    'vendor/npm/_at_electron-internal__extract-zip-1.0.3.tgz',",
    "    'vendor/npm/_at_electron__get-5.0.0.tgz',",
    "    'vendor/npm/_at_types__node-24.10.13.tgz',",
    "    'vendor/npm/electron-43.4.1.tgz',",
    "    'vendor/npm/env-paths-3.0.0.tgz',",
    "    'vendor/npm/undici-7.25.0.tgz',",
    "    'vendor/npm/undici-types-7.16.0.tgz'"
  ].join('\n');
  source = replaceCount(source, before, after, 2, 'Layered exact Electron seed lists');
  write(file, source);
}

{
  const file = 'governance/architecture-closure-v2/wp-b-xstate-supply-chain-lock.json';
  const lock = JSON.parse(read(file));
  const binding = lock.repositoryBinding;
  binding.packageManifestBlobSha = 'e54002c894cb42ffc93ad94b1341f87b53e60728';
  binding.packageLockBlobSha = 'd485f45673eeb4a7293a389ffcd28d3ff7c0b56d';
  binding.packageLockSha256 = '62fedf96db695b1f8da9b7966627f6100939053a95bf4ed8324d814328117198';
  binding.expectedPackageLockBlobSha = 'd485f45673eeb4a7293a389ffcd28d3ff7c0b56d';
  binding.expectedPackageLockSha256 = '62fedf96db695b1f8da9b7966627f6100939053a95bf4ed8324d814328117198';
  binding.repairedAtHead = 'ed372f216a3cb2b56438175fa31d4aeddf271d5a';
  binding.differencePolicy = 'ELECTRON_43_4_1_REPOSITORY_REBIND_PRESERVED_XSTATE_5_32_5_ARTIFACT';
  write(file, `${JSON.stringify(lock, null, 2)}\n`);
}

{
  const file = 'tests/wp0/v21-adaptive-local-llm-runtime-p0.test.js';
  let source = read(file);
  source = replaceCount(
    source,
    "const fs = require('node:fs');\nconst path = require('node:path');",
    "const fs = require('node:fs');\nconst crypto = require('node:crypto');\nconst path = require('node:path');",
    1,
    'adaptive crypto import'
  );

  const marker = "test('implementation diff does not contain committed model/runtime binaries or oversized runtime archives', () => {";
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error('adaptive artifact guard marker missing');
  }

  const replacement = `test('implementation diff does not contain committed model/runtime binaries or oversized runtime archives', () => {\n  let changed = [];\n  try {\n    changed = execFileSync('git', ['diff', '--name-only', \`\${AUTHORIZATION_MERGE}...HEAD\`], { cwd: ROOT, encoding: 'utf8' }).split(/\\r?\\n/u).filter(Boolean);\n  } catch (error) {\n    assert.fail(\`git diff against authorization merge must be available: \${error.message}\`);\n  }\n\n  const forbidden = /\\.(?:gguf|ggml|safetensors|bin|onnx|pt|pth|zip|7z|tar|gz|xz|dll|exe|so|dylib)$/iu;\n  assert.deepEqual(changed.filter(file => forbidden.test(file)), []);\n\n  const dependencyPolicy = json('governance/dependency-install-policy.json');\n  assert.equal(Array.isArray(dependencyPolicy.trustedCacheSeeds), true);\n  const trustedSeeds = new Map(dependencyPolicy.trustedCacheSeeds.map(seed => [seed.archivePath, seed]));\n  assert.equal(trustedSeeds.size, dependencyPolicy.trustedCacheSeeds.length, 'trusted cache seed archive paths must be unique');\n\n  for (const file of changed) {\n    const absolute = path.join(ROOT, file);\n    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;\n    if (fs.statSync(absolute).size < 1024 * 1024) continue;\n\n    const seed = trustedSeeds.get(file);\n    if (seed) {\n      assert.equal(seed.archivePath, file);\n      assert.equal(seed.source, 'npm-official-tarball', \`\${file} must use official npm tarball custody\`);\n      assert.match(seed.resolved, /^https:\\/\\/registry\\.npmjs\\.org\\/.+\\.tgz$/u, \`\${file} must bind an official npm registry tarball\`);\n      assert.match(seed.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, \`\${file} must bind npm SHA-512 integrity\`);\n      assert.match(seed.archiveSha256, /^[0-9a-f]{64}$/u, \`\${file} must bind archive SHA-256\`);\n      const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');\n      assert.equal(actualSha256, seed.archiveSha256, \`\${file} physical bytes must match trusted cache-seed SHA-256\`);\n      continue;\n    }\n\n    assert.equal(file, 'release/production-dependency-binding.json', \`\${file} unexpectedly carries a large artifact without exact trusted authority\`);\n    const binding = json(file);\n    assert.equal(binding.documentType, 'YANCE_PRODUCTION_DEPENDENCY_EXTERNAL_BINDING');\n    assert.equal(binding.generatedBy, 'tools/wp7/generate-production-dependency-binding.js');\n    assert.equal(binding.packageManager, 'npm@10.9.2');\n    assert.equal(binding.lockfileVersion, 3);\n    assert.deepEqual(binding.platformKeys, ['linux-x64', 'win32-x64']);\n    const packageJsonSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package.json'))).digest('hex');\n    const packageLockSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');\n    assert.equal(binding.packageJsonSha256, packageJsonSha256, 'canonical binding must match current package.json SHA-256');\n    assert.equal(binding.packageLockSha256, packageLockSha256, 'canonical binding must match current package-lock.json SHA-256');\n  }\n});\n`;

  source = source.slice(0, start) + replacement;
  write(file, source);
}
