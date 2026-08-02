'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  CURRENT_STAGE,
  REPO_ROOT,
  readJson,
  sha256File,
  runAllChecks,
  scanRepositoryReleaseSurfaces,
  checkRepositoryScope,
  checkProtectedCommandPolicy,
  verifyRejectedBaselineAnchor,
  writeJson
} = require('./lib');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

const explicitOutput = argValue('--output-dir');
const generatedAtUtc = argValue('--generated-at-utc') || new Date().toISOString();
const requestedSourceCommit = argValue('--source-commit');
const requestedBranch = argValue('--branch');

function emitPreflightFailure(reasonCode, detail = {}) {
  process.stdout.write(`${JSON.stringify({
    status: 'FAIL',
    reasonCode,
    ...detail
  }, null, 2)}\n`);
  process.exit(3);
}

let actualHead;
let actualTree;
let actualBranch;
try {
  actualHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  actualTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  actualBranch = execFileSync('git', ['branch', '--show-current'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() || null;
} catch (error) {
  emitPreflightFailure('WP0_EVIDENCE_GIT_IDENTITY_UNAVAILABLE', {
    message: 'Unable to resolve the tested Git HEAD and tree.',
    exitCode: error.status ?? null
  });
}

let sourceCommit = actualHead;
if (requestedSourceCommit) {
  if (!/^[0-9a-f]{40}$/.test(requestedSourceCommit)) {
    emitPreflightFailure('WP0_EVIDENCE_SOURCE_COMMIT_NOT_FOUND', {
      requestedSourceCommit,
      actualHead,
      message: 'sourceCommit must be a full 40-character commit object ID present in this repository.'
    });
  }
  let resolvedRequestedCommit;
  try {
    resolvedRequestedCommit = execFileSync('git', ['rev-parse', '--verify', `${requestedSourceCommit}^{commit}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    }).trim();
  } catch {
    emitPreflightFailure('WP0_EVIDENCE_SOURCE_COMMIT_NOT_FOUND', {
      requestedSourceCommit,
      actualHead,
      message: 'The requested sourceCommit does not resolve to a commit in this repository.'
    });
  }
  if (resolvedRequestedCommit !== actualHead || requestedSourceCommit !== actualHead) {
    emitPreflightFailure('WP0_EVIDENCE_SOURCE_COMMIT_MISMATCH', {
      requestedSourceCommit,
      resolvedRequestedCommit,
      actualHead,
      actualTree,
      message: 'Evidence must be generated inside the exact commit being tested. For a historical commit, create a detached worktree at that commit and run the tests and generator there.'
    });
  }
  sourceCommit = actualHead;
}

if (requestedBranch && requestedBranch !== actualBranch) {
  emitPreflightFailure('WP0_EVIDENCE_BRANCH_MISMATCH', {
    requestedBranch,
    actualBranch,
    actualHead
  });
}

const porcelainStatus = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
  cwd: REPO_ROOT,
  encoding: 'utf8'
});
const repositoryClean = porcelainStatus.length === 0;
if (!repositoryClean) {
  emitPreflightFailure('WP0_EVIDENCE_REPOSITORY_DIRTY', {
    actualHead,
    actualTree,
    repositoryClean: false,
    changedPathCount: porcelainStatus.split(/\r?\n/).filter(Boolean).length,
    message: 'Formal evidence generation requires a clean worktree and index.'
  });
}

const sourceTree = actualTree;
const branch = actualBranch;
const nodeTestTapSource = argValue('--node-test-tap');
const outputDir = explicitOutput
  ? path.resolve(REPO_ROOT, explicitOutput)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp0-evidence-'));
const committedEvidenceDir = path.resolve(REPO_ROOT, 'evidence', 'wp0');
if (outputDir === committedEvidenceDir && !hasArg('--allow-repository-output')) {
  process.stderr.write('Refusing to overwrite committed evidence. Use a temporary --output-dir, or add --allow-repository-output for an intentional evidence commit.\n');
  process.exit(2);
}

const policyPath = path.join(REPO_ROOT, 'governance', 'stage-policy.json');
const rejectedPath = path.join(REPO_ROOT, 'governance', 'rejected-baselines', 'stage-6.4.5.8.json');
const baselineLockPath = path.join(REPO_ROOT, 'governance', 'r5-baseline-lock.json');
const policy = readJson(policyPath);
const rejected = readJson(rejectedPath);
const baselineLock = readJson(baselineLockPath);
const checks = runAllChecks({
  targetStage: CURRENT_STAGE,
  branch: actualBranch,
  evidenceMode: true,
  evidenceSourceCommit: sourceCommit
});
const fullScan = scanRepositoryReleaseSurfaces();
const repositoryScope = checkRepositoryScope();
const commandPolicy = checkProtectedCommandPolicy();
const baselineAnchor = verifyRejectedBaselineAnchor();
const allPass = checks.every((item) => item.pass);
const failed = checks.filter((item) => !item.pass);

const localCommandExecutions = [];
for (const command of ['build', 'package', 'release']) {
  try {
    const protectedCommandArgs = ['tools/wp0/run-protected-command.js', command, '--gate-only'];
    if (actualBranch === null) protectedCommandArgs.push('--evidence-source-commit', sourceCommit);
    const stdout = execFileSync(process.execPath, protectedCommandArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    localCommandExecutions.push(JSON.parse(stdout));
  } catch (error) {
    let parsed = null;
    try { parsed = JSON.parse(String(error.stdout || '')); } catch { parsed = null; }
    localCommandExecutions.push(parsed || {
      status: 'FAIL',
      reasonCode: 'WP0_LOCAL_GATE_EXECUTION_FAILED',
      command,
      exitCode: error.status ?? null,
      stderr: String(error.stderr || '').slice(0, 2000)
    });
  }
}
const localCommandsPass = commandPolicy.pass && localCommandExecutions.every((item) => item.status === 'PASS');

const common = {
  schemaVersion: 2,
  stage: CURRENT_STAGE,
  phase: 'core-runtime-p1',
  workPackage: 'WP0',
  baselinePackageId: baselineLock.packageId,
  generatedAtUtc,
  sourceCommit,
  sourceTree,
  repositoryClean,
  branch
};

function out(name) { return path.join(outputDir, name); }

writeJson(out('freeze-policy.json'), {
  ...common,
  status: checks[0].pass ? 'PASS' : 'FAIL',
  reasonCode: checks[0].reasonCode,
  currentStage: policy.currentStage,
  rejectedBaseline: rejected,
  baselineAnchor,
  policySha256: sha256File(policyPath),
  rejectedBaselineSha256: sha256File(rejectedPath),
  r5BaselineLockSha256: sha256File(baselineLockPath),
  runtimeTargetGate: checks[0].details.runtimeTargetGate,
  violations: checks[0].errors
});

writeJson(out('overlay-installer-scan.json'), {
  ...common,
  status: fullScan.violationCount === 0 ? 'PASS' : 'FAIL',
  reasonCode: fullScan.violationCount === 0 ? null : 'WP0_REPOSITORY_RELEASE_SURFACE_VIOLATION',
  scanPolicy: {
    enumerationMethod: 'git ls-files -z',
    scansCompleteTrackedCandidateTree: true,
    candidateExtensions: ['ps1', 'cmd', 'bat', 'nsh', 'iss', 'js', 'cjs', 'mjs', 'json', 'yml', 'yaml'],
    candidateDirectories: ['installer', 'installers', 'packaging', 'build-scripts', 'release-scripts', 'deploy', 'tools'],
    policyTestAndEvidenceReferencesAreClassifiedButNotTreatedAsExecutableEntrypoints: true,
    rejectsOldInstallerPlusAppAsarUnpackedOverlay: true,
    rejectsStage6458HotfixRevisionAndCompleteInstallerEntrypoints: true
  },
  ...fullScan
});

writeJson(out('distribution-mode.json'), {
  ...common,
  status: checks[2].pass ? 'PASS' : 'FAIL',
  reasonCode: checks[2].reasonCode,
  distributionMode: policy.distributionMode,
  privateSingleOwner: policy.privateSingleOwner,
  publicRelease: policy.publicRelease,
  authenticodeRequired: policy.authenticodeRequired,
  microsoftStoreRequired: policy.microsoftStoreRequired,
  manifestDigitalSignatureRequired: policy.manifestDigitalSignatureRequired,
  unknownPublisherAccepted: policy.unknownPublisherAccepted,
  violations: checks[2].errors
});

writeJson(out('repository-scope.json'), {
  ...common,
  status: repositoryScope.pass ? 'PASS' : 'FAIL',
  reasonCode: repositoryScope.reasonCode,
  ...repositoryScope,
  interpretation: {
    zeroViolationsDoesNotProveUnavailableOriginalRepositoryWasScanned: true,
    completeOriginalDevelopmentAndReleaseSourceClaimed: false,
    canonicalPortableRepositoryIsTheOnlyAllowedSourceForFutureStage6459Commands: true,
    wp1MustCreateNewTrackedReleasePipelineBeforeAnyRelease: true
  }
});

writeJson(out('local-command-gates.json'), {
  ...common,
  status: localCommandsPass ? 'PASS' : 'FAIL',
  reasonCode: localCommandsPass ? null : 'WP0_LOCAL_COMMAND_GATE_EXECUTION_FAILED',
  remotePushPerformed: false,
  remoteCiValidated: false,
  claim: 'Local executable gates were run. No remote CI success is claimed.',
  commandPolicy,
  executions: localCommandExecutions
});

if (nodeTestTapSource) {
  fs.copyFileSync(path.resolve(nodeTestTapSource), out('node-test.tap'));
}

writeJson(out('required-tests.json'), {
  ...common,
  status: allPass ? 'PASS' : 'FAIL',
  requiredTestCount: checks.length,
  passedTestCount: checks.filter((item) => item.pass).length,
  failedTestCount: failed.length,
  results: checks,
  failedReasonCodes: failed.map((item) => item.reasonCode).filter(Boolean)
});

writeJson(out('wp0-completion.json'), {
  ...common,
  status: allPass && repositoryScope.pass && localCommandsPass ? 'PASS' : 'FAIL',
  reasonCode: allPass && repositoryScope.pass && localCommandsPass ? null : 'WP0_COMPLETION_CRITERIA_NOT_MET',
  workPackageStatusCandidate: allPass && repositoryScope.pass && localCommandsPass ? 'COMPLETED' : 'REVIEWED_WITH_BLOCKING_AMENDMENTS',
  wp1EligibilityCandidate: allPass && repositoryScope.pass && localCommandsPass ? 'ELIGIBLE_NOT_STARTED' : 'BLOCKED_BY_WP0',
  remotePushPerformed: false,
  remoteCiValidated: false,
  requiredTestsPass: allPass,
  repositoryScopeEvidencePass: repositoryScope.pass,
  localCommandGatesPass: localCommandsPass
});

const evidenceFiles = [
  'freeze-policy.json',
  'overlay-installer-scan.json',
  'distribution-mode.json',
  'repository-scope.json',
  'local-command-gates.json',
  'required-tests.json',
  'wp0-completion.json',
  ...(nodeTestTapSource ? ['node-test.tap'] : [])
];
const indexEntries = evidenceFiles.map((name) => {
  const filePath = out(name);
  return { name, sizeBytes: fs.statSync(filePath).size, sha256: sha256File(filePath) };
});
writeJson(out('evidence-index.json'), {
  ...common,
  status: allPass && repositoryScope.pass && localCommandsPass ? 'PASS' : 'FAIL',
  evidenceOutputDirectory: '.',
  committedEvidenceOverwriteWasExplicitlyAllowed: outputDir === committedEvidenceDir,
  files: indexEntries
});

process.stdout.write(`${JSON.stringify({
  status: allPass && repositoryScope.pass && localCommandsPass ? 'PASS' : 'FAIL',
  reasonCode: allPass && repositoryScope.pass && localCommandsPass ? null : 'WP0_EVIDENCE_GENERATION_FAILED',
  outputDir,
  sourceCommit,
  sourceTree,
  repositoryClean,
  generatedAtUtc,
  fileCount: evidenceFiles.length + 1
}, null, 2)}\n`);

if (!allPass || !repositoryScope.pass || !localCommandsPass) process.exitCode = 1;
