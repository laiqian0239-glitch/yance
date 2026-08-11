#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { signAuthenticode } = require('./windows-authenticode');
const { validateRoundPair } = require('../release-closure/windows-round-binding');
const {
  FINAL_PACKAGING_TOKEN,
  REPO_ROOT,
  assertActivationBinding,
  buildAuthorizedFinalWindowsInstaller,
  canonicalJsonBuffer,
  gitIdentity,
  sha256File
} = require('./lib');

const REQUIRED_OPTIONS = Object.freeze([
  'output-root',
  'preacceptance-record',
  'preacceptance-sha256',
  'windows-round1-result',
  'windows-round1-sha256',
  'windows-round2-result',
  'windows-round2-sha256',
  'electron-dist',
  'electron-archive',
  'compiler-path',
  'trusted-node-executable',
  'expected-branch',
  'expected-commit',
  'expected-tree',
  'build-timestamp-utc'
]);

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    if (Object.hasOwn(result, key)) throw new Error(`duplicate option --${key}`);
    result[key] = value;
    index += 1;
  }
  for (const key of REQUIRED_OPTIONS) if (!result[key]) throw new Error(`missing required option --${key}`);
  return result;
}

function assertSha256(value, label) {
  if (!/^[0-9a-f]{64}$/.test(String(value || ''))) throw new Error(`${label} must be a lowercase SHA256`);
}

function assertGitObject(value, label) {
  if (!/^[0-9a-f]{40}$/.test(String(value || ''))) throw new Error(`${label} must be a Git object ID`);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertExternalOutput(repoRoot, outputRoot) {
  if (isInside(repoRoot, outputRoot)) throw new Error('builder output must be outside the source repository');
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`${label} is missing: ${filePath}`);
}

function assertDirectory(directory, label) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) throw new Error(`${label} is missing: ${directory}`);
}

function canonicalTimestamp(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new Error('build timestamp must be a canonical UTC ISO timestamp');
  return value;
}

function createBuilderResult(options) {
  const repoRoot = fs.realpathSync(path.resolve(options.repoRoot || REPO_ROOT));
  if (repoRoot !== fs.realpathSync(REPO_ROOT)) throw new Error('builder runner must execute from its own frozen source repository');
  if (process.platform !== 'win32' && options.allowNonWindows !== true) throw new Error('formal Windows Builder must run on Windows');

  const outputRoot = path.resolve(options.outputRoot);
  assertExternalOutput(repoRoot, outputRoot);
  assertGitObject(options.expectedCommit, 'expected commit');
  assertGitObject(options.expectedTree, 'expected tree');
  assertSha256(options.preacceptanceSha256, 'preacceptance SHA256');
  const buildTimestampUtc = canonicalTimestamp(options.buildTimestampUtc);

  const preacceptanceRecordPath = path.resolve(options.preacceptanceRecordPath);
  const electronDist = path.resolve(options.electronDist);
  const electronArchivePath = path.resolve(options.electronArchivePath);
  const compilerPath = path.resolve(options.compilerPath);
  const trustedNodeExecutable = path.resolve(options.trustedNodeExecutable);
  const requirePlatformAuth = options.requirePlatformAuth === true;
  const platformAuthConfigPath = options.platformAuthConfigPath ? path.resolve(options.platformAuthConfigPath) : null;
  const platformAuthHashPath = options.platformAuthHashPath ? path.resolve(options.platformAuthHashPath) : null;
  const requireSignedInstaller = options.requireSignedInstaller === true;
  const signingCertificatePath = options.signingCertificatePath ? path.resolve(options.signingCertificatePath) : null;
  const signToolPath = options.signToolPath ? path.resolve(options.signToolPath) : null;
  assertFile(preacceptanceRecordPath, 'preacceptance record');
  assertDirectory(electronDist, 'Electron distribution');
  assertFile(path.join(electronDist, 'electron.exe'), 'Electron executable');
  assertFile(electronArchivePath, 'official Electron archive');
  assertFile(compilerPath, 'NSIS compiler');
  assertFile(trustedNodeExecutable, 'trusted Node runtime executable');
  if (path.extname(compilerPath).toLowerCase() !== '.exe') throw new Error('formal NSIS compiler must be a native .exe');
  if (requirePlatformAuth) {
    assertFile(platformAuthConfigPath, 'sealed platform auth configuration');
    assertFile(platformAuthHashPath, 'platform auth detached SHA-256');
  } else if (Boolean(platformAuthConfigPath) !== Boolean(platformAuthHashPath)) {
    throw new Error('platform auth configuration and SHA-256 must be supplied together');
  }
  if (requireSignedInstaller) {
    assertFile(signingCertificatePath, 'Windows signing certificate');
    assertFile(signToolPath, 'signtool.exe');
    if (!process.env.YANCE_WINDOWS_CERTIFICATE_PASSWORD) throw new Error('YANCE_WINDOWS_CERTIFICATE_PASSWORD is required for signed release builds');
  }
  if (sha256File(preacceptanceRecordPath) !== options.preacceptanceSha256) throw new Error('preacceptance SHA256 mismatch');

  let windowsRoundBinding = null;
  if (process.platform === 'win32' || options.requireWindowsRoundBinding === true) {
    windowsRoundBinding = validateRoundPair({
      round1Result: options.windowsRound1Result,
      round1Sha256: options.windowsRound1Sha256,
      round2Result: options.windowsRound2Result,
      round2Sha256: options.windowsRound2Sha256,
      expectedCommit: options.expectedCommit,
      expectedTree: options.expectedTree,
      expectedBranch: options.expectedBranch
    });
    const preacceptance = JSON.parse(fs.readFileSync(preacceptanceRecordPath, 'utf8').replace(/^\uFEFF/, ''));
    const validation = preacceptance.windowsInternalValidation || {};
    if (validation.status !== 'PASS_TWO_INDEPENDENT_STRICT_ROUNDS' ||
        validation.round1ResultSha256 !== windowsRoundBinding.round1.sha256 ||
        validation.round2ResultSha256 !== windowsRoundBinding.round2.sha256 ||
        validation.bundleSha256 !== windowsRoundBinding.bundleSha256 ||
        validation.runnerSha256 !== windowsRoundBinding.runnerSha256) {
      throw new Error('preacceptance record is not bound to the validated Windows Round 1 and Round 2 results');
    }
  }

  const before = gitIdentity(repoRoot);
  assertActivationBinding(repoRoot, { identity: before, requireClean: true, requireBranch: true });
  if (before.sourceCommit !== options.expectedCommit || before.sourceTree !== options.expectedTree || before.branch !== options.expectedBranch) throw new Error('source identity does not match the expected Branch/Commit/Tree');

  const built = buildAuthorizedFinalWindowsInstaller({
    repoRoot,
    outputRoot,
    authorizationToken: FINAL_PACKAGING_TOKEN,
    preacceptanceRecordPath,
    preacceptanceRecordSha256: options.preacceptanceSha256,
    buildTimestampUtc,
    allowNonWindows: options.allowNonWindows === true,
    allowNonWindowsCompiler: options.allowNonWindows === true,
    installProductionDependencies: true,
    electronDist,
    electronArchivePath,
    compilerPath,
    rceditPath: options.rceditPath ? path.resolve(options.rceditPath) : undefined,
    iconPath: options.iconPath ? path.resolve(options.iconPath) : path.join(repoRoot, 'frontend', 'assets', 'icon.ico'),
    trustedNodeExecutable: path.resolve(options.trustedNodeExecutable),
    platformAuthConfigPath,
    platformAuthHashPath,
    requirePlatformAuth,
    requireSignedInstaller,
    signInstaller: requireSignedInstaller ? ({ filePath }) => signAuthenticode({
      filePath,
      certificatePath: signingCertificatePath,
      signToolPath,
      timestampUrl: options.timestampUrl,
      password: process.env.YANCE_WINDOWS_CERTIFICATE_PASSWORD
    }) : undefined
  });

  const after = gitIdentity(repoRoot);
  assertActivationBinding(repoRoot, { identity: after, requireClean: true, requireBranch: true });
  if (after.sourceCommit !== before.sourceCommit || after.sourceTree !== before.sourceTree) throw new Error('source identity changed during Builder execution');

  const result = {
    schemaVersion: 1,
    documentType: 'YANCE_WINDOWS_FINAL_BUILDER_RESULT',
    status: 'PASS',
    generatedAtUtc: new Date().toISOString(),
    buildTimestampUtc,
    sourceCommit: before.sourceCommit,
    sourceTree: before.sourceTree,
    sourceBranch: before.branch,
    outputRoot,
    installerFile: built.outputFile,
    installerSizeBytes: fs.statSync(built.outputFile).size,
    installerSha256: built.installerSha256,
    latestYmlFile: built.latestYmlPath,
    latestYmlSha256: built.latestYmlSha256,
    blockmapFile: built.blockmapPath,
    blockmapSha256: built.blockmapSha256,
    releaseEvidenceFile: built.evidencePath,
    releaseEvidenceSha256: sha256File(built.evidencePath),
    buildSessionSealFile: path.join(outputRoot, 'build-session-seal.json'),
    buildSessionSealSha256: sha256File(path.join(outputRoot, 'build-session-seal.json')),
    electronArchiveSha256: sha256File(electronArchivePath),
    trustedNodeExecutableSha256: sha256File(trustedNodeExecutable),
    compilerSha256: sha256File(compilerPath),
    preacceptanceRecordSha256: options.preacceptanceSha256,
    windowsRound1ResultSha256: windowsRoundBinding?.round1.sha256 || null,
    windowsRound2ResultSha256: windowsRoundBinding?.round2.sha256 || null,
    windowsRoundBundleSha256: windowsRoundBinding?.bundleSha256 || null,
    windowsRoundRunnerSha256: windowsRoundBinding?.runnerSha256 || null,
    publicProductName: built.releaseSource.publicProductName,
    publicVersion: built.releaseSource.publicVersion,
    productVersion: built.releaseSource.productVersion,
    authenticodeStatus: built.authenticode?.signatureStatus || 'Unsigned',
    authenticodeSignerThumbprint: built.authenticode?.signerThumbprint || null,
    platformAuthConfigured: built.platformAuth?.configured === true,
    platformAuthConfigSha256: built.platformAuth?.sha256 || null,
    sourceIdentityStable: true,
    gitCleanAfter: true
  };
  fs.writeFileSync(path.join(outputRoot, 'builder-result.json'), canonicalJsonBuffer(result));
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = createBuilderResult({
    outputRoot: args['output-root'],
    preacceptanceRecordPath: args['preacceptance-record'],
    preacceptanceSha256: args['preacceptance-sha256'],
    windowsRound1Result: args['windows-round1-result'],
    windowsRound1Sha256: args['windows-round1-sha256'],
    windowsRound2Result: args['windows-round2-result'],
    windowsRound2Sha256: args['windows-round2-sha256'],
    electronDist: args['electron-dist'],
    electronArchivePath: args['electron-archive'],
    compilerPath: args['compiler-path'],
    trustedNodeExecutable: args['trusted-node-executable'],
    rceditPath: args['rcedit-path'],
    iconPath: args['icon-path'],
    expectedBranch: args['expected-branch'],
    expectedCommit: args['expected-commit'],
    expectedTree: args['expected-tree'],
    buildTimestampUtc: args['build-timestamp-utc'],
    requireSignedInstaller: args['require-signed-installer'] === 'true',
    signingCertificatePath: args['signing-certificate'],
    signToolPath: args['signtool-path'],
    timestampUrl: args['timestamp-url'],
    platformAuthConfigPath: args['platform-auth-config'],
    platformAuthHashPath: args['platform-auth-sha256'],
    requirePlatformAuth: args['require-platform-auth'] === 'true'
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  REQUIRED_OPTIONS,
  assertExternalOutput,
  canonicalTimestamp,
  createBuilderResult,
  parseArgs
};
