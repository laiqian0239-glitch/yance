'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const { createIdentityBoundArchive, listZipEntryNames } = require('../../tools/runtime-delivery/create-round11-windows-uat-package');
const { readZipTextEntry } = require('../../tools/runtime-delivery/identity-bound-source-archive');

const root = path.join(__dirname, '..', '..');
const templateRoot = path.join(root, 'tools', 'runtime-delivery', 'templates');
const generatorPath = path.join(root, 'tools', 'runtime-delivery', 'create-round11-windows-uat-package.js');

function read(name) {
  return fs.readFileSync(path.join(templateRoot, name), 'utf8');
}

test('round11 Windows UI UAT keeps one installer and one evidence entry', () => {
  const cmd = read('INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.cmd.template');
  const ps1 = read('INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.ps1.template');
  const evidenceCmd = read('COLLECT_YANCE_ROUND11_UI_EVIDENCE.cmd.template');
  const evidencePs1 = read('COLLECT_YANCE_ROUND11_UI_EVIDENCE.ps1.template');

  assert.match(cmd, /INSTALL_TEST_AND_START_YANCE_ROUND11_UAT\.ps1/u);
  assert.match(evidenceCmd, /COLLECT_YANCE_ROUND11_UI_EVIDENCE\.ps1/u);
  assert.match(fs.readFileSync(generatorPath, 'utf8'), /START_YANCE_WINDOWS_UI_UAT\.cmd/u);
  assert.match(fs.readFileSync(generatorPath, 'utf8'), /START_YANCE_WINDOWS_UI_UAT_ISOLATED\.cmd/u);
  assert.match(fs.readFileSync(generatorPath, 'utf8'), /COLLECT_YANCE_UI_EVIDENCE\.cmd/u);
  assert.match(ps1, /Get-ExistingDataRoot/u);
  assert.match(ps1, /New-DatabaseRecoveryPoint/u);
  assert.match(ps1, /start-source-uat\.js/u);
  assert.match(ps1, /--install --prepare-only --allow-dirty/u);
  assert.match(ps1, /run-round11-prelaunch-gates\.js/u);
  assert.match(ps1, /The application was not started/u);
  assert.match(ps1, /__EXPECTED_COMMIT__/u);
  assert.match(ps1, /__EXPECTED_TREE__/u);
  assert.match(evidencePs1, /exportPlatformProductionEvidence\.js/u);
  assert.match(evidencePs1, /RUNTIME_EXPORT_STATUS\.json/u);
  assert.match(evidencePs1, /round11-prelaunch-gates/u);
  assert.doesNotMatch(evidencePs1, /throw "Evidence export failed/u);
  assert.doesNotMatch(evidencePs1, /CopyFromScreen|current-screen\.png/u);
  assert.match(evidencePs1, /SCREENSHOT_CAPTURE_POLICY\.txt/u);
  assert.match(evidencePs1, /Compress-Archive/u);

  assert.match(ps1, /prepare-windows-uat-data-clone\.js/u);
  assert.match(ps1, /Yance-UAT-Data/u);
  assert.match(ps1, /YANCE_SOURCE_UAT_DATA_CLONE/u);
  assert.match(ps1, /YANCE_SOURCE_UAT_DATA_CLONE_MARKER/u);
  assert.match(ps1, /YANCE_SOURCE_UAT_RESET_SAFE_MODE/u);
  assert.match(ps1, /sourceUntouched/u);
  assert.match(ps1, /baseTreeMatch/u);
  assert.match(ps1, /real data directory is never used as the runtime data root/u);
  assert.doesNotMatch(ps1, /\$dataRoot\s*=\s*Get-ExistingDataRoot/u);
  assert.match(fs.readFileSync(generatorPath, 'utf8'), /verified-clone-or-fresh-isolated/u);
  assert.match(evidencePs1, /installer-logs/u);
  assert.match(evidencePs1, /desktop-bootstrap\.jsonl/u);
  assert.match(evidencePs1, /desktop\.jsonl/u);
  assert.match(evidencePs1, /server\.jsonl/u);
  assert.match(evidencePs1, /YANCE_SOURCE_UAT_DATA_CLONE_RECEIPT\.json/u);
  assert.match(evidencePs1, /source-uat-launch\.json/u);
  assert.match(evidencePs1, /sanitize-windows-ui-uat-diagnostic\.js/u);
  assert.match(evidencePs1, /Sanitize-DiagnosticFile/u);
  assert.match(ps1, /Invoke-StartupDiagnosticCollector/u);
  assert.match(ps1, /-StartupDiagnosticsOnly/u);
  assert.match(ps1, /powershell\.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \$collector/u);
  assert.doesNotMatch(ps1, /& \$collector -Port/u);
  assert.match(evidencePs1, /\[switch\]\$StartupDiagnosticsOnly/u);
  assert.doesNotMatch(evidencePs1, /Copy-Item[^\r\n]*desktop(?:-bootstrap)?\.jsonl/u);
  assert.doesNotMatch(evidencePs1, /Copy-Item[^\r\n]*server\.jsonl/u);
  assert.doesNotMatch(evidencePs1, /Copy-Item[^\r\n]*(?:yance-r32\.db|credentials\.safe|whatsapp-auth)/u);
  const scopePrefixes = new Set(['env', 'global', 'local', 'private', 'script', 'using']);
  for (const source of [ps1, evidencePs1]) {
    const ambiguous = [...source.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*):/gu)]
      .map(match => match[1])
      .filter(name => !scopePrefixes.has(name.toLowerCase()));
    assert.deepEqual(ambiguous, []);
  }

  const { sanitizeDiagnosticFile } = require('../../tools/runtime-delivery/sanitize-windows-ui-uat-diagnostic');
  const diagnosticRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r11-prelaunch-diagnostic-'));
  const diagnosticInput = path.join(diagnosticRoot, 'desktop.jsonl');
  const diagnosticOutput = path.join(diagnosticRoot, 'desktop.sanitized.jsonl');
  fs.writeFileSync(diagnosticInput, `${JSON.stringify({ level: 'error', event: 'backend-startup-failed', token: 'sk-secret', error: 'SQLITE_BUSY at C:\\Users\\Private\\db' })}\n`, 'utf8');
  sanitizeDiagnosticFile(diagnosticInput, diagnosticOutput);
  const diagnosticText = fs.readFileSync(diagnosticOutput, 'utf8');
  assert.match(diagnosticText, /backend-startup-failed/u);
  assert.doesNotMatch(diagnosticText, /sk-secret|Users\\Private/u);

  const { prepareClone } = require('../../tools/runtime-delivery/prepare-windows-uat-data-clone');
  const cloneSource = path.join(diagnosticRoot, 'real-data-source');
  const cloneTarget = path.join(diagnosticRoot, 'uat-runtime-clone');
  fs.mkdirSync(path.join(cloneSource, 'store'), { recursive: true });
  fs.mkdirSync(path.join(cloneSource, 'preferences'), { recursive: true });
  fs.writeFileSync(path.join(cloneSource, 'store', 'yance-r32.db'), 'sqlite-authority', 'utf8');
  fs.writeFileSync(path.join(cloneSource, 'preferences', 'ui.json'), '{"density":"compact"}', 'utf8');
  const cloneReceipt = prepareClone({ source: cloneSource, target: cloneTarget });
  assert.equal(cloneReceipt.status, 'PASS');
  assert.equal(cloneReceipt.sourceUntouched, true);
  assert.equal(cloneReceipt.baseTreeMatch, true);
  assert.deepEqual(cloneReceipt.sourceTreeDigest, cloneReceipt.targetBaseTreeDigest);
  assert.notEqual(path.resolve(cloneReceipt.sourceDataRoot), path.resolve(cloneReceipt.targetDataRoot));
});




test('round11 UI evidence checklist covers the redesigned production interface', () => {
  const evidencePs1 = read('COLLECT_YANCE_ROUND11_UI_EVIDENCE.ps1.template');
  const readme = read('YANCE_ROUND11_UAT_README_ZH.md.template');

  assert.match(evidencePs1, /Five product areas/u);
  assert.match(evidencePs1, /quick-reply dock/u);
  assert.match(evidencePs1, /3 candidates and can expand to 5/u);
  assert.match(evidencePs1, /never sends automatically/u);
  assert.match(evidencePs1, /daily mode and advanced mode/u);
  assert.match(evidencePs1, /outbound translation route/u);
  assert.match(evidencePs1, /125 percent and 150 percent/u);

  assert.match(readme, /五大区域/u);
  assert.match(readme, /默认3条，可展开到5条/u);
  assert.match(readme, /不自动发送/u);
  assert.match(readme, /中→德/u);
  assert.match(readme, /formalRelease=false/u);
  assert.match(readme, /只读来源/u);
  assert.match(readme, /自动生成脱敏诊断 ZIP/u);
  assert.doesNotMatch(readme, /^3\. .*\n[\s\S]*^3\. /mu);
});



test('round11 prelaunch gate runs dependency-sensitive production tests before Electron starts', () => {
  const gate = fs.readFileSync(path.join(root, 'tools', 'runtime-delivery', 'run-round11-prelaunch-gates.js'), 'utf8');
  const contract = fs.readFileSync(path.join(root, 'tools', 'runtime-delivery', 'round11-prelaunch-contract.js'), 'utf8');
  const installer = read('INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.ps1.template');

  assert.match(gate, /ROUND11_PRELAUNCH_TEST_FILES/u);
  assert.match(contract, /candidateBinding\.test\.js/u);
  assert.match(contract, /round11ConversationCenterUi\.test\.js/u);
  assert.match(contract, /machine-uat-closure\.test\.js/u);
  assert.match(contract, /f25WindowsUatRepairBatch15\.test\.js/u);
  assert.match(contract, /identity-bound-source-archive\.test\.js/u);
  assert.match(contract, /create-identity-bound-source-candidate\.test\.js/u);
  assert.match(contract, /platformProductionReadinessAuthority\.test\.js/u);
  assert.match(gate, /audit-theme-colors\.js/u);
  assert.match(gate, /summary\.json/u);
  assert.ok(installer.indexOf('run-round11-prelaunch-gates.js') < installer.lastIndexOf("-ArgumentsSuffix ''"));
});
test('round11 package generator enforces clean identity-bound immutable payload', () => {
  const generator = fs.readFileSync(generatorPath, 'utf8');

  assert.match(generator, /working tree must be clean/u);
  assert.match(generator, /BATCH40_FIX6D_WINDOWS_UI_UAT_CANDIDATE/u);
  assert.match(generator, /audit-batch40-fix6d-windows-ui-uat-20260731/u);
  assert.match(generator, /identity-bound-source-archive/u);
  assert.match(generator, /CHECKPOINT_FILE/u);
  assert.match(generator, /DESCRIPTOR_FILE/u);
  assert.match(generator, /createIdentityBoundSourceArchive/u);
  assert.match(generator, /assertUniqueZipEntries/u);
  assert.match(generator, /sha256/u);
  assert.match(generator, /formalRelease:\s*false/u);
  assert.match(generator, /realWindowsUatRequired:\s*true/u);
  assert.match(generator, /windowsPowerShell51Compatible:\s*true/u);
  assert.match(generator, /schemaVersion:\s*3/u);
  assert.match(generator, /YANCE_BATCH40_FIX6D_WINDOWS_UI_UAT_/u);
  assert.match(generator, /YANCE_BATCH40_FIX6D_WINDOWS_UI_UAT_PACKAGE/u);
  assert.match(generator, /normalMode:\s*'verified-clone'/u);
  assert.match(generator, /isolatedMode:\s*'fresh-per-run'/u);
  assert.match(generator, /automaticOnFailure:\s*true/u);
  assert.match(generator, /databasesCopied:\s*false/u);
  assert.match(generator, /credentialStoresCopied:\s*false/u);
  assert.match(generator, /topLevelInstallEntry:\s*'START_YANCE_WINDOWS_UI_UAT\.cmd'/u);
  assert.match(generator, /isolatedInstallEntry:\s*'START_YANCE_WINDOWS_UI_UAT_ISOLATED\.cmd'/u);
  assert.match(generator, /evidenceEntry:\s*'COLLECT_YANCE_UI_EVIDENCE\.cmd'/u);
  assert.match(generator, /unresolved placeholder/u);
});

test('round11 generated command and PowerShell files are rendered as ASCII CRLF', () => {
  const generator = fs.readFileSync(generatorPath, 'utf8');
  const asciiTemplates = [
    'INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.cmd.template',
    'INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.ps1.template',
    'COLLECT_YANCE_ROUND11_UI_EVIDENCE.cmd.template',
    'COLLECT_YANCE_ROUND11_UI_EVIDENCE.ps1.template',
  ];

  for (const name of asciiTemplates) {
    const bytes = fs.readFileSync(path.join(templateRoot, name));
    assert.equal([...bytes].every(byte => byte < 128), true, `${name} must remain ASCII source`);
  }
  assert.match(generator, /ascii:\s*true,\s*crlf:\s*true/g);
});


test('round11 identity-bound payload replaces both tracked identity documents with exact delivery identity', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-r11-archive-'));
  const repo = path.join(tempRoot, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Round11 Test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'round11@test.invalid']);
  fs.writeFileSync(path.join(repo, 'app.txt'), 'round11\n');
  fs.writeFileSync(path.join(repo, 'YANCE_SOURCE_CHECKPOINT.json'), '{"commit":"implementation"}\n');
  fs.writeFileSync(path.join(repo, 'YANCE_ARTIFACT_DESCRIPTOR.json'), '{"artifactId":"implementation"}\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'fixture']);

  const payloadPath = path.join(tempRoot, 'payload.zip');
  const identity = {
    branch: String(execFileSync('git', ['-C', repo, 'branch', '--show-current'], { encoding: 'utf8' })).trim(),
    commit: String(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' })).trim(),
    tree: String(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' })).trim(),
    parent: null,
  };
  createIdentityBoundArchive(repo, payloadPath, {
    identity,
    artifact: {
      artifactClass: 'BATCH40_FIX6D_WINDOWS_UI_UAT_CANDIDATE',
      artifactId: 'round11-test',
      formalRelease: false,
      readyForPromotion: false,
      windowsUiUat: false,
    },
  });
  const names = listZipEntryNames(payloadPath);
  assert.equal(names.filter(name => name === 'YANCE_SOURCE_CHECKPOINT.json').length, 1);
  assert.equal(names.filter(name => name === 'YANCE_ARTIFACT_DESCRIPTOR.json').length, 1);
  assert.equal(new Set(names).size, names.length);
  const checkpoint = JSON.parse(readZipTextEntry(payloadPath, 'YANCE_SOURCE_CHECKPOINT.json'));
  const descriptor = JSON.parse(readZipTextEntry(payloadPath, 'YANCE_ARTIFACT_DESCRIPTOR.json'));
  assert.equal(checkpoint.commit, identity.commit);
  assert.equal(checkpoint.tree, identity.tree);
  assert.equal(descriptor.sourceIdentity.commit, identity.commit);
  assert.equal(descriptor.sourceIdentity.tree, identity.tree);
  assert.equal(descriptor.artifactId, 'round11-test');
});
