#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createGitTreeZip,
  ensureExternalOutput,
  git,
  gitText,
  readRepositoryIdentity,
  resolveRepositoryRoot,
  run,
  sha256File,
  verifySourceSeal,
  verifyStandardChecksums,
  writeStandardChecksums
} = require('./source-seal-lib');

const DEFAULT_STAGE6_COMMIT = '4a21ec3b127af8a9362bdc06bf47ef9023138b39';

function parseArgs(argv) {
  const args = { baseCommit: DEFAULT_STAGE6_COMMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--output-dir') args.outputDir = argv[++index];
    else if (value === '--base-commit') args.baseCommit = argv[++index];
    else if (value === '--repo') args.repo = argv[++index];
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node tools/release-closure/create-source-seal.js --output-dir <external-empty-directory> [--base-commit <commit>] [--repo <path>]',
    '',
    'The output directory must be outside the Git worktree and empty.'
  ].join('\n');
}

function changedFiles(repoRoot, baseCommit, head) {
  const raw = git(repoRoot, ['diff', '--name-status', '-z', '--find-renames', baseCommit, head], { encoding: null }).stdout;
  const parts = raw.toString('utf8').split('\0').filter(Boolean);
  const records = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index++];
    if (/^[RC]/.test(status)) records.push({ status, from: parts[index++], path: parts[index++] });
    else records.push({ status, path: parts[index++] });
  }
  return records;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.outputDir) throw new Error(`--output-dir is required\n\n${usage()}`);

  const repoRoot = resolveRepositoryRoot(args.repo || process.cwd());
  const identity = readRepositoryIdentity(repoRoot, args.baseCommit);
  const outputDir = ensureExternalOutput(repoRoot, args.outputDir);
  const shortHead = identity.head.slice(0, 12);
  const sourcePrefix = `Yance_WINDOWS_RELEASE_SOURCE_${shortHead}`;
  const bundleFile = `${sourcePrefix}.bundle`;
  const sourceZipFile = `${sourcePrefix}.zip`;
  const patchFile = `Yance_STAGE6_TO_${shortHead}.patch`;
  const identityFile = 'SOURCE_SEAL_IDENTITY.json';
  const verificationFile = 'SOURCE_SEAL_VERIFICATION.json';
  const reportFile = `Yance_WINDOWS_RELEASE_SOURCE_${shortHead}_REPORT.md`;
  const checksumFile = 'SHA256SUMS.txt';

  const bundlePath = path.join(outputDir, bundleFile);
  const sourceZipPath = path.join(outputDir, sourceZipFile);
  const patchPath = path.join(outputDir, patchFile);

  git(repoRoot, ['bundle', 'create', bundlePath, identity.branch]);
  createGitTreeZip(repoRoot, identity.head, sourceZipPath, sourcePrefix);
  const patch = git(repoRoot, ['diff', '--binary', '--full-index', '--no-ext-diff', identity.baseCommit, identity.head], { encoding: null }).stdout;
  fs.writeFileSync(patchPath, patch, { flag: 'wx' });

  const sealIdentity = Object.freeze({
    schemaVersion: 1,
    identityClass: 'YANCE_WINDOWS_RELEASE_SOURCE_SEAL',
    generatedAt: new Date().toISOString(),
    branch: identity.branch,
    head: identity.head,
    tree: identity.tree,
    baseCommit: identity.baseCommit,
    baseTree: identity.baseTree,
    sourcePrefix,
    bundleFile,
    sourceZipFile,
    patchFile,
    identityFile,
    verificationFile,
    reportFile,
    checksumFile,
    generator: 'tools/release-closure/create-source-seal.js',
    changedFiles: changedFiles(repoRoot, identity.baseCommit, identity.head)
  });
  writeJson(path.join(outputDir, identityFile), sealIdentity);

  const verification = verifySourceSeal(outputDir);
  if (!verification.pass) {
    writeJson(path.join(outputDir, verificationFile), verification);
    throw new Error(`source seal verification failed: ${JSON.stringify(verification, null, 2)}`);
  }
  writeJson(path.join(outputDir, verificationFile), verification);

  const diffStat = gitText(repoRoot, ['diff', '--stat', identity.baseCommit, identity.head]);
  const report = [
    '# Yance Windows Release Source Seal',
    '',
    `Generated: ${sealIdentity.generatedAt}`,
    '',
    '## Source identity',
    '',
    `- Branch: \`${identity.branch}\``,
    `- HEAD: \`${identity.head}\``,
    `- Tree: \`${identity.tree}\``,
    `- Stage6 base: \`${identity.baseCommit}\``,
    `- Stage6 tree: \`${identity.baseTree}\``,
    '- Worktree at generation: clean',
    '',
    '## Independent verification',
    '',
    `- Bundle verify: ${verification.bundleVerifyExitCode === 0 ? 'PASS' : 'FAIL'}`,
    `- Independent clone identity: ${verification.clone.pass ? 'PASS' : 'FAIL'}`,
    `- Clone fsck: ${verification.clone.fsckExitCode === 0 ? 'PASS' : 'FAIL'}`,
    `- Source ZIP / Git Tree: ${verification.zip.pass ? 'PASS' : 'FAIL'} (${verification.zip.zipPathCount}/${verification.zip.gitPathCount})`,
    `- ZIP blob mismatches: ${verification.zip.blobMismatches.length}`,
    `- ZIP mode mismatches: ${verification.zip.modeMismatches.length}`,
    `- Stage6 patch rebuild Tree: ${verification.patch.pass ? 'PASS' : 'FAIL'}`,
    `- Patch UTF-8 BOM: ${verification.patchHasBom ? 'PRESENT (FAIL)' : 'ABSENT (PASS)'}`,
    '',
    '## Stage6 → HEAD diff stat',
    '',
    '```text',
    diffStat,
    '```',
    '',
    'Generated Evidence and historical test outputs are intentionally excluded from the source repository and must remain external.',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, reportFile), report, { encoding: 'utf8', flag: 'wx' });

  const checksumInputs = [bundleFile, sourceZipFile, patchFile, identityFile, verificationFile, reportFile];
  writeStandardChecksums(outputDir, checksumInputs, checksumFile);
  const checksumVerification = verifyStandardChecksums(outputDir, path.join(outputDir, checksumFile));
  if (!checksumVerification.pass) throw new Error('generated SHA256SUMS verification failed');

  const finalIdentity = {
    ...sealIdentity,
    outputDirectory: outputDir,
    checksumsSha256: sha256File(path.join(outputDir, checksumFile)),
    verificationPass: true
  };
  process.stdout.write(`${JSON.stringify(finalIdentity, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  if (error.reasonCode) process.stderr.write(`${JSON.stringify({ reasonCode: error.reasonCode, details: error.details || {} })}\n`);
  process.exitCode = 1;
}
