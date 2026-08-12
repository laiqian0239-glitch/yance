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
