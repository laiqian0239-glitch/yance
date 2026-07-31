'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/^\uFEFF/, ''));
const policy = readJson('governance/wp7/current-authority-consistency-policy.json');
const handoff = readJson('implementation/project-handoff.json');
const status = readJson('implementation/work-package-status.json');
const closure = readJson('governance/wp7/convergence-correction-closure.json');
const candidateHistory = readJson('implementation/wp7-convergence-pre-review-candidate.json');
const reopenHistory = readJson('implementation/wp7-convergence-pre-review-reopen.json');

const wp7Status = status.workPackages && status.workPackages.WP7;
const wp7Handoff = handoff.currentWp7;
const wp7Downstream = handoff.downstream && handoff.downstream.WP7;
const wp7Convergence = handoff.wp7TwoStageAcceptance && handoff.wp7TwoStageAcceptance.convergencePreReview;
const expected = policy.currentState;
const checks = [];

function equal(a, b) {
  if (Array.isArray(a) || Array.isArray(b) || (a && typeof a === 'object') || (b && typeof b === 'object')) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return Object.is(a, b);
}
function check(id, actual, expectedValue) {
  const pass = equal(actual, expectedValue);
  checks.push({ id, pass, expected: expectedValue, actual });
}
function checkTruthy(id, actual) {
  checks.push({ id, pass: Boolean(actual), expected: true, actual: Boolean(actual) });
}
function checkAbsentOrNull(id, actual) {
  const pass = actual === undefined || actual === null;
  checks.push({ id, pass, expected: 'ABSENT_OR_NULL', actual: actual === undefined ? 'ABSENT' : actual });
}
function isHistoricalPath(pathSegments) {
  return pathSegments.some((segment) => String(segment).toLowerCase().includes('historical'));
}
function scanCandidateFields(rootName, value, pathSegments = []) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanCandidateFields(rootName, entry, [...pathSegments, index]));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = [...pathSegments, key];
    if (policy.candidateIdentityPolicy.scannedFieldNames.includes(key)) {
      const historical = isHistoricalPath(nextPath);
      const pass = historical || entry === null || entry === undefined;
      checks.push({
        id: `candidate-scan.${rootName}.${nextPath.join('.')}`,
        pass,
        expected: historical ? 'HISTORICAL_PATH_VALUE_ALLOWED' : null,
        actual: entry === undefined ? 'ABSENT' : entry,
        historicalPath: historical,
      });
    }
    scanCandidateFields(rootName, entry, nextPath);
  }
}

check('policy.revisionId', policy.revisionId, 'CPR-R9');
check('policy.governanceRevisionId', policy.governanceRevisionId, 'CPR-R9-GR1');
check('policy.currentState.revisionCandidateStatus', expected.revisionCandidateStatus, 'FORMED_FOR_CONVERGENCE_PRE_REVIEW');
check('policy.currentState.candidateBindingCommit', expected.candidateBindingCommit, null);
check('policy.currentState.candidateBindingSourceTree', expected.candidateBindingSourceTree, null);
check('policy.currentState.preAcceptedAtUtc', expected.preAcceptedAtUtc, null);
check('policy.currentState.trustedProductProbeExecutions', expected.trustedProductProbeExecutions, 9);
check('policy.currentState.requiredTrustedProductProbeExecutions', expected.requiredTrustedProductProbeExecutions, 9);

// Every current phase authority must resolve to one canonical phase.
check('handoff.currentReviewPhase', handoff.currentReviewPhase, policy.currentReviewPhase);
check('handoff.governance.currentPhase', handoff.governance && handoff.governance.currentPhase, policy.currentReviewPhase);
check('handoff.wp7Convergence.currentReviewPhase', wp7Convergence && wp7Convergence.currentReviewPhase, policy.currentReviewPhase);
check('status.currentReviewPhase', status.currentReviewPhase, policy.currentReviewPhase);
check('closure.currentReviewPhase', closure.governanceState.currentReviewPhase, policy.currentReviewPhase);
check('closure.binding.currentReviewPhase', closure.governanceIdentityBinding.currentReviewPhase, policy.currentReviewPhase);

// Every current WP7 review status and suspension state must agree.
check('handoff.currentWp7.reviewStatus', wp7Handoff.reviewStatus, policy.currentReviewStatus);
check('handoff.downstream.WP7.reviewStatus', wp7Downstream.reviewStatus, policy.currentReviewStatus);
check('status.WP7.reviewStatus', wp7Status.reviewStatus, policy.currentReviewStatus);
check('handoff.topPreAcceptanceStatus', handoff.preAcceptanceStatus, policy.currentPreAcceptanceStatus);
check('handoff.governance.wp7PreAcceptanceStatus', handoff.governance.wp7PreAcceptanceStatus, policy.currentPreAcceptanceStatus);
check('handoff.currentWp7.preAcceptanceStatus', wp7Handoff.preAcceptanceStatus, policy.currentPreAcceptanceStatus);
check('handoff.downstream.WP7.preAcceptanceStatus', wp7Downstream.preAcceptanceStatus, policy.currentPreAcceptanceStatus);
check('status.topPreAcceptanceStatus', status.preAcceptanceStatus, policy.currentPreAcceptanceStatus);
check('status.WP7.preAcceptanceStatus', wp7Status.preAcceptanceStatus, policy.currentPreAcceptanceStatus);

for (const [name, value] of [
  ['handoff.revisionId', wp7Handoff.revisionId],
  ['handoff.downstream.revisionId', wp7Downstream.revisionId],
  ['handoff.wp7Convergence.revisionId', wp7Convergence.revisionId],
  ['status.revisionId', wp7Status.revisionId],
  ['closure.revisionId', closure.revisionId],
]) check(name, value, policy.revisionId);

for (const [name, value] of [
  ['handoff.governanceRevisionId', wp7Handoff.governanceRevisionId],
  ['handoff.downstream.governanceRevisionId', wp7Downstream.governanceRevisionId],
  ['handoff.wp7Convergence.governanceRevisionId', wp7Convergence.governanceRevisionId],
  ['status.governanceRevisionId', wp7Status.governanceRevisionId],
  ['closure.governanceRevisionId', closure.governanceRevisionId],
  ['closure.binding.governanceRevisionId', closure.governanceIdentityBinding.currentGovernanceRevisionId],
]) check(name, value, policy.governanceRevisionId);

for (const [name, identity] of [
  ['handoff.implementationIdentity', wp7Handoff.implementationIdentity],
  ['handoff.correctedProductionIdentity', wp7Handoff.correctedProductionIdentity],
  ['handoff.downstream.implementationIdentity', wp7Downstream.implementationIdentity],
  ['handoff.downstream.correctedProductionIdentity', wp7Downstream.correctedProductionIdentity],
  ['status.implementationIdentity', wp7Status.implementationIdentity],
  ['status.correctedProductionIdentity', wp7Status.correctedProductionIdentity],
]) {
  check(`${name}.commit`, identity && identity.commit, policy.implementationIdentity.commit);
  check(`${name}.sourceTree`, identity && identity.sourceTree, policy.implementationIdentity.sourceTree);
}
check('closure.productionCorrectionCommit', closure.implementationIdentity.productionCorrectionCommit, policy.implementationIdentity.commit);
check('closure.productionCorrectionSourceTree', closure.implementationIdentity.productionCorrectionSourceTree, policy.implementationIdentity.sourceTree);

for (const [name, value] of [
  ['handoff.revisionCandidateStatus', wp7Handoff.revisionCandidateStatus],
  ['handoff.downstream.revisionCandidateStatus', wp7Downstream.revisionCandidateStatus],
  ['handoff.wp7Convergence.revisionCandidateStatus', wp7Convergence.revisionCandidateStatus],
  ['status.revisionCandidateStatus', wp7Status.revisionCandidateStatus],
  ['closure.revisionCandidateStatus', closure.governanceState.revisionCandidateStatus],
]) check(name, value, expected.revisionCandidateStatus);

for (const [name, value] of [
  ['handoff.candidateBindingCommit', wp7Handoff.candidateBindingCommit],
  ['handoff.downstream.candidateBindingCommit', wp7Downstream.candidateBindingCommit],
  ['handoff.wp7Convergence.candidateBindingCommit', wp7Convergence.candidateBindingCommit],
  ['status.candidateBindingCommit', wp7Status.candidateBindingCommit],
  ['closure.candidateBindingCommit', closure.governanceState.candidateBindingCommit],
]) check(name, value, expected.candidateBindingCommit);
for (const [name, value] of [
  ['handoff.candidateBindingSourceTree', wp7Handoff.candidateBindingSourceTree],
  ['handoff.downstream.candidateBindingSourceTree', wp7Downstream.candidateBindingSourceTree],
  ['handoff.wp7Convergence.candidateBindingSourceTree', wp7Convergence.candidateBindingSourceTree],
  ['status.candidateBindingSourceTree', wp7Status.candidateBindingSourceTree],
  ['closure.candidateBindingSourceTree', closure.governanceState.candidateBindingSourceTree],
]) check(name, value, expected.candidateBindingSourceTree);
for (const [name, value] of [
  ['handoff.preAcceptedAtUtc', wp7Handoff.preAcceptedAtUtc],
  ['handoff.downstream.preAcceptedAtUtc', wp7Downstream.preAcceptedAtUtc],
  ['status.preAcceptedAtUtc', wp7Status.preAcceptedAtUtc],
  ['closure.preAcceptedAtUtc', closure.governanceState.preAcceptedAtUtc],
]) checkAbsentOrNull(name, value);

for (const [name, value] of [
  ['handoff.wp7Convergence.preAcceptanceIssuedAfterReopen', wp7Convergence.preAcceptanceIssuedAfterReopen],
  ['handoff.downstream.preAcceptanceIssuedAfterReopen', wp7Downstream.preAcceptanceIssuedAfterReopen],
  ['status.preAcceptanceIssuedAfterReopen', wp7Status.preAcceptanceIssuedAfterReopen],
  ['closure.preAcceptanceIssuedAfterReopen', closure.governanceState.preAcceptanceIssuedAfterReopen],
]) check(name, value, expected.preAcceptanceIssuedAfterReopen);
for (const [name, value] of [
  ['handoff.operationalPreAcceptanceAuthorization', wp7Handoff.operationalPreAcceptanceAuthorization],
  ['handoff.downstream.operationalPreAcceptanceAuthorization', wp7Downstream.operationalPreAcceptanceAuthorization],
  ['status.operationalPreAcceptanceAuthorization', wp7Status.operationalPreAcceptanceAuthorization],
  ['closure.operationalPreAcceptanceAuthorization', closure.governanceState.operationalPreAcceptanceAuthorization],
]) check(name, value, expected.operationalPreAcceptanceAuthorization);
for (const [name, value] of [
  ['handoff.finalPackagingAuthorized', wp7Handoff.finalPackagingAuthorized],
  ['handoff.downstream.finalPackagingAuthorized', wp7Downstream.finalPackagingAuthorized],
  ['status.finalPackagingAuthorized', wp7Status.finalPackagingAuthorized],
  ['closure.finalPackagingAuthorized', closure.governanceState.finalPackagingAuthorized],
  ['handoff.topFinalPackagingAuthorized', handoff.finalPackagingAuthorized],
  ['status.topFinalPackagingAuthorized', status.finalPackagingAuthorized],
]) check(name, value, expected.finalPackagingAuthorized);
for (const [name, value] of [
  ['handoff.downstream.finalDeliveryHead', wp7Downstream.finalDeliveryHead],
  ['status.finalDeliveryHead', wp7Status.finalDeliveryHead],
  ['closure.finalDeliveryHead', closure.governanceState.finalDeliveryHead],
]) check(name, value, expected.finalDeliveryHead);
for (const [name, value] of [
  ['handoff.finalAcceptanceStatus', wp7Handoff.finalAcceptanceStatus],
  ['handoff.downstream.finalAcceptanceStatus', wp7Downstream.finalAcceptanceStatus],
  ['status.finalAcceptanceStatus', wp7Status.finalAcceptanceStatus],
  ['closure.finalAcceptanceStatus', closure.governanceState.finalAcceptanceStatus],
]) check(name, value, expected.finalAcceptanceStatus);

check('status.realTrustedProduct.completed', wp7Status.realTrustedProductNineProbeExecution.completed, expected.trustedProductProbeExecutions);
check('status.realTrustedProduct.required', wp7Status.realTrustedProductNineProbeExecution.required, expected.requiredTrustedProductProbeExecutions);
check('status.realTrustedProduct.status', wp7Status.realTrustedProductNineProbeExecution.status, expected.trustedProductExecutionStatus);
check('status.realTrustedProduct.formalPassClaimed', wp7Status.realTrustedProductNineProbeExecution.formalPassClaimed, expected.trustedProductFormalPassClaimed);
check('closure.realTrustedProduct.completed', closure.realTrustedProductNineProbeExecution.completed, expected.trustedProductProbeExecutions);
check('closure.realTrustedProduct.required', closure.realTrustedProductNineProbeExecution.required, expected.requiredTrustedProductProbeExecutions);
check('closure.realTrustedProduct.status', closure.realTrustedProductNineProbeExecution.status, expected.trustedProductExecutionStatus);
check('closure.realTrustedProduct.formalPassClaimed', closure.realTrustedProductNineProbeExecution.formalPassClaimed, expected.trustedProductFormalPassClaimed);

for (const [name, execution] of [
  ['handoff.currentWp7.realTrustedProduct', wp7Handoff.realTrustedProductNineProbeExecution],
  ['handoff.downstream.realTrustedProduct', wp7Downstream.realTrustedProductNineProbeExecution],
  ['handoff.wp7Convergence.realTrustedProduct', wp7Convergence.realTrustedProductNineProbeExecution],
]) {
  check(`${name}.completed`, execution && execution.completed, expected.trustedProductProbeExecutions);
  check(`${name}.required`, execution && execution.required, expected.requiredTrustedProductProbeExecutions);
  check(`${name}.status`, execution && execution.status, expected.trustedProductExecutionStatus);
  check(`${name}.formalPassClaimed`, execution && execution.formalPassClaimed, expected.trustedProductFormalPassClaimed);
  check(`${name}.sourceCommit`, execution && execution.sourceCommit, policy.implementationIdentity.commit);
  check(`${name}.sourceTree`, execution && execution.sourceTree, policy.implementationIdentity.sourceTree);
}
check('closure.directParentCommit', closure.implementationIdentity.directParentCommit, '40647dbdaa768517ddbcdb31ff207ac9d3a87457');
check('policy.candidateFormation.productionCommit', policy.candidateFormationPolicy.productionCommit, policy.implementationIdentity.commit);
check('policy.candidateFormation.productionSourceTree', policy.candidateFormationPolicy.productionSourceTree, policy.implementationIdentity.sourceTree);
check('policy.candidateFormation.preAcceptanceIssued', policy.candidateFormationPolicy.preAcceptanceIssued, false);
check('policy.candidateFormation.finalPackagingAuthorized', policy.candidateFormationPolicy.finalPackagingAuthorized, false);

const evidenceBinding = policy.candidateFormationPolicy.evidenceBinding;
check('policy.evidenceBinding.artifactClass', evidenceBinding.artifactClass, 'WP7_PRE_REVIEW_ONLY');
check('policy.evidenceBinding.evidenceClass', evidenceBinding.evidenceClass, 'PRE_REVIEW_PACKAGED_INTEGRATION');
check('policy.evidenceBinding.finalInstaller', evidenceBinding.finalInstaller, false);
check('policy.evidenceBinding.finalReleaseEvidence', evidenceBinding.finalReleaseEvidence, false);
check('policy.evidenceBinding.formalWindowsEvidenceEligible', evidenceBinding.formalWindowsEvidenceEligible, false);
checkTruthy('policy.evidenceBinding.preReviewSealedArtifactSha256', /^[0-9a-f]{64}$/.test(evidenceBinding.preReviewSealedArtifactSha256 || ''));
checkTruthy('policy.evidenceBinding.preReviewEvidenceIndexSha256', /^[0-9a-f]{64}$/.test(evidenceBinding.preReviewEvidenceIndexSha256 || ''));
checkTruthy('policy.evidenceBinding.realTrustedProductProbeResultSha256', /^[0-9a-f]{64}$/.test(evidenceBinding.realTrustedProductProbeResultSha256 || ''));
checkTruthy('policy.evidenceBinding.completeVerificationSummarySha256', /^[0-9a-f]{64}$/.test(evidenceBinding.completeVerificationSummarySha256 || ''));

for (const [name, binding] of [
  ['handoff.currentWp7.candidateEvidenceBinding', wp7Handoff.candidateEvidenceBinding],
  ['handoff.downstream.candidateEvidenceBinding', wp7Downstream.candidateEvidenceBinding],
  ['handoff.wp7Convergence.candidateEvidenceBinding', wp7Convergence.candidateEvidenceBinding],
  ['status.candidateEvidenceBinding', wp7Status.candidateEvidenceBinding],
  ['closure.candidateEvidenceBinding', closure.candidateFormation && closure.candidateFormation.candidateEvidenceBinding],
]) {
  for (const field of [
    'productionCorrectionCommit','productionCorrectionSourceTree','directParentCommit','buildId','buildSessionId',
    'artifactClass','evidenceClass','finalInstaller','finalReleaseEvidence','formalWindowsEvidenceEligible',
    'trustedProductArchive','trustedProductArchiveSha256','preReviewSealedArtifact','preReviewSealedArtifactSha256',
    'preReviewSealedArtifactType','preReviewEvidenceIndex','preReviewEvidenceIndexSha256',
    'preReviewInternalSha256ManifestSha256','realTrustedProductProbeResultPath','realTrustedProductProbeResultSha256',
    'completeVerificationSummaryPath','completeVerificationSummarySha256'
  ]) check(`${name}.${field}`, binding && binding[field], evidenceBinding[field]);
}

for (const [name, execution] of [
  ['status.rawExecution', wp7Status.realTrustedProductNineProbeExecution],
  ['closure.rawExecution', closure.realTrustedProductNineProbeExecution],
  ['handoff.currentWp7.rawExecution', wp7Handoff.realTrustedProductNineProbeExecution],
  ['handoff.downstream.rawExecution', wp7Downstream.realTrustedProductNineProbeExecution],
  ['handoff.wp7Convergence.rawExecution', wp7Convergence.realTrustedProductNineProbeExecution],
]) {
  check(`${name}.executionClass`, execution && execution.executionClass, 'PRE_REVIEW_PACKAGED_INTEGRATION');
  check(`${name}.artifactClass`, execution && execution.artifactClass, 'WP7_PRE_REVIEW_ONLY');
  check(`${name}.finalReleaseEvidence`, execution && execution.finalReleaseEvidence, false);
  check(`${name}.formalWindowsEvidenceEligible`, execution && execution.formalWindowsEvidenceEligible, false);
  check(`${name}.preReviewSealedArtifactSha256`, execution && execution.preReviewSealedArtifactSha256, evidenceBinding.preReviewSealedArtifactSha256);
  check(`${name}.preReviewEvidenceIndexSha256`, execution && execution.preReviewEvidenceIndexSha256, evidenceBinding.preReviewEvidenceIndexSha256);
  check(`${name}.rawProbeAggregateSha256`, execution && execution.rawProbeAggregateSha256, evidenceBinding.realTrustedProductProbeResultSha256);
}

const requiredCprR9Closures = [
  'WP7_TRUSTED_PRODUCT_RAW_PROBE_EVIDENCE_MISSING',
  'WP7_PRE_REVIEW_EVIDENCE_INDEX_MISSING',
  'WP7_CANDIDATE_REQUIRED_DELIVERY_ARTIFACTS_MISSING',
  'WP7_PRE_REVIEW_ARTIFACT_CLASSIFICATION_CONTRADICTION',
  'WP7_PACKAGED_PROBE_SEALED_ARTIFACT_NOT_VERIFIED',
  'WP7_COMPLETE_TEST_RAW_RESULTS_MISSING'
];
for (const reasonCode of requiredCprR9Closures) {
  checkTruthy(`closure.blockerClosed.${reasonCode}`, closure.blockerClosures.some((row) => row.reasonCode === reasonCode && String(row.status).startsWith('CLOSED')));
  checkTruthy(`status.blockerClosed.${reasonCode}`, wp7Status.closedBlockingReasonCodes.includes(reasonCode));
  checkTruthy(`handoff.blockerClosed.${reasonCode}`, wp7Handoff.closedBlockingReasonCodes.includes(reasonCode));
}
check('closure.remainingBlockingReasonCodes', closure.remainingBlockingReasonCodes, []);
check('status.remainingBlockingReasonCodes', wp7Status.remainingBlockingReasonCodes, []);
check('handoff.remainingBlockingReasonCodes', wp7Handoff.remainingBlockingReasonCodes, []);
check('closure.verification.installedRuntimeProbeTests', closure.verification.installedRuntimeProbeTests, 'PASS_58_OF_58');
check('closure.verification.correctionMatrix', closure.verification.correctionMatrix, 'PASS_128_OF_128_KILLED');
check('closure.verification.developerAdversarialReview', closure.verification.developerAdversarialReview, 'PASS_25_OF_25_AR24_128_OF_128');
check('closure.verification.sourceClosure', closure.verification.sourceClosure, 'PASS_807_TRACKED_559_OF_559_JAVASCRIPT');

check('candidateHistory.authorityClassification', candidateHistory.authorityClassification, 'HISTORICAL_CPR_R5_SNAPSHOT_ONLY');
check('candidateHistory.currentAuthority', candidateHistory.currentAuthority, false);
check('candidateHistory.reusableAsCurrentCandidate', candidateHistory.reusableAsCurrentCandidate, false);
check('reopenHistory.authorityClassification', reopenHistory.authorityClassification, 'HISTORICAL_CPR_R5_REOPEN_SNAPSHOT_ONLY');
check('reopenHistory.currentAuthority', reopenHistory.currentAuthority, false);
check('reopenHistory.reusableAsCurrentCandidate', reopenHistory.reusableAsCurrentCandidate, false);
checkTruthy('candidateHistory.snapshotPresent', candidateHistory.historicalSnapshot && candidateHistory.historicalSnapshot.revisionId === 'CPR-R5');
checkTruthy('reopenHistory.snapshotPresent', reopenHistory.historicalSnapshot && reopenHistory.historicalSnapshot.revisionId === 'CPR-R5');

check('handoff.historicalPreAcceptance.currentAuthority', wp7Handoff.historicalPreAcceptanceRecord.currentAuthority, false);
check('status.historicalPreAcceptance.currentAuthority', wp7Status.historicalPreAcceptanceRecord.currentAuthority, false);
checkTruthy('handoff.historicalCandidateSeparated', wp7Handoff.historicalPreAcceptanceRecord.candidateBindingCommit && wp7Handoff.candidateBindingCommit === null);
checkTruthy('status.historicalCandidateSeparated', wp7Status.historicalPreAcceptanceRecord.candidateBindingCommit && wp7Status.candidateBindingCommit === null);
checkTruthy('handoff.downstream.historicalCandidateSeparated', wp7Downstream.historicalPreWindowsBlockedArtifacts.candidateBindingCommit && wp7Downstream.candidateBindingCommit === null);

check('handoff.riskAcceptanceIds', wp7Handoff.preservedRiskAcceptanceIds, policy.preservedRiskAcceptanceIds);
check('status.riskAcceptanceIds', wp7Status.preservedRiskAcceptanceIds, policy.preservedRiskAcceptanceIds);
check('closure.riskAcceptanceIds', closure.preservedRiskAcceptanceIds, policy.preservedRiskAcceptanceIds);
check('handoff.installationPolicy', handoff.installationPolicy, policy.installationPolicy);
check('status.installationPolicy', status.installationPolicy, policy.installationPolicy);
check('closure.installationPolicy', closure.installationPolicy, policy.installationPolicy);
check('handoff.authorityVerification.command', handoff.governanceAuthorityConsistencyVerification.command, policy.verificationCommand);
check('status.authorityVerification.command', status.governanceAuthorityConsistencyVerification.command, policy.verificationCommand);
check('closure.authorityVerification.command', closure.governanceAuthorityConsistencyVerification.command, policy.verificationCommand);
check('handoff.currentWp7.claimVerification.command', wp7Handoff.developerClaimedGovernanceClosures.verificationCommand, policy.verificationCommand);
check('handoff.downstream.claimVerification.command', wp7Downstream.developerClaimedGovernanceClosures.verificationCommand, policy.verificationCommand);
check('status.WP7.claimVerification.command', wp7Status.developerClaimedGovernanceClosures.verificationCommand, policy.verificationCommand);
check('handoff.activeWorkPackages', handoff.activeWorkPackages, ['WP7']);
check('status.activeWorkPackages', status.activeWorkPackages, ['WP7']);
check('handoff.lastCompletedWorkPackage', handoff.lastCompletedWorkPackage, 'WP6');
check('status.lastCompletedWorkPackage', status.lastCompletedWorkPackage, 'WP6');
check('closure.currentAuthorityFiles', closure.governanceIdentityBinding.trackedAuthorityFiles, policy.currentAuthorityFiles);

// Exhaustive WP7 current-object scan: preacceptance binding identity must remain null outside explicit historical paths.
scanCandidateFields('handoff.currentWp7', wp7Handoff);
scanCandidateFields('handoff.downstream.WP7', wp7Downstream);
scanCandidateFields('handoff.wp7TwoStageAcceptance.convergencePreReview', wp7Convergence);
scanCandidateFields('status.workPackages.WP7', wp7Status);
scanCandidateFields('closure.governanceState', closure.governanceState);

const failed = checks.filter((entry) => !entry.pass);
const result = {
  schemaVersion: 2,
  documentType: 'WP7_GOVERNANCE_AUTHORITY_CONSISTENCY_RESULT',
  revisionId: policy.revisionId,
  governanceRevisionId: policy.governanceRevisionId,
  currentReviewPhase: policy.currentReviewPhase,
  currentReviewStatus: policy.currentReviewStatus,
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  status: failed.length === 0 ? 'PASS' : 'FAIL',
  scanScope: 'ALL_CURRENT_WP7_AUTHORITY_PATHS_AND_NON_HISTORICAL_CANDIDATE_FIELDS',
  checks,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
