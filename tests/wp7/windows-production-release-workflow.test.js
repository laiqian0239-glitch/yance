'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '../..');
const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/windows-production-release.yml'), 'utf8');

test('production release workflow binds current Final Builder packaging contract without requiring signing', () => {
  for (const token of [
    'NODE_VERSION: 22.16.0',
    'TRUSTED_NODE_VERSION: 22.23.1',
    'TRUSTED_NODE_ARCHIVE_SHA256: 7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29',
    'TRUSTED_NODE_EXE_SHA256: f8d162c0641dcee512132f3bcf8a68169c7ecb852efd8e1a46c9fec5a0f469ed',
    'expected_commit:',
    'expected_tree:',
    'rebuild/windows-release-closure-$releaseDate-run-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT',
    'RUN_WINDOWS_VERIFY_ROUND.ps1',
    "'-VerificationMode', 'STRICT'",
    'create-windows-preacceptance.js',
    '-WindowsRound1Result',
    '-WindowsRound1Sha256',
    '-WindowsRound2Result',
    '-WindowsRound2Sha256',
    '-ExpectedBundleSha256',
    '-NodeRoot',
    '-TrustedNodeExecutable',
    "authenticodeStatus -ne 'Unsigned'",
    "signature.Status -ne 'NotSigned'",
    'latestYmlFile',
    'blockmapFile',
    'yance-unsigned-windows-release'
  ]) assert.match(workflow, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  assert.doesNotMatch(workflow, /WINDOWS_CERTIFICATE_PFX_BASE64/);
  assert.doesNotMatch(workflow, /WINDOWS_CERTIFICATE_PASSWORD/);
  assert.doesNotMatch(workflow, /-RequireSignedInstaller/);
  assert.doesNotMatch(workflow, /-SigningCertificate/);
  assert.doesNotMatch(workflow, /-SignToolPath/);
  assert.doesNotMatch(workflow, /release-candidate-\$env:GITHUB_RUN_ID/);
  assert.doesNotMatch(workflow, /WP7_PREACCEPTANCE_RECORD_BASE64/);
  assert.doesNotMatch(workflow, /WP7_PREACCEPTANCE_RECORD_SHA256/);
});

test('workflow creates exact strict-round preacceptance before the unsigned Final Builder', () => {
  const round = workflow.indexOf('Run two independent strict Windows packaging rounds');
  const preacceptance = workflow.indexOf('Create exact machine-bound final packaging preacceptance');
  const builder = workflow.indexOf('Build unsigned release before metadata sealing');
  const verify = workflow.indexOf('Verify unsigned release assets');
  const publish = workflow.indexOf('Publish unsigned Windows release');
  assert.ok(round > 0 && preacceptance > round && builder > preacceptance && verify > builder && publish > verify);
});

test('unsigned publishing is stable and includes auto-update metadata', () => {
  assert.match(workflow, /if: \$\{\{ inputs\.publish \}\}/);
  assert.match(workflow, /RELEASE_REPOSITORY: wangyi198675-coder\/Yance-Releases/);
  assert.match(workflow, /gh release create \$tag [^\n]*--repo \$env:RELEASE_REPOSITORY/u);
  assert.doesNotMatch(workflow, /--prerelease/u);
  assert.match(workflow, /latest\.yml and blockmap for normal automatic updates/u);

  const publishStart = workflow.indexOf('- name: Publish unsigned Windows release');
  const publishStep = workflow.slice(publishStart);
  assert.match(publishStep, /\$builder\.installerFile/u);
  assert.match(publishStep, /\$builder\.releaseEvidenceFile/u);
  assert.match(publishStep, /\$builder\.latestYmlFile/u);
  assert.match(publishStep, /\$builder\.blockmapFile/u);
  assert.doesNotMatch(workflow, /PUBLIC_SIGNED_AUTOUPDATE/);
});

test('final builder preserves signing-before-update-metadata order when signing is enabled later', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'tools/wp7/lib.js'), 'utf8');
  const signing = lib.indexOf("options.signInstaller({");
  const metadata = lib.indexOf('const updateMeta = emitUpdateMetadata({', signing);
  const finalHash = lib.indexOf('const installerSha256 = sha256File(outputFile);', metadata);
  assert.ok(signing > 0 && metadata > signing && finalHash > metadata);
  assert.doesNotMatch(lib.slice(signing, metadata), /emitUpdateMetadata/);
});

test('sealed Matrix promotion validates exact Product Experience run provenance before download and carries PR-head identity into Final Builder', () => {
  const matrixStart = workflow.indexOf('- name: Download and verify same-source sealed Matrix runtime artifact');
  const builderStart = workflow.indexOf('- name: Build unsigned release before metadata sealing');
  const verifyStart = workflow.indexOf('- name: Verify unsigned release assets');
  assert.ok(matrixStart >= 0 && builderStart > matrixStart && verifyStart > builderStart);

  const matrixStep = workflow.slice(matrixStart, builderStart);
  const runLookup = matrixStep.indexOf('gh api "repos/$env:GITHUB_REPOSITORY/actions/runs/$env:MATRIX_RUN_ID"');
  const download = matrixStep.indexOf('gh run download $env:MATRIX_RUN_ID');
  assert.ok(runLookup >= 0 && download > runLookup, 'exact run provenance validation must happen before artifact download');

  for (const token of [
    'EXPECTED_MATRIX_BRANCH: rebuild/windows-release-closure-20260911-matrix-runtime',
    'EXPECTED_MATRIX_WORKFLOW_PATH: .github/workflows/v21-product-experience-shell-p0-final-validation.yml',
    '[string]$run.repository.full_name -ne $env:GITHUB_REPOSITORY',
    '[string]$run.path -ne $env:EXPECTED_MATRIX_WORKFLOW_PATH',
    "[string]$run.event -ne 'pull_request'",
    "[string]$run.status -ne 'completed'",
    "[string]$run.conclusion -ne 'success'",
    '[string]$run.head_branch -ne $env:EXPECTED_MATRIX_BRANCH',
    "[string]$run.head_sha -notmatch '^[0-9a-f]{40}$'",
    '$runAttempt = [int]$run.run_attempt',
    '$artifactName = "Product-Experience-Materialized-Matrix-UAT-$($run.head_sha)"',
    '[string]$manifest.candidateCommit -ne [string]$run.head_sha',
    '[string]$manifest.candidateBranch -ne [string]$run.head_branch',
    '[string]$manifest.candidateTree -ne $env:EXPECTED_TREE',
    '--candidate-branch $manifest.candidateBranch',
    '--candidate-commit $manifest.candidateCommit',
    '--candidate-tree $manifest.candidateTree',
    '"candidate_branch=$($manifest.candidateBranch)"',
    '"candidate_commit=$($manifest.candidateCommit)"',
    '"candidate_tree=$($manifest.candidateTree)"',
    '"run_attempt=$runAttempt"'
  ]) assert.ok(matrixStep.includes(token), `missing exact Matrix promotion token: ${token}`);

  assert.doesNotMatch(matrixStep, /gh run view/u);
  assert.doesNotMatch(matrixStep, /Product-Experience-Materialized-Matrix-UAT-\$env:EXPECTED_COMMIT/u);
  assert.doesNotMatch(matrixStep, /candidateCommit -ne \$env:EXPECTED_COMMIT/u);

  const builderStep = workflow.slice(builderStart, verifyStart);
  for (const token of [
    'MATRIX_RUNTIME_CANDIDATE_BRANCH: ${{ steps.matrix_runtime.outputs.candidate_branch }}',
    'MATRIX_RUNTIME_CANDIDATE_COMMIT: ${{ steps.matrix_runtime.outputs.candidate_commit }}',
    'MATRIX_RUNTIME_CANDIDATE_TREE: ${{ steps.matrix_runtime.outputs.candidate_tree }}',
    "-ExpectedCommit '${{ steps.identity.outputs.commit }}'",
    "-ExpectedTree '${{ steps.identity.outputs.tree }}'",
    '-MatrixRuntimeCandidateBranch $env:MATRIX_RUNTIME_CANDIDATE_BRANCH',
    '-MatrixRuntimeCandidateCommit $env:MATRIX_RUNTIME_CANDIDATE_COMMIT',
    '-MatrixRuntimeCandidateTree $env:MATRIX_RUNTIME_CANDIDATE_TREE'
  ]) assert.ok(builderStep.includes(token), `missing Final Builder source/artifact identity token: ${token}`);

  assert.doesNotMatch(builderStep, /-RequireSignedInstaller/u);
  assert.doesNotMatch(builderStep, /-SigningCertificate/u);
  assert.doesNotMatch(builderStep, /-SignToolPath/u);
  assert.doesNotMatch(builderStep, /-MatrixRuntimeCandidateCommit '\$\{\{ steps\.identity\.outputs\.commit \}\}'/u);
  assert.doesNotMatch(builderStep, /-MatrixRuntimeCandidateTree '\$\{\{ steps\.identity\.outputs\.tree \}\}'/u);
});
