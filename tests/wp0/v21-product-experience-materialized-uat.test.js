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
const SOURCE_COMPOSE = 'services/matrix/docker-compose.yml';
const HOMESERVER = 'config/matrix/synapse/homeserver.yaml';
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
  const electronStepStart = source.indexOf('- name: Materialize and verify official Windows Electron Release asset');
  const electronStepEnd = source.indexOf('\n      - name:', electronStepStart + 1);
  assert.ok(electronStepStart >= 0 && electronStepEnd > electronStepStart, 'official Electron Release materialization step must exist');
  const electronStep = source.slice(electronStepStart, electronStepEnd);
  assert.match(electronStep, /curl\.exe --fail --location/u);
  assert.match(electronStep, /\$archive\.sizeBytes/u);
  assert.match(electronStep, /Get-FileHash[^\n]*SHA256/u);
  assert.doesNotMatch(electronStep, /git lfs|git-lfs\.github\.com|HEAD:\$relativePath/u);
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
  assert.match(source, /docker compose -f "\$bundle\/materialized-matrix-compose\.yml" config/u);
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);

  const saveIndex = source.indexOf('docker save');
  const composeCopyIndex = source.indexOf('cp tools/product-experience/materialized-matrix-compose.yml "$bundle/materialized-matrix-compose.yml"');
  const composeParseIndex = source.indexOf('docker compose -f "$bundle/materialized-matrix-compose.yml" config');
  const sealIndex = source.indexOf('create-materialized-uat-candidate.js seal', composeParseIndex);
  const matrixUploadIndex = source.indexOf(MATRIX_ARTIFACT_PREFIX);
  assert.ok(
    saveIndex >= 0 && composeCopyIndex > saveIndex && composeParseIndex > composeCopyIndex && sealIndex > composeParseIndex && matrixUploadIndex > sealIndex,
    'Matrix upload must follow exact materialized compose parse and candidate seal'
  );
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
  assert.match(
    compose,
    /^x-mautrix-meta-service:\s*&mautrix-meta-service\s*\{\s*image:\s*"yance-product-uat-mautrix-meta:\$\{YANCE_UAT_CANDIDATE_SHA\}"\s*\}\s*$/mu,
    'mautrix-meta flow-mapping image interpolation must remain quoted for real Compose/YAML parsing'
  );
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

test('Product Final verifies trusted rcedit from the exact native Git blob without LFS or live materialization', () => {
  const source = read(WORKFLOW);
  const attributes = read('.gitattributes');
  const marker = '      - name: Materialize exact trusted rcedit custody input';
  const rceditStart = source.indexOf(marker);
  assert.notEqual(rceditStart, -1, 'rcedit custody step is missing');
  const rceditEnd = source.indexOf('\n      - name:', rceditStart + marker.length);
  const rceditStep = source.slice(rceditStart, rceditEnd === -1 ? undefined : rceditEnd);

  assert.match(attributes, /vendor\/rcedit\/\*\.exe\s+filter=lfs\s+diff=lfs\s+merge=lfs\s+-text/u, 'future or unreviewed rcedit binaries must remain LFS-governed');
  assert.match(attributes, /^vendor\/rcedit\/rcedit-v2\.0\.0-x64\.exe\s+-filter\s+-diff\s+-merge\s+-text$/mu, 'only the exact reviewed rcedit binary may bypass LFS filtering');
  assert.match(rceditStep, /vendor\/rcedit\/rcedit-v2\.0\.0-x64\.exe/u);
  assert.doesNotMatch(rceditStep, /\bgit\s+lfs\b|git-lfs\.github\.com/iu, 'exact reviewed rcedit custody must not depend on Git LFS materialization');
  assert.doesNotMatch(rceditStep, /\b(?:Invoke-WebRequest|Start-BitsTransfer|curl(?:\.exe)?|wget(?:\.exe)?)\b/iu, 'rcedit custody step must not perform a live network download');
  assert.doesNotMatch(rceditStep, /\b(?:npm|pnpm|yarn)\b/iu, 'rcedit custody must not use a package manager as a binary authority');
  assert.match(rceditStep, /git\s+rev-parse\s+"HEAD:\$relativePath"/u, 'rcedit custody must resolve the tracked HEAD blob identity');
  assert.match(rceditStep, /git\s+hash-object\s+--no-filters\s+--\s+\$relativePath/u, 'rcedit custody must prove worktree bytes equal the tracked native Git blob');
  assert.match(rceditStep, /1360384/u);
  assert.match(rceditStep, /RCEDIT_SHA256/u);
  assert.match(rceditStep, /Get-FileHash[^\n]*SHA256/u);
  assert.match(rceditStep, /git\s+status\s+--porcelain=v1\s+--untracked-files=all/u, 'rcedit verification must preserve a clean Product candidate tree');
});

test('WP7 archive ownership retires manual USTAR format code for exact locked node-tar PAX tooling', () => {
  const archiveSource = read('tools/wp7/deterministic-tar-gzip.js');
  const builderSource = read('tools/wp7/create-pre-review-trusted-product.js');
  const workflow = read(WORKFLOW);
  const previewRunner = read('tools/release-closure/WINDOWS_PREVIEW_UAT_RUNNER.template.ps1');

  assert.doesNotMatch(
    archiveSource,
    /\b(?:splitUstarPath|tarHeader|writeOctal)\b/u,
    'causal RED: the active WP7 archive owner still contains Yance-authored USTAR format implementation'
  );
  assert.doesNotMatch(builderSource, /NODE_USTAR_STREAM_GZIP_V2/u);
  assert.match(builderSource, /NODE_TAR_PAX_GZIP_V1/u);
  assert.match(builderSource, /archive-tool-node-modules/u);

  const archiveManifest = JSON.parse(read('tools/wp7/archive-oss/package.json'));
  const archiveLock = JSON.parse(read('tools/wp7/archive-oss/package-lock.json'));
  assert.equal(archiveManifest.private, true);
  assert.equal(archiveManifest.dependencies?.tar, '7.5.22');
  assert.equal(archiveLock.packages?.['node_modules/tar']?.version, '7.5.22');
  assert.match(String(archiveLock.packages?.['node_modules/tar']?.integrity || ''), /^sha512-/u);

  assert.match(workflow, /tools[\\/]wp7[\\/]archive-oss[\\/]package-lock\.json/u);
  assert.match(workflow, /npm(?:\.cmd)?\s+exec\s+--yes\s+--package=npm@10\.9\.2\s+--\s+npm\s+ci[^\n]*--omit=dev[^\n]*--ignore-scripts/u);
  assert.match(workflow, /--archive-tool-node-modules/u);
  assert.match(previewRunner, /tools[\\/]wp7[\\/]archive-oss[\\/]package-lock\.json/u);
  assert.match(previewRunner, /--archive-tool-node-modules/u);

  const rootPackage = JSON.parse(read('package.json'));
  assert.equal(rootPackage.dependencies?.tar, undefined);
  assert.equal(rootPackage.devDependencies?.tar, undefined);
});

test('Product Final routes the Windows startup P0 branch through both required jobs and launches exact packaged Yance.exe', () => {
  const source = read(WORKFLOW);
  const implementationBranch = 'fix/v21-product-experience-windows-uat-startup-p0';
  const escapedBranch = implementationBranch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const frozenStart = source.indexOf('  frozen-element-reproducibility:');
  const materializedStart = source.indexOf('  materialized-desktop-uat:');
  assert.ok(frozenStart >= 0 && materializedStart > frozenStart, 'required Product Final jobs must exist');
  const frozenBlock = source.slice(frozenStart, materializedStart);
  const materializedBlock = source.slice(materializedStart);

  assert.match(frozenBlock, new RegExp(escapedBranch, 'u'), 'frozen Element reproducibility must route the exact implementation branch');
  assert.match(materializedBlock, new RegExp(escapedBranch, 'u'), 'materialized desktop UAT must route the exact implementation branch');
  assert.match(materializedBlock, /Yance\.exe/u, 'Windows Product Final must launch the exact packaged executable');
  assert.match(materializedBlock, /--post-install/u, 'Windows Product Final must launch packaged Yance with post-install activation');
  assert.match(materializedBlock, /YANCE_WP2_PRODUCTION_RUNTIME_PROBE/u, 'Windows Product Final must enable the existing production runtime probe');
  assert.match(materializedBlock, /post-install-launch\.json/u, 'Windows Product Final must require the existing post-install PASS receipt');
});

test('materialized UAT GREEN is receipt-bound and fails if packaged Yance exits before readiness proof', () => {
  const runner = read(RUNNER);
  assert.match(runner, /YANCE_WP2_PRODUCTION_RUNTIME_PROBE/u, 'UAT runner must enable the production runtime path probe');
  assert.match(runner, /--post-install/u, 'UAT runner must use the post-install activation path');
  assert.match(runner, /post-install-launch\.json/u, 'UAT runner must wait for the existing post-install launch receipt');
  assert.match(runner, /HasExited/u, 'UAT runner must fail immediately when packaged Yance exits before receipt');
  assert.match(runner, /status[^\n]*PASS|PASS[^\n]*status/iu, 'UAT runner must require receipt status PASS');
  const receiptIndex = runner.indexOf('post-install-launch.json');
  const greenIndex = runner.indexOf('Write-Host "GREEN: verified same-identity materialized UAT candidate');
  assert.ok(receiptIndex >= 0 && greenIndex > receiptIndex, 'GREEN evidence must be emitted only after receipt validation');
});

test('Product Final preserves packaged startup diagnostics after a failing receipt-bound launch', () => {
  const source = read(WORKFLOW);
  const materializedStart = source.indexOf('  materialized-desktop-uat:');
  const matrixStart = source.indexOf('  materialized-matrix-uat:', materializedStart);
  assert.ok(materializedStart >= 0 && matrixStart > materializedStart, 'materialized desktop Product Final job must exist');
  const materializedBlock = source.slice(materializedStart, matrixStart);

  const launchMarker = '      - name: Launch exact packaged Yance against exact Element ModuleLoader path and require fresh PASS receipt';
  const normalUploadMarker = '      - name: Upload materialized desktop UAT';
  const launchStart = materializedBlock.indexOf(launchMarker);
  const normalUploadStart = materializedBlock.indexOf(normalUploadMarker, launchStart + launchMarker.length);
  assert.ok(launchStart >= 0 && normalUploadStart > launchStart, 'receipt-bound packaged launch and normal desktop upload steps must remain ordered');

  const postLaunch = materializedBlock.slice(launchStart + launchMarker.length, normalUploadStart);
  const pinnedUpload = /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/gu;
  const startupCapsuleUploadMarker = '      - name: Upload same-build startup capsule';
  const diagnosticUploadMarker = '      - name: Upload packaged startup diagnostics after Product Final RED';
  const startupCapsuleUploadStart = postLaunch.indexOf(startupCapsuleUploadMarker);
  const diagnosticUploadStart = postLaunch.indexOf(diagnosticUploadMarker);
  assert.ok(startupCapsuleUploadStart >= 0 && diagnosticUploadStart > startupCapsuleUploadStart, 'startup capsule and diagnostic uploads must remain distinct and ordered after packaged launch');

  const startupCapsuleStep = postLaunch.slice(startupCapsuleUploadStart, diagnosticUploadStart);
  const diagnosticStep = postLaunch.slice(diagnosticUploadStart);
  assert.equal((startupCapsuleStep.match(pinnedUpload) || []).length, 1, 'same-build startup capsule must have exactly one pinned artifact upload');
  assert.equal((diagnosticStep.match(pinnedUpload) || []).length, 1, 'Product Final must keep exactly one pinned diagnostics artifact after the startup capsule');

  assert.match(startupCapsuleStep, /Product-Experience-Startup-Capsule-\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/u);
  assert.match(startupCapsuleStep, /\$\{\{\s*runner\.temp\s*\}\}[\\/]product-experience-startup-capsule[\\/]startup-capsule[\\/]\*\*/u);
  assert.match(startupCapsuleStep, /if-no-files-found:\s*error/u, 'startup capsule upload must fail closed when its payload is missing');
  assert.doesNotMatch(startupCapsuleStep, /if:\s*\$\{\{\s*always\(\)\s*\}\}/u, 'startup capsule is a validated evidence artifact, not a failure-only diagnostic upload');

  assert.match(diagnosticStep, /if:\s*\$\{\{\s*always\(\)\s*\}\}/u, 'diagnostic upload must execute after a failing packaged launch');
  assert.match(diagnosticStep, /uses:\s*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(diagnosticStep, /\$\{\{\s*runner\.temp\s*\}\}[\\/]product-uat-packaged-data[\\/]logs[\\/]desktop-bootstrap\.jsonl/u);
  assert.match(diagnosticStep, /\$\{\{\s*runner\.temp\s*\}\}[\\/]product-uat-packaged-data[\\/]logs[\\/]desktop\.jsonl/u);
  assert.match(diagnosticStep, /\$\{\{\s*runner\.temp\s*\}\}[\\/]product-uat-packaged-data[\\/]logs[\\/]server\.jsonl/u);
  assert.equal((diagnosticStep.match(/\.jsonl/gu) || []).length, 3, 'diagnostic artifact must preserve exactly the three authorized internal logs');
  assert.match(diagnosticStep, /if-no-files-found:\s*warn/u, 'diagnostic upload must tolerate logs that do not yet exist');
  assert.doesNotMatch(diagnosticStep, /post-install-launch\.json|product-experience-materialized-desktop-uat[\\/]\*\*/u, 'diagnostic artifact must not become a readiness receipt or broad payload authority');
});

test('failure-first binds complete materialized Matrix runtime topology, ephemeral secrets, and pre-Desktop readiness', () => {
  const source = read(WORKFLOW);
  const runner = read(RUNNER);
  const compose = read(COMPOSE);
  const homeserver = read(HOMESERVER);

  assert.match(source, /\.runtime\/mautrix-meta/u, 'trusted Matrix materialization must include the pinned mautrix-meta source');
  assert.match(source, /docker\s+build[^\n]*yance-product-uat-mautrix-meta:\$\{CANDIDATE_SHA\}[^\n]*\.runtime\/mautrix-meta/u, 'trusted CI must build the exact mautrix-meta image');
  assert.match(source, /docker\s+save[\s\S]*yance-product-uat-mautrix-meta:\$\{CANDIDATE_SHA\}/u, 'sealed Matrix image archive must include mautrix-meta');
  assert.match(source, /config\/matrix\/mautrix-meta\/config\.yaml/u, 'sealed Matrix artifact must include the existing mautrix-meta config authority');
  assert.match(source, /matrix-config\/mautrix-meta\/config\.yaml/u, 'sealed Matrix artifact must project mautrix-meta config into its image-only topology');

  for (const service of ['mautrix-meta-registration', 'synapse', 'element', 'mautrix-whatsapp', 'mautrix-meta']) {
    assert.match(compose, new RegExp(`^\\s{2}${service}:\\s*$`, 'mu'), `materialized compose must preserve source Matrix service ${service}`);
  }
  // Runtime secrets are projected, not bind-mounted: the host secret is readable
  // only by the root matrix-secret-projection init, which writes a UID-owned file
  // into a named volume that every consumer mounts read-only at /run/secrets.
  assert.match(compose, /^\s{2}matrix-secret-projection:\s*$/mu, 'root secret projection init must exist');
  assert.match(compose, /user:\s*"0:0"/u, 'secret projection must run as root');
  assert.match(compose, /YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE:\?required/u);
  assert.match(compose, /YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE:\?required/u);
  assert.match(compose, /target:\s*\/bootstrap\/matrix-registration-shared-secret/u);
  assert.match(compose, /target:\s*\/bootstrap\/mautrix-meta-provisioning-secret/u);

  // projection produces the exact named-volume targets with owner-only modes
  assert.match(compose, /synapse-secret-data:\/projected\/matrix/u);
  assert.match(compose, /mautrix-meta-secret-data:\/projected\/meta/u);
  assert.match(compose, /cp \/bootstrap\/matrix-registration-shared-secret \/projected\/matrix\/yance_matrix_registration_shared_secret/u);
  assert.match(compose, /chown 991:991 \/projected\/matrix\/yance_matrix_registration_shared_secret/u);
  assert.match(compose, /chmod 0400 \/projected\/matrix\/yance_matrix_registration_shared_secret/u);
  assert.match(compose, /cp \/bootstrap\/mautrix-meta-provisioning-secret \/projected\/meta\/yance_mautrix_meta_provisioning_secret/u);
  assert.match(compose, /chown 1337:1337 \/projected\/meta\/yance_mautrix_meta_provisioning_secret/u);
  assert.match(compose, /chmod 0400 \/projected\/meta\/yance_mautrix_meta_provisioning_secret/u);

  // projected secret named volumes are declared and mounted read-only by consumers
  assert.match(compose, /^\s{2}synapse-secret-data:$/mu);
  assert.match(compose, /^\s{2}mautrix-meta-secret-data:$/mu);
  assert.match(compose, /synapse-secret-data:\/run\/secrets:ro/u);
  assert.match(compose, /mautrix-meta-secret-data:\/run\/secrets:ro/u);

  // Synapse consumes the exact projected path from its own config authority
  assert.match(homeserver, /registration_shared_secret_path:\s*\/run\/secrets\/yance_matrix_registration_shared_secret/u);
  // mautrix-meta keeps its locked _FILE env pointing at the exact projected path
  assert.match(compose, /YANCE_MAUTRIX_META_PROVISIONING__SHARED_SECRET_FILE:\s*\/run\/secrets\/yance_mautrix_meta_provisioning_secret/u);
  // consumers must start only after the projection init completed successfully
  assert.match(compose, /condition:\s*service_completed_successfully/u);
  assert.doesNotMatch(
    compose,
    /\/run\/secrets\/yance_matrix_registration_shared_secret/u,
    'Synapse registration secret must reach Synapse through the projected named volume, never a direct host-file consumer bind'
  );
  assert.match(compose, /mautrix-meta-data/u);
  assert.match(compose, /matrix-config\/mautrix-meta\/config\.yaml/u);
  assert.doesNotMatch(compose, /^\s+build:\s*/gmu);
  assert.doesNotMatch(compose, /^\s+context:\s*/gmu);

  assert.match(runner, /RandomNumberGenerator/iu, 'Windows UAT must create cryptographically random per-UAT secrets');
  assert.match(runner, /YANCE_MATRIX_REGISTRATION_SHARED_SECRET_FILE/u);
  assert.match(runner, /YANCE_MAUTRIX_META_PROVISIONING_SECRET_FILE/u);
  assert.match(runner, /_matrix\/client\/versions/u, 'Windows UAT must prove real Synapse HTTP readiness');
  assert.match(runner, /docker(?:\.exe)?\s+compose[^\n]*ps/iu, 'Windows UAT must prove required Matrix containers are actually running');
  const readinessIndex = runner.indexOf('_matrix/client/versions');
  const desktopLaunchIndex = runner.indexOf('$process = Start-Process -FilePath $yanceExe.FullName');
  assert.ok(readinessIndex >= 0 && desktopLaunchIndex > readinessIndex, 'real Matrix readiness must be established before packaged Desktop launch');
  assert.doesNotMatch(runner, /materialized-uat-evidence\.json[^\n]*(?:secret|shared_secret)/iu, 'plaintext secrets must never become evidence authority');
});

test('Matrix runtime state stays writable, registers WhatsApp, and isolates every real Windows UAT project', () => {
  const sourceCompose = read(SOURCE_COMPOSE);
  const materializedCompose = read(COMPOSE);
  const homeserver = read(HOMESERVER);
  const runner = read(RUNNER);
  const workflow = read(WORKFLOW);

  for (const compose of [sourceCompose, materializedCompose]) {
    assert.match(compose, /^\s{2}synapse-data-init:\s*$/mu);
    assert.match(compose, /chown -R 991:991 \/data/u);
    assert.match(compose, /^\s{2}mautrix-whatsapp-registration:\s*$/mu);
    assert.match(compose, /\/usr\/bin\/mautrix-whatsapp -g -c \/data\/config\.yaml -r \/data\/registration\.yaml/u);
    assert.match(compose, /mautrix-whatsapp-data:\/data/u);
    assert.match(compose, /mautrix-whatsapp-data:\/mautrix-whatsapp:ro/u);
    assert.doesNotMatch(compose, /mautrix-whatsapp\/config\.yaml:\/data\/config\.yaml:ro/u);
  }
  assert.match(homeserver, /\/mautrix-meta\/registration\.yaml/u);
  assert.match(homeserver, /\/mautrix-whatsapp\/registration\.yaml/u);

  assert.match(runner, /\$matrixProjectName = "yance-uat-/u);
  assert.match(runner, /--project-name \$matrixProjectName/u);
  assert.match(runner, /down --volumes --remove-orphans/u);
  for (const service of ['synapse-data-init', 'mautrix-meta-registration', 'mautrix-whatsapp-registration']) {
    assert.match(runner, new RegExp(service, 'u'));
  }

  const parseIndex = workflow.indexOf('docker compose -f "$bundle/materialized-matrix-compose.yml" config');
  const smokeIndex = workflow.indexOf('docker compose --project-name "$project" --project-directory "$bundle" -f "$bundle/materialized-matrix-compose.yml" up -d --no-build');
  const synapseReadyIndex = workflow.indexOf('http://127.0.0.1:8008/_matrix/client/versions');
  const elementReadyIndex = workflow.indexOf('http://127.0.0.1:8080/config.json');
  const sealIndex = workflow.indexOf('create-materialized-uat-candidate.js seal', parseIndex);
  assert.ok(parseIndex >= 0 && smokeIndex > parseIndex && synapseReadyIndex > smokeIndex && elementReadyIndex > smokeIndex && sealIndex > synapseReadyIndex && sealIndex > elementReadyIndex);
});

test('auth entry requires Element login_for_welcome and does not bypass the registered Yance V2 login', () => {
  const config = JSON.parse(read('config/matrix/element-config.json'));
  const homeserver = read('config/matrix/synapse/homeserver.yaml');
  assert.match(
    homeserver,
    /^enable_registration:\s*false\s*$/mu,
    'Synapse production config must keep registration disabled'
  );
  assert.equal(
    config.setting_defaults && config.setting_defaults['UIFeature.registration'],
    false,
    'materialized UAT auth entry must pin Element registration UI off'
  );
  assert.equal(
    config.embedded_pages && config.embedded_pages.login_for_welcome,
    true,
    'shipped element-config.json must enable login_for_welcome'
  );
  assert.notEqual(
    config.setting_defaults && config.setting_defaults['UIFeature.passwordReset'],
    false,
    'password reset must not be disabled by the registration policy binding'
  );

  const workflow = read(WORKFLOW);
  const runner = read(RUNNER);
  // Windows Product Final must assert the generated config enables login_for_welcome before launch.
  assert.match(workflow, /login_for_welcome[^\n]*'true'/u);
  // The generated runtime config must mount the Yance V2 module.
  assert.match(workflow, /\/modules\/yance\/lib\/index\.js/u);
  assert.match(
    workflow,
    /Copy-Item\s+-LiteralPath\s+\$moduleLib\s+-Destination\s+\$servedModuleRoot\s+-Recurse\s+-Force/u,
    'Product Final must copy the built lib directory under modules/yance'
  );
  assert.match(
    workflow,
    /\$builtModulePath\s*=\s*Join-Path\s+\$servedModuleRoot\s+'lib\\index\.js'/u,
    'Product Final must validate the served lib entrypoint'
  );
  assert.doesNotMatch(
    workflow,
    /\$builtModulePath\s*=\s*Join-Path\s+\$servedModuleRoot\s+'index\.js'/u,
    'Product Final must not validate a parent-level index.js that the projection never serves'
  );
  // The built module must carry the stable V2 authority marker.
  assert.match(
    workflow,
    /Select-String\s+-Path\s+\$builtModulePath\s+-Pattern\s+'data-yance-login-authority'\s+-Quiet/u
  );
});

test('sealed Element image and runtime config carry the stable Yance V2 login authority marker', () => {
  const workflow = read(WORKFLOW);
  // Sealed image V2 inspection before artifact seal/upload.
  assert.match(workflow, /docker run[^\n]*yance-product-uat-element:\$\{CANDIDATE_SHA\}[^\n]*data-yance-login-authority/u);
  // Runtime config.json fail-closed before seal.
  assert.match(workflow, /login_for_welcome\s*!==\s*true/u);
  assert.match(workflow, /modules[^\n]*\/modules\/yance\/lib\/index\.js/u);
});

test('Windows UAT runner and Product Final use the approved direct DateTime/DateTimeOffset absolute-time path', () => {
  const runner = read(RUNNER);
  const workflow = read(WORKFLOW);
  // The lossy string round-trip must be gone everywhere.
  assert.doesNotMatch(runner, /\[DateTimeOffset\]::Parse\(\[string\]\$candidateReceipt\.activatedAtUtc\)/u);
  assert.doesNotMatch(workflow, /\[DateTimeOffset\]::Parse\(\[string\]\$candidateReceipt\.activatedAtUtc\)/u);
  // Both must use the direct cast.
  assert.match(runner, /\[DateTimeOffset\]\$candidateReceipt\.activatedAtUtc/u);
  assert.match(workflow, /\[DateTimeOffset\]\$candidateReceipt\.activatedAtUtc/u);
});

test('UTC freshness regression: direct cast classifies the frozen activated timestamp as fresh on this host', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    $receipt = '{"activatedAtUtc":"2026-08-31T15:00:56.011Z"}' | ConvertFrom-Json
    $activatedAt = [DateTimeOffset]$receipt.activatedAtUtc
    $startedAt = [DateTimeOffset]::Parse('2026-08-31T15:00:28.7635157+00:00')
    [string]$activatedZ = $activatedAt.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    [string]$isFresh = ($activatedAt -gt $startedAt).ToString()
    Write-Output "ACTIVATED=$activatedZ"
    Write-Output "FRESH=$isFresh"
  `;
  let out;
  try {
    out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  } catch {
    return; // Skip when PowerShell is unavailable; the dedicated UTC regression step owns the host proof.
  }
  assert.match(out, /ACTIVATED=2026-08-31T15:00:56\.011Z/u);
  assert.match(out, /FRESH=True/u);
});
