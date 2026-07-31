'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  CHECKPOINT_FILE,
  DESCRIPTOR_FILE,
  createIdentityBoundSourceArchive,
  sha256File,
  zipEntries,
} = require('./identity-bound-source-archive');

const UAT_TAG = 'audit-batch40-fix6d-windows-ui-uat-20260731';
const ARTIFACT_CLASS = 'BATCH40_FIX6D_WINDOWS_UI_UAT_CANDIDATE';

function git(root, args) {
  return String(execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })).trim();
}

function repositoryIdentity(repoRoot) {
  const commit = git(repoRoot, ['rev-parse', 'HEAD']);
  const lineage = git(repoRoot, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/u);
  const branch = git(repoRoot, ['branch', '--show-current']);
  if (!branch) throw new Error('working tree must be on a named branch');
  return {
    branch,
    commit,
    tree: git(repoRoot, ['rev-parse', 'HEAD^{tree}']),
    parent: lineage[1] || null,
  };
}

function render(file, values) {
  let source = fs.readFileSync(file, 'utf8');
  for (const [key, value] of Object.entries(values)) source = source.split(key).join(String(value));
  if (/__[A-Z0-9_]+__/u.test(source)) throw new Error(`unresolved placeholder in ${file}`);
  return source;
}

function write(templateRoot, packageRoot, template, output, values, { ascii = false, crlf = false } = {}) {
  let source = render(path.join(templateRoot, template), values);
  if (crlf) source = source.replace(/\r?\n/gu, '\r\n');
  if (ascii) {
    if (!/^[\x00-\x7F]*$/u.test(source)) throw new Error(`${output} must be ASCII`);
    fs.writeFileSync(path.join(packageRoot, output), Buffer.from(source, 'ascii'));
    return;
  }
  fs.writeFileSync(path.join(packageRoot, output), source, 'utf8');
}

function writeAsciiCommand(packageRoot, output, lines) {
  const source = `${lines.join('\r\n')}\r\n`;
  if (!/^[\x00-\x7F]*$/u.test(source)) throw new Error(`${output} must be ASCII`);
  fs.writeFileSync(path.join(packageRoot, output), Buffer.from(source, 'ascii'));
}

function buildUiLauncher({ isolated = false } = {}) {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'cd /d "%~dp0"',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.ps1"${isolated ? ' -UseIsolatedData' : ''} %*`,
    'set "EXIT_CODE=%ERRORLEVEL%"',
    'if not "%EXIT_CODE%"=="0" pause',
    'exit /b %EXIT_CODE%'
  ];
}

function buildEvidenceLauncher() {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'cd /d "%~dp0"',
    'call "%~dp0COLLECT_YANCE_ROUND11_UI_EVIDENCE.cmd" %*',
    'exit /b %ERRORLEVEL%'
  ];
}

function listZipEntryNames(zipPath) {
  return zipEntries(zipPath).entries.map(entry => entry.name);
}

function assertUniqueZipEntries(zipPath) {
  const names = listZipEntryNames(zipPath);
  if (new Set(names).size !== names.length) throw new Error('ZIP contains duplicate entries');
  for (const file of [CHECKPOINT_FILE, DESCRIPTOR_FILE]) {
    const count = names.filter(name => name === file).length;
    if (count !== 1) throw new Error(`ZIP must contain exactly one ${file}; actual=${count}`);
  }
  return names;
}

function createIdentityBoundArchive(repoRoot, payloadPath, options) {
  if (!options || typeof options !== 'object') throw new TypeError('identity archive options are required');
  const result = createIdentityBoundSourceArchive({
    repoRoot,
    outputPath: payloadPath,
    identity: options.identity,
    artifact: options.artifact,
  });
  assertUniqueZipEntries(payloadPath);
  return result;
}

function createPackage(repoRoot, outputRoot) {
  if (git(repoRoot, ['status', '--porcelain'])) throw new Error('working tree must be clean');
  const identity = repositoryIdentity(repoRoot);
  const { branch, commit, tree, parent } = identity;
  const short = commit.slice(0, 7);
  const packageRoot = path.join(path.resolve(outputRoot), `YANCE_BATCH40_FIX6D_WINDOWS_UI_UAT_${short}`);
  const payloadRoot = path.join(packageRoot, 'payload');
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(payloadRoot, { recursive: true });

  const payloadName = `YANCE_BATCH40_FIX6D_UI_UAT_SOURCE_${short}.zip`;
  const payloadPath = path.join(payloadRoot, payloadName);
  const artifactId = `${UAT_TAG}-${short}`;
  const archive = createIdentityBoundArchive(repoRoot, payloadPath, {
    identity,
    artifact: {
      artifactType: 'WINDOWS_UI_SOURCE_CANDIDATE',
      artifactClass: ARTIFACT_CLASS,
      artifactId,
      formalRelease: false,
      readyForPromotion: false,
      windowsUiUat: false,
    },
  });

  const payloadSha256 = sha256File(payloadPath);
  const values = {
    '__EXPECTED_COMMIT__': commit,
    '__EXPECTED_TREE__': tree,
    '__EXPECTED_BRANCH__': branch,
    '__SHORT_COMMIT__': short,
    '__PAYLOAD_NAME__': payloadName,
    '__PAYLOAD_SHA256__': payloadSha256,
  };
  const templates = path.join(repoRoot, 'tools', 'runtime-delivery', 'templates');
  write(templates, packageRoot, 'INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.cmd.template', 'INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.cmd', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.ps1.template', 'INSTALL_TEST_AND_START_YANCE_ROUND11_UAT.ps1', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'COLLECT_YANCE_ROUND11_UI_EVIDENCE.cmd.template', 'COLLECT_YANCE_ROUND11_UI_EVIDENCE.cmd', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'COLLECT_YANCE_ROUND11_UI_EVIDENCE.ps1.template', 'COLLECT_YANCE_ROUND11_UI_EVIDENCE.ps1', values, { ascii: true, crlf: true });
  write(templates, packageRoot, 'YANCE_ROUND11_UAT_README_ZH.md.template', 'README_FIRST_ZH.md', values);

  writeAsciiCommand(packageRoot, 'START_YANCE_WINDOWS_UI_UAT.cmd', buildUiLauncher());
  writeAsciiCommand(packageRoot, 'START_YANCE_WINDOWS_UI_UAT_ISOLATED.cmd', buildUiLauncher({ isolated: true }));
  writeAsciiCommand(packageRoot, 'COLLECT_YANCE_UI_EVIDENCE.cmd', buildEvidenceLauncher());

  const manifest = {
    schemaVersion: 3,
    documentType: 'YANCE_BATCH40_FIX6D_WINDOWS_UI_UAT_PACKAGE',
    generatedAtUtc: new Date().toISOString(),
    artifactClass: ARTIFACT_CLASS,
    artifactId,
    branch,
    commit,
    tree,
    parent,
    payload: { fileName: payloadName, sha256: payloadSha256 },
    identityFiles: [CHECKPOINT_FILE, DESCRIPTOR_FILE],
    payloadIdentityVerified: archive.verification.ok === true,
    formalRelease: false,
    realWindowsUatRequired: true,
    windowsPowerShell51Compatible: true,
    dataRootSelection: 'verified-clone-or-fresh-isolated',
    runtimeDataIsolation: {
      normalMode: 'verified-clone',
      isolatedMode: 'fresh-per-run',
      realDataMutationAllowed: false,
    },
    startupDiagnostics: {
      automaticOnFailure: true,
      sanitizer: 'tools/runtime-delivery/sanitize-windows-ui-uat-diagnostic.js',
      databasesCopied: false,
      credentialStoresCopied: false,
    },
    topLevelInstallEntry: 'START_YANCE_WINDOWS_UI_UAT.cmd',
    isolatedInstallEntry: 'START_YANCE_WINDOWS_UI_UAT_ISOLATED.cmd',
    evidenceEntry: 'COLLECT_YANCE_UI_EVIDENCE.cmd',
    payloadEntryUniquenessVerified: true,
  };
  fs.writeFileSync(path.join(packageRoot, 'ROUND11_UAT_MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  const files = [];
  for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.isFile()) files.push({ name: entry.name, sha256: sha256File(path.join(packageRoot, entry.name)) });
  }
  files.push({ name: `payload/${payloadName}`, sha256: payloadSha256 });
  fs.writeFileSync(
    path.join(packageRoot, 'SHA256SUMS.txt'),
    files.sort((a, b) => a.name.localeCompare(b.name)).map(item => `${item.sha256}  ${item.name}`).join('\n') + '\n',
  );
  return { packageRoot, manifest };
}

if (require.main === module) {
  try {
    const repo = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
    const output = path.resolve(process.argv[3] || path.join(repo, '.tmp', 'round11-uat-package'));
    process.stdout.write(JSON.stringify(createPackage(repo, output), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildEvidenceLauncher,
  buildUiLauncher,
  assertUniqueZipEntries,
  createIdentityBoundArchive,
  createPackage,
  listZipEntryNames,
  repositoryIdentity,
  sha256File,
};
