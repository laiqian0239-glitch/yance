#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EVIDENCE_PATH = 'governance/architecture-closure-v2/wp-b-m1-red-evidence.json';
const EXPECTED_SOURCE_COMMIT = 'da773d5b29c1f54c6c14f6024c38b53ab7ca10bb';
const EXPECTED_WORKFLOW = Object.freeze({
  workflowId: 325869061,
  workflowName: 'WP-B Validation',
  workflowRunId: 30779566915,
  workflowConclusion: 'failure',
  expectedFailureReason: 'MILESTONE_ONE_CONTRACTS_RECORDED_RED',
  governanceJobsPassed: true,
  xstateUpstreamGateJobsPassed: true
});
const EXPECTED_CONTRACTS = Object.freeze([
  Object.freeze({
    id: 'LIFECYCLE',
    testPath: 'backend/tests/architectureClosureV2/wpB/lifecycleContract.test.js',
    matchedIndicators: Object.freeze(['durableExecutionLifecycle']),
    hashes: Object.freeze({
      'ubuntu-latest': 'a4020d1df3ab384e3bc432866c5c5f0cd1fea122812f009b37a50be3158301c8',
      'windows-latest': 'ffec44b5f367709241450f7f210b074497b45f3044b88040692b3cd906208393'
    })
  }),
  Object.freeze({
    id: 'DEEP_FREEZE_AND_AUTHORITY_TIME',
    testPath: 'backend/tests/architectureClosureV2/wpB/deepFreezeAndTimestamp.test.js',
    matchedIndicators: Object.freeze(['/lib/deepFreeze', 'authorityTimestamp']),
    hashes: Object.freeze({
      'ubuntu-latest': '4f064904eaaed8fa96b3ef6c4dae59d491a56c0591bc7ee82e6c9e7cb4398339',
      'windows-latest': '38748033bf7eb7e6bff8b00078b2c4cbb343e8f2fd707b40b1614eb6b13e8eec'
    })
  }),
  Object.freeze({
    id: 'SCHEMA_23',
    testPath: 'backend/tests/architectureClosureV2/wpB/schema23Migration.test.js',
    matchedIndicators: Object.freeze(['architectureClosureV2WpB']),
    hashes: Object.freeze({
      'ubuntu-latest': '891de6289531f382cebc53f401b1f77d2240404e5ca5acae06e2afa3fa6bb6f1',
      'windows-latest': 'bb8f176d40f8c5c36ab950b8fcaf8d81db223c19eb1e6d4725b634c312995847'
    })
  }),
  Object.freeze({
    id: 'DURABLE_EXECUTION_CAS',
    testPath: 'backend/tests/architectureClosureV2/wpB/durableExecutionCas.test.js',
    matchedIndicators: Object.freeze(['durableExecutionAuthority']),
    hashes: Object.freeze({
      'ubuntu-latest': '36178248e275f41fa940f8c4aa9712009a726ee1a6f982abd972d11803b6f5a8',
      'windows-latest': '4482e6dc3b7adf536450f26bf3badb20dd9a45a5d400149d68fad93b1a8eba94'
    })
  }),
  Object.freeze({
    id: 'EXTERNAL_ACTION_OUTBOX',
    testPath: 'backend/tests/architectureClosureV2/wpB/externalActionOutbox.test.js',
    matchedIndicators: Object.freeze(['externalActionOutboxAuthority', 'externalActionDispatcher']),
    hashes: Object.freeze({
      'ubuntu-latest': 'd0fd4b85c8c5bff05aa1f31fb0a458982b4f134df4e63f6e72708e8e1e8e7013',
      'windows-latest': '566d4df5a8c8ba348ab5136fc55d93bd889ffa89db4ebabdc4d68b2044f87330'
    })
  }),
  Object.freeze({
    id: 'TRANSACTION_IO_BOUNDARY',
    testPath: 'backend/tests/architectureClosureV2/wpB/transactionIoBoundary.test.js',
    matchedIndicators: Object.freeze(['WP_B_CREATE_TRANSACTION_IO_GUARD_MISSING']),
    hashes: Object.freeze({
      'ubuntu-latest': '4697bd928d5e93e4166ccb19d737e046a1078f85d5cb1319e6d8b59cc1072cc6',
      'windows-latest': '51e0c2618f77d6925be89e0b51066482aa1fe190efa5669d9ae22257383c173a'
    })
  }),
  Object.freeze({
    id: 'UNCERTAIN_OUTCOME_RECONCILIATION',
    testPath: 'backend/tests/architectureClosureV2/wpB/uncertainOutcomeReconciliation.test.js',
    matchedIndicators: Object.freeze(['externalOutcomeReconciliation']),
    hashes: Object.freeze({
      'ubuntu-latest': '5b23057c74f6432f26c9640948547b1f6517473e551b957b6bd4a4af0b936385',
      'windows-latest': '444c4b3b227be929a30e9b2289df7bbcde4a1ea37c8dafa1c3b6be8fd6bff896'
    })
  })
]);
const EXPECTED_PLATFORMS = Object.freeze({
  'ubuntu-latest': Object.freeze({ jobId: 91581416455 }),
  'windows-latest': Object.freeze({ jobId: 91581416474 })
});

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function violation(violations, code, details = {}) {
  violations.push(Object.freeze({ code, ...details }));
}

function verifyEvidence(evidence) {
  const violations = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return Object.freeze({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_M1_RED_EVIDENCE_VERIFICATION',
      ok: false,
      schema23StartupRegistrationAuthorized: false,
      violations: Object.freeze([{ code: 'WP_B_M1_RED_EVIDENCE_NOT_OBJECT' }])
    });
  }

  if (evidence.schemaVersion !== 1) violation(violations, 'WP_B_M1_RED_SCHEMA_VERSION_INVALID');
  if (evidence.documentType !== 'YANCE_ACV2_WP_B_M1_RED_EVIDENCE') {
    violation(violations, 'WP_B_M1_RED_DOCUMENT_TYPE_INVALID');
  }
  if (evidence.program !== 'Architecture Closure V2') violation(violations, 'WP_B_M1_RED_PROGRAM_INVALID');
  if (evidence.repository !== 'laiqian0239-glitch/yance') violation(violations, 'WP_B_M1_RED_REPOSITORY_INVALID');
  if (evidence.workPackage !== 'WP-B') violation(violations, 'WP_B_M1_RED_WORK_PACKAGE_INVALID');
  if (evidence.milestone !== 'M1_DURABLE_EXECUTION_EXTERNAL_ACTION_OUTBOX') {
    violation(violations, 'WP_B_M1_RED_MILESTONE_INVALID');
  }
  if (evidence.status !== 'RECORDED_VALID_CAPABILITY_RED') violation(violations, 'WP_B_M1_RED_STATUS_INVALID');
  if (evidence.sourceCommit !== EXPECTED_SOURCE_COMMIT) violation(violations, 'WP_B_M1_RED_SOURCE_COMMIT_INVALID');
  if (!/^2026-08-03T02:33:[0-9]{2}\.[0-9]{3}Z$/u.test(String(evidence.recordedAt || ''))) {
    violation(violations, 'WP_B_M1_RED_RECORDED_AT_INVALID');
  }
  if (!same(evidence.workflow, EXPECTED_WORKFLOW)) violation(violations, 'WP_B_M1_RED_WORKFLOW_BINDING_INVALID');

  const expectedTestPaths = EXPECTED_CONTRACTS.map(contract => contract.testPath);
  if (evidence.contractSet?.schemaVersion !== 2
      || evidence.contractSet?.documentType !== 'YANCE_ACV2_WP_B_M1_CONTRACT_EXECUTION'
      || evidence.contractSet?.productionImplementationExpectedAbsent !== true
      || !same(evidence.contractSet?.testPaths, expectedTestPaths)) {
    violation(violations, 'WP_B_M1_RED_CONTRACT_SET_INVALID');
  }

  const platformKeys = Object.keys(evidence.platforms || {}).sort();
  if (!same(platformKeys, Object.keys(EXPECTED_PLATFORMS).sort())) {
    violation(violations, 'WP_B_M1_RED_PLATFORM_SET_INVALID', { platformKeys });
  }

  for (const [platform, expectedPlatform] of Object.entries(EXPECTED_PLATFORMS)) {
    const actual = evidence.platforms?.[platform];
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) {
      violation(violations, 'WP_B_M1_RED_PLATFORM_MISSING', { platform });
      continue;
    }
    if (actual.jobId !== expectedPlatform.jobId) violation(violations, 'WP_B_M1_RED_JOB_ID_INVALID', { platform });
    if (actual.status !== 'VALID_CAPABILITY_RED') violation(violations, 'WP_B_M1_RED_PLATFORM_STATUS_INVALID', { platform });
    if (!same(actual.counts, { green: 0, validCapabilityRed: 7, invalidRedInfrastructure: 0 })) {
      violation(violations, 'WP_B_M1_RED_PLATFORM_COUNTS_INVALID', { platform, counts: actual.counts });
    }
    if (!Array.isArray(actual.contracts) || actual.contracts.length !== EXPECTED_CONTRACTS.length) {
      violation(violations, 'WP_B_M1_RED_CONTRACT_COUNT_INVALID', { platform });
      continue;
    }
    const ids = actual.contracts.map(contract => contract?.id);
    if (new Set(ids).size !== ids.length || !same(ids, EXPECTED_CONTRACTS.map(contract => contract.id))) {
      violation(violations, 'WP_B_M1_RED_CONTRACT_ORDER_INVALID', { platform, ids });
    }
    for (let index = 0; index < EXPECTED_CONTRACTS.length; index += 1) {
      const expected = EXPECTED_CONTRACTS[index];
      const contract = actual.contracts[index] || {};
      if (contract.id !== expected.id) violation(violations, 'WP_B_M1_RED_CONTRACT_ID_INVALID', { platform, index });
      if (contract.testPath !== expected.testPath) {
        violation(violations, 'WP_B_M1_RED_CONTRACT_PATH_INVALID', { platform, id: expected.id });
      }
      if (!same(contract.matchedIndicators, expected.matchedIndicators)) {
        violation(violations, 'WP_B_M1_RED_INDICATORS_INVALID', { platform, id: expected.id });
      }
      if (contract.outputSha256 !== expected.hashes[platform]) {
        violation(violations, 'WP_B_M1_RED_OUTPUT_HASH_INVALID', { platform, id: expected.id });
      }
    }
  }

  const authorization = evidence.authorization || {};
  if (authorization.redRecorded !== true
      || authorization.productionImplementationAuthorizedAfterRecordedRed !== true
      || authorization.schema23StartupRegistrationAuthorized !== true
      || authorization.automaticMilestoneClosureAuthorized !== false
      || authorization.independentReviewRequired !== true) {
    violation(violations, 'WP_B_M1_RED_AUTHORIZATION_INVALID');
  }

  const governance = evidence.governance || {};
  if (governance.wpBImplementationAuthorized !== true
      || governance.schema23AppliedToProductionStartup !== false
      || governance.thirdPartyProductionUseAuthorized !== false
      || governance.wpCAuthorized !== false
      || governance.formalRelease !== false
      || governance.publish !== false
      || governance.temporaryBypassAllowed !== false
      || governance.warningOnlyClosureAllowed !== false) {
    violation(violations, 'WP_B_M1_RED_GOVERNANCE_INVALID');
  }

  const schema23StartupRegistrationAuthorized = violations.length === 0;
  return Object.freeze({
    schemaVersion: 1,
    documentType: 'YANCE_ACV2_WP_B_M1_RED_EVIDENCE_VERIFICATION',
    ok: schema23StartupRegistrationAuthorized,
    sourceCommit: evidence.sourceCommit || '',
    workflowRunId: Number(evidence.workflow?.workflowRunId || 0),
    platformCount: Object.keys(EXPECTED_PLATFORMS).length,
    contractCount: EXPECTED_CONTRACTS.length,
    schema23StartupRegistrationAuthorized,
    violations: Object.freeze(violations)
  });
}

function verifyFile(repositoryRoot = path.resolve(__dirname, '..', '..')) {
  const evidence = JSON.parse(fs.readFileSync(path.join(repositoryRoot, EVIDENCE_PATH), 'utf8'));
  return verifyEvidence(evidence);
}

if (require.main === module) {
  try {
    const report = verifyFile();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: 1,
      documentType: 'YANCE_ACV2_WP_B_M1_RED_EVIDENCE_VERIFICATION_FAILURE',
      ok: false,
      schema23StartupRegistrationAuthorized: false,
      code: String(error?.code || 'WP_B_M1_RED_EVIDENCE_VERIFICATION_FAILED'),
      message: String(error?.message || error)
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  EVIDENCE_PATH,
  EXPECTED_CONTRACTS,
  EXPECTED_PLATFORMS,
  EXPECTED_SOURCE_COMMIT,
  EXPECTED_WORKFLOW,
  verifyEvidence,
  verifyFile
});
