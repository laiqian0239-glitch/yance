'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  REBUILD_BRANCH_PATTERN_SOURCE,
  canonicalStageBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription
} = require('../../shared/release/implementationBranchPolicy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_SOURCE_PATH = path.join(REPO_ROOT, 'release', 'release-source.json');
const POLICY_PATH = path.join(REPO_ROOT, 'governance', 'stage-policy.json');
const REJECTED_BASELINE_PATH = path.join(REPO_ROOT, 'governance', 'rejected-baselines', 'stage-6.4.5.8.json');
const REPOSITORY_SCOPE_POLICY_PATH = path.join(REPO_ROOT, 'governance', 'repository-scope-policy.json');
const EXPECTED_TAG = 'stage-6.4.5.8-rejected-architecture';
const EXPECTED_BASELINE_COMMIT = 'c150182219edea2faf49c714275e9921a21df742';
const PROTECTED_ACTIVE_ROOTS = new Set([
  'backend',
  'electron',
  'frontend',
  'shared',
  'scripts',
  'services',
  'tools'
]);

function configuredStage() {
  const source = JSON.parse(fs.readFileSync(RELEASE_SOURCE_PATH, 'utf8'));
  if (!source.stageVersion || typeof source.stageVersion !== 'string') {
    throw new Error('release/release-source.json must define stageVersion');
  }
  return source.stageVersion;
}
const CURRENT_STAGE = configuredStage();
const ALLOWED_BRANCH = canonicalStageBranch(CURRENT_STAGE);
const REJECTED_STAGE = '6.4.5.8';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeRepositoryRelativePath(value, fieldName) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${fieldName} must be a non-empty repository-relative path`);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${fieldName} must not contain empty, current-directory, or parent-directory segments`);
  }
  return normalized;
}

function referenceOnlyRootPolicies(policy = readJson(REPOSITORY_SCOPE_POLICY_PATH)) {
  if (!policy || policy.schemaVersion !== 2 || !Array.isArray(policy.referenceOnlyRoots)) {
    throw new Error('repository scope policy must define schemaVersion 2 referenceOnlyRoots');
  }
  const seen = new Set();
  const rows = policy.referenceOnlyRoots.map((entry, index) => {
    const root = normalizeRepositoryRelativePath(entry?.path, `referenceOnlyRoots[${index}].path`);
    const classification = String(entry?.classification || '').trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(classification) || classification === 'ACTIVE_SOURCE_OR_AUTOMATION') {
      throw new Error(`referenceOnlyRoots[${index}].classification must be an explicit non-active classification`);
    }
    const firstSegment = root.split('/')[0].toLowerCase();
    if (PROTECTED_ACTIVE_ROOTS.has(firstSegment)) {
      throw new Error(`reference-only root ${root} overlaps protected active source root ${firstSegment}`);
    }
    const key = root.toLowerCase();
    if (seen.has(key)) throw new Error(`duplicate reference-only root ${root}`);
    seen.add(key);
    return Object.freeze({ path: root, lowerPath: key, classification });
  });
  return rows.sort((left, right) => right.lowerPath.length - left.lowerPath.length || left.lowerPath.localeCompare(right.lowerPath));
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd || REPO_ROOT,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe']
  }).trim();
}

function currentCommit() {
  try { return git(['rev-parse', 'HEAD']); } catch { return null; }
}

function currentBranch() {
  try { return git(['branch', '--show-current']); } catch { return null; }
}

function listTrackedFiles(rootDir = REPO_ROOT) {
  if (path.resolve(rootDir) === REPO_ROOT && fs.existsSync(path.join(REPO_ROOT, '.git'))) {
    const raw = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT });
    return raw.toString('utf8').split('\0').filter(Boolean).sort();
  }
  const result = [];
  const excluded = new Set(['.git', 'node_modules', '.tmp', 'coverage', 'dist', 'build', 'release-output']);
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && excluded.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) result.push(path.relative(rootDir, full).split(path.sep).join('/'));
    }
  }
  walk(rootDir);
  return result.sort();
}

function isScanCandidate(relativePath) {
  const lower = relativePath.toLowerCase();
  const ext = path.extname(lower);
  const scriptExtensions = new Set(['.ps1', '.cmd', '.bat', '.nsh', '.iss', '.js', '.cjs', '.mjs', '.json', '.yml', '.yaml']);
  if (scriptExtensions.has(ext)) return true;
  if (/(^|\/)(installer|installers|packaging|build-scripts|release-scripts|deploy|tools)(\/|$)/i.test(relativePath)) return true;
  return /(^|\/)(package\.json|electron-builder\.ya?ml|forge\.config\.(js|cjs|mjs))$/i.test(relativePath);
}

function classifyScanPath(relativePath, scopePolicy = readJson(REPOSITORY_SCOPE_POLICY_PATH)) {
  const normalized = normalizeRepositoryRelativePath(relativePath, 'relativePath');
  const lower = normalized.toLowerCase();
  if (lower.startsWith('governance/')) return 'POLICY_REFERENCE';
  if (lower.startsWith('tests/wp0/')) return 'TEST_FIXTURE_OR_ASSERTION';
  if (lower.startsWith('tools/wp0/')) return 'WP0_GATE_IMPLEMENTATION';
  if (lower.startsWith('evidence/')) return 'GENERATED_EVIDENCE';
  if (lower.startsWith('implementation/')) return 'STATUS_METADATA';
  const referenceOnly = referenceOnlyRootPolicies(scopePolicy).find((entry) =>
    lower === entry.lowerPath || lower.startsWith(`${entry.lowerPath}/`)
  );
  return referenceOnly?.classification || 'ACTIVE_SOURCE_OR_AUTOMATION';
}

function relFromRoot(rootDir, relativePath) {
  return path.join(rootDir, ...relativePath.split('/'));
}

function scanRepositoryReleaseSurfaces(rootDir = REPO_ROOT) {
  const trackedFiles = listTrackedFiles(rootDir);
  const candidates = trackedFiles.filter(isScanCandidate);
  const violations = [];
  const scanned = [];
  const referenceOnly = [];
  const scopePolicy = readJson(REPOSITORY_SCOPE_POLICY_PATH);
  const filenamePattern = /(integrated[ _-]?repair|complete[ _-]?installer|apply.*hotfix|start[ _-]?update|stage6[._-]?4[._-]?5[._-]?8|revision\s*\d*)/i;
  const overlayTargetPattern = /(app\.asar\.unpacked|resources[\\/]app\.asar\.unpacked)/i;
  const copyPattern = /(copy-item|xcopy|robocopy|copy\s+\/y|fs\.(?:cp|copyfile)|copyfiles|rsync)/i;
  const baseInstallerPattern = /(base[_ -]?installer|setup.*-base\.exe|start-process.*\.exe|\/s\b|\/silent\b)/i;
  const oldReleaseTermPattern = /(integrated[ _-]?repair[ _-]?hotfix|complete[ _-]?installer|revision\s*\d+|runtime[ _-]?patch|post[ _-]?install[ _-]?patch)/i;

  for (const relativePath of candidates) {
    const classification = classifyScanPath(relativePath, scopePolicy);
    const record = { path: relativePath, classification };
    scanned.push(record);
    const full = relFromRoot(rootDir, relativePath);
    let text = '';
    try { text = fs.readFileSync(full, 'utf8'); } catch { text = ''; }
    if (classification !== 'ACTIVE_SOURCE_OR_AUTOMATION') {
      referenceOnly.push(record);
      continue;
    }
    const baseName = path.basename(relativePath);
    if (filenamePattern.test(baseName)) {
      violations.push({
        reasonCode: 'WP0_FORBIDDEN_RELEASE_ENTRYPOINT',
        file: relativePath,
        detail: 'Tracked executable or release-surface filename matches a rejected Hotfix, Revision, Complete Installer, update, or Stage 6.4.5.8 pattern.'
      });
    }
    if (overlayTargetPattern.test(text) && copyPattern.test(text) && baseInstallerPattern.test(text)) {
      violations.push({
        reasonCode: 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED',
        file: relativePath,
        detail: 'Tracked release surface combines a base installer with post-install app.asar.unpacked copying.'
      });
    }
    if (/6\.4\.5\.8/i.test(text) && /(hotfix|repair|release candidate|runtime patch|overlay|complete installer|revision)/i.test(text)) {
      violations.push({
        reasonCode: 'WP0_REJECTED_STAGE_RELEASE_PATH_DETECTED',
        file: relativePath,
        detail: 'Tracked active source or automation targets rejected Stage 6.4.5.8 release behavior.'
      });
    }
    if (oldReleaseTermPattern.test(text) && /(install|release|build|package|copy|patch|execute|spawn|start-process|child_process)/i.test(text)) {
      violations.push({
        reasonCode: 'WP0_FORBIDDEN_LEGACY_RELEASE_MECHANISM',
        file: relativePath,
        detail: 'Tracked active source or automation contains a legacy Hotfix, Revision, Complete Installer, or runtime patch mechanism.'
      });
    }
  }

  return {
    enumerationMethod: path.resolve(rootDir) === REPO_ROOT ? 'git ls-files -z' : 'recursive-fixture-enumeration',
    trackedFileCount: trackedFiles.length,
    candidateFileCount: candidates.length,
    scannedFileCount: scanned.length,
    activeSurfaceCount: scanned.filter((item) => item.classification === 'ACTIVE_SOURCE_OR_AUTOMATION').length,
    referenceOnlyCount: referenceOnly.length,
    scannedFiles: scanned,
    violationCount: violations.length,
    violations
  };
}

function verifyImmutableTag() {
  const errors = [];
  let tagRef = null;
  let tagObjectType = null;
  let peeledCommit = null;
  try { tagRef = git(['show-ref', '--verify', '--hash', `refs/tags/${EXPECTED_TAG}`]); }
  catch { errors.push(`missing Git tag refs/tags/${EXPECTED_TAG}`); }
  if (tagRef) {
    try { tagObjectType = git(['cat-file', '-t', `refs/tags/${EXPECTED_TAG}`]); }
    catch { errors.push('unable to inspect immutable tag object type'); }
    try { peeledCommit = git(['rev-parse', `refs/tags/${EXPECTED_TAG}^{}`]); }
    catch { errors.push('unable to peel immutable tag to commit'); }
  }
  if (tagObjectType !== 'tag') errors.push('immutable tag must be an annotated tag object');
  if (peeledCommit !== EXPECTED_BASELINE_COMMIT) errors.push(`immutable tag must point to baseline commit ${EXPECTED_BASELINE_COMMIT}`);
  return {
    pass: errors.length === 0,
    reasonCode: errors.length ? 'WP0_IMMUTABLE_TAG_INVALID' : null,
    errors,
    tagName: EXPECTED_TAG,
    tagRefObject: tagRef,
    tagObjectType,
    peeledCommit,
    expectedBaselineCommit: EXPECTED_BASELINE_COMMIT
  };
}

function changedFilesSinceBaseline() {
  try {
    const raw = git(['diff', '--name-only', `${EXPECTED_TAG}^{}`, 'HEAD']);
    return raw ? raw.split(/\r?\n/).filter(Boolean).sort() : [];
  } catch {
    return [];
  }
}

function checkRuntimeTargetGate(options = {}) {
  const targetStage = options.targetStage || process.env.YANCE_TARGET_STAGE || CURRENT_STAGE;
  const branch = Object.prototype.hasOwnProperty.call(options, 'branch') ? options.branch : currentBranch();
  const changedFiles = options.changedFiles || changedFilesSinceBaseline();
  const runtimeChangedFiles = changedFiles.filter((name) => /^(backend|electron|frontend|shared)\//.test(name));
  const evidenceSourceCommit = options.evidenceSourceCommit || null;
  const detachedEvidenceAllowed = options.evidenceMode === true
    && branch === null
    && evidenceSourceCommit === currentCommit();
  const errors = [];
  if (targetStage === REJECTED_STAGE) errors.push('target stage 6.4.5.8 is permanently rejected for runtime, build, package, and release changes');
  if (targetStage !== CURRENT_STAGE) errors.push(`target stage must be ${CURRENT_STAGE}`);
  if (!isAuthorizedImplementationBranch(branch, CURRENT_STAGE) && !detachedEvidenceAllowed) errors.push(`implementation branch must be ${authorizedImplementationBranchDescription(CURRENT_STAGE)}; detached HEAD is allowed only for evidence generated at the exact checked-out commit`);
  return {
    pass: errors.length === 0,
    reasonCode: errors.length ? 'WP0_REJECTED_STAGE_TARGET_DENIED' : null,
    errors,
    targetStage,
    branch,
    detachedEvidenceAllowed,
    changedFileCount: changedFiles.length,
    runtimeChangedFileCount: runtimeChangedFiles.length,
    runtimeChangedFiles
  };
}

function checkFreezePolicy(options = {}) {
  const policy = readJson(POLICY_PATH);
  const rejected = readJson(REJECTED_BASELINE_PATH);
  const errors = [];
  if (policy.currentStage !== CURRENT_STAGE) errors.push(`currentStage must be ${CURRENT_STAGE}`);
  if (policy.currentBranch !== ALLOWED_BRANCH) errors.push('currentBranch mismatch');
  if (policy.authorizedRebuildBranchPattern !== REBUILD_BRANCH_PATTERN_SOURCE) errors.push('authorizedRebuildBranchPattern mismatch');
  if (policy.originalStageBranchRewriteAllowed !== false) errors.push('originalStageBranchRewriteAllowed must be false');
  if (policy.baselineCommit !== EXPECTED_BASELINE_COMMIT) errors.push('stage policy baselineCommit mismatch');
  if (rejected.baselineCommit !== EXPECTED_BASELINE_COMMIT) errors.push('rejected baseline commit mismatch');
  const baseline = policy.rejectedBaselines.find((item) => item.stage === REJECTED_STAGE);
  if (!baseline) errors.push(`missing rejected Stage ${REJECTED_STAGE} baseline`);
  else {
    if (baseline.status !== 'REJECTED_ARCHITECTURE_NOT_CLOSED') errors.push('rejected baseline status mismatch');
    for (const key of ['hotfixesAllowed', 'runtimeChangesAllowed', 'releaseCandidateAllowed', 'overlayInstallersAllowed']) {
      if (baseline[key] !== false) errors.push(`${key} must be false`);
    }
  }
  if (rejected.archivalUseOnly !== true) errors.push('rejected baseline must be archivalUseOnly');
  if (rejected.replacementStage !== CURRENT_STAGE) errors.push('replacementStage mismatch');
  const tag = verifyImmutableTag();
  if (!tag.pass) errors.push(...tag.errors);
  const runtimeTarget = checkRuntimeTargetGate(options);
  if (!runtimeTarget.pass) errors.push(...runtimeTarget.errors);
  return {
    id: 'freeze-rejected-baseline.test',
    pass: errors.length === 0,
    reasonCode: errors.length ? (tag.pass ? runtimeTarget.reasonCode || 'WP0_FREEZE_POLICY_INVALID' : tag.reasonCode) : null,
    errors,
    details: {
      policyId: policy.policyId,
      currentStage: policy.currentStage,
      rejectedStage: rejected.stage,
      rejectedStatus: rejected.status,
      immutableTag: tag,
      runtimeTargetGate: runtimeTarget
    }
  };
}

function checkOverlayInstallerPatterns(rootDir = REPO_ROOT) {
  const scan = scanRepositoryReleaseSurfaces(rootDir);
  const violations = scan.violations.filter((item) => item.reasonCode === 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED');
  return {
    id: 'overlay-installer-pattern-scan.test',
    pass: violations.length === 0,
    reasonCode: violations.length ? 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED' : null,
    errors: violations,
    details: { ...scan, violationCount: violations.length, violations }
  };
}

function checkUnsignedModePolicy() {
  const policy = readJson(POLICY_PATH);
  const errors = [];
  if (policy.distributionMode !== 'LOCAL_PRIVATE_UNSIGNED') errors.push('distributionMode mismatch');
  if (policy.privateSingleOwner !== true) errors.push('privateSingleOwner must be true');
  if (policy.publicRelease !== false) errors.push('publicRelease must be false');
  if (policy.authenticodeRequired !== false) errors.push('authenticodeRequired must be false');
  if (policy.microsoftStoreRequired !== false) errors.push('microsoftStoreRequired must be false');
  if (policy.manifestDigitalSignatureRequired !== false) errors.push('manifestDigitalSignatureRequired must be false');
  if (policy.unknownPublisherAccepted !== true) errors.push('unknownPublisherAccepted must be true');
  return {
    id: 'unsigned-mode-policy.test',
    pass: errors.length === 0,
    reasonCode: errors.length ? 'WP0_DISTRIBUTION_MODE_POLICY_INVALID' : null,
    errors,
    details: {
      distributionMode: policy.distributionMode,
      authenticodeRequired: policy.authenticodeRequired,
      microsoftStoreRequired: policy.microsoftStoreRequired,
      manifestDigitalSignatureRequired: policy.manifestDigitalSignatureRequired,
      unknownPublisherAccepted: policy.unknownPublisherAccepted
    }
  };
}

function checkProtectedCommandPolicy() {
  const pkg = readJson(path.join(REPO_ROOT, 'package.json'));
  const scripts = pkg.scripts || {};
  const errors = [];
  for (const command of ['build', 'package', 'release']) {
    const expected = `node tools/wp0/run-protected-command.js ${command}`;
    if (scripts[command] !== expected) errors.push(`${command} must use the WP0 protected-command wrapper`);
  }
  if (scripts['verify:wp0:gate'] !== 'node tools/wp0/verify-gate.js') errors.push('verify:wp0:gate must derive target stage from release/release-source.json');
  if (scripts.prepack !== 'npm run verify:wp0:gate') errors.push('prepack must run verify:wp0:gate');
  if (scripts.prepublishOnly !== 'npm run verify:wp0:gate') errors.push('prepublishOnly must run verify:wp0:gate');
  return {
    pass: errors.length === 0,
    reasonCode: errors.length ? 'WP0_LOCAL_COMMAND_GATE_NOT_ENFORCED' : null,
    errors,
    protectedCommands: ['build', 'package', 'release', 'pack', 'publish'],
    packageScripts: scripts
  };
}

function listUntrackedReleaseCandidates() {
  try {
    const raw = git(['ls-files', '--others', '--exclude-standard', '-z']);
    return raw.split('\0').filter(Boolean).filter(isScanCandidate).sort();
  } catch {
    return [];
  }
}

function checkRepositoryScope() {
  const policy = readJson(REPOSITORY_SCOPE_POLICY_PATH);
  const tracked = listTrackedFiles();
  const scan = scanRepositoryReleaseSurfaces();
  const errors = [];
  const missingRuntimeRoots = policy.runtimeSourceRootsRequired.filter((root) => !fs.existsSync(path.join(REPO_ROOT, root)));
  if (missingRuntimeRoots.length) errors.push(`missing runtime source roots: ${missingRuntimeRoots.join(', ')}`);
  const untrackedReleaseCandidates = listUntrackedReleaseCandidates();
  if (untrackedReleaseCandidates.length) errors.push('untracked build, package, release, installer, deploy, or tool files exist');
  if (policy.externalUntrackedBuildReleaseScriptsAllowed !== false) errors.push('external untracked release scripts must be forbidden');
  if (policy.completeOriginalDevelopmentAndReleaseSourceProven !== false) errors.push('portable extracted repository must not claim proven complete original release source');
  if (policy.fullOriginalRepositoryClaimAllowed !== false) errors.push('full original repository claim must be disabled');
  const originalInstallerProjectFiles = tracked.filter((name) => /\.(nsh|iss)$/i.test(name) || /(^|\/)(installer|installers|packaging)(\/|$)/i.test(name));
  return {
    pass: errors.length === 0,
    reasonCode: errors.length ? 'WP0_REPOSITORY_SCOPE_INVALID' : null,
    errors,
    sourceOrigin: policy.sourceOrigin,
    baselineCommit: policy.baselineCommit,
    canonicalImplementationRepository: policy.canonicalImplementationRepository,
    trackedFileCount: tracked.length,
    runtimeSourceRootsRequired: policy.runtimeSourceRootsRequired,
    referenceOnlyRoots: referenceOnlyRootPolicies(policy).map(({ path: root, classification }) => ({ path: root, classification })),
    missingRuntimeRoots,
    runtimeSourceForExtractedArtifactPresent: missingRuntimeRoots.length === 0,
    originalVcsHistoryAvailable: policy.originalVcsHistoryAvailable,
    originalInstallerProjectAvailable: policy.originalInstallerProjectAvailable,
    originalInstallerProjectFiles,
    completeOriginalDevelopmentAndReleaseSourceProven: policy.completeOriginalDevelopmentAndReleaseSourceProven,
    scopeDecision: policy.scopeDecision,
    zeroViolationClaimScope: policy.zeroViolationClaimScope,
    fullOriginalRepositoryClaimAllowed: policy.fullOriginalRepositoryClaimAllowed,
    externalUntrackedBuildReleaseScriptsAllowed: policy.externalUntrackedBuildReleaseScriptsAllowed,
    untrackedReleaseCandidateCount: untrackedReleaseCandidates.length,
    untrackedReleaseCandidates,
    releaseBeforeTrackedWp1PipelineAllowed: policy.releaseBeforeTrackedWp1PipelineAllowed,
    scanEnumerationMethod: scan.enumerationMethod,
    scanCandidateFileCount: scan.candidateFileCount
  };
}

function checkForbiddenHotfixEntrypoints(rootDir = REPO_ROOT) {
  const scan = scanRepositoryReleaseSurfaces(rootDir);
  const violations = scan.violations.filter((item) => item.reasonCode !== 'WP0_OVERLAY_INSTALLER_PATTERN_DETECTED');
  const commandGate = path.resolve(rootDir) === REPO_ROOT ? checkProtectedCommandPolicy() : { pass: true, errors: [], reasonCode: null };
  const repositoryScope = path.resolve(rootDir) === REPO_ROOT ? checkRepositoryScope() : { pass: true, errors: [], reasonCode: null };
  const errors = [...violations, ...commandGate.errors, ...repositoryScope.errors];
  return {
    id: 'forbidden-hotfix-entrypoints.test',
    pass: errors.length === 0,
    reasonCode: errors.length ? (violations.length ? 'WP0_FORBIDDEN_HOTFIX_ENTRYPOINT' : commandGate.reasonCode || repositoryScope.reasonCode) : null,
    errors,
    details: {
      enumerationMethod: scan.enumerationMethod,
      trackedFileCount: scan.trackedFileCount,
      scannedFileCount: scan.scannedFileCount,
      activeSurfaceCount: scan.activeSurfaceCount,
      referenceOnlyCount: scan.referenceOnlyCount,
      scannedFiles: scan.scannedFiles,
      violationCount: violations.length,
      violations,
      commandGate,
      repositoryScope
    }
  };
}

function runAllChecks(options = {}) {
  const rootDir = options.rootDir || REPO_ROOT;
  return [
    checkFreezePolicy({
      targetStage: options.targetStage || CURRENT_STAGE,
      branch: Object.prototype.hasOwnProperty.call(options, 'branch') ? options.branch : currentBranch(),
      evidenceMode: options.evidenceMode === true,
      evidenceSourceCommit: options.evidenceSourceCommit || null
    }),
    checkOverlayInstallerPatterns(rootDir),
    checkUnsignedModePolicy(),
    checkForbiddenHotfixEntrypoints(rootDir)
  ];
}

function verifyWp0Gate(options = {}) {
  const checks = runAllChecks({
    targetStage: options.targetStage || CURRENT_STAGE,
    ...(Object.prototype.hasOwnProperty.call(options, 'branch') ? { branch: options.branch } : {}),
    evidenceMode: options.evidenceMode === true,
    evidenceSourceCommit: options.evidenceSourceCommit || null
  });
  const failed = checks.filter((item) => !item.pass);
  return {
    schemaVersion: 1,
    gateId: `YANCE-S${CURRENT_STAGE}-WP0-LOCAL-GATE`,
    status: failed.length ? 'FAIL' : 'PASS',
    reasonCode: failed.length ? failed[0].reasonCode : null,
    targetStage: options.targetStage || CURRENT_STAGE,
    sourceCommit: currentCommit(),
    branch: Object.prototype.hasOwnProperty.call(options, 'branch') ? options.branch : currentBranch(),
    requiredCheckCount: checks.length,
    passedCheckCount: checks.filter((item) => item.pass).length,
    failedCheckCount: failed.length,
    failedReasonCodes: failed.map((item) => item.reasonCode).filter(Boolean),
    checks
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

module.exports = {
  REPO_ROOT,
  POLICY_PATH,
  REJECTED_BASELINE_PATH,
  REPOSITORY_SCOPE_POLICY_PATH,
  EXPECTED_TAG,
  EXPECTED_BASELINE_COMMIT,
  CURRENT_STAGE,
  ALLOWED_BRANCH,
  REJECTED_STAGE,
  readJson,
  referenceOnlyRootPolicies,
  sha256File,
  git,
  currentCommit,
  currentBranch,
  listTrackedFiles,
  classifyScanPath,
  scanRepositoryReleaseSurfaces,
  verifyImmutableTag,
  changedFilesSinceBaseline,
  checkRuntimeTargetGate,
  checkFreezePolicy,
  checkOverlayInstallerPatterns,
  checkUnsignedModePolicy,
  checkProtectedCommandPolicy,
  checkRepositoryScope,
  checkForbiddenHotfixEntrypoints,
  runAllChecks,
  verifyWp0Gate,
  writeJson
};
