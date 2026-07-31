'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT = /^[0-9a-f]{40}$/;

function clean(value, max = 600) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath, code) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) {
    throw Object.assign(new Error(`治理证据无法读取：${path.basename(filePath)}`), {
      code,
      detail: error.message
    });
  }
}

function findSibling(root, matcher) {
  if (!root || !fs.existsSync(root)) return '';
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isFile() && matcher.test(entry.name))
    .map(entry => path.join(root, entry.name))
    .sort()[0] || '';
}

function evidenceFailure(reasonCode, detail = {}, paths = {}) {
  return {
    pass: false,
    sourcePreReviewPassed: false,
    windowsUatAuthorized: false,
    formalRelease: false,
    reasonCode,
    detail,
    paths,
    checkedAt: new Date().toISOString()
  };
}

function verifyRuntimeGovernanceEvidence(options = {}) {
  const env = options.env || process.env;
  const releaseIdentity = options.releaseIdentity || {};
  const cwd = path.resolve(options.repoRoot || process.cwd());
  const recordPath = clean(options.authorizationRecordPath || env.YANCE_WINDOWS_UAT_AUTHORIZATION_RECORD);
  const gateReceiptPath = clean(options.prelaunchGateReceiptPath || env.YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT || path.join(cwd, 'YANCE_RUNTIME_PRELAUNCH_GATE_RECEIPT.json'));
  const expectedCommit = clean(env.YANCE_UAT_EXPECTED_COMMIT || releaseIdentity.sourceCommit || releaseIdentity.gitCommit);
  const expectedTree = clean(env.YANCE_UAT_EXPECTED_TREE || releaseIdentity.sourceTree);
  const runtimeCommit = clean(releaseIdentity.sourceCommit || releaseIdentity.gitCommit);
  const runtimeTree = clean(releaseIdentity.sourceTree);

  const paths = { authorizationRecord: recordPath, prelaunchGateReceipt: gateReceiptPath };
  if (env.YANCE_WINDOWS_UAT_AUTHORIZED !== '1') return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_ENV_MISSING', {}, paths);
  if (!recordPath || !fs.existsSync(recordPath)) return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_RECORD_MISSING', {}, paths);
  if (!GIT_OBJECT.test(expectedCommit) || !GIT_OBJECT.test(expectedTree)) return evidenceFailure('WINDOWS_UAT_EXPECTED_IDENTITY_INVALID', { expectedCommit, expectedTree }, paths);
  if (runtimeCommit !== expectedCommit || runtimeTree !== expectedTree) {
    return evidenceFailure('WINDOWS_UAT_RUNTIME_IDENTITY_MISMATCH', { runtimeCommit, runtimeTree, expectedCommit, expectedTree }, paths);
  }

  try {
    const record = readJson(recordPath, 'WINDOWS_UAT_AUTHORIZATION_RECORD_INVALID');
    const recordSha256 = sha256File(recordPath);
    const root = path.dirname(recordPath);
    const overlayPath = options.authorizationOverlayPath || findSibling(root, /WINDOWS_UAT_AUTHORIZATION_OVERLAY_DESCRIPTOR\.json$/i);
    const receiptPath = options.authorizationReceiptPath || findSibling(root, /WINDOWS_UAT_AUTHORIZATION_RECEIPT\.json$/i);
    const packageManifestPath = options.packageManifestPath || path.join(root, 'ROUND12_13_UAT_MANIFEST.json');
    const localBindingPath = options.localBindingPath || path.join(root, 'YANCE_AUTHORIZED_WINDOWS_UAT_LOCAL_BINDING.json');
    Object.assign(paths, { authorizationOverlay: overlayPath, authorizationReceipt: receiptPath, packageManifest: packageManifestPath, localBinding: localBindingPath });

    if (record.documentType !== 'YANCE_WINDOWS_UAT_AUTHORIZATION_RECORD' || record.authorizationStatus !== 'AUTHORIZED') {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_RECORD_NOT_AUTHORIZED', { documentType: record.documentType, status: record.authorizationStatus }, paths);
    }
    const identity = record.candidateIdentity || {};
    if (identity.commit !== expectedCommit || identity.tree !== expectedTree) {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_IDENTITY_MISMATCH', { identity, expectedCommit, expectedTree }, paths);
    }
    if (record.independentReview?.completed !== true || record.independentReview?.candidateIdentityVerified !== true || record.independentReview?.prelaunchEvidenceVerified !== true || record.independentReview?.packageContractVerified !== true) {
      return evidenceFailure('WINDOWS_UAT_INDEPENDENT_REVIEW_NOT_VERIFIED', { independentReview: record.independentReview || null }, paths);
    }
    if (record.authorizedScope?.realWindowsUat !== true || record.authorizedScope?.evidenceCollection !== true) {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZED_SCOPE_INCOMPLETE', { authorizedScope: record.authorizedScope || null }, paths);
    }
    if (record.governance?.windowsUatAuthorized !== true || record.governance?.formalRelease === true) {
      return evidenceFailure('WINDOWS_UAT_GOVERNANCE_STATE_INVALID', { governance: record.governance || null }, paths);
    }

    if (!overlayPath || !fs.existsSync(overlayPath) || !receiptPath || !fs.existsSync(receiptPath)) {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_CHAIN_INCOMPLETE', {}, paths);
    }
    const overlay = readJson(overlayPath, 'WINDOWS_UAT_AUTHORIZATION_OVERLAY_INVALID');
    const receipt = readJson(receiptPath, 'WINDOWS_UAT_AUTHORIZATION_RECEIPT_INVALID');
    const overlaySha256 = sha256File(overlayPath);
    if (overlay.authorization?.authorizationRecordSha256 !== recordSha256 || receipt.authorizationRecordSha256 !== recordSha256 || receipt.authorizationOverlaySha256 !== overlaySha256) {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_HASH_CHAIN_MISMATCH', { recordSha256, overlaySha256 }, paths);
    }
    const candidateZipSha256 = clean(record.artifacts?.candidateZip?.sha256);
    if (!SHA256.test(candidateZipSha256) || clean(overlay.appliesToCandidateZipSha256) !== candidateZipSha256 || clean(receipt.candidateZipSha256) !== candidateZipSha256) {
      return evidenceFailure('WINDOWS_UAT_CANDIDATE_ZIP_BINDING_MISMATCH', { candidateZipSha256, overlayCandidateZipSha256: overlay.appliesToCandidateZipSha256 || '', receiptCandidateZipSha256: receipt.candidateZipSha256 || '' }, paths);
    }
    if (overlay.documentType !== 'YANCE_WINDOWS_UAT_AUTHORIZATION_OVERLAY_DESCRIPTOR' || overlay.sourceIdentity?.commit !== expectedCommit || overlay.sourceIdentity?.tree !== expectedTree || overlay.authorization?.authorizationId !== record.authorizationId || overlay.authorization?.windowsUatAuthorized !== true || overlay.effectiveState?.formalRelease === true) {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_OVERLAY_STATE_INVALID', { overlayState: overlay.effectiveState || null }, paths);
    }
    if (receipt.documentType !== 'YANCE_F25FE2E_WINDOWS_UAT_AUTHORIZATION_RECEIPT' || receipt.status !== 'REAL_WINDOWS_UAT_AUTHORIZED' || receipt.authorizationId !== record.authorizationId || receipt.sourceIdentity?.commit !== expectedCommit || receipt.sourceIdentity?.tree !== expectedTree || receipt.state?.windowsUatAuthorized !== true || receipt.state?.formalRelease === true || receipt.state?.evidenceGateStillRequired !== true) {
      return evidenceFailure('WINDOWS_UAT_AUTHORIZATION_RECEIPT_STATE_INVALID', { receiptState: receipt.state || null }, paths);
    }

    if (!fs.existsSync(packageManifestPath)) return evidenceFailure('WINDOWS_UAT_PACKAGE_MANIFEST_MISSING', {}, paths);
    const packageManifest = readJson(packageManifestPath, 'WINDOWS_UAT_PACKAGE_MANIFEST_INVALID');
    if (packageManifest.commit !== expectedCommit || packageManifest.tree !== expectedTree || packageManifest.formalRelease === true) {
      return evidenceFailure('WINDOWS_UAT_PACKAGE_MANIFEST_IDENTITY_MISMATCH', { packageManifest }, paths);
    }
    const payloadSha256 = clean(packageManifest.payload?.sha256);
    if (!SHA256.test(payloadSha256) || payloadSha256 !== clean(record.artifacts?.sourcePayload?.sha256)) {
      return evidenceFailure('WINDOWS_UAT_SOURCE_PAYLOAD_BINDING_MISMATCH', { packagePayloadSha256: payloadSha256, recordPayloadSha256: record.artifacts?.sourcePayload?.sha256 || '' }, paths);
    }

    if (!fs.existsSync(localBindingPath)) return evidenceFailure('WINDOWS_UAT_LOCAL_BINDING_MISSING', {}, paths);
    const localBinding = readJson(localBindingPath, 'WINDOWS_UAT_LOCAL_BINDING_INVALID');
    if (localBinding.documentType !== 'YANCE_AUTHORIZED_WINDOWS_UAT_LOCAL_BINDING' || localBinding.expectedCommit !== expectedCommit || localBinding.expectedTree !== expectedTree || localBinding.windowsUatAuthorized !== true || localBinding.formalRelease === true || localBinding.authorizationId !== record.authorizationId || clean(localBinding.candidateZipSha256) !== candidateZipSha256) {
      return evidenceFailure('WINDOWS_UAT_LOCAL_BINDING_MISMATCH', { localBinding }, paths);
    }

    if (!gateReceiptPath || !fs.existsSync(gateReceiptPath)) return evidenceFailure('SOURCE_PRE_REVIEW_RUNTIME_GATE_RECEIPT_MISSING', {}, paths);
    const gateReceipt = readJson(gateReceiptPath, 'SOURCE_PRE_REVIEW_RUNTIME_GATE_RECEIPT_INVALID');
    if (gateReceipt.status !== 'PASS' || gateReceipt.commit !== expectedCommit || gateReceipt.tree !== expectedTree || gateReceipt.prelaunchGatePassed !== true) {
      return evidenceFailure('SOURCE_PRE_REVIEW_RUNTIME_GATE_NOT_VERIFIED', { gateReceipt }, paths);
    }
    if (!SHA256.test(clean(gateReceipt.stdoutSha256)) || !SHA256.test(clean(gateReceipt.stderrSha256))) {
      return evidenceFailure('SOURCE_PRE_REVIEW_RUNTIME_GATE_HASH_INVALID', { gateReceipt }, paths);
    }
    const gateStdoutPath = clean(gateReceipt.stdoutPath);
    const gateStderrPath = clean(gateReceipt.stderrPath);
    Object.assign(paths, { prelaunchGateStdout: gateStdoutPath, prelaunchGateStderr: gateStderrPath });
    if (!gateStdoutPath || !gateStderrPath || !fs.existsSync(gateStdoutPath) || !fs.existsSync(gateStderrPath)) {
      return evidenceFailure('SOURCE_PRE_REVIEW_RUNTIME_GATE_LOG_MISSING', {}, paths);
    }
    const actualStdoutSha256 = sha256File(gateStdoutPath);
    const actualStderrSha256 = sha256File(gateStderrPath);
    if (actualStdoutSha256 !== clean(gateReceipt.stdoutSha256) || actualStderrSha256 !== clean(gateReceipt.stderrSha256)) {
      return evidenceFailure('SOURCE_PRE_REVIEW_RUNTIME_GATE_LOG_HASH_MISMATCH', { actualStdoutSha256, actualStderrSha256 }, paths);
    }
    if (clean(gateReceipt.authorizationId) !== clean(record.authorizationId) || clean(gateReceipt.authorizationRecordSha256) !== recordSha256) {
      return evidenceFailure('SOURCE_PRE_REVIEW_RUNTIME_GATE_AUTHORIZATION_MISMATCH', { gateAuthorizationId: gateReceipt.authorizationId || '', recordAuthorizationId: record.authorizationId || '' }, paths);
    }

    return {
      pass: true,
      sourcePreReviewPassed: true,
      windowsUatAuthorized: true,
      formalRelease: false,
      reasonCode: 'WINDOWS_UAT_RUNTIME_GOVERNANCE_VERIFIED',
      authorizationId: clean(record.authorizationId),
      recordSha256,
      overlaySha256,
      receiptSha256: sha256File(receiptPath),
      candidateZipSha256,
      sourcePayloadSha256: payloadSha256,
      prelaunchEvidenceSha256: clean(record.artifacts?.prelaunchEvidence?.sha256),
      gateReceiptSha256: sha256File(gateReceiptPath),
      commit: expectedCommit,
      tree: expectedTree,
      independentReview: record.independentReview,
      paths,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return evidenceFailure(error.code || 'WINDOWS_UAT_GOVERNANCE_EVIDENCE_FAILED', { message: error.message, detail: error.detail || '' }, paths);
  }
}

module.exports = { verifyRuntimeGovernanceEvidence, sha256File };
