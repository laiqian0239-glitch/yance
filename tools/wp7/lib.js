'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const wp1 = require('../wp1/lib');
const { validateReleaseManifest } = require('../../shared/release/releaseManifestSchema');
const { writeInstallerIdentityReceipt } = require('../../installer/installedIdentityReceipt');
const { GENERATED_NPM_BIN_SHIM_POLICY, verifyProductionDependencyClosure } = require('./production-dependency-binding');
const { runNpmCommand, spawnFailureDetails } = require('./host-command-runner');
const { applicationPayloadFilesystemIdentitySha256 } = require('./filesystem-identity');
const { compareElectronDistributionTree, verifyElectronDistributionTree } = require('./packaged-product-trust');
const { copyTrustedNodeRuntime } = require('./node-runtime-identity');
const { CONTROLLED_METADATA_PATHS, validateReviewedApplicationSourceClosure } = require('./packaged-payload-closure');
const { canonicalBuffer: nativeBinaryCanonicalBuffer, verifyNativeBinaries } = require('./verify-native-binaries');
const { validateProductionRuntimeSourceDependencies } = require('./runtime-source-dependency-closure');
const releasePlatformAuth = require('../../backend/services/releasePlatformAuth');
const {
  canonicalStageBranch,
  isAuthorizedImplementationBranch,
  authorizedImplementationBranchDescription
} = require('../../shared/release/implementationBranchPolicy');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ACCEPTED_BINDING_COMMIT = '4ac6d2185bed28823210849704f3850cd875b5fb';
const ACCEPTED_BINDING_TREE = 'd7f64dbf602ded1075978c13bea8449d7ef7e5e2';
const WP6_ACCEPTED_HEAD = '07b1b4c8b49e09195ef1cf1186f6d632b7567677';
const WP6_ACCEPTED_TREE = '485891e55298667df30e2f588daec196dc530eb7';
const IMPLEMENTATION_BRANCH = canonicalStageBranch('6.4.5.9');
const PRE_REVIEW_ARTIFACT_CLASS = 'WP7_PRE_REVIEW_ONLY';
const PIPELINE_TEST_ARTIFACT_CLASS = 'PIPELINE_TEST_ONLY';
const FINAL_ARTIFACT_CLASS = 'WP7_FINAL_RELEASE';
const FINAL_PACKAGING_TOKEN = 'WP7_PREACCEPTED_FOR_FINAL_PACKAGING';
const REVIEW_FIXTURE_BRANDING_CAPABILITY = Object.freeze({ capability: 'WP7_REVIEW_FIXTURE_BRANDING_V1' });
const PREACCEPTANCE_DECISION = 'WP7_PREACCEPTED_FOR_FINAL_PACKAGING';
const PREACCEPTANCE_RECORD_ENV = 'WP7_PREACCEPTANCE_RECORD';
const PREACCEPTANCE_HASH_ENV = 'WP7_PREACCEPTANCE_RECORD_SHA256';
const RISK_IDS = Object.freeze([
  'WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION',
  'WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION',
  'WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION',
  'WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED'
]);
const GOVERNANCE_ROOT = path.join(REPO_ROOT, 'governance', 'wp7');
const PHASE_MODEL_PATH = path.join(GOVERNANCE_ROOT, 'required-test-phase-model.json');
const ACCEPTANCE_MAPPING_PATH = path.join(GOVERNANCE_ROOT, 'acceptance-check-mapping.json');
const TRACEABILITY_PATH = path.join(GOVERNANCE_ROOT, 'workstream-traceability.json');
const MATRICES_PATH = path.join(GOVERNANCE_ROOT, 'design-gate-matrices.json');
const EVIDENCE_REQUIREMENTS_PATH = path.join(GOVERNANCE_ROOT, 'evidence-requirements.json');
const ADVERSARIAL_REQUIREMENTS_PATH = path.join(GOVERNANCE_ROOT, 'developer-adversarial-requirements.json');
const RELEASE_SOURCE_PATH = path.join(REPO_ROOT, 'release', 'release-source.json');
const FINAL_EVIDENCE_ALLOWLIST = new Set([
  'evidence/wp7/source-freeze.json',
  'evidence/wp7/final-release-evidence.json',
  'evidence/wp7/clean-install.json',
  'evidence/wp7/restart-cycle.json',
  'evidence/wp7/build-identity.json',
  'evidence/wp7/runtime-ownership.json',
  'evidence/wp7/safe-mode-removal.json',
  'evidence/wp7/credential-ready-gate.json',
  'evidence/wp7/offline-startup.json',
  'evidence/wp7/install-tree-inventory.json',
  'evidence/wp7/build-provenance.json',
  'evidence/wp7/boot-failure-diagnostics.json',
  'evidence/wp7/upstream-contract-binding.json',
  'evidence/wp7/protocol-version-binding.json',
  'evidence/wp7/build-session-integrity.json',
  'evidence/wp7/full-source-delivery-closure.json',
  'evidence/wp7/legacy-cleanup-inventory.json',
  'evidence/wp7/preinstall-installer-sha256.json',
  'evidence/wp7/first-start-initialization.json',
  'evidence/wp7/no-contamination.json',
  'evidence/phase1-acceptance-evidence.json'
]);
const FORBIDDEN_EVIDENCE_PREFIXES = ['evidence/wp0/', 'evidence/wp1/', 'evidence/wp2/', 'evidence/wp3/', 'evidence/wp4/', 'evidence/wp5/', 'evidence/wp6/'];
const SECRET_FIELD_RE = /(credential|secret|token|password|vault|digest)/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_OBJECT_RE = /^[0-9a-f]{40}$/;
const UPSTREAM_ACCEPTED_BINDINGS = Object.freeze({
  WP4: Object.freeze({
    finalAcceptanceStatus: 'WP4_ACCEPTED',
    implementationCommit: 'da29b9dc13e258b66d3de5a5320132a324ab8b6f',
    implementationSourceTree: 'ffcf273bf83416c4eec38f1e9d2b3f1de6bc7f35',
    acceptedFinalDeliveryHead: '2b929258c4d51c10a4dc49e90fcecf8b9f8170c4',
    acceptedFinalSourceTree: '8de896200f82a65d22a7d15db78cd83f813188bf',
    riskAcceptanceIds: Object.freeze(['WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION'])
  }),
  WP5: Object.freeze({
    finalAcceptanceStatus: 'WP5_ACCEPTED',
    implementationCommit: '2d42a7424b1bac0dafa2b4c3bee3378266e1a92f',
    implementationSourceTree: '1b7594dcc35e77a09e3e31473fbec74847a5e3c1',
    acceptedFinalDeliveryHead: 'c4d5a641e93c600c0199e9960fe8f570faa07808',
    acceptedFinalSourceTree: 'b6ece87673d804686bd231858097f6561ff1b200',
    riskAcceptanceIds: Object.freeze(['WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED'])
  }),
  WP6: Object.freeze({
    finalAcceptanceStatus: 'WP6_ACCEPTED',
    implementationCommit: '30311e402c4c687b6c96c4cbc5c4a9bfc3420ebb',
    implementationSourceTree: '9e5560c06c955adce653962bf7c4b5fde59a4f0e',
    candidateBindingCommit: '992f919a4c9becedee598255cb7567b511911740',
    acceptedFinalDeliveryHead: WP6_ACCEPTED_HEAD,
    acceptedFinalSourceTree: WP6_ACCEPTED_TREE,
    riskAcceptanceIds: Object.freeze([...RISK_IDS])
  })
});

class Wp7Error extends Error {
  constructor(reasonCode, message, details = {}) {
    super(message);
    this.name = 'Wp7Error';
    this.reasonCode = reasonCode;
    this.details = details;
  }
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { return sha256Buffer(fs.readFileSync(filePath)); }
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
function canonicalJsonBuffer(value) { return Buffer.from(`${JSON.stringify(sortValue(value), null, 2)}\n`, 'utf8'); }
function writeCanonicalJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, canonicalJsonBuffer(value));
}
function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitIdentity(repoRoot = REPO_ROOT) {
  const sourceCommit = git(['rev-parse', 'HEAD'], repoRoot);
  const sourceTree = git(['rev-parse', 'HEAD^{tree}'], repoRoot);
  const branch = git(['branch', '--show-current'], repoRoot) || null;
  const porcelain = git(['status', '--porcelain=v1', '--untracked-files=all'], repoRoot);
  return { sourceCommit, sourceTree, branch, repositoryClean: porcelain === '' };
}
function trackedWorkingTreeSha256(repoRoot = REPO_ROOT) {
  const rows = listTracked(repoRoot).map((relativePath) => {
    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    if (!fs.existsSync(absolutePath)) {
      throw new Wp7Error('WP7_SOURCE_CHANGED_DURING_BUILD', 'tracked source file disappeared during build', { relativePath });
    }
    const stat = fs.lstatSync(absolutePath);
    const content = stat.isSymbolicLink()
      ? Buffer.from(fs.readlinkSync(absolutePath), 'utf8')
      : fs.readFileSync(absolutePath);
    return `${relativePath}\0${sha256Buffer(content)}\n`;
  });
  return sha256Buffer(Buffer.from(rows.join(''), 'utf8'));
}
function isAncestor(ancestor, descendant, repoRoot = REPO_ROOT) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoRoot });
  return result.status === 0;
}
function assertActivationBinding(repoRoot = REPO_ROOT, options = {}) {
  const identity = options.identity || gitIdentity(repoRoot);
  const exact = options.exact === true;
  if (exact) {
    if (identity.sourceCommit !== ACCEPTED_BINDING_COMMIT || identity.sourceTree !== ACCEPTED_BINDING_TREE) {
      throw new Wp7Error('WP7_ACTIVATION_BINDING_MISMATCH', 'HEAD/tree do not equal accepted Activation binding identity', { identity });
    }
  } else {
    if (!isAncestor(ACCEPTED_BINDING_COMMIT, identity.sourceCommit, repoRoot)) {
      throw new Wp7Error('WP7_ACTIVATION_BINDING_MISMATCH', 'implementation HEAD does not descend from accepted Activation binding commit', { identity });
    }
    const bindingTree = git(['rev-parse', `${ACCEPTED_BINDING_COMMIT}^{tree}`], repoRoot);
    if (bindingTree !== ACCEPTED_BINDING_TREE) {
      throw new Wp7Error('WP7_ACTIVATION_BINDING_MISMATCH', 'accepted Activation binding commit resolves to an unexpected tree', { expected: ACCEPTED_BINDING_TREE, actual: bindingTree });
    }
  }
  if (options.requireBranch !== false && !isAuthorizedImplementationBranch(identity.branch, '6.4.5.9')) {
    throw new Wp7Error('WP7_WP0_GATE_BRANCH_MISMATCH', 'implementation branch is not an authorized WP7 release-closure branch', { expected: authorizedImplementationBranchDescription('6.4.5.9'), actual: identity.branch });
  }
  if (options.requireClean !== false && !identity.repositoryClean) {
    throw new Wp7Error('WP7_SOURCE_NOT_CLEAN', 'WP7 source repository must be clean', { identity });
  }
  return { status: 'PASS', ...identity, acceptedBindingCommit: ACCEPTED_BINDING_COMMIT, acceptedBindingTree: ACCEPTED_BINDING_TREE };
}
function assertWp6Binding(repoRoot = REPO_ROOT) {
  const headTree = git(['rev-parse', `${WP6_ACCEPTED_HEAD}^{tree}`], repoRoot);
  if (headTree !== WP6_ACCEPTED_TREE) {
    throw new Wp7Error('WP7_WP6_FINAL_BINDING_REQUIRED', 'WP6 accepted Final Delivery identity mismatch', { expected: WP6_ACCEPTED_TREE, actual: headTree });
  }
  if (!isAncestor(WP6_ACCEPTED_HEAD, ACCEPTED_BINDING_COMMIT, repoRoot)) {
    throw new Wp7Error('WP7_WP6_FINAL_BINDING_REQUIRED', 'Activation binding does not descend from WP6 accepted Final Delivery HEAD');
  }
  return { status: 'PASS', wp6AcceptedHead: WP6_ACCEPTED_HEAD, wp6AcceptedTree: WP6_ACCEPTED_TREE };
}
function readPreacceptanceBinding(options = {}) {
  const recordPath = path.resolve(options.recordPath || process.env[PREACCEPTANCE_RECORD_ENV] || '');
  if (!recordPath || recordPath === path.resolve('')) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', `final packaging requires ${PREACCEPTANCE_RECORD_ENV}`);
  }
  if (!fs.existsSync(recordPath)) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', 'preacceptance binding record is missing', { recordPath });
  }
  const actualSha256 = sha256File(recordPath);
  const expectedSha256 = options.recordSha256 || process.env[PREACCEPTANCE_HASH_ENV] || null;
  if (!expectedSha256 || !SHA256_RE.test(expectedSha256) || expectedSha256 !== actualSha256) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', 'preacceptance binding record SHA256 is missing or mismatched', { expectedSha256, actualSha256 });
  }
  const record = readJson(recordPath);
  const implementationCommit = record.implementationCommit || record.identity?.implementationCommit;
  const implementationSourceTree = record.implementationSourceTree || record.identity?.implementationSourceTree;
  const decision = record.decision || record.preAcceptanceStatus || record.acceptanceToken;
  if (decision !== PREACCEPTANCE_DECISION || !GIT_OBJECT_RE.test(implementationCommit || '') || !GIT_OBJECT_RE.test(implementationSourceTree || '')) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', 'preacceptance binding record is invalid', { decision, implementationCommit, implementationSourceTree });
  }
  if (record.independentReview !== true || record.productionImplementationAccepted !== true) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', 'record does not represent an independent preacceptance decision');
  }
  return { status: 'PASS', recordPath, recordSha256: actualSha256, decision, implementationCommit, implementationSourceTree, record };
}
function assertPreacceptedImplementation(repoRoot = REPO_ROOT, options = {}) {
  const binding = options.binding || readPreacceptanceBinding(options);
  const identity = options.identity || gitIdentity(repoRoot);
  if (identity.sourceCommit !== binding.implementationCommit || identity.sourceTree !== binding.implementationSourceTree) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', 'current HEAD/tree do not equal the independently preaccepted implementation identity', { current: identity, preaccepted: { sourceCommit: binding.implementationCommit, sourceTree: binding.implementationSourceTree } });
  }
  const resolvedTree = git(['rev-parse', `${binding.implementationCommit}^{tree}`], repoRoot);
  if (resolvedTree !== binding.implementationSourceTree) {
    throw new Wp7Error('WP7_PREACCEPTED_IMPLEMENTATION_IDENTITY_NOT_ENFORCED', 'preaccepted commit resolves to an unexpected tree', { expected: binding.implementationSourceTree, actual: resolvedTree });
  }
  return { status: 'PASS', ...binding, identity };
}
function createDetachedFrozenSource(repoRoot, sourceCommit, expectedTree, parentRoot) {
  const frozenRoot = path.join(parentRoot, 'frozen-source');
  if (fs.existsSync(frozenRoot)) fs.rmSync(frozenRoot, { recursive: true, force: true });
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'worktree', 'add', '--detach', '--force', frozenRoot, sourceCommit], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Wp7Error('WP7_SOURCE_CHANGED_DURING_BUILD', 'failed to create detached frozen source worktree', { stdout: result.stdout, stderr: result.stderr });
  const identity = gitIdentity(frozenRoot);
  if (identity.sourceCommit !== sourceCommit || identity.sourceTree !== expectedTree || !identity.repositoryClean) {
    try { execFileSync('git', ['worktree', 'remove', '--force', frozenRoot], { cwd: repoRoot, stdio: 'ignore' }); } catch {}
    throw new Wp7Error('WP7_SOURCE_CHANGED_DURING_BUILD', 'detached frozen source identity mismatch', { identity, sourceCommit, expectedTree });
  }
  let released = false;
  return {
    frozenRoot,
    identity,
    release() {
      if (released) return;
      released = true;
      try { execFileSync('git', ['worktree', 'remove', '--force', frozenRoot], { cwd: repoRoot, stdio: 'ignore' }); }
      catch { fs.rmSync(frozenRoot, { recursive: true, force: true }); }
    }
  };
}
function assertSourceStillFrozen(repoRoot, expectedIdentity, frozenRoot, expectedContent = null) {
  const current = gitIdentity(repoRoot);
  const frozen = gitIdentity(frozenRoot);
  const currentTrackedContentSha256 = trackedWorkingTreeSha256(repoRoot);
  const frozenTrackedContentSha256 = trackedWorkingTreeSha256(frozenRoot);
  const contentMismatch = expectedContent && (
    currentTrackedContentSha256 !== expectedContent.currentTrackedContentSha256
    || frozenTrackedContentSha256 !== expectedContent.frozenTrackedContentSha256
  );
  const mismatch = current.sourceCommit !== expectedIdentity.sourceCommit || current.sourceTree !== expectedIdentity.sourceTree || !current.repositoryClean || frozen.sourceCommit !== expectedIdentity.sourceCommit || frozen.sourceTree !== expectedIdentity.sourceTree || !frozen.repositoryClean || contentMismatch;
  if (mismatch) throw new Wp7Error('WP7_SOURCE_CHANGED_DURING_BUILD', 'source identity changed during build', { expected: expectedIdentity, current, frozen, expectedContent, currentTrackedContentSha256, frozenTrackedContentSha256 });
  return { status: 'PASS', current, frozen };
}
function completeProjectSourceTreeSha256(repoRoot = REPO_ROOT, commit = 'HEAD') {
  const rows = git(['ls-tree', '-r', '-z', '--full-tree', commit], repoRoot).split('\0').filter(Boolean).map((line) => {
    const match = line.match(/^(\d+)\s+(\w+)\s+([0-9a-f]+)\t(.+)$/s);
    if (!match) throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'unable to parse Git tree inventory', { line });
    return `${match[1]}\0${match[2]}\0${match[3]}\0${match[4]}\n`;
  }).sort();
  return sha256Buffer(Buffer.from(rows.join(''), 'utf8'));
}
function readReleaseSource(repoRoot = REPO_ROOT) {
  const source = wp1.readReleaseSource(path.join(repoRoot, 'release', 'release-source.json'));
  if (source.credentialProtocolVersion !== 3) {
    throw new Wp7Error('WP7_PROTOCOL_VERSION_BINDING_MISMATCH', 'release source must bind credentialProtocolVersion 3', { actual: source.credentialProtocolVersion });
  }
  return source;
}
function verifyRuntimeProtocolConvergence(repoRoot = REPO_ROOT) {
  const source = readReleaseSource(repoRoot);
  const protocolFiles = [
    'shared/credentialProtocol.js',
    'shared/credentialCustodyProtocol.js'
  ].filter((relative) => fs.existsSync(path.join(repoRoot, relative)));
  const observed = [];
  for (const relative of protocolFiles) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    const versions = [...text.matchAll(/(?:PROTOCOL_VERSION|protocolVersion)\s*[:=]\s*(\d+)/g)].map((m) => Number(m[1]));
    if (versions.length) observed.push({ path: relative, versions: [...new Set(versions)] });
  }
  const bad = observed.flatMap((entry) => entry.versions.filter((v) => v !== source.credentialProtocolVersion).map((v) => ({ path: entry.path, version: v })));
  if (bad.length) throw new Wp7Error('WP7_PROTOCOL_VERSION_BINDING_MISMATCH', 'runtime protocol constants do not converge to release source', { bad, expected: source.credentialProtocolVersion });
  return { status: 'PASS', credentialProtocolVersion: source.credentialProtocolVersion, observed };
}
function normalizeTimestamp(value) { return wp1.normalizeTimestamp(value || new Date().toISOString()); }
function ensureDirectoryEmpty(dir) {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); return; }
  const entries = fs.readdirSync(dir);
  if (entries.length) throw new Wp7Error('FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT', 'WP7 build root must be empty', { dir, entries: entries.sort() });
}
function acquireExclusiveLease(leasePath, metadata = {}) {
  try { fs.mkdirSync(leasePath); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Wp7Error('WP7_BUILD_SESSION_BUSY', 'WP7 build lease is already held', { leasePath });
    throw error;
  }
  writeCanonicalJson(path.join(leasePath, 'lease.json'), { schemaVersion: 1, pid: process.pid, createdAtUtc: new Date().toISOString(), ...metadata });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    fs.rmSync(leasePath, { recursive: true, force: true });
  };
}
function assertCanonicalPayloadPath(relativePath) { return wp1.canonicalizeRelativePayloadPath(relativePath); }
function assertNoWp1Reuse(root, provenanceIndexes = []) {
  const result = wp1.scanForPipelineTestArtifacts(root, { provenanceIndexes, requireProvenanceIndex: provenanceIndexes.length > 0 });
  if (result.status !== 'PASS') throw new Wp7Error('FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT', 'WP1 pipeline artifact detected in WP7 build', { violations: result.violations });
  return result;
}
function buildSessionId(identity, timestamp, nonce = '') {
  return sha256Buffer(Buffer.from(`${identity.sourceCommit}\0${identity.sourceTree}\0${timestamp}\0${nonce}`, 'utf8')).slice(0, 32);
}
function preReviewInstallerName(releaseSource, buildId) {
  return `Yance-${releaseSource.productVersion}-${buildId}-PRE-REVIEW-FIXTURE.exe`;
}
function writePreReviewInstallerFixture(filePath, data) {
  const header = Buffer.from('YANCE-WP7-PRE-REVIEW-INSTALLER-FIXTURE\n', 'utf8');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([header, canonicalJsonBuffer({ artifactClass: PIPELINE_TEST_ARTIFACT_CLASS, finalInstaller: false, ...data })]));
}
function readPreReviewInstallerFixture(filePath) {
  const bytes = fs.readFileSync(filePath);
  const marker = Buffer.from('YANCE-WP7-PRE-REVIEW-INSTALLER-FIXTURE\n', 'utf8');
  if (!bytes.subarray(0, marker.length).equals(marker)) throw new Wp7Error('WP7_INSTALLER_FIXTURE_INVALID', 'installer fixture marker missing');
  return JSON.parse(bytes.subarray(marker.length).toString('utf8'));
}

function copyTree(sourceRoot, destinationRoot, options = {}) {
  if (!fs.existsSync(sourceRoot)) throw new Wp7Error(options.missingReason || 'WP7_BUILD_INPUT_MISSING', 'required build input is missing', { sourceRoot });
  fs.mkdirSync(destinationRoot, { recursive: true });
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if ((options.excludeNames || []).includes(entry.name)) continue;
    const source = path.join(sourceRoot, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Wp7Error('WP1_PAYLOAD_SYMLINK_REJECTED', 'symlinks are forbidden in final runtime payload', { source });
    if (entry.isDirectory()) copyTree(source, destination, options);
    else if (entry.isFile()) {
      fs.copyFileSync(source, destination);
      if (process.platform !== 'win32') fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
    }
    else throw new Wp7Error('WP1_PAYLOAD_PATH_INVALID', 'unsupported file type in final runtime payload', { source });
  }
}
function presealedParlantRuntimeRecords(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  if (!fs.existsSync(root)) throw new Wp7Error('WP7_PARLANT_RUNTIME_REQUIRED', 'presealed Parlant runtime input is missing', { runtimeRoot: root });
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Wp7Error('WP7_PARLANT_RUNTIME_INVALID', 'presealed Parlant runtime must be a real non-symlink directory', { runtimeRoot: root });
  const records = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Wp7Error('WP7_PARLANT_RUNTIME_SYMLINK_REJECTED', 'symlinks are forbidden in the presealed Parlant runtime', { path: absolute });
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        if (entry.name === 'runtime-seal.json') continue;
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        const stat = fs.statSync(absolute);
        records.push(Object.freeze({ path: relative, sizeBytes: stat.size, sha256: sha256File(absolute) }));
      } else throw new Wp7Error('WP7_PARLANT_RUNTIME_INVALID', 'unsupported file type in presealed Parlant runtime', { path: absolute });
    }
  }
  visit(root);
  records.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return Object.freeze(records);
}
function validatePresealedParlantRuntime(runtimeRoot) {
  const root = path.resolve(runtimeRoot);
  const required = [
    'runtime-seal.json',
    'runtime-sbom.cdx.json',
    'yance_parlant_server.py',
    'python/python.exe',
    'venv/Scripts/python.exe'
  ];
  for (const relative of required) {
    const absolute = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(absolute)) throw new Wp7Error('WP7_PARLANT_RUNTIME_INVALID', 'presealed Parlant runtime is missing a required file', { relative });
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Wp7Error('WP7_PARLANT_RUNTIME_INVALID', 'presealed Parlant runtime required path must be a regular non-symlink file', { relative });
  }
  let seal;
  try { seal = JSON.parse(fs.readFileSync(path.join(root, 'runtime-seal.json'), 'utf8')); }
  catch (error) { throw new Wp7Error('WP7_PARLANT_RUNTIME_SEAL_INVALID', 'presealed Parlant runtime seal is not valid JSON', { message: error.message }); }
  if (seal.schemaVersion !== 1 || seal.documentType !== 'YANCE_PARLANT_WINDOWS_RUNTIME_SEAL') throw new Wp7Error('WP7_PARLANT_RUNTIME_SEAL_INVALID', 'presealed Parlant runtime seal identity is invalid');
  if (!seal.runtime || !Number.isInteger(seal.runtime.fileCount) || seal.runtime.fileCount <= 0 || !SHA256_RE.test(String(seal.runtime.treeSha256 || '')) || !SHA256_RE.test(String(seal.runtime.sbomSha256 || ''))) {
    throw new Wp7Error('WP7_PARLANT_RUNTIME_SEAL_INVALID', 'presealed Parlant runtime seal runtime identity is invalid');
  }
  if (seal.runtime.dependencyResolution !== 'build-time-only' || seal.runtime.networkResolutionAtRuntime !== false) {
    throw new Wp7Error('WP7_PARLANT_RUNTIME_SEAL_INVALID', 'presealed Parlant runtime must prohibit runtime dependency resolution and runtime network resolution');
  }
  const records = presealedParlantRuntimeRecords(root);
  const canonical = Buffer.from(records.map((row) => `${row.path}|${row.sizeBytes}|${row.sha256}\n`).join(''), 'utf8');
  const treeSha256 = sha256Buffer(canonical);
  if (records.length !== seal.runtime.fileCount || treeSha256 !== seal.runtime.treeSha256) {
    throw new Wp7Error('WP7_PARLANT_RUNTIME_TREE_MISMATCH', 'presealed Parlant runtime tree does not match its runtime seal', { expectedFileCount: seal.runtime.fileCount, actualFileCount: records.length, expectedTreeSha256: seal.runtime.treeSha256, actualTreeSha256: treeSha256 });
  }
  const sbomSha256 = sha256File(path.join(root, 'runtime-sbom.cdx.json'));
  if (sbomSha256 !== seal.runtime.sbomSha256) throw new Wp7Error('WP7_PARLANT_RUNTIME_SBOM_MISMATCH', 'presealed Parlant runtime SBOM does not match its runtime seal', { expected: seal.runtime.sbomSha256, actual: sbomSha256 });
  return Object.freeze({ root: fs.realpathSync(root), fileCount: records.length, treeSha256, sbomSha256, sealSha256: sha256File(path.join(root, 'runtime-seal.json')), seal });
}
function copyPresealedParlantRuntime(sourceRoot, resourcesRoot) {
  const source = validatePresealedParlantRuntime(sourceRoot);
  const destinationRoot = path.join(path.resolve(resourcesRoot), 'parlant-runtime');
  if (fs.existsSync(destinationRoot)) throw new Wp7Error('WP7_PARLANT_RUNTIME_DESTINATION_NOT_EMPTY', 'Parlant runtime destination must not already exist', { destinationRoot });
  copyTree(source.root, destinationRoot, { missingReason: 'WP7_PARLANT_RUNTIME_REQUIRED' });
  const copied = validatePresealedParlantRuntime(destinationRoot);
  if (copied.fileCount !== source.fileCount || copied.treeSha256 !== source.treeSha256 || copied.sbomSha256 !== source.sbomSha256 || copied.sealSha256 !== source.sealSha256) {
    throw new Wp7Error('WP7_PARLANT_RUNTIME_COPY_MISMATCH', 'copied Parlant runtime differs from the presealed source', { source, copied });
  }
  return Object.freeze({ ...copied, relativeRoot: 'resources/parlant-runtime' });
}
function copyProductionDependencyTree(sourceRoot, destinationRoot) {
  const excludedGeneratedBinDirectories = [];
  const sourceBase = path.resolve(sourceRoot);
  function visit(sourceDirectory, destinationDirectory) {
    if (!fs.existsSync(sourceDirectory)) throw new Wp7Error('WP7_PRODUCTION_DEPENDENCY_DIRECTORY_TREE_MISMATCH', 'production dependency source is missing', { sourceDirectory });
    fs.mkdirSync(destinationDirectory, { recursive: true });
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const source = path.join(sourceDirectory, entry.name);
      const relative = path.relative(sourceBase, source).split(path.sep).join('/');
      if (entry.name === '.bin' && path.basename(sourceDirectory).toLowerCase() === 'node_modules') {
        excludedGeneratedBinDirectories.push(relative || '.bin');
        continue;
      }
      const destination = path.join(destinationDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Wp7Error('WP1_PAYLOAD_SYMLINK_REJECTED', 'symlinks are forbidden in final runtime payload', { source });
      if (entry.isDirectory()) visit(source, destination);
      else if (entry.isFile()) {
        fs.copyFileSync(source, destination);
        if (process.platform !== 'win32') fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
      } else throw new Wp7Error('WP1_PAYLOAD_PATH_INVALID', 'unsupported file type in final runtime payload', { source });
    }
  }
  visit(sourceBase, path.resolve(destinationRoot));
  return Object.freeze({
    policy: GENERATED_NPM_BIN_SHIM_POLICY,
    excludedGeneratedBinDirectories: Object.freeze(excludedGeneratedBinDirectories.sort((a, b) => a.localeCompare(b, 'en')))
  });
}

function createReviewFixtureBrandingOptions(testRceditRunner) {
  if (typeof testRceditRunner !== 'function') throw new Wp7Error('WP7_REVIEW_FIXTURE_BRANDING_RUNNER_INVALID', 'review fixture branding requires a callable test rcedit runner');
  return Object.freeze({
    reviewFixtureBrandingCapability: REVIEW_FIXTURE_BRANDING_CAPABILITY,
    testRceditRunner
  });
}
function resolveReviewFixtureRceditRunner(options = {}) {
  if (options.testRceditRunner === undefined || options.testRceditRunner === null) return null;
  if (typeof options.testRceditRunner !== 'function') throw new Wp7Error('WP7_REVIEW_FIXTURE_BRANDING_RUNNER_INVALID', 'review fixture branding runner must be callable');
  if (options.allowNonWindows !== true || options.reviewFixtureBrandingCapability !== REVIEW_FIXTURE_BRANDING_CAPABILITY) {
    throw new Wp7Error('WP7_REVIEW_FIXTURE_BRANDING_NOT_AUTHORIZED', 'test rcedit runner is restricted to explicitly authorized review fixtures');
  }
  return options.testRceditRunner;
}

function installReleasePlatformAuth(resourcesRoot, options = {}) {
  const configInput = options.platformAuthConfigPath ? path.resolve(options.platformAuthConfigPath) : '';
  const hashInput = options.platformAuthHashPath ? path.resolve(options.platformAuthHashPath) : '';
  const required = options.requirePlatformAuth === true;
  if (!configInput && !hashInput) {
    if (required) throw new Wp7Error('WP7_PLATFORM_AUTH_RELEASE_CONFIG_REQUIRED', 'formal platform-enabled build requires at least one sealed platform release configuration');
    return Object.freeze({ configured: false, sealed: false, configPath: '', hashPath: '', sha256: '' });
  }
  if (!configInput || !hashInput) {
    throw new Wp7Error('WP7_PLATFORM_AUTH_RELEASE_CONFIG_INCOMPLETE', 'platform release configuration and detached SHA-256 file must be supplied together', { configInput: Boolean(configInput), hashInput: Boolean(hashInput) });
  }
  if (!fs.existsSync(configInput) || !fs.statSync(configInput).isFile() || !fs.existsSync(hashInput) || !fs.statSync(hashInput).isFile()) {
    throw new Wp7Error('WP7_PLATFORM_AUTH_RELEASE_CONFIG_MISSING', 'platform release configuration input is missing', { configInput, hashInput });
  }
  let loaded;
  try { loaded = releasePlatformAuth.readSealedFile(configInput, { hashPath: hashInput }); }
  catch (error) {
    throw new Wp7Error('WP7_PLATFORM_AUTH_RELEASE_CONFIG_INVALID', error.message, { code: error.code || '', details: error.details || {} });
  }
  fs.mkdirSync(resourcesRoot, { recursive: true });
  const configPath = path.join(resourcesRoot, releasePlatformAuth.CONFIG_FILE);
  const hashPath = path.join(resourcesRoot, releasePlatformAuth.HASH_FILE);
  const bytes = fs.readFileSync(configInput);
  if (path.resolve(configInput) !== path.resolve(configPath)) fs.writeFileSync(configPath, bytes, { mode: 0o600 });
  else fs.chmodSync(configPath, 0o600);
  const digest = sha256Buffer(bytes);
  fs.writeFileSync(hashPath, `${digest}  ${releasePlatformAuth.CONFIG_FILE}\n`, { mode: 0o600 });
  return Object.freeze({
    configured: true,
    sealed: loaded.sealed === true,
    source: loaded.source,
    configPath,
    hashPath,
    sha256: digest,
    telegramConfigured: Boolean(loaded.telegram?.apiId && loaded.telegram?.apiHash),
    facebookConfigured: Boolean(loaded.facebook?.workerBaseUrl)
  });
}

function assembleWindowsApplication(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const payloadRoot = path.resolve(options.payloadRoot);
  const targetPlatform = options.targetPlatform || process.platform;
  const targetArch = options.targetArch || process.arch;
  if (targetPlatform !== 'win32' && options.allowNonWindows !== true) throw new Wp7Error('WP7_WINDOWS_FINAL_BUILD_REQUIRED', 'Windows runtime assembly must target win32 unless explicitly running a non-Windows review fixture', { targetPlatform, targetArch });
  const electronDist = path.resolve(options.electronDist || path.join(repoRoot, 'node_modules', 'electron', 'dist'));
  const electronExecutable = path.join(electronDist, targetPlatform === 'win32' ? 'electron.exe' : 'electron');
  if (!fs.existsSync(electronExecutable)) throw new Wp7Error('WP7_ELECTRON_RUNTIME_INPUT_MISSING', 'tracked final build requires the pinned Electron runtime dependency to be installed', { electronDist });
  const releaseSource = readReleaseSource(repoRoot);
  const productVersion = releaseSource.productVersion;
  const fileVersion = productVersion.split('.').length === 3 ? `${productVersion}.0` : productVersion;
  ensureDirectoryEmpty(payloadRoot);
  copyTree(electronDist, payloadRoot, { missingReason: 'WP7_ELECTRON_RUNTIME_INPUT_MISSING' });
  const copiedElectron = path.join(payloadRoot, path.basename(electronExecutable));
  const productExecutableName = targetPlatform === 'win32' ? releaseSource.executableName : path.parse(releaseSource.executableName).name;
  const productExecutable = path.join(payloadRoot, productExecutableName);
  if (copiedElectron !== productExecutable) fs.renameSync(copiedElectron, productExecutable);
  const iconPath = options.iconPath || path.join(repoRoot, 'assets', 'branding', 'yance', 'generated', 'Yance.ico');
  const rceditPath = options.rceditPath;
  const testRceditRunner = resolveReviewFixtureRceditRunner(options);
  const versionFields = {
    ProductName: releaseSource.productName,
    FileDescription: releaseSource.productName,
    CompanyName: releaseSource.companyName,
    LegalCopyright: releaseSource.legalCopyright,
    InternalName: releaseSource.internalName,
    OriginalFilename: releaseSource.originalFilename,
    FileVersion: fileVersion,
    ProductVersion: releaseSource.productVersion
  };
  const iconExists = fs.existsSync(iconPath);
  const rceditExists = Boolean(rceditPath && fs.existsSync(rceditPath));
  if (iconExists && (rceditExists || testRceditRunner)) {
    if (testRceditRunner) testRceditRunner({ exePath: productExecutable, iconPath, versionFields });
    else require('./pe-resource-editor').runRcedit({ rceditPath, exePath: productExecutable, iconPath, versionFields });
  } else if (targetPlatform === 'win32') {
    throw new Wp7Error('WP7_BRANDING_INPUT_MISSING', 'rcedit and approved icon.ico are required to brand the Windows product executable', { targetPlatform, hostPlatform: process.platform, iconPath, iconExists, rceditPath: rceditPath || null, rceditExists, testRceditRunnerProvided: typeof options.testRceditRunner === 'function', reviewFixtureBrandingAuthorized: options.reviewFixtureBrandingCapability === REVIEW_FIXTURE_BRANDING_CAPABILITY && options.allowNonWindows === true });
  }
  const appRoot = path.join(payloadRoot, 'resources', 'app');
  fs.mkdirSync(appRoot, { recursive: true });
  for (const rootName of ['backend', 'frontend', 'shared', 'electron', 'diagnostics', 'release']) copyTree(path.join(repoRoot, rootName), path.join(appRoot, rootName), { excludeNames: rootName === 'backend' ? ['tests'] : [] });
  for (const file of ['package.json', 'package-lock.json', 'installer/installedIdentityReceipt.js']) {
    const source = path.join(repoRoot, file);
    const destination = path.join(appRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    if (process.platform !== 'win32') fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
  }
  let productionDependencyCanonicalization = Object.freeze({ policy: GENERATED_NPM_BIN_SHIM_POLICY, excludedGeneratedBinDirectories: Object.freeze([]) });
  if (options.productionNodeModulesSource) productionDependencyCanonicalization = copyProductionDependencyTree(path.resolve(options.productionNodeModulesSource), path.join(appRoot, 'node_modules'));
  else if (options.installProductionDependencies !== false) {
    const result = runNpmCommand(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--no-bin-links', `--os=${targetPlatform}`, `--cpu=${targetArch}`], { cwd: appRoot, platform: options.hostPlatform || process.platform, command: options.npmExecutable, spawn: options.npmSpawn });
    if (result.status !== 0) throw new Wp7Error('WP7_PRODUCTION_DEPENDENCY_INSTALL_FAILED', 'production dependency installation failed', { ...spawnFailureDetails(result), targetPlatform, targetArch });
  }
  fs.rmSync(path.join(appRoot, 'node_modules', '.package-lock.json'), { force: true });
  const installedBinRoot = path.join(appRoot, 'node_modules', '.bin');
  if (fs.existsSync(installedBinRoot)) {
    fs.rmSync(installedBinRoot, { recursive: true, force: true });
    productionDependencyCanonicalization = Object.freeze({ policy: GENERATED_NPM_BIN_SHIM_POLICY, excludedGeneratedBinDirectories: Object.freeze(['.bin']) });
  }
  const trustedNodeExecutable = path.resolve(options.trustedNodeExecutable || process.execPath);
  const nodeRuntime = copyTrustedNodeRuntime({ sourceExecutable: trustedNodeExecutable, destinationRoot: path.join(payloadRoot, 'resources', 'runtime', 'node22'), platform: targetPlatform });
  const parlantRuntime = options.parlantRuntimeSource ? copyPresealedParlantRuntime(options.parlantRuntimeSource, path.join(payloadRoot, 'resources')) : null;
  return { status: 'PASS', payloadRoot, appRoot, productExecutable: path.relative(payloadRoot, productExecutable).split(path.sep).join('/'), targetPlatform, targetArch, nodeRuntime, parlantRuntime, productionDependencyCanonicalization };
}

function buildFinalWindowsPayload(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const stagingRoot = path.resolve(options.stagingRoot);
  const identity = options.identity;
  const buildTimestampUtc = options.buildTimestampUtc;
  const targetPlatform = options.targetPlatform || process.platform;
  const targetArch = options.targetArch || process.arch;
  const releaseSource = readReleaseSource(repoRoot);
  const singleSource = wp1.scanSingleHumanMaintainedReleaseSource(repoRoot, releaseSource);
  if (singleSource.status !== 'PASS') throw new Wp7Error(singleSource.reasonCode || 'WP7_RELEASE_SOURCE_DUPLICATED', 'duplicate release identity source detected', { violations: singleSource.violations });
  const schemaAuthority = wp1.deriveDatabaseSchemaVersion(repoRoot);
  const payloadRoot = path.join(stagingRoot, 'application-payload');
  const runtimeDependencyClosure = validateProductionRuntimeSourceDependencies({ repoRoot });
  const runtime = assembleWindowsApplication({ repoRoot, payloadRoot, allowNonWindows: options.allowNonWindows === true, installProductionDependencies: options.installProductionDependencies !== false, productionNodeModulesSource: options.productionNodeModulesSource, electronDist: options.electronDist, npmExecutable: options.npmExecutable, rceditPath: options.rceditPath, iconPath: options.iconPath, reviewFixtureBrandingCapability: options.reviewFixtureBrandingCapability, testRceditRunner: options.testRceditRunner, targetPlatform, targetArch, trustedNodeExecutable: options.trustedNodeExecutable, parlantRuntimeSource: options.parlantRuntimeSource });
  const sourceClosure = validateReviewedApplicationSourceClosure(payloadRoot, repoRoot, identity.sourceCommit, { platform: targetPlatform });
  const dependencies = verifyProductionDependencyClosure({ repoRoot, appRoot: runtime.appRoot, sourceCommit: identity.sourceCommit, platform: targetPlatform, arch: targetArch });
  let electronDistribution;
  const executableName = targetPlatform === 'win32' ? releaseSource.executableName : path.parse(releaseSource.executableName).name;
  const archiveExecutableEntry = options.archiveExecutableEntry || (targetPlatform === 'win32' ? 'electron.exe' : 'electron');
  if (Array.isArray(options.electronOfficialRecords)) electronDistribution = compareElectronDistributionTree({ payloadRoot, archiveExecutableEntry, productExecutableName: executableName, officialRecords: options.electronOfficialRecords, platform: targetPlatform });
  else {
    if (!options.electronArchivePath) throw new Wp7Error('WP7_PACKAGED_ELECTRON_ARCHIVE_REQUIRED', 'final payload identity requires the official Electron release archive');
    electronDistribution = verifyElectronDistributionTree({ archivePath: options.electronArchivePath, payloadRoot, archiveExecutableEntry, productExecutableName: executableName, platform: targetPlatform, baseExecutablePath: path.join(options.electronDist || path.join(repoRoot, 'node_modules', 'electron', 'dist'), 'electron.exe') });
  }
  const artifactClass = options.artifactClass || FINAL_ARTIFACT_CLASS;
  const finalReleaseEvidence = options.finalReleaseEvidence === undefined ? artifactClass === FINAL_ARTIFACT_CLASS : options.finalReleaseEvidence === true;
  if (![PRE_REVIEW_ARTIFACT_CLASS, FINAL_ARTIFACT_CLASS].includes(artifactClass) || finalReleaseEvidence !== (artifactClass === FINAL_ARTIFACT_CLASS)) throw new Wp7Error('WP7_ARTIFACT_CLASS_INVALID', 'payload artifact class and final release evidence flag are inconsistent', { artifactClass, finalReleaseEvidence });
  const resourcesRoot = path.join(payloadRoot, 'resources');
  const platformAuth = installReleasePlatformAuth(resourcesRoot, { platformAuthConfigPath: options.platformAuthConfigPath, platformAuthHashPath: options.platformAuthHashPath, requirePlatformAuth: options.requirePlatformAuth === true });
  const nativeBinaryEvidencePath = path.join(resourcesRoot, 'evidence', 'native-binary-scan.json');
  const nativeBinaryScan = verifyNativeBinaries({ payloadRoot, evidenceFile: nativeBinaryEvidencePath, targetPlatform, targetArch, generatedAtUtc: buildTimestampUtc });
  if (nativeBinaryScan.status !== 'PASS') throw new Wp7Error('WP7_NATIVE_BINARY_SCAN_FAILED', 'native binary scan failed', { nativeBinaryScan });
  const nativeBinaryScanSha256 = sha256Buffer(nativeBinaryCanonicalBuffer(nativeBinaryScan));
  const records = wp1.generatePayloadRecords(payloadRoot, { excludedPaths: CONTROLLED_METADATA_PATHS });
  const payloadDocument = { ...wp1.payloadFilesDocument(records), artifactClass, finalReleaseEvidence };
  const payloadFilesPath = path.join(resourcesRoot, 'payload-files.json');
  writeCanonicalJson(payloadFilesPath, payloadDocument);
  const payloadFilesSha256 = sha256File(payloadFilesPath);
  const buildId = wp1.buildIdFrom({ releaseSource, sourceCommit: identity.sourceCommit, buildTimestampUtc });
  const manifest = {
    ...wp1.buildManifest({ releaseSource, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, buildTimestampUtc, buildId, records, payloadFilesSha256, databaseSchemaVersion: schemaAuthority.databaseSchemaVersion }),
    artifactClass,
    finalReleaseEvidence,
    platformAuthConfigured: platformAuth.configured === true,
    platformAuthConfigSha256: platformAuth.configured ? platformAuth.sha256 : null,
    platformAuthReleaseManaged: true,
    productionDependencyBindingSha256: dependencies.externalBindingSha256,
    productionDependencyPackageGraphSha256: dependencies.packageGraphSha256,
    productionDependencyFileTreeSha256: dependencies.dependencyFileTreeSha256,
    productionDependencyModeTreeSha256: dependencies.dependencyModeTreeSha256,
    productionDependencyDirectoryModeTreeSha256: dependencies.dependencyDirectoryModeTreeSha256,
    productionDependencyFileModePolicy: dependencies.fileModePolicy,
    productionDependencyDirectoryModePolicy: dependencies.directoryModePolicy,
    productionDependencyPackageCount: dependencies.packageCount,
    productionDependencyFileCount: dependencies.fileCount,
    productionDependencyModeRecordCount: dependencies.modeBoundFileCount,
    productionDependencyDirectoryCount: dependencies.directoryCount,
    productionDependencyDirectoryModeRecordCount: dependencies.modeBoundDirectoryCount,
    gitPayloadModeTreeSha256: sourceClosure.gitPayloadModeTreeSha256,
    gitPayloadModeRecordCount: sourceClosure.gitPayloadModeRecordCount,
    electronDistributionTreeSha256: electronDistribution.distributionTreeSha256,
    electronDistributionFileCount: electronDistribution.archiveFileCount,
    electronDistributionModeBoundFileCount: electronDistribution.modeBoundFileCount,
    nodeRuntimeVersion: runtime.nodeRuntime.version,
    appRoot: 'app',
    backendEntryPath: 'app/backend/desktopHostedEntry.js',
    nodeModulesPath: 'app/node_modules',
    nodeRuntimeExecutablePath: `runtime/node22/${runtime.nodeRuntime.executableRelativePath}`,
    nodeRuntimeExecutableSha256: runtime.nodeRuntime.executableSha256,
    nodeRuntimeTreeSha256: runtime.nodeRuntime.runtimeTreeSha256,
    nodeRuntimeFileCount: runtime.nodeRuntime.fileCount,
    nodeRuntimeModeBoundFileCount: runtime.nodeRuntime.modeBoundFileCount,
    nativeBinaryScanSha256,
    nativeBinaryFileCount: nativeBinaryScan.fileCount,
    nativeBinaryFailureCount: nativeBinaryScan.failureCount,
    nativeBinaryTargetPlatform: targetPlatform,
    nativeBinaryTargetArch: targetArch
  };
  manifest.applicationPayloadFilesystemIdentitySha256 = applicationPayloadFilesystemIdentitySha256(manifest);
  validateReleaseManifest(manifest, { expectedProductVersion: releaseSource.productVersion, expectedStageVersion: releaseSource.stageVersion });
  const manifestPath = path.join(resourcesRoot, 'release-manifest.json');
  writeCanonicalJson(manifestPath, manifest);
  const releaseManifestSha256 = sha256File(manifestPath);
  const detachedPath = path.join(resourcesRoot, 'release-manifest.sha256');
  fs.writeFileSync(detachedPath, wp1.detachedHashText(releaseManifestSha256), 'utf8');
  const installerIdentityReceipt = writeInstallerIdentityReceipt(resourcesRoot, { ...manifest, manifestSha256: releaseManifestSha256 }, { generatedAtUtc: buildTimestampUtc, installerScriptSha256: sha256File(path.join(repoRoot, 'installer', 'wp7', 'YanceFinalInstaller.nsi')) });
  return { releaseSource, schemaAuthority, payloadRoot, runtime, runtimeDependencyClosure, records, payloadFilesPath, payloadFilesSha256, resourcesRoot, manifest, manifestPath, releaseManifestSha256, detachedPath, installerIdentityReceipt, nativeBinaryScan, buildId, sourceClosure, dependencies, electronDistribution, platformAuth };
}

function buildManifestAndPayload({ repoRoot, stagingRoot, identity, buildTimestampUtc }) {
  const releaseSource = readReleaseSource(repoRoot);
  const singleSource = wp1.scanSingleHumanMaintainedReleaseSource(repoRoot, releaseSource);
  if (singleSource.status !== 'PASS') throw new Wp7Error(singleSource.reasonCode || 'WP7_RELEASE_SOURCE_DUPLICATED', 'duplicate release identity source detected', { violations: singleSource.violations });
  const schemaAuthority = wp1.deriveDatabaseSchemaVersion(repoRoot);
  const payloadRoot = path.join(stagingRoot, 'application-payload');
  const payloadBuild = wp1.createApplicationPayload(repoRoot, payloadRoot, { releaseSource, schemaAuthority });
  const records = wp1.generatePayloadRecords(payloadRoot);
  const payloadDocument = { ...wp1.payloadFilesDocument(records), artifactClass: PIPELINE_TEST_ARTIFACT_CLASS, finalReleaseEvidence: false };
  const resourcesRoot = path.join(stagingRoot, 'resources');
  const payloadFilesPath = path.join(resourcesRoot, 'payload-files.json');
  writeCanonicalJson(payloadFilesPath, payloadDocument);
  const payloadFilesSha256 = sha256File(payloadFilesPath);
  const buildId = wp1.buildIdFrom({ releaseSource, sourceCommit: identity.sourceCommit, buildTimestampUtc });
  const manifest = { ...wp1.buildManifest({ releaseSource, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, buildTimestampUtc, buildId, records, payloadFilesSha256, databaseSchemaVersion: schemaAuthority.databaseSchemaVersion }), artifactClass: PIPELINE_TEST_ARTIFACT_CLASS, finalReleaseEvidence: false };
  validateReleaseManifest(manifest, { expectedProductVersion: releaseSource.productVersion, expectedStageVersion: releaseSource.stageVersion });
  if (manifest.credentialProtocolVersion !== 3) throw new Wp7Error('WP7_PROTOCOL_VERSION_BINDING_MISMATCH', 'generated manifest did not bind credential protocol version 3');
  const manifestPath = path.join(resourcesRoot, 'release-manifest.json');
  writeCanonicalJson(manifestPath, manifest);
  const releaseManifestSha256 = sha256File(manifestPath);
  const detachedPath = path.join(resourcesRoot, 'release-manifest.sha256');
  fs.writeFileSync(detachedPath, wp1.detachedHashText(releaseManifestSha256), 'utf8');
  const installerIdentityReceipt = writeInstallerIdentityReceipt(resourcesRoot, { ...manifest, manifestSha256: releaseManifestSha256 }, { generatedAtUtc: buildTimestampUtc, installerScriptSha256: sha256File(path.join(repoRoot, 'installer', 'wp7', 'YanceFinalInstaller.nsi')) });
  return { releaseSource, schemaAuthority, payloadRoot, payloadBuild, records, payloadFilesPath, payloadFilesSha256, resourcesRoot, manifest, manifestPath, releaseManifestSha256, detachedPath, installerIdentityReceipt, buildId };
}

function buildPreReviewFixture(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const outputRoot = path.resolve(options.outputRoot || path.join(os.tmpdir(), `yance-wp7-pre-review-${process.pid}`));
  const identity = options.identity || gitIdentity(repoRoot);
  assertActivationBinding(repoRoot, { identity, requireClean: options.requireClean !== false, requireBranch: options.requireBranch !== false });
  assertWp6Binding(repoRoot);
  verifyRuntimeProtocolConvergence(repoRoot);
  const buildTimestampUtc = normalizeTimestamp(options.buildTimestampUtc || new Date().toISOString());
  const leasePath = `${outputRoot}.lease`;
  const releaseLease = acquireExclusiveLease(leasePath, { outputRoot, sourceCommit: identity.sourceCommit });
  try {
    ensureDirectoryEmpty(outputRoot);
    const stagingRoot = path.join(outputRoot, 'staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    wp1.assertEmptyBeforeFinalBuild(stagingRoot);
    const sessionId = buildSessionId(identity, buildTimestampUtc, options.sessionNonce || 'pre-review');
    const built = buildManifestAndPayload({ repoRoot, stagingRoot, identity, buildTimestampUtc });
    const artifactsRoot = path.join(outputRoot, 'artifacts');
    const installerFileName = preReviewInstallerName(built.releaseSource, built.buildId);
    const installerPath = path.join(artifactsRoot, installerFileName);
    writePreReviewInstallerFixture(installerPath, { schemaVersion: 1, buildSessionId: sessionId, buildId: built.buildId, productVersion: built.releaseSource.productVersion, stageVersion: built.releaseSource.stageVersion, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, releaseManifestSha256: built.releaseManifestSha256, applicationPayloadSha256: built.manifest.applicationPayloadSha256, payloadFilesSha256: built.payloadFilesSha256 });
    const installerSha256 = sha256File(installerPath);
    const evidence = {
      schemaVersion: 3,
      documentType: 'WP7_PRE_REVIEW_RELEASE_EVIDENCE',
      stage: '6.4.5.9', phase: 'core-runtime-p1', workPackage: 'WP7', evidenceKind: 'BUILD_PIPELINE_FIXTURE', evidenceClass: PIPELINE_TEST_ARTIFACT_CLASS,
      status: 'PASS', generatedAtUtc: buildTimestampUtc, frozenSourceCommit: identity.sourceCommit, frozenSourceTree: identity.sourceTree, buildSessionId: sessionId, buildId: built.buildId,
      productVersion: built.releaseSource.productVersion, stageVersion: built.releaseSource.stageVersion, distributionMode: built.releaseSource.distributionMode, apiContractVersion: built.releaseSource.apiContractVersion,
      credentialProtocolVersion: built.releaseSource.credentialProtocolVersion, runtimeLockProtocolVersion: built.releaseSource.runtimeLockProtocolVersion, databaseSchemaVersion: built.schemaAuthority.databaseSchemaVersion,
      releaseManifestSha256: built.releaseManifestSha256, applicationPayloadSha256: built.manifest.applicationPayloadSha256, payloadFilesSha256: built.payloadFilesSha256,
      installerFileName, installerSizeBytes: fs.statSync(installerPath).size, installerSha256, finalInstallationMode: 'CLEAN_INSTALL', legacyTestDataMigrationRequired: false, legacyTestVersionRollbackRequired: false,
      inheritedRiskAcceptances: RISK_IDS.map((id) => ({ id, scopeExpansionAllowed: false })), assertions: ['stagingInitiallyEmpty', 'wp1ArtifactsNotReused', 'identityTupleConsistent', 'notFinalInstaller'], reasonCodes: [], finalReleaseEvidence: false
    };
    const evidencePath = path.join(outputRoot, 'pre-review-release-evidence.json');
    writeCanonicalJson(evidencePath, evidence);
    const provenance = { schemaVersion: 1, documentType: 'WP7_PRE_REVIEW_BUILD_PROVENANCE', status: 'PASS', artifactClass: PIPELINE_TEST_ARTIFACT_CLASS, generatedAtUtc: buildTimestampUtc, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, buildSessionId: sessionId, buildId: built.buildId, stagingInitiallyEmpty: true, oldStagingReuseAllowed: false, wp1PipelineArtifactReuseAllowed: false, overlayInstallerAllowed: false, releaseManifestSha256: built.releaseManifestSha256, installerSha256, includedRoots: built.payloadBuild.includedRoots, copiedFilesByRoot: built.payloadBuild.copiedFilesByRoot };
    const provenancePath = path.join(outputRoot, 'build-provenance.json');
    writeCanonicalJson(provenancePath, provenance);
    assertNoWp1Reuse(built.payloadRoot);
    const seal = { schemaVersion: 1, documentType: 'WP7_PRE_REVIEW_BUILD_SESSION_SEAL', status: 'SEALED_PIPELINE_TEST_ONLY', artifactClass: PIPELINE_TEST_ARTIFACT_CLASS, buildSessionId: sessionId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, buildId: built.buildId, installerSha256, releaseManifestSha256: built.releaseManifestSha256, finalInstaller: false, generatedAtUtc: buildTimestampUtc };
    const sealPath = path.join(outputRoot, 'build-session-seal.json');
    writeCanonicalJson(sealPath, seal);
    return { status: 'PASS', outputRoot, stagingRoot, artifactsRoot, installerPath, evidencePath, provenancePath, sealPath, identity, sessionId, installerSha256, ...built };
  } finally { releaseLease(); }
}

function assertSessionSealed(outputRoot) {
  const sealPath = path.join(outputRoot, 'build-session-seal.json');
  if (!fs.existsSync(sealPath)) throw new Wp7Error('WP7_PARTIAL_BUILD_REUSE_DENIED', 'unsealed WP7 build session cannot be reused', { outputRoot });
  const seal = readJson(sealPath);
  if (!String(seal.status).startsWith('SEALED_')) throw new Wp7Error('WP7_PARTIAL_BUILD_REUSE_DENIED', 'invalid build session seal', { seal });
  return seal;
}
function validateBuildIdentity(consumers) {
  const names = ['electron', 'backend', 'installer', 'diagnostics'];
  const missing = names.filter((name) => !consumers[name]);
  if (missing.length) throw new Wp7Error('BOOT_BUILD_ID_MISMATCH', 'release identity consumer missing', { missing });
  const fields = ['buildId', 'productVersion', 'stageVersion', 'sourceCommit', 'sourceTree', 'manifestSha256'];
  const reference = consumers.electron;
  const mismatches = [];
  for (const name of names) for (const field of fields) if (consumers[name][field] !== reference[field]) mismatches.push({ consumer: name, field, expected: reference[field], actual: consumers[name][field] });
  if (mismatches.length) throw new Wp7Error('BOOT_BUILD_ID_MISMATCH', 'release identity consumers disagree', { mismatches });
  return { status: 'PASS', consumers: names, fields };
}
function validateRiskRegister(register) {
  const records = register.records || [];
  const ids = records.map((r) => r.riskAcceptanceId);
  const missing = RISK_IDS.filter((id) => !ids.includes(id));
  if (missing.length) throw new Wp7Error('WP7_INHERITED_RISK_RECORD_MISMATCH', 'inherited risk acceptance missing', { missing });
  if (records.some((r) => RISK_IDS.includes(r.riskAcceptanceId) && /CLOSED|PASS/.test(String(r.status)))) throw new Wp7Error('WP7_INHERITED_RISK_RECORD_MISMATCH', 'accepted risk was rewritten as closed/pass');
  return { status: 'PASS', ids: RISK_IDS };
}
function validateDeferredScope(document) {
  const forbiddenTrue = ['authenticodeAccepted', 'manifestSignatureAccepted', 'automaticUpdateAccepted', 'upgradePackageAccepted', 'publicReleaseAccepted', 'enterpriseDeploymentAccepted'];
  const violations = forbiddenTrue.filter((key) => document[key] === true);
  if (violations.length) throw new Wp7Error('WP7_DEFERRED_SCOPE_CLAIMED', 'deferred release scope was claimed', { violations });
  if (document.distributionMode && document.distributionMode !== 'LOCAL_PRIVATE_UNSIGNED') throw new Wp7Error('WP7_UNSIGNED_POLICY_MISAPPLIED', 'distribution mode must remain LOCAL_PRIVATE_UNSIGNED');
  return { status: 'PASS' };
}
function validateEvidenceReferences(references, options = {}) {
  const invalid = [];
  for (const ref of references || []) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) { invalid.push(typeof ref === 'string' ? ref : null); continue; }
    const file = ref.path;
    if (!file || FORBIDDEN_EVIDENCE_PREFIXES.some((prefix) => file.startsWith(prefix))) invalid.push(file || null);
    if (options.final === true && !FINAL_EVIDENCE_ALLOWLIST.has(file)) invalid.push(file);
    if (!SHA256_RE.test(ref.sha256 || '')) invalid.push(file);
    if (options.rootDir && file) {
      const absolute = path.resolve(options.rootDir, ...file.split('/'));
      const root = path.resolve(options.rootDir);
      if (!absolute.startsWith(`${root}${path.sep}`) || !fs.existsSync(absolute) || sha256File(absolute) !== ref.sha256) invalid.push(file);
    }
  }
  if (invalid.length) throw new Wp7Error('WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION', 'evidence references violate WP7 allowlist', { invalid });
  return { status: 'PASS', count: (references || []).length };
}
function scanSecrets(value, pathParts = [], findings = []) {
  if (Array.isArray(value)) value.forEach((item, index) => scanSecrets(item, [...pathParts, String(index)], findings));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_FIELD_RE.test(key) && !['credentialProtocolVersion'].includes(key)) findings.push([...pathParts, key].join('.'));
      scanSecrets(child, [...pathParts, key], findings);
    }
  }
  return findings;
}
function validateEvidenceCommon(document, options = {}) {
  const required = ['schemaVersion', 'documentType', 'stage', 'phase', 'workPackage', 'status', 'generatedAtUtc'];
  const missing = required.filter((key) => document[key] === undefined || document[key] === null || document[key] === '');
  if (missing.length) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'evidence required fields missing', { missing });
  if (document.stage !== '6.4.5.9' || document.phase !== 'core-runtime-p1' || document.workPackage !== 'WP7') throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'evidence stage identity mismatch');
  const secretFindings = scanSecrets(document);
  if (secretFindings.length) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'secret-like fields are forbidden in evidence', { secretFindings });
  if (options.final === true) {
    const schema = readJson(EVIDENCE_REQUIREMENTS_PATH).finalEvidenceSchema;
    for (const field of schema.commonRequiredFields || []) if (document[field] === undefined || document[field] === null || document[field] === '') throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `final evidence field missing: ${field}`);
    for (const field of ['releaseManifestSha256', 'applicationPayloadSha256', 'applicationPayloadFilesystemIdentitySha256', 'payloadFilesSha256', 'productionDependencyBindingSha256', 'productionDependencyPackageGraphSha256', 'productionDependencyFileTreeSha256', 'productionDependencyModeTreeSha256', 'productionDependencyDirectoryModeTreeSha256', 'gitPayloadModeTreeSha256', 'electronDistributionTreeSha256', 'nodeRuntimeExecutableSha256', 'nodeRuntimeTreeSha256', 'nativeBinaryScanSha256', 'installerSha256', 'completeProjectSourceTreeSha256']) if (!SHA256_RE.test(document[field])) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `invalid SHA256 field ${field}`);
    for (const field of ['productionDependencyPackageCount', 'productionDependencyFileCount', 'productionDependencyModeRecordCount', 'productionDependencyDirectoryCount', 'productionDependencyDirectoryModeRecordCount', 'gitPayloadModeRecordCount', 'electronDistributionFileCount', 'nodeRuntimeFileCount', 'nativeBinaryFileCount']) if (!Number.isInteger(document[field]) || document[field] <= 0) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `invalid positive count field ${field}`);
    if (!Number.isInteger(document.electronDistributionModeBoundFileCount) || document.electronDistributionModeBoundFileCount < 0 || document.electronDistributionModeBoundFileCount > document.electronDistributionFileCount) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'invalid Electron mode-bound file count');
    if (document.nodeRuntimeVersion !== '22.23.1') throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'invalid reviewed Node runtime version');
    if (!/^runtime\/node22\/(?:node|node\.exe)$/.test(document.nodeRuntimeExecutablePath)) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'invalid Node runtime executable path');
    if (document.nativeBinaryFailureCount !== 0 || !['linux', 'win32'].includes(document.nativeBinaryTargetPlatform) || document.nativeBinaryTargetArch !== 'x64') throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'invalid native binary scan identity');
    if (!Number.isInteger(document.nodeRuntimeModeBoundFileCount) || document.nodeRuntimeModeBoundFileCount < 1 || document.nodeRuntimeModeBoundFileCount > document.nodeRuntimeFileCount) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'invalid Node runtime mode-bound file count');
    if (!GIT_OBJECT_RE.test(document.frozenSourceCommit) || !GIT_OBJECT_RE.test(document.frozenSourceTree)) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'invalid frozen Git identity');
    if (document.finalInstallationMode !== 'CLEAN_INSTALL' || document.legacyTestDataMigrationRequired !== false || document.legacyTestVersionRollbackRequired !== false) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'final installation policy mismatch');
    const upstream = document.upstreamBindings || {};
    for (const [wp, fields] of Object.entries(schema.upstreamBindingsRequired || {})) {
      if (!upstream[wp]) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `missing upstream binding ${wp}`);
      for (const field of fields) if (upstream[wp][field] === undefined) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', `missing upstream binding field ${wp}.${field}`);
    }
    const inherited = document.inheritedRiskAcceptances || [];
    const ids = inherited.map((entry) => typeof entry === 'string' ? entry : entry.id);
    const missingRisks = RISK_IDS.filter((id) => !ids.includes(id));
    if (missingRisks.length || inherited.some((entry) => entry && typeof entry === 'object' && entry.scopeExpansionAllowed !== false)) throw new Wp7Error('WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID', 'inherited risk binding mismatch', { missingRisks });
  }
  return { status: 'PASS' };
}
function validateCrossFileIdentity(documents) {
  const fields = ['frozenSourceCommit', 'frozenSourceTree', 'buildSessionId', 'buildId', 'installerSha256'];
  const docs = Object.entries(documents || {});
  if (!docs.length) throw new Wp7Error('WP7_EVIDENCE_IDENTITY_SPLIT', 'no evidence documents provided');
  const reference = docs[0][1];
  const mismatches = [];
  for (const [name, doc] of docs) for (const field of fields) if (doc[field] !== reference[field]) mismatches.push({ name, field, expected: reference[field], actual: doc[field] });
  if (mismatches.length) throw new Wp7Error('WP7_EVIDENCE_IDENTITY_SPLIT', 'evidence identity tuple split', { mismatches });
  return { status: 'PASS', fields, documentCount: docs.length };
}
function validateCleanInstallEvidence(doc) {
  const required = ['finalInstallationMode', 'legacyInstallationsDetected', 'legacyInstallationsUninstalled', 'oldProcessesDetected', 'oldProcessesTerminated', 'remainingResidueCount', 'legacyTestDataMigrationAttempted', 'legacyTestVersionRollbackAttempted', 'installerSha256VerifiedImmediatelyBeforeInstall', 'firstStartFreshInitialization', 'status', 'reasonCodes'];
  const missing = required.filter((key) => doc[key] === undefined);
  if (missing.length) throw new Wp7Error('WP7_CLEAN_INSTALL_EVIDENCE_INCOMPLETE', 'clean-install evidence incomplete', { missing });
  if (doc.finalInstallationMode !== 'CLEAN_INSTALL' || doc.legacyTestDataMigrationAttempted !== false || doc.legacyTestVersionRollbackAttempted !== false) throw new Wp7Error('WP7_LEGACY_TEST_DATA_MIGRATION_FORBIDDEN', 'clean-install policy mismatch');
  if (doc.remainingResidueCount !== 0) throw new Wp7Error('WP7_LEGACY_TEST_DATA_RESIDUE', 'legacy residue remains', { remainingResidueCount: doc.remainingResidueCount });
  if (doc.installerSha256VerifiedImmediatelyBeforeInstall !== true) throw new Wp7Error('WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH', 'installer SHA256 was not verified immediately before install');
  if (doc.firstStartFreshInitialization !== true) throw new Wp7Error('WP7_FIRST_START_NOT_CLEAN', 'first start did not initialize fresh state');
  return { status: 'PASS' };
}
function validateBootFailureDiagnostics(doc) {
  const required = ['buildId', 'failedPhase', 'reasonCode'];
  const missing = required.filter((key) => typeof doc[key] !== 'string' || !doc[key]);
  if (missing.length) throw new Wp7Error('WP7_BOOT_DIAGNOSTIC_INCOMPLETE', 'boot failure diagnostics incomplete', { missing });
  return { status: 'PASS' };
}
function validateAcceptanceMapping(mapping = readJson(ACCEPTANCE_MAPPING_PATH), phaseModel = readJson(PHASE_MODEL_PATH), evidenceRequirements = readJson(EVIDENCE_REQUIREMENTS_PATH)) {
  const items = mapping.acceptanceChecks || mapping.acceptanceCheckMapping || [];
  const expected = Array.from({ length: 10 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`);
  const ids = items.map((item) => item.acceptanceId);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Wp7Error('WP7_ACCEPTANCE_CHECK_ID_MAPPING_MISSING', 'A01-A10 mapping must be exact and ordered', { ids });
  const allTests = new Set(Object.values(phaseModel.testAssignments || {}).flat());
  const evidenceOutputs = new Set(evidenceRequirements.finalEvidenceSchema?.finalEvidenceOutputs || evidenceRequirements.finalEvidenceOutputs || [...FINAL_EVIDENCE_ALLOWLIST]);
  const errors = [];
  for (const item of items) {
    for (const key of ['formalRequirement', 'passOracle', 'applicablePhase']) if (!item[key]) errors.push({ id: item.acceptanceId, missing: key });
    if (!item.requiredTestIds?.length || !item.requiredEvidenceFiles?.length || !item.failReasonCodes?.length) errors.push({ id: item.acceptanceId, missing: 'arrays' });
    for (const id of item.requiredTestIds || []) if (!allTests.has(id)) errors.push({ id: item.acceptanceId, unknownTest: id });
    for (const file of item.requiredEvidenceFiles || []) if (!evidenceOutputs.has(file) && !FINAL_EVIDENCE_ALLOWLIST.has(file)) errors.push({ id: item.acceptanceId, unknownEvidence: file });
  }
  if (errors.length) throw new Wp7Error('WP7_ACCEPTANCE_CHECK_ID_MAPPING_MISSING', 'A01-A10 mapping references invalid items', { errors });
  return { status: 'PASS', count: items.length };
}
function validatePhaseModel(model = readJson(PHASE_MODEL_PATH)) {
  const expectedClasses = ['PRE_REVIEW', 'PRE_REVIEW_AND_FINAL', 'FINAL_PACKAGING', 'FINAL_WINDOWS'];
  const actual = Object.keys(model.testAssignments || {});
  if (JSON.stringify(actual) !== JSON.stringify(expectedClasses)) throw new Wp7Error('WP7_REQUIRED_TEST_PHASE_CONTRADICTION', 'required test phase classes mismatch', { actual });
  const all = Object.values(model.testAssignments).flat();
  if (new Set(all).size !== all.length) throw new Wp7Error('WP7_REQUIRED_TEST_PHASE_CONTRADICTION', 'test assigned to multiple phase classes');
  const pre = [...model.testAssignments.PRE_REVIEW, ...model.testAssignments.PRE_REVIEW_AND_FINAL];
  const expectedPreReviewTotal = Number(model.convergencePreReviewRequiredTestCount);
  if (!Number.isInteger(expectedPreReviewTotal) || expectedPreReviewTotal <= 0 || pre.length !== expectedPreReviewTotal) throw new Wp7Error('WP7_REQUIRED_TEST_PHASE_CONTRADICTION', 'Convergence Pre-Review required-test count does not match the governed model', { expected: expectedPreReviewTotal, actual: pre.length });
  return { status: 'PASS', total: all.length, preReviewTotal: pre.length, counts: Object.fromEntries(expectedClasses.map((key) => [key, model.testAssignments[key].length])) };
}
function verifyRequiredTestImplementations(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const model = options.model || readJson(PHASE_MODEL_PATH);
  const exists = options.exists || fs.existsSync;
  const all = Object.values(model.testAssignments || {}).flat();
  const missing = all.filter((id) => !exists(path.join(repoRoot, 'tests', 'wp7', `${id}.js`), id));
  if (missing.length) throw new Wp7Error('WP7_FINAL_PHASE_REQUIRED_TEST_IMPLEMENTATIONS_MISSING', 'required test implementation files missing', { missing });
  return { status: 'PASS', total: all.length, finalPackaging: model.testAssignments.FINAL_PACKAGING.length, finalWindows: model.testAssignments.FINAL_WINDOWS.length };
}
function validateWorkstreamTraceability(trace = readJson(TRACEABILITY_PATH), matrices = readJson(MATRICES_PATH), phaseModel = readJson(PHASE_MODEL_PATH), evidenceRequirements = readJson(EVIDENCE_REQUIREMENTS_PATH)) {
  const streams = trace.workstreams || trace.workstreamTraceability || [];
  const expected = Array.from({ length: 10 }, (_, i) => `WS${String(i + 1).padStart(2, '0')}`);
  const ids = streams.map((stream) => stream.id);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) throw new Wp7Error('WP7_WORKSTREAM_TRACEABILITY_INCOMPLETE', 'WS01-WS10 traceability must be exact', { ids });
  const catalogs = {
    faultIds: new Set((matrices.faultMatrix || []).map((x) => x.id)),
    raceIds: new Set((matrices.concurrencyRaceMatrix || []).map((x) => x.id)),
    crashIds: new Set((matrices.crashMatrix || []).map((x) => x.id)),
    mutationIds: new Set((matrices.mutationMatrix || []).map((x) => x.id)),
    requiredTestIds: new Set(Object.values(phaseModel.testAssignments || {}).flat()),
    requiredEvidenceOutputs: new Set(evidenceRequirements.finalEvidenceSchema?.finalEvidenceOutputs || [...FINAL_EVIDENCE_ALLOWLIST])
  };
  const errors = [];
  for (const stream of streams) {
    for (const key of ['entryConditions', 'exitConditions', 'faultIds', 'raceIds', 'crashIds', 'mutationIds', 'requiredTestIds', 'requiredEvidenceOutputs', 'blockingReasonCodes']) if (!Array.isArray(stream[key])) errors.push({ id: stream.id, missing: key });
    if (!stream.requiredBeforePhase) errors.push({ id: stream.id, missing: 'requiredBeforePhase' });
    for (const [key, catalog] of Object.entries(catalogs)) for (const id of stream[key] || []) {
      if (key === 'requiredEvidenceOutputs' && (catalog.has(id) || id.startsWith('evidence/wp7/pre-review/'))) continue;
      if (!catalog.has(id)) errors.push({ workstream: stream.id, key, unknown: id });
    }
  }
  if (errors.length) throw new Wp7Error('WP7_WORKSTREAM_TRACEABILITY_INCOMPLETE', 'workstream traceability contains missing or dangling references', { errors });
  return { status: 'PASS', count: streams.length };
}
function validateAllGovernance() {
  return {
    phaseModel: validatePhaseModel(),
    acceptanceMapping: validateAcceptanceMapping(),
    workstreamTraceability: validateWorkstreamTraceability(),
    riskRegister: validateRiskRegister(readJson(path.join(REPO_ROOT, 'governance', 'risk-acceptance-register.json')))
  };
}
function listTracked(repoRoot = REPO_ROOT) { return git(['ls-files', '-z'], repoRoot).split('\0').filter(Boolean).sort(); }
function verifyCompleteSourceClosure(repoRoot = REPO_ROOT, sourceRoot) {
  const tracked = listTracked(repoRoot);
  const missing = [], mismatch = [], extra = [];
  const trackedSet = new Set(tracked);
  for (const relative of tracked) {
    const filePath = path.join(sourceRoot, ...relative.split('/'));
    if (!fs.existsSync(filePath)) { missing.push(relative); continue; }
    const actual = fs.readFileSync(filePath);
    const expectedBytes = execFileSync('git', ['show', `HEAD:${relative}`], { cwd: repoRoot });
    if (!actual.equals(expectedBytes)) mismatch.push(relative);
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const rel = path.relative(sourceRoot, full).split(path.sep).join('/');
        if (!trackedSet.has(rel)) extra.push(rel);
      }
    }
  }
  walk(sourceRoot);
  if (missing.length || mismatch.length || extra.length) throw new Wp7Error('WP7_COMPLETE_PROJECT_SOURCE_REQUIRED', 'source tree closure failed', { missing, mismatch, extra });
  return { status: 'PASS', trackedFileCount: tracked.length, sourceFileCount: tracked.length, missing, mismatch, extra };
}
function createSourceDeliveryPreview(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const outputRoot = path.resolve(options.outputRoot);
  ensureDirectoryEmpty(outputRoot);
  const identity = gitIdentity(repoRoot);
  assertActivationBinding(repoRoot, { identity, requireClean: true, requireBranch: true });
  const sourceZip = path.join(outputRoot, 'Yance-WP7-PRE-REVIEW-Complete-Source.zip');
  const bundle = path.join(outputRoot, 'Yance-WP7-PRE-REVIEW-History.bundle');
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=zip', `--output=${sourceZip}`, 'HEAD'], { cwd: repoRoot });
  execFileSync('git', ['bundle', 'create', bundle, 'HEAD'], { cwd: repoRoot });
  const verify = spawnSync('git', ['bundle', 'verify', bundle], { cwd: repoRoot, encoding: 'utf8' });
  if (verify.status !== 0) throw new Wp7Error('WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'pre-review bundle verification failed', { stderr: verify.stderr });
  if (!isAncestor(ACCEPTED_BINDING_COMMIT, identity.sourceCommit, repoRoot)) throw new Wp7Error('WP7_COMPLETE_GIT_HISTORY_REQUIRED', 'bundle source does not include accepted binding ancestry');
  return { status: 'PASS', artifactClass: PRE_REVIEW_ARTIFACT_CLASS, sourceZip, sourceZipSha256: sha256File(sourceZip), bundle, bundleSha256: sha256File(bundle), sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, trackedFileCount: listTracked(repoRoot).length };
}
function verifyInstallerHash(filePath, expected) {
  const actual = sha256File(filePath);
  if (actual !== expected) throw new Wp7Error('WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH', 'installer SHA256 mismatch', { expected, actual });
  return { status: 'PASS', actual };
}
function validateNsisSourcePaths(options = {}) {
  const stagingRoot = path.resolve(options.stagingRoot);
  const scriptPath = path.resolve(options.scriptPath || path.join(REPO_ROOT, 'installer', 'wp7', 'YanceFinalInstaller.nsi'));
  const text = fs.readFileSync(scriptPath, 'utf8');
  const sources = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^File\b/i.test(line)) continue;
    const quoted = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (!quoted.length) continue;
    const source = quoted[quoted.length - 1];
    if (!source.startsWith('${STAGING_ROOT}\\')) continue;
    const relative = source.slice('${STAGING_ROOT}\\'.length).replace(/\\/g, '/');
    const wildcard = /\*\.\*$/.test(relative);
    const normalized = wildcard ? relative.replace(/\/\*\.\*$/, '') : relative;
    const resolved = path.resolve(stagingRoot, ...normalized.split('/'));
    if (!resolved.startsWith(`${stagingRoot}${path.sep}`) && resolved !== stagingRoot) throw new Wp7Error('WP7_FINAL_INSTALLER_STAGING_PATH_MISMATCH', 'NSIS source escapes staging root', { source, resolved });
    if (!fs.existsSync(resolved) || (wildcard && (!fs.statSync(resolved).isDirectory() || fs.readdirSync(resolved).length === 0))) throw new Wp7Error('WP7_FINAL_INSTALLER_STAGING_PATH_MISMATCH', 'NSIS source is missing from final staging', { source, resolved, wildcard });
    sources.push({ source, resolved, wildcard });
  }
  if (!sources.length) throw new Wp7Error('WP7_FINAL_INSTALLER_STAGING_PATH_MISMATCH', 'NSIS script has no staging-bound File sources');
  return { status: 'PASS', scriptPath, sources };
}
function directorySizeBytes(root) {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot)) throw new Wp7Error('WP7_FINAL_INSTALLER_STAGING_PATH_MISMATCH', 'installer payload root is missing', { root: absoluteRoot });
  let total = 0;
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Wp7Error('WP1_PAYLOAD_SYMLINK_REJECTED', 'symlinks are forbidden in final installer payload', { path: full });
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
      else throw new Wp7Error('WP1_PAYLOAD_PATH_INVALID', 'unsupported file type in final installer payload', { path: full });
    }
  }
  visit(absoluteRoot);
  return total;
}
function runNsisCompiler(options = {}) {
  const hostPlatform = options.hostPlatform || process.platform;
  if (hostPlatform !== 'win32' && options.allowNonWindows !== true) throw new Wp7Error('WP7_WINDOWS_FINAL_BUILD_REQUIRED', 'final installer must be built on Windows');
  const compiler = options.compilerPath || process.env.MAKENSIS_PATH || 'makensis.exe';
  const scriptPath = options.scriptPath || path.join(REPO_ROOT, 'installer', 'wp7', 'YanceFinalInstaller.nsi');
  const releaseSource = readReleaseSource(options.repoRoot || REPO_ROOT);
  const sourceValidation = validateNsisSourcePaths({ stagingRoot: options.stagingRoot, scriptPath });
  const payloadRoot = path.join(path.resolve(options.stagingRoot), 'application-payload');
  const estimatedSizeBytes = directorySizeBytes(payloadRoot);
  const estimatedSizeKb = Math.max(1, Math.ceil(estimatedSizeBytes / 1024));
  const args = [
    `/DSTAGING_ROOT=${path.resolve(options.stagingRoot)}`,
    `/DOUTPUT_FILE=${path.resolve(options.outputFile)}`,
    `/DPRODUCT_VERSION=${options.productVersion}`,
    `/DPUBLIC_VERSION=${options.publicVersion || releaseSource.publicVersion}`,
    `/DPUBLIC_PRODUCT_NAME=${options.publicProductName || releaseSource.publicProductName}`,
    `/DUPDATE_PRODUCT_NAME=${options.updateProductName || releaseSource.productName}`,
    `/DPRODUCT_EXECUTABLE_NAME=${releaseSource.executableName}`,
    `/DINSTALL_DIRECTORY_NAME=${releaseSource.installDirectoryName}`,
    `/DUSER_DATA_DIRECTORY_NAME=${releaseSource.userDataDirectoryName}`,
    `/DINTERNAL_PRODUCT_ID=${releaseSource.internalProductId}`,
    `/DESTIMATED_SIZE_KB=${estimatedSizeKb}`,
    scriptPath
  ];
  if (hostPlatform === 'win32' && /\.(?:cmd|bat)$/i.test(compiler)) throw new Wp7Error('WP7_INSTALLER_COMPILER_SHIM_DENIED', 'final Windows installer requires a native makensis executable, not a command shim', { compiler });
  const spawn = options.spawn || spawnSync;
  const result = spawn(compiler, args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: options.timeout || 15 * 60 * 1000 });
  if (result.status !== 0) throw new Wp7Error('WP7_INSTALLER_BUILD_FAILED', 'NSIS compiler failed', { ...spawnFailureDetails(result), compiler, args });
  if (!fs.existsSync(options.outputFile)) throw new Wp7Error('WP7_INSTALLER_BUILD_FAILED', 'NSIS compiler did not create installer');
  if (hostPlatform === 'win32' && options.allowNonWindows !== true) {
    const installerBytes = fs.readFileSync(options.outputFile);
    const peMachine = require('./verify-native-binaries').readPeMachine(installerBytes);
    if (peMachine === null) throw new Wp7Error('WP7_INSTALLER_NOT_PE', 'NSIS compiler output is not a valid Windows PE installer', { outputFile: options.outputFile, sizeBytes: installerBytes.length });
  }
  return { status: 'PASS', outputFile: options.outputFile, sha256: sha256File(options.outputFile), stdout: result.stdout, sourceValidation, estimatedSizeBytes, estimatedSizeKb };
}
function emitUpdateMetadata(options = {}) {
  const installerPath = path.resolve(options.installerPath);
  if (!fs.existsSync(installerPath)) throw new Wp7Error('WP7_UPDATE_METADATA_INSTALLER_MISSING', 'cannot emit update metadata before a real installer exists');
  const buf = fs.readFileSync(installerPath);
  const size = buf.length;
  const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
  const installerName = path.basename(installerPath);
  const channel = options.channel || 'latest';
  const prerelease = options.prerelease === true;
  const releaseDate = options.buildTimestampUtc || new Date().toISOString();
  const latestYml = `version: ${options.productVersion}\npublicVersion: ${options.publicVersion || options.productVersion}\nreleaseName: ${options.publicProductName || 'Yance'} ${options.publicVersion || options.productVersion}\nfiles:\n  - url: ${installerName}\n    sha512: ${sha512}\n    size: ${size}\npath: ${installerName}\nsha512: ${sha512}\nreleaseDate: ${releaseDate}\nchannel: ${channel}\nprerelease: ${prerelease}\n`;
  const latestYmlPath = path.join(options.outputRoot, 'latest.yml');
  fs.writeFileSync(latestYmlPath, latestYml, 'utf8');
  const BLOCK_SIZE = 1024 * 1024;
  const checksums = [], sizes = [];
  for (let pos = 0; pos < buf.length; pos += BLOCK_SIZE) {
    const chunk = buf.subarray(pos, Math.min(pos + BLOCK_SIZE, buf.length));
    checksums.push(crypto.createHash('sha512').update(chunk).digest('base64'));
    sizes.push(chunk.length);
  }
  const blockmap = { version: '1', files: [{ name: installerName, offset: 0, checksums, sizes }] };
  const blockmapName = `${installerName}.blockmap`;
  const blockmapPath = path.join(options.outputRoot, blockmapName);
  fs.writeFileSync(blockmapPath, JSON.stringify(blockmap, null, 2), 'utf8');
  return { status: 'PASS', latestYmlPath, blockmapPath, latestYmlSha256: sha256File(latestYmlPath), blockmapSha256: sha256File(blockmapPath), installerName, installerSize: size, installerSha512: sha512 };
}

function buildAuthorizedFinalWindowsInstaller(options = {}) {
  if (options.authorizationToken !== FINAL_PACKAGING_TOKEN) throw new Wp7Error('WP7_FINAL_PACKAGING_NOT_AUTHORIZED', `final build requires ${FINAL_PACKAGING_TOKEN}`);
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const outputRoot = path.resolve(options.outputRoot);
  const identity = options.identity || gitIdentity(repoRoot);
  assertActivationBinding(repoRoot, { identity, requireClean: true, requireBranch: true });
  const preacceptance = assertPreacceptedImplementation(repoRoot, { identity, recordPath: options.preacceptanceRecordPath, recordSha256: options.preacceptanceRecordSha256 });
  const buildTimestampUtc = normalizeTimestamp(options.buildTimestampUtc || new Date().toISOString());
  const releaseLease = acquireExclusiveLease(`${outputRoot}.lease`, { outputRoot, sourceCommit: identity.sourceCommit, final: true, preacceptanceRecordSha256: preacceptance.recordSha256 });
  const frozenParent = `${outputRoot}.frozen-${process.pid}`;
  let frozen = null, frozenContent = null;
  try {
    ensureDirectoryEmpty(outputRoot);
    fs.mkdirSync(frozenParent, { recursive: true });
    frozen = createDetachedFrozenSource(repoRoot, identity.sourceCommit, identity.sourceTree, frozenParent);
    frozenContent = { currentTrackedContentSha256: trackedWorkingTreeSha256(repoRoot), frozenTrackedContentSha256: trackedWorkingTreeSha256(frozen.frozenRoot) };
    assertSourceStillFrozen(repoRoot, identity, frozen.frozenRoot, frozenContent);
    const stagingRoot = path.join(outputRoot, 'staging');
    fs.mkdirSync(stagingRoot, { recursive: true });
    wp1.assertEmptyBeforeFinalBuild(stagingRoot);
    const sessionId = buildSessionId(identity, buildTimestampUtc, 'final-windows');
    const built = buildFinalWindowsPayload({ repoRoot: frozen.frozenRoot, stagingRoot, identity, buildTimestampUtc, allowNonWindows: options.allowNonWindows === true, installProductionDependencies: options.installProductionDependencies !== false, electronDist: options.electronDist || path.join(repoRoot, 'node_modules', 'electron', 'dist'), npmExecutable: options.npmExecutable, productionNodeModulesSource: options.allowNonWindows === true ? options.productionNodeModulesSource : undefined, electronArchivePath: options.electronArchivePath, electronOfficialRecords: options.allowNonWindows === true ? options.electronOfficialRecords : undefined, archiveExecutableEntry: options.archiveExecutableEntry, targetPlatform: options.allowNonWindows === true ? (options.targetPlatform || process.platform) : 'win32', targetArch: 'x64', trustedNodeExecutable: options.trustedNodeExecutable, rceditPath: options.rceditPath, iconPath: options.iconPath, reviewFixtureBrandingCapability: options.reviewFixtureBrandingCapability, testRceditRunner: options.testRceditRunner, platformAuthConfigPath: options.platformAuthConfigPath, platformAuthHashPath: options.platformAuthHashPath, requirePlatformAuth: options.requirePlatformAuth === true, parlantRuntimeSource: options.parlantRuntimeSource });
    if (typeof options.afterPayloadHook === 'function') options.afterPayloadHook({ repoRoot, frozenRoot: frozen.frozenRoot, stagingRoot, identity, built });
    assertSourceStillFrozen(repoRoot, identity, frozen.frozenRoot, frozenContent);
    assertNoWp1Reuse(built.payloadRoot);
    const outputFile = path.join(outputRoot, `${built.releaseSource.installerBaseName}-${built.releaseSource.publicVersion}-x64.exe`);
    const compiled = runNsisCompiler({ stagingRoot, outputFile, productVersion: built.releaseSource.productVersion, publicVersion: built.releaseSource.publicVersion, publicProductName: built.releaseSource.publicProductName, updateProductName: built.releaseSource.productName, compilerPath: options.compilerPath, scriptPath: path.join(frozen.frozenRoot, 'installer', 'wp7', 'YanceFinalInstaller.nsi'), allowNonWindows: options.allowNonWindowsCompiler === true });
    let authenticode = Object.freeze({ status: 'NOT_REQUESTED', signatureStatus: 'Unsigned' });
    if (typeof options.signInstaller === 'function') {
      authenticode = options.signInstaller({ filePath: outputFile, productVersion: built.releaseSource.productVersion, publicVersion: built.releaseSource.publicVersion, publicProductName: built.releaseSource.publicProductName, updateProductName: built.releaseSource.productName, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree });
      if (!authenticode || authenticode.status !== 'PASS' || authenticode.signatureStatus !== 'Valid') throw new Wp7Error('WP7_INSTALLER_AUTHENTICODE_SIGNATURE_INVALID', 'installer signing did not produce a valid Authenticode receipt', { authenticode: authenticode || null });
    } else if (options.requireSignedInstaller === true) throw new Wp7Error('WP7_INSTALLER_AUTHENTICODE_SIGNATURE_REQUIRED', 'production release requires a signed installer before update metadata is emitted');
    const updateMeta = emitUpdateMetadata({ installerPath: outputFile, outputRoot, productVersion: built.releaseSource.productVersion, publicVersion: built.releaseSource.publicVersion, publicProductName: built.releaseSource.publicProductNameEnglish || 'Yance', channel: 'latest', prerelease: false, buildTimestampUtc });
    if (typeof options.beforeSealHook === 'function') options.beforeSealHook({ repoRoot, frozenRoot: frozen.frozenRoot, stagingRoot, outputFile, identity, built });
    assertSourceStillFrozen(repoRoot, identity, frozen.frozenRoot, frozenContent);
    const installerSha256 = sha256File(outputFile);
    const projectSourceSha256 = completeProjectSourceTreeSha256(repoRoot, identity.sourceCommit);
    const evidence = {
      schemaVersion: 3, documentType: 'WP7_FINAL_RELEASE_EVIDENCE', stage: '6.4.5.9', phase: 'core-runtime-p1', workPackage: 'WP7', evidenceKind: 'FINAL_RELEASE', evidenceClass: FINAL_ARTIFACT_CLASS, status: 'PASS', generatedAtUtc: buildTimestampUtc,
      frozenSourceCommit: identity.sourceCommit, frozenSourceTree: identity.sourceTree, buildSessionId: sessionId, buildId: built.buildId, productVersion: built.releaseSource.productVersion, publicVersion: built.releaseSource.publicVersion, publicProductName: built.releaseSource.publicProductName, publicProductNameEnglish: built.releaseSource.publicProductNameEnglish, brandingEpoch: built.releaseSource.brandingEpoch, stageVersion: built.releaseSource.stageVersion, distributionMode: built.releaseSource.distributionMode,
      apiContractVersion: built.releaseSource.apiContractVersion, credentialProtocolVersion: built.releaseSource.credentialProtocolVersion, runtimeLockProtocolVersion: built.releaseSource.runtimeLockProtocolVersion, databaseSchemaVersion: built.schemaAuthority.databaseSchemaVersion,
      releaseManifestSha256: built.releaseManifestSha256, applicationPayloadSha256: built.manifest.applicationPayloadSha256, payloadFilesSha256: built.payloadFilesSha256, productionDependencyBindingSha256: built.manifest.productionDependencyBindingSha256, productionDependencyPackageGraphSha256: built.manifest.productionDependencyPackageGraphSha256, productionDependencyFileTreeSha256: built.manifest.productionDependencyFileTreeSha256, productionDependencyModeTreeSha256: built.manifest.productionDependencyModeTreeSha256, productionDependencyDirectoryModeTreeSha256: built.manifest.productionDependencyDirectoryModeTreeSha256,
      productionDependencyFileModePolicy: built.manifest.productionDependencyFileModePolicy, productionDependencyDirectoryModePolicy: built.manifest.productionDependencyDirectoryModePolicy, productionDependencyPackageCount: built.manifest.productionDependencyPackageCount, productionDependencyFileCount: built.manifest.productionDependencyFileCount, productionDependencyModeRecordCount: built.manifest.productionDependencyModeRecordCount, productionDependencyDirectoryCount: built.manifest.productionDependencyDirectoryCount, productionDependencyDirectoryModeRecordCount: built.manifest.productionDependencyDirectoryModeRecordCount,
      applicationPayloadFilesystemIdentitySha256: built.manifest.applicationPayloadFilesystemIdentitySha256, gitPayloadModeTreeSha256: built.manifest.gitPayloadModeTreeSha256, gitPayloadModeRecordCount: built.manifest.gitPayloadModeRecordCount, electronDistributionTreeSha256: built.manifest.electronDistributionTreeSha256, electronDistributionFileCount: built.manifest.electronDistributionFileCount, electronDistributionModeBoundFileCount: built.manifest.electronDistributionModeBoundFileCount,
      nodeRuntimeVersion: built.manifest.nodeRuntimeVersion, nodeRuntimeExecutablePath: built.manifest.nodeRuntimeExecutablePath, nodeRuntimeExecutableSha256: built.manifest.nodeRuntimeExecutableSha256, nodeRuntimeTreeSha256: built.manifest.nodeRuntimeTreeSha256, nodeRuntimeFileCount: built.manifest.nodeRuntimeFileCount, nodeRuntimeModeBoundFileCount: built.manifest.nodeRuntimeModeBoundFileCount,
      nativeBinaryScanSha256: built.manifest.nativeBinaryScanSha256, nativeBinaryFileCount: built.manifest.nativeBinaryFileCount, nativeBinaryFailureCount: built.manifest.nativeBinaryFailureCount, nativeBinaryTargetPlatform: built.manifest.nativeBinaryTargetPlatform, nativeBinaryTargetArch: built.manifest.nativeBinaryTargetArch,
      installerFileName: path.basename(outputFile), installerSizeBytes: fs.statSync(outputFile).size, installerSha256, authenticodeStatus: authenticode.signatureStatus, authenticodeSignerSubject: authenticode.signerSubject || null, authenticodeSignerThumbprint: authenticode.signerThumbprint || null, authenticodeTimestampSubject: authenticode.timestampSubject || null,
      latestYmlPath: updateMeta.latestYmlPath, latestYmlSha256: updateMeta.latestYmlSha256, blockmapPath: updateMeta.blockmapPath, blockmapSha256: updateMeta.blockmapSha256, upstreamBindings: JSON.parse(JSON.stringify(UPSTREAM_ACCEPTED_BINDINGS)), inheritedRiskAcceptances: RISK_IDS.map((id) => ({ id, scopeExpansionAllowed: false })), assertions: ['sealedInstaller', 'cleanStaging', 'singleManifestIdentity', 'detachedFrozenSource', 'exactPreacceptedImplementationIdentity', 'nsisSourcesExist'], reasonCodes: [], finalInstallationMode: 'CLEAN_INSTALL', legacyTestDataMigrationRequired: false, legacyTestVersionRollbackRequired: false, completeProjectSourceTreeSha256: projectSourceSha256,
      preacceptanceBinding: { decision: preacceptance.decision, implementationCommit: preacceptance.implementationCommit, implementationSourceTree: preacceptance.implementationSourceTree, recordSha256: preacceptance.recordSha256 }
    };
    validateEvidenceCommon(evidence, { final: true });
    const evidencePath = path.join(outputRoot, 'release-evidence.json');
    writeCanonicalJson(evidencePath, evidence);
    const seal = { schemaVersion: 1, documentType: 'WP7_FINAL_BUILD_SESSION_SEAL', status: 'SEALED_FINAL_INSTALLER', buildSessionId: sessionId, sourceCommit: identity.sourceCommit, sourceTree: identity.sourceTree, buildId: built.buildId, productVersion: built.releaseSource.productVersion, publicVersion: built.releaseSource.publicVersion, publicProductName: built.releaseSource.publicProductName, installerSha256, authenticodeStatus: authenticode.signatureStatus, authenticodeSignerThumbprint: authenticode.signerThumbprint || null, releaseManifestSha256: built.releaseManifestSha256, productionDependencyBindingSha256: built.manifest.productionDependencyBindingSha256, productionDependencyPackageGraphSha256: built.manifest.productionDependencyPackageGraphSha256, productionDependencyFileTreeSha256: built.manifest.productionDependencyFileTreeSha256, productionDependencyModeTreeSha256: built.manifest.productionDependencyModeTreeSha256, productionDependencyDirectoryModeTreeSha256: built.manifest.productionDependencyDirectoryModeTreeSha256, productionDependencyFileModePolicy: built.manifest.productionDependencyFileModePolicy, productionDependencyDirectoryModePolicy: built.manifest.productionDependencyDirectoryModePolicy, productionDependencyModeRecordCount: built.manifest.productionDependencyModeRecordCount, productionDependencyDirectoryCount: built.manifest.productionDependencyDirectoryCount, productionDependencyDirectoryModeRecordCount: built.manifest.productionDependencyDirectoryModeRecordCount, applicationPayloadFilesystemIdentitySha256: built.manifest.applicationPayloadFilesystemIdentitySha256, gitPayloadModeTreeSha256: built.manifest.gitPayloadModeTreeSha256, electronDistributionTreeSha256: built.manifest.electronDistributionTreeSha256, nativeBinaryScanSha256: built.manifest.nativeBinaryScanSha256, nativeBinaryFileCount: built.manifest.nativeBinaryFileCount, nativeBinaryFailureCount: built.manifest.nativeBinaryFailureCount, nativeBinaryTargetPlatform: built.manifest.nativeBinaryTargetPlatform, nativeBinaryTargetArch: built.manifest.nativeBinaryTargetArch, completeProjectSourceTreeSha256: projectSourceSha256, preacceptanceRecordSha256: preacceptance.recordSha256, nsisSourceValidation: compiled.sourceValidation, generatedAtUtc: buildTimestampUtc };
    writeCanonicalJson(path.join(outputRoot, 'build-session-seal.json'), seal);
    assertSourceStillFrozen(repoRoot, identity, frozen.frozenRoot, frozenContent);
    return { status: 'PASS', outputRoot, stagingRoot, outputFile, evidencePath, installerSha256, latestYmlPath: updateMeta.latestYmlPath, blockmapPath: updateMeta.blockmapPath, latestYmlSha256: updateMeta.latestYmlSha256, blockmapSha256: updateMeta.blockmapSha256, authenticode, identity, preacceptance, sessionId, completeProjectSourceTreeSha256: projectSourceSha256, ...built };
  } finally {
    if (frozen) frozen.release();
    fs.rmSync(frozenParent, { recursive: true, force: true });
    releaseLease();
  }
}
function protectedTarget(command, options = {}) {
  if (command === 'build') return buildPreReviewFixture(options);
  if (command === 'package' || command === 'release') return buildAuthorizedFinalWindowsInstaller(options);
  throw new Wp7Error('WP7_PROTECTED_COMMAND_UNKNOWN', 'unknown WP7 protected command', { command });
}

module.exports = {
  ACCEPTED_BINDING_COMMIT, ACCEPTED_BINDING_TREE, WP6_ACCEPTED_HEAD, WP6_ACCEPTED_TREE,
  IMPLEMENTATION_BRANCH, PRE_REVIEW_ARTIFACT_CLASS, FINAL_ARTIFACT_CLASS, FINAL_PACKAGING_TOKEN,
  createReviewFixtureBrandingOptions,
  PREACCEPTANCE_DECISION, PREACCEPTANCE_RECORD_ENV, PREACCEPTANCE_HASH_ENV,
  RISK_IDS, UPSTREAM_ACCEPTED_BINDINGS, REPO_ROOT, GOVERNANCE_ROOT, PHASE_MODEL_PATH, ACCEPTANCE_MAPPING_PATH, TRACEABILITY_PATH,
  MATRICES_PATH, EVIDENCE_REQUIREMENTS_PATH, ADVERSARIAL_REQUIREMENTS_PATH, FINAL_EVIDENCE_ALLOWLIST,
  Wp7Error, readJson, sha256Buffer, sha256File, canonicalJsonBuffer, writeCanonicalJson, git, gitIdentity,
  isAncestor, assertActivationBinding, assertWp6Binding, readPreacceptanceBinding, assertPreacceptedImplementation,
  createDetachedFrozenSource, assertSourceStillFrozen, trackedWorkingTreeSha256, completeProjectSourceTreeSha256,
  readReleaseSource, verifyRuntimeProtocolConvergence,
  ensureDirectoryEmpty, acquireExclusiveLease, assertCanonicalPayloadPath, assertNoWp1Reuse, buildSessionId,
  writePreReviewInstallerFixture, readPreReviewInstallerFixture, copyTree, presealedParlantRuntimeRecords, validatePresealedParlantRuntime, copyPresealedParlantRuntime, copyProductionDependencyTree, installReleasePlatformAuth, assembleWindowsApplication, buildFinalWindowsPayload, buildManifestAndPayload, buildPreReviewFixture,
  assertSessionSealed, validateBuildIdentity, validateRiskRegister, validateDeferredScope, validateEvidenceReferences,
  validateEvidenceCommon, validateCrossFileIdentity, validateCleanInstallEvidence, validateBootFailureDiagnostics,
  validateAcceptanceMapping, validatePhaseModel, verifyRequiredTestImplementations, validateWorkstreamTraceability, validateAllGovernance,
  listTracked, verifyCompleteSourceClosure, createSourceDeliveryPreview, verifyInstallerHash, validateNsisSourcePaths, runNsisCompiler, emitUpdateMetadata, buildAuthorizedFinalWindowsInstaller,
  protectedTarget, normalizeTimestamp
};
