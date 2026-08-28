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

test('Product Experience final validation is an exact-head same-repository pull-request workflow with Windows and Linux trusted-CI materializers', () => {
  const source = readWorkflow();
  assert.match(source, /^name:\s*V21 Product Experience Shell P0 Final Validation\s*$/mu);
  assert.match(source, /^on:\s*\n\s*pull_request:\s*$/mu);
  assert.doesNotMatch(source, /^\s*(workflow_dispatch|push|schedule):/mu);
  assert.match(source, /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-experience-shell-p0'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-experience-bilingual-search-translation-task-ux-p0'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-prelaunch-relationship-tool-portal-route-closure-successor-p0'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-prelaunch-dating-ai-experience-amendment-wp1'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-prelaunch-dating-ai-experience-amendment-wp1-v3'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'fix\/v21-product-experience-windows-uat-startup-p0'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'fix\/v21-product-experience-windows-uat-startup-p0-amendment-1-v2'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'fix\/v21-product-experience-windows-uat-startup-p0-amendment-2'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'product\/v21-product-system-settings-reachability-p1-successor-v2-amendment-1'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'fix\/v21-electron-supported-runtime-p0-production-amendment-5'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v2'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v3'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v4'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v5'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v6'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v7'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v8'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v9'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'release\/v21-final-rc-uat-p0-successor-v10'/u);
  assert.match(source, /github\.event\.pull_request\.head\.ref\s*==\s*'fix\/v21-final-rc-materialized-matrix-uat-runtime-closure-p0'/u);
  const allowedBranches = new Set([...source.matchAll(/github\.event\.pull_request\.head\.ref\s*==\s*'([^']+)'/gu)].map((match) => match[1]));
  assert.deepEqual([...allowedBranches].sort(), [
    'product/v21-product-experience-bilingual-search-translation-task-ux-p0',
    'product/v21-product-experience-shell-p0',
    'product/v21-product-prelaunch-dating-ai-experience-amendment-wp1',
    'product/v21-product-prelaunch-dating-ai-experience-amendment-wp1-v3',
    'product/v21-product-prelaunch-relationship-tool-portal-route-closure-successor-p0',
    'product/v21-product-system-settings-reachability-p1-successor-v2-amendment-1',
    'fix/v21-electron-supported-runtime-p0-production-amendment-5',
    'fix/v21-final-rc-materialized-matrix-uat-runtime-closure-p0',
    'fix/v21-product-experience-windows-uat-startup-p0',
    'fix/v21-product-experience-windows-uat-startup-p0-amendment-1-v2',
    'fix/v21-product-experience-windows-uat-startup-p0-amendment-2',
    'release/v21-final-rc-uat-p0',
    'release/v21-final-rc-uat-p0-successor-v2',
    'release/v21-final-rc-uat-p0-successor-v3',
    'release/v21-final-rc-uat-p0-successor-v4',
    'release/v21-final-rc-uat-p0-successor-v5',
    'release/v21-final-rc-uat-p0-successor-v6',
    'release/v21-final-rc-uat-p0-successor-v7',
    'release/v21-final-rc-uat-p0-successor-v8',
    'release/v21-final-rc-uat-p0-successor-v9',
    'release/v21-final-rc-uat-p0-successor-v10'
  ].sort());
  assert.doesNotMatch(source, /github\.event\.pull_request\.head\.ref[\s\S]{0,80}(?:startsWith|contains|matches)/u);
  assert.match(source, /runs-on:\s*windows-latest/u);
  assert.match(source, /runs-on:\s*ubuntu-latest/u);
  assert.match(source, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u);
  assert.match(source, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/u);
  assert.match(source, /fetch-depth:\s*0/u);
  assert.match(source, /persist-credentials:\s*false/u);
  assert.match(source, /actions\/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/u);
  assert.match(source, /node-version:\s*['"]22\.23\.1['"]/u);
  assert.match(source, /permissions:\s*\n\s*contents:\s*read/u);
  assert.doesNotMatch(source, /continue-on-error:\s*true/u);
});

test('Task 9 still runs two clean pinned Element materializations with pnpm 11.5.2 frozen build and typecheck', () => {
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

test('Task 9 and packaged Element pnpm shims launch from exactly three neutral RUNNER_TEMP phases while --dir stays pinned', () => {
  const source = readWorkflow();
  assert.match(source, /Push-Location \$env:RUNNER_TEMP[\s\S]*?\$actualPnpm = \(pnpm --version\)\.Trim\(\)[\s\S]*?Pop-Location/u);
  assert.match(source, /Push-Location \$env:RUNNER_TEMP[\s\S]*?pnpm --dir \$element install --frozen-lockfile[\s\S]*?pnpm --dir \$element exec nx build yance-element-module[\s\S]*?pnpm --dir \$element exec nx run yance-element-module:lint:types[\s\S]*?Pop-Location/u);
  const packagedStepStart = source.indexOf('- name: Launch exact packaged Yance against exact Element ModuleLoader path and require fresh PASS receipt');
  const packagedStepEnd = source.indexOf('\n      - name:', packagedStepStart + 1);
  assert.ok(packagedStepStart >= 0 && packagedStepEnd > packagedStepStart, 'packaged Yance/Element validation step must exist');
  const packagedStep = source.slice(packagedStepStart, packagedStepEnd);
  assert.match(packagedStep, /Push-Location \$env:RUNNER_TEMP[\s\S]*?\$pnpmVersionLines = @\(pnpm --version\)[\s\S]*?IsNullOrWhiteSpace\(\$actualPnpm\)[\s\S]*?pnpm --dir \$element install --frozen-lockfile --store-dir \$pnpmStore[\s\S]*?pnpm --dir \$element exec nx build yance-element-module[\s\S]*?pnpm --dir \(Join-Path \$element 'apps\/web'\) build[\s\S]*?Pop-Location/u);
  assert.equal((source.match(/Push-Location \$env:RUNNER_TEMP/gu) || []).length, 3);
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

test('trusted Windows CI keeps Builder-host npm separate and uses exact npm@10.9.2 for reviewed production dependency materialization before WP7', () => {
  const source = readWorkflow();
  const electronStepStart = source.indexOf('- name: Materialize and verify official Windows Electron Release asset');
  const electronStepEnd = source.indexOf('\n      - name:', electronStepStart + 1);
  const exactNpmIndex = source.indexOf('npm.cmd exec --yes --package=npm@10.9.2 -- npm ci');
  const builderIndex = source.indexOf('tools/wp7/create-pre-review-trusted-product.js');
  const uploadIndex = source.indexOf('Product-Experience-Materialized-Desktop-UAT-');
  assert.ok(electronStepStart >= 0 && electronStepEnd > electronStepStart, 'official Electron Release step must exist');
  assert.ok(exactNpmIndex > electronStepEnd && builderIndex > exactNpmIndex && uploadIndex > builderIndex);
  const electronStep = source.slice(electronStepStart, electronStepEnd);
  assert.match(source, /release[\\/]electron-distribution-trust\.json/u);
  assert.match(electronStep, /\$archive\.sourceRepository/u);
  assert.match(electronStep, /\$archive\.releaseTag/u);
  assert.match(electronStep, /\$archive\.assetId/u);
  assert.match(electronStep, /\$archive\.downloadUrl/u);
  assert.match(electronStep, /\$archive\.sizeBytes/u);
  assert.match(electronStep, /curl\.exe --fail --location/u);
  assert.match(electronStep, /Get-FileHash[^\n]*SHA256/u);
  assert.doesNotMatch(electronStep, /git lfs|git show "HEAD:\$relativePath"|git-lfs\.github\.com|oid sha256:/u);
  assert.match(source, /node-version:\s*['"]22\.23\.1['"]/u);
  assert.doesNotMatch(source, /unexpected Builder-host npm/u);
  assert.doesNotMatch(source, /\(npm --version\)\.Trim\(\) -ne '10\.9\.2'/u);
  assert.match(source, /npm\.cmd exec --yes --package=npm@10\.9\.2 -- npm ci --omit=dev --ignore-scripts[^\n]*--no-bin-links --os=win32 --cpu=x64/u);
  assert.doesNotMatch(source, /^\s*npm(?:\.cmd)?\s+ci\s+/mu);
  assert.match(source, /node-v22\.23\.1-win-x64\.zip/u);
  assert.match(source, /7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29/u);
  assert.match(source, /f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed/u);
  assert.match(source, /tools\/parlant\/build-windows-runtime\.ps1/u);
  assert.match(source, /rcedit-v2\.0\.0-x64\.exe/u);
  assert.match(source, /3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a/u);
  assert.match(source, /WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD\.json/u);
  assert.match(source, /PRODUCT_EXPERIENCE_MATERIALIZED_DESKTOP_UAT_ONLY/u);
});

test('trusted Linux CI delegates CRLF apply semantics to Matrix bootstrap, then builds, docker-saves and seals image-only UAT', () => {
  const source = readWorkflow();
  const beforeIndex = source.indexOf('ambient_core_autocrlf_before=');
  const bootstrapIndex = source.lastIndexOf('node tools/matrix/bootstrap.js');
  const afterIndex = source.indexOf('ambient_core_autocrlf_after=', bootstrapIndex);
  const compareIndex = source.indexOf('test "$ambient_core_autocrlf_after" = "$ambient_core_autocrlf_before"', afterIndex);
  const firstBuildIndex = source.indexOf('docker build', bootstrapIndex);
  const saveIndex = source.indexOf('docker save');
  const uploadIndex = source.indexOf('Product-Experience-Materialized-Matrix-UAT-');
  const cleanIndex = source.indexOf('git status --porcelain=v1 --untracked-files=all', afterIndex);

  assert.ok(beforeIndex >= 0 && beforeIndex < bootstrapIndex);
  assert.ok(afterIndex > bootstrapIndex && compareIndex > afterIndex);
  assert.ok(firstBuildIndex > compareIndex && saveIndex > firstBuildIndex && cleanIndex > compareIndex && uploadIndex > saveIndex);
  assert.match(source, /ambient_core_autocrlf_before="\$\(git config --show-origin --get-all core\.autocrlf \|\| true\)"/u);
  assert.match(source, /ambient_core_autocrlf_after="\$\(git config --show-origin --get-all core\.autocrlf \|\| true\)"/u);
  assert.match(source, /test "\$ambient_core_autocrlf_after" = "\$ambient_core_autocrlf_before"/u);
  assert.doesNotMatch(source, /GIT_CONFIG_COUNT=1|GIT_CONFIG_KEY_0=core\.autocrlf|GIT_CONFIG_VALUE_0=true/u);
  assert.doesNotMatch(source, /git\s+config\s+(?:--global|--local)[^\n]*core\.autocrlf/u);
  assert.doesNotMatch(source, /git\s+-c\s+core\.autocrlf=true\s+checkout/u);
  assert.doesNotMatch(source, /upstream-patches\/element-web\/[0-9]{4}[^\n]*(?:checkout|sed|perl|python|dos2unix|unix2dos)/u);
  assert.doesNotMatch(source, /git\s+apply[^\n]*(?:--ignore-whitespace|--ignore-space-change|--reject|--3way|--recount|--unidiff-zero)/u);
  assert.match(source, /services\/matrix\/\.runtime\/synapse/u);
  assert.match(source, /services\/matrix\/\.runtime\/element-web/u);
  assert.match(source, /services\/matrix\/\.runtime\/mautrix-whatsapp/u);
  assert.match(source, /services\/matrix\/\.runtime\/mautrix-meta/u);
  assert.match(source, /nx build yance-element-module/u);
  assert.match(source, /\/modules\/yance\/package\.json/u);
  assert.match(source, /docker build --file services\/matrix\/\.runtime\/synapse\/docker\/Dockerfile --tag "yance-product-uat-synapse:\$\{CANDIDATE_SHA\}" services\/matrix\/\.runtime\/synapse/u);
  assert.match(source, /docker build --file services\/matrix\/\.runtime\/element-web\/apps\/web\/Dockerfile --tag "yance-product-uat-element:\$\{CANDIDATE_SHA\}" services\/matrix\/\.runtime\/element-web/u);
  assert.match(source, /docker build --tag "yance-product-uat-mautrix-whatsapp:\$\{CANDIDATE_SHA\}" services\/matrix\/\.runtime\/mautrix-whatsapp/u);
  assert.match(source, /docker build --tag "yance-product-uat-mautrix-meta:\$\{CANDIDATE_SHA\}" services\/matrix\/\.runtime\/mautrix-meta/u);
  assert.equal((source.match(/docker build(?: --file \S+)? --tag/gu) || []).length, 4);
  assert.match(source, /docker save --output/u);
  assert.match(source, /materialized-matrix-compose\.yml/u);
  assert.match(source, /PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY/u);
});

test('Product final validation keeps exactly two materialized UAT artifacts plus one startup capsule and permits only the authorized packaged-startup diagnostic artifact', () => {
  const source = readWorkflow();
  assert.doesNotMatch(source, /create-round12-13-windows-uat-package\.js/u);
  assert.doesNotMatch(source, /start-source-uat\.js/u);
  assert.doesNotMatch(source, /NOT_REAL_ELECTRON_UAT/u);
  assert.doesNotMatch(source, /ROUND12_13_UAT_MANIFEST\.json/u);

  const pinnedUploadCount = (source.match(/actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/gu) || []).length;
  const capsuleNames = source.match(/name: Product-Experience-Startup-Capsule-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/gu) || [];
  const diagnosticNames = source.match(/name: Product-Experience-Packaged-Startup-Diagnostics-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/gu) || [];
  assert.equal(capsuleNames.length, 1, 'exactly one same-build startup-capsule artifact must exist');
  assert.ok(diagnosticNames.length === 0 || diagnosticNames.length === 1, 'only one authorized packaged-startup diagnostic artifact may exist');
  assert.equal(pinnedUploadCount, 3 + diagnosticNames.length, 'pinned uploads must be two materialized UAT artifacts, one startup capsule, and at most one diagnostic artifact');
  assert.equal((source.match(/name: Product-Experience-Materialized-Desktop-UAT-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/gu) || []).length, 1);
  assert.equal((source.match(/name: Product-Experience-Materialized-Matrix-UAT-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/gu) || []).length, 1);

  const capsuleStepStart = source.indexOf('- name: Upload same-build startup capsule');
  const capsuleStepEnd = source.indexOf('\n      - name:', capsuleStepStart + 1);
  assert.ok(capsuleStepStart >= 0 && capsuleStepEnd > capsuleStepStart, 'same-build startup-capsule upload step must be independently bounded');
  const capsuleStep = source.slice(capsuleStepStart, capsuleStepEnd);
  assert.match(capsuleStep, /uses:\s*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
  assert.match(capsuleStep, /name: Product-Experience-Startup-Capsule-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.match(capsuleStep, /\$\{\{ runner\.temp \}\}\\product-experience-startup-capsule\\startup-capsule\\\*\*/u);
  assert.match(capsuleStep, /if-no-files-found:\s*error/u);
  assert.match(capsuleStep, /retention-days:\s*7/u);

  if (diagnosticNames.length === 1) {
    const diagnosticStepStart = source.indexOf('- name: Upload packaged startup diagnostics after Product Final RED');
    const diagnosticStepEnd = source.indexOf('\n      - name:', diagnosticStepStart + 1);
    assert.ok(diagnosticStepStart >= 0 && diagnosticStepEnd > diagnosticStepStart, 'authorized packaged-startup diagnostic upload step must be independently bounded');
    const diagnosticStep = source.slice(diagnosticStepStart, diagnosticStepEnd);
    assert.match(diagnosticStep, /if:\s*\$\{\{\s*always\(\)\s*\}\}/u);
    assert.match(diagnosticStep, /uses:\s*actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u);
    assert.equal((diagnosticStep.match(/actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/gu) || []).length, 1);
    assert.match(diagnosticStep, /name: Product-Experience-Packaged-Startup-Diagnostics-\$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
    const diagnosticLogs = [...diagnosticStep.matchAll(/\$\{\{ runner\.temp \}\}\\product-uat-packaged-data\\logs\\([a-z-]+\.jsonl)/gu)].map((match) => match[1]);
    assert.deepEqual(diagnosticLogs, ['desktop-bootstrap.jsonl', 'desktop.jsonl', 'server.jsonl']);
    assert.match(diagnosticStep, /\$\{\{ runner\.temp \}\}\\product-experience-startup-capsule\\startup-capsule\\diagnostics\\\*\*/u);
    assert.match(diagnosticStep, /if-no-files-found:\s*warn/u);
    assert.doesNotMatch(diagnosticStep, /continue-on-error/u);
  }

  assert.match(source, /create-materialized-uat-candidate\.js seal/u);
  assert.match(source, /create-materialized-uat-candidate\.js verify/u);
  assert.match(source, /RUN_PRODUCT_EXPERIENCE_MATERIALIZED_UAT\.ps1/u);
  assert.doesNotMatch(source, /docs\/uat\/V21_PRODUCT_EXPERIENCE_SHELL_P0_UAT\.md/u);
  assert.doesNotMatch(source, /windows-production-release|gh\s+release|npm\s+publish/u);
});

test('PowerShell loop diagnostics delimit iteration before colon punctuation', () => {
  const source = readWorkflow();
  assert.doesNotMatch(source, /iteration \$iteration:/u);
  assert.match(source, /Element pin mismatch on iteration \$\{iteration\}: expected=\$env:ELEMENT_COMMIT actual=\$actualElementCommit/u);
});

test('trusted Windows Product Final materializes sealed Learning runtime before WP7 and passes its exact root', () => {
  const source = readWorkflow();
  const learningIndex = source.indexOf('- name: Materialize presealed Learning Windows runtime in trusted CI');
  const builderIndex = source.indexOf('- name: Build existing WP7 PRE_REVIEW_ONLY trusted desktop and seal Product bundle');
  assert.ok(learningIndex >= 0, 'Product Final must materialize the existing sealed Learning Windows runtime');
  assert.ok(builderIndex > learningIndex, 'Learning runtime must be materialized before the existing WP7 trusted-product builder');
  const learningEnd = source.indexOf('\n      - name:', learningIndex + 1);
  const learningStep = source.slice(learningIndex, learningEnd === -1 ? source.length : learningEnd);
  assert.match(learningStep, /tools[\\/]learning-growth[\\/]build-windows-runtime\.ps1/u);
  assert.match(learningStep, /runtime-seal\.json/u);
  assert.match(learningStep, /"root=\$output"\s*\|\s*Out-File -FilePath \$env:GITHUB_OUTPUT -Append/u);
  const builderEnd = source.indexOf('\n      - name:', builderIndex + 1);
  const builderStep = source.slice(builderIndex, builderEnd === -1 ? source.length : builderEnd);
  assert.match(builderStep, /--learning-runtime '\$\{\{ steps\.learning\.outputs\.root \}\}'/u);
  assert.doesNotMatch(builderStep, /learning-runtime[^\n]*(?:optional|fallback|skip)/iu);
});