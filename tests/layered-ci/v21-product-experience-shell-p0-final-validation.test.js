'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW = '.github/workflows/v21-product-experience-shell-p0-final-validation.yml';
const workflowPath = path.join(ROOT, ...WORKFLOW.split('/'));

function readWorkflow() {
  assert.equal(fs.existsSync(workflowPath), true, `missing Product Experience final-validation workflow: ${WORKFLOW}`);
  return fs.readFileSync(workflowPath, 'utf8');
}

test('Product Experience final validation is a dedicated exact-head Windows pull-request workflow', () => {
  const source = readWorkflow();
  assert.match(source, /^name:\s*V21 Product Experience Shell P0 Final Validation\s*$/mu);
  assert.match(source, /^on:\s*\n\s*pull_request:\s*$/mu);
  assert.doesNotMatch(source, /^\s*(workflow_dispatch|push|schedule):/mu);
  assert.match(source, /runs-on:\s*windows-latest/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-experience-shell-p0'/u);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/u);
  assert.match(source, /fetch-depth:\s*0/u);
  assert.match(source, /persist-credentials:\s*false/u);
  assert.match(source, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u);
  assert.match(source, /node-version:\s*['"]22\.23\.1['"]/u);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
});

test('Task 9 runs two clean pinned Element materializations with pnpm 11.5.2 frozen build and typecheck', () => {
  const source = readWorkflow();
  assert.match(source, /corepack prepare pnpm@11\.5\.2 --activate/u);
  assert.match(source, /foreach\s*\(\$iteration\s+in\s+1\.\.2\)/u);
  assert.match(source, /Remove-Item[^\n]*services[\\/]matrix[\\/]\.runtime/u);
  assert.match(source, /node tools\/matrix\/bootstrap\.js/u);
  assert.match(source, /a2a996ae50d802878bf48e4bbf3730004bdcc55c/u);
  assert.match(source, /pnpm --dir \$element install --frozen-lockfile/u);
  assert.match(source, /pnpm --dir \$element exec nx build yance-element-module/u);
  assert.match(source, /pnpm --dir \$element exec nx run yance-element-module:lint:types/u);
  assert.match(source, /Get-FileHash[^\n]*pnpm-lock\.yaml[^\n]*SHA256/u);
  assert.match(source, /Get-FileHash[^\n]*modules[\\/]yance[\\/]package\.json[^\n]*SHA256/u);
  assert.match(source, /lockSha256/u);
  assert.match(source, /packageSha256/u);
  assert.match(source, /reproducibility mismatch/u);
  assert.doesNotMatch(source, /pnpm\s+(install|add|update)[^\n]*--no-frozen-lockfile/u);
  assert.doesNotMatch(source, /pnpm\s+install[^\n]*--lockfile-only/u);
});

test('every pnpm shim invocation launches from neutral RUNNER_TEMP while --dir still targets Element', () => {
  const source = readWorkflow();
  assert.match(source, /Push-Location \$env:RUNNER_TEMP\s*\n\s*try \{\s*\n\s*\$actualPnpm = \(pnpm --version\)\.Trim\(\)\s*\n\s*\} finally \{\s*\n\s*Pop-Location\s*\n\s*\}/u);
  assert.match(source, /Push-Location \$env:RUNNER_TEMP\s*\n\s*try \{[\s\S]*?pnpm --dir \$element install --frozen-lockfile[\s\S]*?pnpm --dir \$element exec nx build yance-element-module[\s\S]*?pnpm --dir \$element exec nx run yance-element-module:lint:types[\s\S]*?\} finally \{\s*\n\s*Pop-Location\s*\n\s*\}/u);
  assert.equal((source.match(/Push-Location \$env:RUNNER_TEMP/gu) || []).length, 2);
  assert.match(source, /PNPM_VERSION:\s*11\.5\.2/u);
  assert.doesNotMatch(source, /packageManager[^\n]*pnpm/u);
  assert.doesNotMatch(source, /--no-frozen-lockfile|--lockfile-only/u);
});

test('Task 9 gives each frozen Element install a clean iteration-scoped RUNNER_TEMP pnpm store', () => {
  const source = readWorkflow();
  assert.match(source, /\$pnpmStore = Join-Path \$env:RUNNER_TEMP "product-experience-pnpm-store-\$iteration"/u);
  assert.match(source, /Remove-Item -Recurse -Force -ErrorAction SilentlyContinue \$pnpmStore/u);
  assert.match(source, /pnpm --dir \$element install --frozen-lockfile --store-dir \$pnpmStore/u);
  assert.doesNotMatch(source, /pnpm[^\n]*--force/u);
  assert.doesNotMatch(source, /strictStorePkgContentCheck\s*=\s*false|strict-store-pkg-content-check(?:=|\s+)false/u);
  assert.doesNotMatch(source, /verifyStoreIntegrity\s*=\s*false|verify-store-integrity(?:=|\s+)false/u);
});

test('Product final validation materializes and verifies the trusted Windows Electron LFS object before UAT packaging', () => {
  const source = readWorkflow();
  const lfsPullIndex = source.indexOf('git lfs pull');
  const packageIndex = source.indexOf('create-round12-13-windows-uat-package.js');
  assert.ok(lfsPullIndex >= 0, 'trusted Windows Electron LFS object must be materialized explicitly');
  assert.ok(packageIndex > lfsPullIndex, 'LFS materialization and verification must happen before UAT packaging');
  assert.match(source, /release[\\/]electron-distribution-trust\.json/u);
  assert.match(source, /git lfs install --local/u);
  assert.match(source, /git lfs pull origin --include=/u);
  assert.match(source, /git show "HEAD:\$relativePath"/u);
  assert.match(source, /oid sha256:/u);
  assert.match(source, /Get-FileHash[^\n]*SHA256/u);
  assert.match(source, /Get-Item[^\n]*Length/u);
  assert.match(source, /git status --porcelain=v1 --untracked-files=all/u);
  assert.doesNotMatch(source, /Invoke-WebRequest|Start-BitsTransfer|windows-side.*download|electron.*download fallback/iu);
});

test('PowerShell loop diagnostics delimit iteration before colon punctuation', () => {
  const source = readWorkflow();
  assert.doesNotMatch(source, /iteration \$iteration:/u);
  assert.match(source, /Element pin mismatch on iteration \$\{iteration\}: expected=\$env:ELEMENT_COMMIT actual=\$actualElementCommit/u);
});

test('the workflow prepares a non-release exact-head UAT package without claiming real Electron UAT', () => {
  const source = readWorkflow();
  assert.match(source, /create-round12-13-windows-uat-package\.js/u);
  assert.match(source, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(source, /NOT_REAL_ELECTRON_UAT/u);
  assert.match(source, /ROUND12_13_UAT_MANIFEST\.json/u);
  assert.match(source, /formalRelease[^\n]*false/u);
  assert.match(source, /realWindowsUatRequired[^\n]*true/u);
  assert.doesNotMatch(source, /docs\/uat\/V21_PRODUCT_EXPERIENCE_SHELL_P0_UAT\.md/u);
  assert.doesNotMatch(source, /continue-on-error:\s*true/u);
  assert.doesNotMatch(source, /windows-production-release|gh\s+release|npm\s+publish/u);
});
