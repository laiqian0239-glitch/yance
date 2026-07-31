'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  PACKAGE_KIND,
  BATCH14_TEST_FILE,
  THEME_LAYOUT_TEST_FILES,
  buildAcceptanceArchiveName,
  buildManifest,
  buildWindowsCommand,
  buildOneClickLauncher,
  buildCompatibilityLauncher,
  buildOneClickPowerShell,
  createStagingDirectory,
  verifyAcceptanceSourceBinding
} = require('../../scripts/create-batch40-windows-acceptance');
const {
  assertExactTestRun,
  parseBackendRun,
  verifyEvidence
} = require('../../scripts/verify-batch40-windows-evidence');
const {
  EXPECTED_ROUND11_PRELAUNCH_TESTS,
  ROUND11_PRELAUNCH_TEST_FILES
} = require('../../tools/runtime-delivery/round11-prelaunch-contract');
const { createIdentityBoundSourceArchive } = require('../../tools/runtime-delivery/identity-bound-source-archive');

const EXACT = Object.freeze({
  batch14: 3,
  themeLayout: 43,
  focused: 66,
  fix6dPrelaunch: EXPECTED_ROUND11_PRELAUNCH_TESTS,
  backendFiles: 200,
  backendTests: 1201
});

function tap(tests) {
  return [
    'TAP version 13',
    `1..${tests}`,
    `# tests ${tests}`,
    '# suites 0',
    `# pass ${tests}`,
    '# fail 0',
    '# cancelled 0',
    '# skipped 0',
    '# todo 0',
    '# duration_ms 1.23',
    ''
  ].join('\n');
}

function backendLog(sections) {
  return `${sections.map(({ file, tests }) => [
    `========== RUNNING: ${file} ==========`,
    '',
    tap(tests).trimEnd(),
    ''
  ].join('\n')).join('\n')}\n========== ALL DONE (${sections.length} files) ==========\nALL PASSED\n`;
}

function findAmbiguousPowerShellVariableReferences(script) {
  const validScopePrefixes = new Set(['env', 'global', 'local', 'private', 'script', 'using']);
  return [...String(script).matchAll(/\$([A-Za-z_][A-Za-z0-9_]*):/gu)]
    .map(match => match[1])
    .filter(name => !validScopePrefixes.has(name.toLowerCase()));
}

function createVerifierFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yb40-verifier-'));
  const packageRoot = path.join(root, 'acceptance-package');
  const evidenceRoot = path.join(root, 'evidence');
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const write = (base, name, value) => {
    const file = path.join(base, name);
    fs.writeFileSync(file, value, 'utf8');
    return file;
  };
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const sourceArchive = write(packageRoot, 'candidate.zip', 'bound candidate bytes');
  const sourceSha256 = hash(sourceArchive);
  const packageFiles = {};
  for (const [name, value] of Object.entries({
    'RUN_ACCEPTANCE.cmd': '@echo off\r\n',
    'RUN_ACCEPTANCE.ps1': "Write-Host 'acceptance'\r\n",
    'RUN_BATCH40_WINDOWS_ACCEPTANCE.cmd': '@echo off\r\n',
    'BATCH40_WINDOWS_ACCEPTANCE_ZH.md': '# acceptance\n',
    'BATCH40_EXTERNAL_EVIDENCE_TEMPLATE.json': '{"schemaVersion":1}\n',
    'candidate.zip': 'bound candidate bytes'
  })) {
    const file = path.join(packageRoot, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, value, 'utf8');
    packageFiles[name] = hash(file);
  }
  const packageManifest = write(packageRoot, 'BATCH40_WINDOWS_ACCEPTANCE_MANIFEST.json', `${JSON.stringify({
    schemaVersion: 4,
    packageKind: 'YANCE_BATCH40_FIX6D_WINDOWS_FULL_AUTOMATED_ACCEPTANCE',
    generatedAtUtc: '2026-07-31T00:00:00.000Z',
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    sourceArchive: 'candidate.zip',
    sourceSha256,
    payloadIdentityVerified: true,
    exactAutomatedGates: { ...EXACT, backendFiles: 2 },
    packageFiles
  }, null, 2)}\n`);
  return {
    root,
    packageRoot,
    packageManifest,
    packageManifestSha256: hash(packageManifest),
    packageFiles,
    sourceArchive,
    sourceSha256,
    batch14Log: write(evidenceRoot, 'batch14.tap', tap(3)),
    themeLog: write(evidenceRoot, 'theme.tap', tap(43)),
    focusedLog: write(evidenceRoot, 'focused.tap', tap(66)),
    prelaunchLog: write(evidenceRoot, 'prelaunch.tap', tap(EXPECTED_ROUND11_PRELAUNCH_TESTS)),
    themeAuditLog: write(evidenceRoot, 'theme-audit.log', 'Theme color audit PASS. Legacy inline structural color debt: 0; maintained runtime fixed colors: 0.\n'),
    backendLog: write(evidenceRoot, 'backend.log', backendLog([
      { file: 'tests/a.test.js', tests: 500 },
      { file: 'tests/b.test.js', tests: 701 }
    ]))
  };
}

function verifierOptions(files) {
  return {
    batch14Log: files.batch14Log,
    batch14Exit: 0,
    themeLog: files.themeLog,
    themeExit: 0,
    focusedLog: files.focusedLog,
    focusedExit: 0,
    prelaunchLog: files.prelaunchLog,
    prelaunchExit: 0,
    themeAuditLog: files.themeAuditLog,
    themeAuditExit: 0,
    backendLog: files.backendLog,
    backendExit: 0,
    expectedBatch14Tests: 3,
    expectedThemeTests: 43,
    expectedFocusedTests: 66,
    expectedPrelaunchTests: EXPECTED_ROUND11_PRELAUNCH_TESTS,
    expectedBackendFiles: 2,
    expectedBackendTests: 1201,
    expectedNodeVersion: '22.16.0',
    expectedNpmVersion: '10.9.2',
    sourceArchive: files.sourceArchive,
    expectedSourceSha256: files.sourceSha256,
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    packageManifest: files.packageManifest,
    packageRoot: files.packageRoot,
    runtime: { platform: 'win32', nodeVersion: '22.16.0', npmVersion: '10.9.2' }
  };
}

test('Batch40 FIX6D Windows acceptance manifest encodes every exact automated gate', () => {
  const commit = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const sourceArchive = 'candidate.zip';
  const sourceSha256 = 'c'.repeat(64);
  const manifest = buildManifest({
    commit,
    tree,
    sourceArchive,
    sourceSha256,
    payloadIdentityVerified: true,
    packageFiles: { 'RUN_ACCEPTANCE.cmd': 'd'.repeat(64) },
    generatedAtUtc: '2026-07-30T00:00:00.000Z'
  });

  assert.equal(PACKAGE_KIND, 'YANCE_BATCH40_FIX6D_WINDOWS_FULL_AUTOMATED_ACCEPTANCE');
  assert.equal(buildAcceptanceArchiveName(commit), 'YANCE_BATCH40_FIX6D_WINDOWS_FULL_AUTOMATED_ACCEPTANCE_aaaaaaa.zip');
  assert.equal(manifest.schemaVersion, 4);
  assert.equal(manifest.packageKind, PACKAGE_KIND);
  assert.equal(manifest.sourceCommit, commit);
  assert.equal(manifest.sourceTree, tree);
  assert.equal(manifest.sourceArchive, sourceArchive);
  assert.equal(manifest.sourceSha256, sourceSha256);
  assert.equal(manifest.payloadIdentityVerified, true);
  assert.deepEqual(manifest.packageFiles, { 'RUN_ACCEPTANCE.cmd': 'd'.repeat(64) });
  assert.equal(buildManifest({ commit, tree, sourceArchive, sourceSha256, payloadIdentityVerified: false }).payloadIdentityVerified, false);
  assert.equal(manifest.requiredPlatform, 'win32');
  assert.equal(manifest.requiredNodeVersion, '22.16.0');
  assert.equal(manifest.requiredNpmVersion, '10.9.2');
  assert.deepEqual(manifest.exactAutomatedGates, EXACT);
  assert.equal(manifest.externalEvidenceStatus, 'EVIDENCE_NOT_COLLECTED');
  assert.deepEqual(manifest.governance, {
    windowsUatStatus: 'WINDOWS_UAT_SOURCE_READY_EXTERNAL_EVIDENCE_REQUIRED',
    readyForPromotion: false,
    formalRelease: false
  });
  assert.equal(JSON.stringify(manifest).includes('"PASS"'), false);

  assert.equal(BATCH14_TEST_FILE, 'backend\\tests\\f25WindowsUatRepairBatch14.test.js');
  assert.equal(THEME_LAYOUT_TEST_FILES.length, 10);
  assert.equal(EXPECTED_ROUND11_PRELAUNCH_TESTS, 136);
  assert.equal(ROUND11_PRELAUNCH_TEST_FILES.length, 17);
  assert.ok(ROUND11_PRELAUNCH_TEST_FILES.includes('tests/uat/fix6dWindowsUiPublicContract.test.js'));
  assert.ok(ROUND11_PRELAUNCH_TEST_FILES.includes('tests/uat/fix6dWorkspaceEmptyStateContract.test.js'));
  assert.ok(ROUND11_PRELAUNCH_TEST_FILES.includes('tests/uat/fix6dScreenshotMatrixGate.test.js'));
  assert.ok(ROUND11_PRELAUNCH_TEST_FILES.includes('tests/uat/fix6dRouteScrollStateAuthority.test.js'));
  assert.ok(ROUND11_PRELAUNCH_TEST_FILES.includes('tests/uat/layoutDiagnosticsRouteAuthority.test.js'));
  assert.ok(THEME_LAYOUT_TEST_FILES.includes(BATCH14_TEST_FILE));

  const command = buildWindowsCommand({ commit, tree });
  assert.match(command, /SOURCE_COMMIT_MISMATCH/);
  assert.match(command, /SOURCE_TREE_MISMATCH/);
  assert.match(command, /BATCH14_THEME_CONTRACT\.tap/);
  assert.match(command, /THEME_LAYOUT_CONTRACT\.tap/);
  assert.match(command, /backend\\tests\\f25WindowsUatRepairBatch14\.test\.js/);
  assert.match(command, /backend\\tests\\batch40\*\.test\.js/);
  assert.match(command, /backend\\run_all_tests\.js/);
  assert.match(command, /FIX6D_UI_PRELAUNCH/);
  assert.match(command, /FIX6D_THEME_AUDIT/);
  assert.match(command, /verify-batch40-windows-evidence\.js/);
  assert.match(command, new RegExp(`\\s3\\s43\\s66\\s${EXPECTED_ROUND11_PRELAUNCH_TESTS}\\s200\\s1201\\s22\\.16\\.0\\s10\\.9\\.2\\s`));
  assert.doesNotMatch(command, /\s27\s192\s/);
  assert.doesNotMatch(command, /ACCEPTANCE_PASS/);

  assert.equal(assertExactTestRun({ output: tap(3), exitCode: 0, expectedTests: 3, label: 'Batch14' }).tests, 3);
  assert.throws(
    () => assertExactTestRun({ output: tap(2), exitCode: 0, expectedTests: 3, label: 'Batch14' }),
    /Batch14 test count 2 does not equal required 3/
  );
  assert.throws(
    () => assertExactTestRun({ output: tap(4), exitCode: 0, expectedTests: 3, label: 'Batch14' }),
    /Batch14 test count 4 does not equal required 3/
  );
  const identityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yb40-acceptance-binding-'));
  const identityRepo = path.join(identityRoot, 'repo');
  fs.mkdirSync(identityRepo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'fix6c-full-acceptance', identityRepo]);
  execFileSync('git', ['-C', identityRepo, 'config', 'user.name', 'Acceptance Test']);
  execFileSync('git', ['-C', identityRepo, 'config', 'user.email', 'acceptance@test.invalid']);
  fs.writeFileSync(path.join(identityRepo, 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(identityRepo, 'YANCE_SOURCE_CHECKPOINT.json'), '{}\n');
  fs.writeFileSync(path.join(identityRepo, 'YANCE_ARTIFACT_DESCRIPTOR.json'), '{}\n');
  execFileSync('git', ['-C', identityRepo, 'add', '.']);
  execFileSync('git', ['-C', identityRepo, 'commit', '-qm', 'fixture']);
  const identity = {
    branch: 'fix6c-full-acceptance',
    commit: String(execFileSync('git', ['-C', identityRepo, 'rev-parse', 'HEAD'])).trim(),
    tree: String(execFileSync('git', ['-C', identityRepo, 'rev-parse', 'HEAD^{tree}'])).trim(),
    parent: null
  };
  const identityArchive = path.join(identityRoot, 'candidate.zip');
  createIdentityBoundSourceArchive({
    repoRoot: identityRepo, outputPath: identityArchive, identity,
    artifact: { artifactClass: 'FIX6D_WINDOWS_FULL_ACCEPTANCE_SOURCE_CANDIDATE', artifactId: 'fixture', formalRelease: false, readyForPromotion: false }
  });
  assert.equal(verifyAcceptanceSourceBinding({ sourceArchive: identityArchive, identity }).ok, true);
  assert.throws(() => verifyAcceptanceSourceBinding({ sourceArchive: identityArchive, identity: { ...identity, tree: '0'.repeat(40) } }), /tree mismatch/);
  fs.rmSync(identityRoot, { recursive: true, force: true });

  assert.deepEqual(parseBackendRun(backendLog([
    { file: 'tests/a.test.js', tests: 2 },
    { file: 'tests/b.test.js', tests: 3 }
  ])), {
    completedFiles: 2,
    totalTests: 5,
    totalPass: 5,
    totalFail: 0,
    totalSkipped: 0,
    totalCancelled: 0,
    totalTodo: 0,
    allPassed: true
  });
});

test('one-click launcher binds the candidate SHA, runs all exact gates, and records a tamper rejection', () => {
  const sourceArchive = 'YANCE_BATCH40_UNIFIED_REPAIR_WORKING_TREE_64ea29f_FIX6D_WINDOWS_UI_GATE.zip';
  const sourceSha256 = '53cdfc28bd3563abaca0761a5b96daa0be5d80acfbe12476d6d8c62fc8e6bcf9';
  const script = buildOneClickPowerShell({
    sourceArchive,
    sourceSha256,
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40)
  });

  assert.match(buildOneClickLauncher(), /RUN_ACCEPTANCE\.ps1/);
  const compatibilityLauncher = buildCompatibilityLauncher();
  assert.match(compatibilityLauncher, /call "%~dp0RUN_ACCEPTANCE\.cmd"/i);
  assert.doesNotMatch(compatibilityLauncher, /git rev-parse|npm ci|backend\\run_all_tests\.js/i);
  assert.match(script, /node-v22\.16\.0-win-x64\.zip/);
  assert.match(script, /21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd/);
  assert.match(script, new RegExp(sourceSha256));
  assert.match(script, /Get-FileHash/);
  assert.match(script, /BATCH40_WINDOWS_ACCEPTANCE_MANIFEST\.json/);
  assert.match(script, /PACKAGE_FILE_SHA256_MISMATCH/);
  assert.deepEqual(
    findAmbiguousPowerShellVariableReferences(script),
    [],
    'generated PowerShell must brace ordinary variables before a literal colon'
  );
  assert.match(script, /packageManifest/);
  assert.match(script, /packageRoot/);
  assert.match(script, /SOURCE_BINDING_NEGATIVE/);
  assert.match(script, /SOURCE_PAYLOAD_NEGATIVE/);
  assert.match(script, /tampered-source\.zip/);
  assert.match(script, /Expand-Archive/);
  assert.match(script, /npm-cli\.js/);
  assert.match(script, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(script, /Invoke-Logged 'BATCH14_THEME_CONTRACT'/);
  assert.match(script, /Invoke-Logged 'THEME_LAYOUT_CONTRACT'/);
  assert.match(script, /Invoke-Logged 'BATCH40_FOCUSED'/);
  assert.match(script, /Invoke-Logged 'BATCH40_BACKEND_FULL'/);
  assert.match(script, /Invoke-Logged 'FIX6D_UI_PRELAUNCH'/);
  assert.match(script, /Invoke-Logged 'FIX6D_THEME_AUDIT'/);
  assert.match(script, /backend\\tests\\f25WindowsUatRepairBatch14\.test\.js/);
  for (const file of THEME_LAYOUT_TEST_FILES) {
    assert.match(script, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(script, /backend\\tests\\batch40\*\.test\.js/);
  assert.match(script, /backend\\run_all_tests\.js/);
  for (const file of ROUND11_PRELAUNCH_TEST_FILES) {
    assert.ok(script.includes(file.replaceAll('/', '\\')), `missing FIX6D prelaunch file: ${file}`);
  }
  assert.match(script, /scripts\\audit-theme-colors\.js/);
  assert.match(script, /verify-batch40-windows-evidence\.js/);
  assert.match(script, new RegExp(`'3', '43', '66', '${EXPECTED_ROUND11_PRELAUNCH_TESTS}', '200', '1201'`));
  assert.match(script, /\$SourceZip, \$ExpectedSourceSha256/);
  assert.match(script, /tests\\wp3\\windows-named-mutex-real\.test\.js/);
  assert.match(script, /WINDOWS_SYSTEM_THREADING_MUTEX/);
  assert.doesNotMatch(script, /windows-named-mutex-evidence\.js/);
  assert.match(script, /\[System\.IO\.Path\]::GetTempPath\(\)/);
  assert.match(script, /YANCE_TEST_TEMP_ROOT/);
  assert.match(script, /HEARTBEAT/);
  assert.match(script, /run-command-with-heartbeat\.js/);
  assert.match(script, /RUNNING STAGE/);
  assert.doesNotMatch(script, /Invoke-Logged 'BATCH40_BACKEND_FULL'.*\| Out-Null/);
  assert.match(script, /Compress-Archive/);
  assert.match(script, /AUTOMATED_SOURCE_GATES_COMPLETE_EXTERNAL_PLATFORM_EVIDENCE_REQUIRED/);
  assert.match(script, /readyForPromotion.*false/);
  assert.doesNotMatch(script, /\$env:Path\s*=/i);
  assert.doesNotMatch(script, /ACCEPTANCE_PASS/);

  const files = createVerifierFixture();
  try {
    const receipt = verifyEvidence(verifierOptions(files));
    assert.equal(receipt.sourceArchive.sha256, files.sourceSha256);
    assert.equal(receipt.sourceArchive.bindingStatus, 'SHA256_VERIFIED');
    assert.equal(receipt.acceptancePackage.packageKind, PACKAGE_KIND);
    assert.equal(receipt.acceptancePackage.manifestSha256, files.packageManifestSha256);
    assert.equal(receipt.acceptancePackage.packageFilesVerified, Object.keys(files.packageFiles).length);
    const outsideManifest = path.join(files.root, 'outside-manifest.json');
    fs.copyFileSync(files.packageManifest, outsideManifest);
    assert.throws(
      () => verifyEvidence({ ...verifierOptions(files), packageManifest: outsideManifest }),
      /Acceptance package manifest must be inside package root/
    );
    const originalManifest = fs.readFileSync(files.packageManifest);
    const incompleteManifest = JSON.parse(originalManifest);
    delete incompleteManifest.packageFiles['RUN_ACCEPTANCE.ps1'];
    fs.writeFileSync(files.packageManifest, `${JSON.stringify(incompleteManifest, null, 2)}\n`);
    assert.throws(() => verifyEvidence(verifierOptions(files)), /Acceptance package mandatory file hash is missing/);
    fs.writeFileSync(files.packageManifest, originalManifest);
    assert.equal(receipt.batch14.tests, 3);
    assert.equal(receipt.themeLayout.tests, 43);
    assert.equal(receipt.focused.tests, 66);
    assert.equal(receipt.fix6dPrelaunch.tests, EXPECTED_ROUND11_PRELAUNCH_TESTS);
    assert.equal(receipt.fix6cThemeAudit.status, 'PASS');
    assert.equal(receipt.backend.completedFiles, 2);
    assert.equal(receipt.backend.totalTests, 1201);
    assert.deepEqual(receipt.governance, { readyForPromotion: false, formalRelease: false });
    const defaultCountOptions = verifierOptions(files);
    delete defaultCountOptions.expectedBackendTests;
    assert.equal(verifyEvidence(defaultCountOptions).backend.totalTests, 1201);
    const runner = path.join(files.packageRoot, 'RUN_ACCEPTANCE.ps1');
    const originalRunner = fs.readFileSync(runner);
    fs.appendFileSync(runner, '# tampered\n');
    assert.throws(() => verifyEvidence(verifierOptions(files)), /Acceptance package file SHA-256 mismatch/);
    fs.writeFileSync(runner, originalRunner);
    assert.throws(
      () => verifyEvidence({ ...verifierOptions(files), expectedSourceSha256: '0'.repeat(64) }),
      /(?:Acceptance package source|Source archive) SHA-256 mismatch/
    );
    fs.writeFileSync(files.themeAuditLog, 'Theme color audit FAIL.\n');
    assert.throws(() => verifyEvidence(verifierOptions(files)), /FIX6D theme audit did not pass/);
    fs.writeFileSync(files.themeAuditLog, 'Theme color audit PASS. Legacy inline structural color debt: 0; maintained runtime fixed colors: 0.\n');
    assert.throws(
      () => verifyEvidence({ ...verifierOptions(files), expectedBackendTests: 1200 }),
      /(?:Acceptance package exact automated gates mismatch|Backend total test count 1201 does not equal required 1200)/
    );
    assert.throws(
      () => verifyEvidence({ ...verifierOptions(files), expectedFocusedTests: 65 }),
      /(?:Acceptance package exact automated gates mismatch|Batch40 focused test count 66 does not equal required 65)/
    );
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('acceptance package staging falls back to the writable output directory', () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), 'batch40-staging-test-'));
  const missingPreferredRoot = path.join(root, 'missing-temp-root');
  const outputRoot = path.join(root, 'output');
  fs.mkdirSync(outputRoot);
  const staging = createStagingDirectory(outputRoot, missingPreferredRoot);
  try {
    assert.equal(path.dirname(staging), outputRoot);
    assert.equal(fs.statSync(staging).isDirectory(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
