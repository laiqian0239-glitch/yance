'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = '.github/workflows/v21-product-experience-shell-p0-final-validation.yml';
const CREATOR = 'tools/product-experience/create-materialized-uat-candidate.js';
const RUNNER = 'tools/product-experience/RUN_PRODUCT_EXPERIENCE_MATERIALIZED_UAT.ps1';
const COMPOSE = 'tools/product-experience/materialized-matrix-compose.yml';
const DESKTOP_ARTIFACT_PREFIX = 'Product-Experience-Materialized-Desktop-UAT-';
const MATRIX_ARTIFACT_PREFIX = 'Product-Experience-Materialized-Matrix-UAT-';

function absolute(relative) {
  return path.join(ROOT, ...relative.split('/'));
}

function read(relative) {
  const filePath = absolute(relative);
  assert.equal(fs.existsSync(filePath), true, `missing required materialized-UAT path: ${relative}`);
  return fs.readFileSync(filePath, 'utf8');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function withTemporaryDirectory(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-materialized-uat-contract-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('Product Final Validation retires the Product-specific Round12/13 source-UAT handoff', () => {
  const source = read(WORKFLOW);

  assert.doesNotMatch(source, /create-round12-13-windows-uat-package\.js/u);
  assert.doesNotMatch(source, /start-source-uat\.js/u);
  assert.doesNotMatch(source, /NOT_REAL_ELECTRON_UAT/u);
  assert.doesNotMatch(source, /ROUND12_13_UAT_MANIFEST\.json/u);
  assert.match(source, new RegExp(`${DESKTOP_ARTIFACT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\$\\{\\{\\s*github\\.event\\.pull_request\\.head\\.sha\\s*\\}\\}`, 'u'));
  assert.match(source, new RegExp(`${MATRIX_ARTIFACT_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\$\\{\\{\\s*github\\.event\\.pull_request\\.head\\.sha\\s*\\}\\}`, 'u'));
  assert.match(source, /create-materialized-uat-candidate\.js/u);
  assert.match(source, /RUN_PRODUCT_EXPERIENCE_MATERIALIZED_UAT\.ps1/u);
  assert.doesNotMatch(source, /continue-on-error:\s*true/u);
});

test('trusted Windows CI fully materializes the desktop UAT before upload', () => {
  const source = read(WORKFLOW);

  assert.match(source, /runs-on:\s*windows-latest/u);
  assert.match(source, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u);
  assert.match(source, /node-version:\s*['"]22\.23\.1['"]/u);
  assert.match(source, /node-v22\.23\.1-win-x64\.zip/u);
  assert.match(source, /7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29/u);
  assert.match(source, /f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed/u);
  assert.match(source, /release[\\/]electron-distribution-trust\.json/u);
  assert.match(source, /git lfs pull origin --include=/u);
  assert.match(source, /npm(?:\.cmd)?\s+ci[^\n]*(?:--omit=dev|--production)/u);
  assert.match(source, /tools[\\/]parlant[\\/]build-windows-runtime\.ps1/u);
  assert.match(source, /tools\/wp7\/create-pre-review-trusted-product\.js/u);
  assert.match(source, /WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD\.json/u);
  assert.match(source, /PRODUCT_EXPERIENCE_MATERIALIZED_DESKTOP_UAT_ONLY/u);
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);

  const builderIndex = source.indexOf('tools/wp7/create-pre-review-trusted-product.js');
  const desktopUploadIndex = source.indexOf(DESKTOP_ARTIFACT_PREFIX);
  assert.ok(builderIndex >= 0 && desktopUploadIndex > builderIndex, 'desktop upload must occur only after the existing WP7 trusted product is built');
});

test('trusted Linux CI materializes pinned Matrix sources, builds three images, and docker-saves them before upload', () => {
  const source = read(WORKFLOW);

  assert.match(source, /runs-on:\s*ubuntu-latest/u);
  assert.match(source, /node tools\/matrix\/bootstrap\.js/u);
  assert.match(source, /\.runtime\/synapse/u);
  assert.match(source, /\.runtime\/element-web/u);
  assert.match(source, /\.runtime\/mautrix-whatsapp/u);
  assert.match(source, /docker\s+build[^\n]*\.runtime\/synapse/u);
  assert.match(source, /docker\s+build[^\n]*\.runtime\/element-web/u);
  assert.match(source, /docker\s+build[^\n]*\.runtime\/mautrix-whatsapp/u);
  assert.match(source, /modules\/yance/u);
  assert.match(source, /docker\s+save/u);
  assert.match(source, /PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY/u);
  assert.match(source, /materialized-matrix-compose\.yml/u);
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);

  const saveIndex = source.indexOf('docker save');
  const matrixUploadIndex = source.indexOf(MATRIX_ARTIFACT_PREFIX);
  assert.ok(saveIndex >= 0 && matrixUploadIndex > saveIndex, 'Matrix upload must occur only after exact candidate images are exported with docker save');
});

test('materialized candidate creator seals every file and verification fails closed on tamper, extras, duplicate identity, or path escape', () => {
  const creatorPath = absolute(CREATOR);
  assert.equal(fs.existsSync(creatorPath), true, `missing candidate creator: ${CREATOR}`);
  delete require.cache[require.resolve(creatorPath)];
  const creator = require(creatorPath);

  assert.equal(typeof creator.sealCandidateBundle, 'function');
  assert.equal(typeof creator.verifyCandidateBundle, 'function');
  assert.equal(typeof creator.MANIFEST_FILE_NAME, 'string');
  assert.equal(creator.BUNDLE_CLASSES?.DESKTOP, 'PRODUCT_EXPERIENCE_MATERIALIZED_DESKTOP_UAT_ONLY');
  assert.equal(creator.BUNDLE_CLASSES?.MATRIX, 'PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY');

  withTemporaryDirectory(root => {
    fs.mkdirSync(path.join(root, 'payload', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'payload', 'alpha.txt'), 'alpha\n');
    fs.writeFileSync(path.join(root, 'payload', 'nested', 'beta.bin'), Buffer.from([0, 1, 2, 3, 255]));

    const identity = {
      candidateBranch: 'product/v21-product-experience-shell-p0',
      candidateCommit: 'a'.repeat(40),
      candidateTree: 'b'.repeat(40)
    };
    const manifest = creator.sealCandidateBundle({
      root,
      bundleClass: creator.BUNDLE_CLASSES.DESKTOP,
      ...identity
    });

    assert.equal(manifest.bundleClass, creator.BUNDLE_CLASSES.DESKTOP);
    assert.equal(manifest.formalRelease, false);
    assert.deepEqual(
      { candidateBranch: manifest.candidateBranch, candidateCommit: manifest.candidateCommit, candidateTree: manifest.candidateTree },
      identity
    );
    assert.equal(Array.isArray(manifest.files), true);
    assert.equal(manifest.files.length, 2);
    assert.deepEqual(manifest.files.map(row => row.path), ['payload/alpha.txt', 'payload/nested/beta.bin']);
    for (const row of manifest.files) {
      assert.equal(Number.isSafeInteger(row.sizeBytes) && row.sizeBytes >= 0, true);
      assert.match(row.sha256, /^[0-9a-f]{64}$/u);
    }

    const verified = creator.verifyCandidateBundle({ root, expectedBundleClass: creator.BUNDLE_CLASSES.DESKTOP, ...identity });
    assert.equal(verified.bundleClass, creator.BUNDLE_CLASSES.DESKTOP);

    const manifestPath = path.join(root, creator.MANIFEST_FILE_NAME);
    const pristineManifest = fs.readFileSync(manifestPath, 'utf8');
    const alphaPath = path.join(root, 'payload', 'alpha.txt');
    const pristineAlpha = fs.readFileSync(alphaPath);

    fs.appendFileSync(alphaPath, 'tamper');
    assert.throws(() => creator.verifyCandidateBundle({ root, ...identity }), /hash|sha|size|tamper|mismatch/iu);
    fs.writeFileSync(alphaPath, pristineAlpha);

    fs.writeFileSync(path.join(root, 'payload', 'extra.txt'), 'unexpected\n');
    assert.throws(() => creator.verifyCandidateBundle({ root, ...identity }), /extra|unexpected|file set|manifest/iu);
    fs.rmSync(path.join(root, 'payload', 'extra.txt'));

    const duplicate = JSON.parse(pristineManifest);
    duplicate.files.push({ ...duplicate.files[0] });
    fs.writeFileSync(manifestPath, `${JSON.stringify(duplicate, null, 2)}\n`);
    assert.throws(() => creator.verifyCandidateBundle({ root, ...identity }), /duplicate|identity|manifest/iu);

    const escaping = JSON.parse(pristineManifest);
    escaping.files[0].path = '../escape.txt';
    fs.writeFileSync(manifestPath, `${JSON.stringify(escaping, null, 2)}\n`);
    assert.throws(() => creator.verifyCandidateBundle({ root, ...identity }), /path|escape|relative|manifest/iu);

    fs.writeFileSync(manifestPath, pristineManifest);
    if (process.platform !== 'win32') {
      const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.txt`);
      fs.writeFileSync(outside, 'outside\n');
      try {
        fs.symlinkSync(outside, path.join(root, 'payload', 'symlink.txt'));
        assert.throws(() => creator.verifyCandidateBundle({ root, ...identity }), /symlink|symbolic|unsupported/iu);
      } finally {
        fs.rmSync(outside, { force: true });
      }
    }

    const beta = fs.readFileSync(path.join(root, 'payload', 'nested', 'beta.bin'));
    const betaRow = manifest.files.find(row => row.path === 'payload/nested/beta.bin');
    assert.equal(betaRow.sha256, sha256(beta));
  });
});

test('Windows UAT runner is verify-only and starts an image-only Matrix compose with no user-machine build or package resolution', () => {
  const runner = read(RUNNER);
  const compose = read(COMPOSE);

  assert.match(runner, /PRODUCT_EXPERIENCE_MATERIALIZED_UAT_MANIFEST\.json/u);
  assert.match(runner, /Get-FileHash[^\n]*SHA256/u);
  assert.match(runner, /Length/u);
  assert.match(runner, /candidateBranch/u);
  assert.match(runner, /candidateCommit/u);
  assert.match(runner, /candidateTree/u);
  assert.match(runner, /PRODUCT_EXPERIENCE_MATERIALIZED_DESKTOP_UAT_ONLY/u);
  assert.match(runner, /PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY/u);
  assert.match(runner, /docker(?:\.exe)?\s+load/iu);
  assert.match(runner, /docker(?:\.exe)?\s+compose[^\n]*up[^\n]*--no-build/iu);
  assert.match(runner, /tar(?:\.exe)?[^\n]*(?:-xf|-xvf|--extract)/iu);
  assert.match(runner, /Yance\.exe/u);
  assert.match(runner, /Start-Process/u);
  assert.doesNotMatch(runner, /^\s*(?:&\s*)?(?:npm(?:\.cmd)?|pnpm|node-gyp)(?:\.cmd|\.exe)?\s+/imu);
  assert.doesNotMatch(runner, /^\s*(?:&\s*)?docker(?:\.exe)?\s+build\b/imu);
  assert.doesNotMatch(runner, /^\s*(?:&\s*)?docker(?:\.exe)?\s+compose[^\n]*\sbuild(?:\s|$)/imu);
  assert.doesNotMatch(runner, /Invoke-WebRequest|Start-BitsTransfer|git\s+clone/iu);

  for (const service of ['synapse', 'element', 'mautrix-whatsapp']) {
    assert.match(compose, new RegExp(`^\\s{2}${service}:\\s*$`, 'mu'));
  }
  assert.equal((compose.match(/^\s+image:\s+/gmu) || []).length, 3, 'image-only compose must define exactly three image authorities');
  assert.doesNotMatch(compose, /^\s+build:\s*/gmu);
  assert.doesNotMatch(compose, /^\s+context:\s*/gmu);
  assert.match(compose, /YANCE_UAT_CANDIDATE_SHA/u);
});

test('trusted desktop materialization keeps Builder-host npm separate from repository npm@10.9.2 authority', () => {
  const source = read(WORKFLOW);

  assert.match(source, /node-version:\s*['"]22\.23\.1['"]/u);
  assert.doesNotMatch(source, /unexpected Builder-host npm/u);
  assert.doesNotMatch(source, /\(npm --version\)\.Trim\(\) -ne '10\.9\.2'/u);
  assert.match(source, /npm(?:\.cmd)?\s+exec\s+--yes\s+--package=npm@10\.9\.2\s+--\s+npm\s+ci[^\n]*--omit=dev[^\n]*--ignore-scripts[^\n]*--no-bin-links[^\n]*--os=win32[^\n]*--cpu=x64/u);
  assert.doesNotMatch(source, /^\s*npm(?:\.cmd)?\s+ci\s+/mu);
});

test('trusted Linux Matrix bootstrap keeps checkout native and scopes Git CRLF semantics to strict apply children', () => {
  const source = read(WORKFLOW);
  const bootstrap = read('tools/matrix/bootstrap.js');

  const beforeIndex = source.indexOf('ambient_core_autocrlf_before=');
  const bootstrapIndex = source.lastIndexOf('node tools/matrix/bootstrap.js');
  const afterIndex = source.indexOf('ambient_core_autocrlf_after=', bootstrapIndex);
  const compareIndex = source.indexOf('ambient_core_autocrlf_after" = "$ambient_core_autocrlf_before', afterIndex);
  const cleanIndex = source.indexOf('git status --porcelain=v1 --untracked-files=all', bootstrapIndex);

  assert.ok(beforeIndex >= 0 && beforeIndex < bootstrapIndex, 'ambient Git core.autocrlf state must be captured before Matrix bootstrap');
  assert.ok(afterIndex > bootstrapIndex && compareIndex > afterIndex, 'ambient Git core.autocrlf state must be captured and compared after bootstrap');
  assert.ok(cleanIndex > compareIndex, 'root git-clean proof must follow the ambient config restoration proof');
  assert.match(source, /ambient_core_autocrlf_before="\$\(git config --show-origin --get-all core\.autocrlf \|\| true\)"/u);
  assert.match(source, /ambient_core_autocrlf_after="\$\(git config --show-origin --get-all core\.autocrlf \|\| true\)"/u);
  assert.match(source, /test "\$ambient_core_autocrlf_after" = "\$ambient_core_autocrlf_before"/u);
  assert.doesNotMatch(source, /GIT_CONFIG_COUNT=1|GIT_CONFIG_KEY_0=core\.autocrlf|GIT_CONFIG_VALUE_0=true/u);
  assert.match(bootstrap, /const isStrictGitApply = command === 'git' && args\[0\] === 'apply'/u);
  assert.match(bootstrap, /GIT_CONFIG_COUNT:\s*'1'/u);
  assert.match(bootstrap, /GIT_CONFIG_KEY_0:\s*'core\.autocrlf'/u);
  assert.match(bootstrap, /GIT_CONFIG_VALUE_0:\s*'true'/u);
  assert.match(bootstrap, /run\(repoDir, 'git', \['apply', '--check', patchPath\]\);/u);
  assert.match(bootstrap, /run\(repoDir, 'git', \['apply', patchPath\]\);/u);
  assert.match(bootstrap, /run\(element, 'git', \['apply', '--check', MODULE_DELIVERY_PATCH\]\);/u);
  assert.match(bootstrap, /run\(element, 'git', \['apply', MODULE_DELIVERY_PATCH\]\);/u);
  assert.match(bootstrap, /run\(RUNTIME, 'git', \['clone', '--no-checkout', upstream\.repository, name\]\)/u);
  assert.match(bootstrap, /run\(dir, 'git', \['fetch', 'origin', upstream\.commit, '--depth=1'\]\)/u);
  assert.match(bootstrap, /run\(dir, 'git', \['checkout', '--detach', upstream\.commit\]\)/u);
  assert.doesNotMatch(bootstrap, /git\s+config\s+(?:--global|--local)[^\n]*core\.autocrlf/u);
  assert.doesNotMatch(bootstrap, /--ignore-whitespace|--ignore-space-change|--reject|--3way|--recount|--unidiff-zero/u);
  assert.doesNotMatch(source, /git\s+config\s+(?:--global|--local)[^\n]*core\.autocrlf/u);
  assert.doesNotMatch(source, /git\s+-c\s+core\.autocrlf=true\s+checkout/u);
  assert.doesNotMatch(source, /upstream-patches\/element-web\/[0-9]{4}[^\n]*(?:checkout|sed|perl|python|dos2unix|unix2dos)/u);
  assert.doesNotMatch(source, /git\s+apply[^\n]*(?:--ignore-whitespace|--ignore-space-change|--reject|--3way|--recount|--unidiff-zero)/u);
});

test('trusted Matrix image materialization uses exact upstream Dockerfile entrypoints with repository-root contexts', () => {
  const source = read(WORKFLOW);
  assert.match(source, /docker\s+build\s+--file\s+services\/matrix\/\.runtime\/synapse\/docker\/Dockerfile\s+--tag\s+"yance-product-uat-synapse:\$\{CANDIDATE_SHA\}"\s+services\/matrix\/\.runtime\/synapse\s*$/mu);
  assert.match(source, /docker\s+build\s+--file\s+services\/matrix\/\.runtime\/element-web\/apps\/web\/Dockerfile\s+--tag\s+"yance-product-uat-element:\$\{CANDIDATE_SHA\}"\s+services\/matrix\/\.runtime\/element-web\s*$/mu);
  assert.match(source, /docker\s+build\s+--tag\s+"yance-product-uat-mautrix-whatsapp:\$\{CANDIDATE_SHA\}"\s+services\/matrix\/\.runtime\/mautrix-whatsapp\s*$/mu);
  assert.doesNotMatch(source, /docker\s+build\s+--tag\s+"yance-product-uat-(?:synapse|element):[^\n]+"\s+services\/matrix\/\.runtime\/(?:synapse|element-web)\s*$/mu);
});

test('WP0 failure-first covers WP1 nested backend tests while preserving real runtime hardcoded identity rejection', () => {
  const { execFileSync } = require('node:child_process');
  const { scanSingleHumanMaintainedReleaseSource } = require('../../tools/wp1/lib');
  const releaseSource = Object.freeze({ productVersion: '29.2.5', stageVersion: '6.4.5.9' });

  withTemporaryDirectory(root => {
    const writeFixture = (relative, value) => {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value, 'utf8');
    };
    const gitFixture = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    writeFixture('package.json', `${JSON.stringify({ name: 'fixture', version: '0.0.0-development', private: true, description: 'fixture repository' }, null, 2)}\n`);
    writeFixture('release/release-source.json', `${JSON.stringify(releaseSource, null, 2)}\n`);
    writeFixture('backend/index.js', "module.exports = 'backend';\n");
    writeFixture('backend/tests/release-identity.fixture.test.js', "const productVersion = '29.2.5';\nconst buildId = 'YANCE-29.2.5-S6.4.5.9-P1-bbbbbbbbbbbb-20260703T000000Z';\nmodule.exports = { productVersion, buildId };\n");
    gitFixture(['init', '-q']);
    gitFixture(['config', 'user.name', 'fixture']);
    gitFixture(['config', 'user.email', 'fixture@local.invalid']);
    gitFixture(['add', '.']);

    const fixtureOnly = scanSingleHumanMaintainedReleaseSource(root, releaseSource);
    assert.equal(fixtureOnly.status, 'PASS', JSON.stringify(fixtureOnly.violations));
    assert.equal(fixtureOnly.violations.some(item => item.path.startsWith('backend/tests/')), false);

    writeFixture('backend/runtime-hardcoded.js', "const buildId = 'YANCE-29.2.5-S6.4.5.9-P1-cccccccccccc-20260703T000000Z';\nmodule.exports = buildId;\n");
    gitFixture(['add', 'backend/runtime-hardcoded.js']);
    const withRuntimeViolation = scanSingleHumanMaintainedReleaseSource(root, releaseSource);
    assert.equal(withRuntimeViolation.status, 'FAIL');
    assert.ok(withRuntimeViolation.violations.some(item => item.path === 'backend/runtime-hardcoded.js' && item.reasonCode === 'WP1_RUNTIME_HARDCODED_BUILD_ID'));
    assert.equal(withRuntimeViolation.violations.some(item => item.path.startsWith('backend/tests/')), false);
  });
});

test('WP0 failure-first proves the existing SillyTavern vendor slice is packaged runtime authority', () => {
  const { createApplicationPayload, generatePayloadRecords } = require('../../tools/wp1/lib');
  const { validateProductionRuntimeSourceDependencies } = require('../../tools/wp7/runtime-source-dependency-closure');
  const expectedVendorPaths = [
    'vendor/sillytavern/1.18.0/LICENSE',
    'vendor/sillytavern/1.18.0/UPSTREAM.json',
    'vendor/sillytavern/1.18.0/src/character-card-parser.cjs',
    'vendor/sillytavern/1.18.0/src/png/encode.cjs',
    'vendor/sillytavern/1.18.0/src/prompt/prompt-composition-core.cjs',
    'vendor/sillytavern/1.18.0/src/validator/TavernCardValidator.cjs'
  ];

  withTemporaryDirectory(payloadRoot => {
    createApplicationPayload(ROOT, payloadRoot);
    const payloadPaths = new Set(generatePayloadRecords(payloadRoot).map(row => row.path));
    for (const relativePath of expectedVendorPaths) {
      assert.equal(payloadPaths.has(relativePath), true, `runtime payload must include reviewed SillyTavern authority: ${relativePath}`);
    }
  });

  const closure = validateProductionRuntimeSourceDependencies({ repoRoot: ROOT });
  assert.equal(closure.status, 'PASS');
  for (const targetPath of expectedVendorPaths.filter(relativePath => relativePath.endsWith('.cjs'))) {
    assert.ok(closure.records.some(row => row.targetPath === targetPath), `WP7 closure must recognize packaged SillyTavern source: ${targetPath}`);
  }
});

test('real Git fixture proves Matrix EOL semantics belong only to strict git apply children', () => {
  const { execFileSync } = require('node:child_process');
  const workflow = read(WORKFLOW);
  const bootstrapPath = absolute('tools/matrix/bootstrap.js');
  const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8');

  assert.doesNotMatch(
    workflow,
    /GIT_CONFIG_COUNT=1\s*\\\s*\n\s*GIT_CONFIG_KEY_0=core\.autocrlf\s*\\\s*\n\s*GIT_CONFIG_VALUE_0=true\s*\\\s*\n\s*node tools\/matrix\/bootstrap\.js/u,
    'Matrix bootstrap must not inherit CRLF conversion across clone/fetch/checkout and Docker materialization'
  );
  assert.match(bootstrapSource, /GIT_CONFIG_COUNT/u, 'bootstrap owner layer must scope Git runtime config itself');
  assert.match(bootstrapSource, /core\.autocrlf/u, 'bootstrap owner layer must opt only strict apply children into Git-native CRLF semantics');
  assert.doesNotMatch(bootstrapSource, /git\s+config\s+(?:--global|--local)[^\n]*core\.autocrlf/u);
  assert.doesNotMatch(bootstrapSource, /--ignore-whitespace|--ignore-space-change|--reject|--3way|--recount|--unidiff-zero/u);

  delete require.cache[require.resolve(bootstrapPath)];
  const matrixBootstrap = require(bootstrapPath);
  assert.equal(typeof matrixBootstrap.applyPatch, 'function', 'real fixture requires the production strict-apply seam');

  withTemporaryDirectory(root => {
    const targetPath = path.join(root, 'target.txt');
    const shellPath = path.join(root, 'keep-native.sh');
    const patchPath = path.join(root, 'change.patch');
    const gitFixture = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

    gitFixture(['init', '-q']);
    gitFixture(['config', 'user.name', 'fixture']);
    gitFixture(['config', 'user.email', 'fixture@local.invalid']);
    gitFixture(['config', 'core.autocrlf', 'false']);
    fs.writeFileSync(targetPath, Buffer.from('alpha\r\nbeta\r\n', 'utf8'));
    fs.writeFileSync(shellPath, Buffer.from('#!/usr/bin/env bash\necho keep-native\n', 'utf8'));
    if (process.platform !== 'win32') fs.chmodSync(shellPath, 0o755);
    gitFixture(['add', 'target.txt', 'keep-native.sh']);
    gitFixture(['commit', '-q', '-m', 'fixture baseline']);
    fs.writeFileSync(
      patchPath,
      'diff --git a/target.txt b/target.txt\n--- a/target.txt\n+++ b/target.txt\n@@ -1,2 +1,2 @@\n alpha\n-beta\n+gamma\n',
      'utf8'
    );

    const shellBefore = fs.readFileSync(shellPath);
    matrixBootstrap.applyPatch(root, patchPath, 'fixture CRLF target');
    assert.deepEqual(fs.readFileSync(targetPath), Buffer.from('alpha\r\ngamma\r\n', 'utf8'));
    assert.deepEqual(fs.readFileSync(shellPath), shellBefore, 'unrelated executable checkout bytes must stay byte-identical');
    assert.equal(fs.readFileSync(shellPath).includes(0x0d), false, 'unrelated shell script must remain LF-native');
  });
});

test('Product Final materializes trusted rcedit from identity-bound Git LFS custody without a live release download', () => {
  const source = read(WORKFLOW);
  const attributes = read('.gitattributes');
  const marker = '      - name: Materialize exact trusted rcedit custody input';
  const rceditStart = source.indexOf(marker);
  assert.notEqual(rceditStart, -1, 'rcedit custody step is missing');
  const rceditEnd = source.indexOf('\n      - name:', rceditStart + marker.length);
  const rceditStep = source.slice(rceditStart, rceditEnd === -1 ? undefined : rceditEnd);

  assert.doesNotMatch(
    rceditStep,
    /\b(?:Invoke-WebRequest|curl(?:\.exe)?|wget(?:\.exe)?)\b/iu,
    'rcedit custody step must not perform a live network download'
  );
  assert.match(attributes, /vendor\/rcedit\/\*\.exe\s+filter=lfs\s+diff=lfs\s+merge=lfs\s+-text/u);
  assert.match(rceditStep, /vendor\/rcedit\/rcedit-v2\.0\.0-x64\.exe/u);
  assert.match(rceditStep, /git\s+lfs\s+pull\s+origin\s+--include=/u);
  assert.match(rceditStep, /oid\s+sha256:/u);
  assert.match(rceditStep, /1360384/u);
  assert.match(rceditStep, /RCEDIT_SHA256/u);
  assert.match(rceditStep, /Get-FileHash[^\n]*SHA256/u);
});
