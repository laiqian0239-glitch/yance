'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const {
  createIdentityBoundArchive,
  listZipEntryNames,
  resolveTrackedPayloadData,
} = require('../../tools/runtime-delivery/create-round12-13-windows-uat-package');

const root = path.join(__dirname, '..', '..');
const templateRoot = path.join(root, 'tools', 'runtime-delivery', 'templates');
const generatorPath = path.join(root, 'tools', 'runtime-delivery', 'create-round12-13-windows-uat-package.js');
function read(name) { return fs.readFileSync(path.join(templateRoot, name), 'utf8'); }

test('round12/13 Windows UAT keeps one installer and one evidence entry', () => {
  const cmd = read('INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.cmd.template');
  const ps1 = read('INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.ps1.template');
  const evidenceCmd = read('COLLECT_YANCE_ROUND12_13_EVIDENCE.cmd.template');
  const evidencePs1 = read('COLLECT_YANCE_ROUND12_13_EVIDENCE.ps1.template');
  assert.match(cmd, /INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT\.ps1/u);
  assert.match(evidenceCmd, /COLLECT_YANCE_ROUND12_13_EVIDENCE\.ps1/u);
  assert.match(ps1, /Get-ExistingDataRoot/u);
  assert.match(ps1, /New-DatabaseRecoveryPoint/u);
  assert.match(ps1, /--install --prepare-only --allow-dirty/u);
  assert.match(ps1, /run-round12-13-prelaunch-gates\.js/u);
  assert.match(ps1, /The application was not started/u);
  assert.match(evidencePs1, /exportPlatformProductionEvidence\.js/u);
  assert.match(evidencePs1, /runtimeSourceCommit/u);
  assert.match(evidencePs1, /runtimeSourceTree/u);
  assert.match(evidencePs1, /governanceEvidenceComplete/u);
  assert.match(evidencePs1, /evidenceTruncation/u);
  assert.match(evidencePs1, /runtimeEvidenceIntegrity\.releaseBlocking/u);
  assert.match(evidencePs1, /evidencePromotionAllowed/u);
  assert.match(evidencePs1, /WINDOWS_EVIDENCE_GATE\.json/u);
  assert.match(evidencePs1, /Get-FileHash/u);
  assert.match(evidencePs1, /exit 3/u);
  assert.doesNotMatch(evidencePs1, /CopyFromScreen|current-screen\.png/u);
  assert.match(evidencePs1, /SCREENSHOT_CAPTURE_POLICY\.txt/u);
  assert.match(evidencePs1, /Compress-Archive/u);
});

test('round12/13 evidence checklist covers platform core, AI quality and Round 11 UI', () => {
  const evidence = read('COLLECT_YANCE_ROUND12_13_EVIDENCE.ps1.template');
  const readme = read('YANCE_ROUND12_13_UAT_README_ZH.md.template');
  for (const pattern of [/Outbox/u, /IdentityLink/u, /same Person profile, relationship, memory and learning/u, /verify, dispute, detach/u, /complete paginated audit/u, /blocking=0/u, /approve or reject/u, /rollback and forget/u, /emergency mode/u, /125 and 150 percent/u, /Kurt/u]) assert.match(evidence, pattern);
  for (const pattern of [/Round 11/u, /Capability\/Health/u, /OutboxCommand/u, /event-first/u, /全量分页收敛审计/u, /人工确认、争议、解除/u, /同一Person锚定档案、关系、记忆与学习/u, /L3提案批准\/拒绝/u, /DirectorStrategyV2/u, /L1\/L2\/L3/u, /formalRelease=false/u]) assert.match(readme, pattern);
  for (const pattern of [/WINDOWS_EVIDENCE_GATE\.json/u, /退出码 `3`/u, /不能把“生成了 ZIP”解释为验收通过/u, /readyForPromotion=true/u]) assert.match(readme, pattern);
});

test('round12/13 prelaunch gate requires complete dependencies and all architecture layers before Electron starts', () => {
  const gate = fs.readFileSync(path.join(root, 'tools', 'runtime-delivery', 'run-round12-13-prelaunch-gates.js'), 'utf8');
  const installer = read('INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.ps1.template');
  for (const pattern of [/engineering-protocol-v3/u, /validate-v3-protocols\.js/u, /round12Round13ThirdSelfCheck/u, /round12Round13ProductGovernanceClosure/u, /round12Round13FinalGovernanceClosure/u, /candidateBinding/u, /round11ConversationCenterUi/u, /platformProductionReadinessAuthority/u, /runtime-contract/u, /workbench-api/u, /audit-theme-colors/u, /summary\.json/u]) assert.match(gate, pattern);
  assert.ok(installer.indexOf('run-round12-13-prelaunch-gates.js') < installer.lastIndexOf("-ArgumentsSuffix ''"));
});

test('round12/13 package generator enforces a clean identity-bound immutable payload', () => {
  const generator = fs.readFileSync(generatorPath, 'utf8');
  for (const pattern of [
    /working tree must be clean/u,
    /ROUND12_13_COMPREHENSIVE_WINDOWS_UAT_CANDIDATE/u,
    /architecture-round12-round13-final-governance-windows-uat-20260727/u,
    /YANCE_SOURCE_CHECKPOINT\.json/u,
    /listHeadBlobs/u,
    /readGitBlobs/u,
    /ZIP does not match Git HEAD/u,
    /assertUniqueZipEntries/u,
    /formalRelease:\s*false/u,
    /realWindowsUatRequired:\s*true/u,
    /realPlatformUatRequired:\s*true/u,
    /realOpenRouterQualificationRequired:\s*true/u,
    /topLevelInstallEntry:\s*'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT\.cmd'/u,
    /evidenceEntry:\s*'COLLECT_YANCE_ROUND12_13_EVIDENCE\.cmd'/u,
    /unresolved placeholder/u
  ]) assert.match(generator, pattern);
});

test('tracked Git LFS blobs require verified materialized worktree bytes before UAT archiving', () => {
  assert.equal(typeof resolveTrackedPayloadData, 'function');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-13-lfs-'));
  const repo = path.join(tempRoot, 'repo');
  const relativePath = 'vendor/electron/electron-fixture.zip';
  const worktreePath = path.join(repo, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  const materialized = Buffer.from('verified-materialized-lfs-object\n', 'utf8');
  const oid = crypto.createHash('sha256').update(materialized).digest('hex');
  const pointer = Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${materialized.length}\n`, 'utf8');
  const entry = { file: relativePath, mode: '100644', object: 'fixture-object' };

  fs.writeFileSync(worktreePath, materialized);
  assert.deepEqual(resolveTrackedPayloadData(repo, entry, pointer), materialized);

  fs.writeFileSync(worktreePath, pointer);
  assert.throws(
    () => resolveTrackedPayloadData(repo, entry, pointer),
    /Git LFS.*materialized|materialized.*Git LFS/iu,
  );

  fs.writeFileSync(worktreePath, Buffer.from('tampered-lfs-object\n', 'utf8'));
  assert.throws(
    () => resolveTrackedPayloadData(repo, entry, pointer),
    /Git LFS.*(SHA-256|size)|(?:SHA-256|size).*Git LFS/iu,
  );

  const ordinaryBlob = Buffer.from('ordinary-git-blob\n', 'utf8');
  fs.writeFileSync(worktreePath, Buffer.from('worktree-does-not-authorize-ordinary-blob\n', 'utf8'));
  assert.deepEqual(resolveTrackedPayloadData(repo, entry, ordinaryBlob), ordinaryBlob);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('round12/13 generated command and PowerShell files are ASCII CRLF', () => {
  const generator = fs.readFileSync(generatorPath, 'utf8');
  for (const name of [
    'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.cmd.template',
    'INSTALL_TEST_AND_START_YANCE_ROUND12_13_UAT.ps1.template',
    'COLLECT_YANCE_ROUND12_13_EVIDENCE.cmd.template',
    'COLLECT_YANCE_ROUND12_13_EVIDENCE.ps1.template'
  ]) {
    const bytes = fs.readFileSync(path.join(templateRoot, name));
    assert.equal([...bytes].every(byte => byte < 128), true, `${name} must remain ASCII source`);
  }
  assert.match(generator, /ascii:\s*true,\s*crlf:\s*true/g);
});

test('round12/13 identity-bound payload contains exactly one delivery checkpoint', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-13-archive-'));
  const repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Round12 Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'round12@test.invalid']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'round12-13\n');
  fs.writeFileSync(path.join(repo, 'YANCE_SOURCE_CHECKPOINT.json'), '{"commit":"implementation"}\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture']);
  const payloadPath = path.join(tempRoot, 'payload.zip');
  createIdentityBoundArchive(repo, payloadPath, '{"commit":"delivery"}\n');
  const names = listZipEntryNames(payloadPath);
  assert.equal(names.filter(name => name === 'YANCE_SOURCE_CHECKPOINT.json').length, 1);
  assert.equal(new Set(names).size, names.length);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('round12/13 payload includes every tracked file even when export-ignore is set', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r12-13-export-ignore-'));
  const repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Round12 Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'round12@test.invalid']);
  fs.writeFileSync(path.join(repo, '.gitattributes'), 'hidden.ps1 export-ignore\n');
  fs.writeFileSync(path.join(repo, 'app.txt'), 'round12-13\n');
  fs.writeFileSync(path.join(repo, 'hidden.ps1'), 'Write-Host included\n');
  fs.writeFileSync(path.join(repo, 'YANCE_SOURCE_CHECKPOINT.json'), '{"commit":"implementation"}\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture']);
  const payloadPath = path.join(tempRoot, 'payload.zip');
  createIdentityBoundArchive(repo, payloadPath, '{"commit":"delivery"}\n');
  const names = listZipEntryNames(payloadPath);
  assert.deepEqual(names.sort(), ['.gitattributes', 'YANCE_SOURCE_CHECKPOINT.json', 'app.txt', 'hidden.ps1'].sort());
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
