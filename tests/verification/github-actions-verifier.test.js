'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeCanonicalPayloadSha256,
  computeReceiptSha256
} = require('../../shared/verification/canonicalEvidenceReceipt');
const { canonicalSha256, sha256Hex } = require('../../shared/verification/jcs');
const { commandSetDigest } = require('../../shared/verification/commandSetRegistry');
const { verifyGitHubActionsReceipt } = require('../../shared/verification/githubActionsVerifier');

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const EMPTY = sha256Hex(Buffer.alloc(0));
const EMPTY_PATHS = sha256Hex(Buffer.from('', 'utf8'));

function createContext() {
  const commandSet = {
    schemaVersion: 1,
    commandSetId: 'pvep-linux-selftest-v1',
    platform: 'linux',
    commands: [{
      commandId: 'pvep-required-tests',
      executable: 'node',
      argv: ['tools/verification/run-required-tests.js'],
      expectedExitCode: 0,
      generatedRoots: ['.pvep-output'],
      artifacts: ['.pvep-output/pvep-report.json']
    }]
  };
  const digest = commandSetDigest(commandSet);
  const artifactBytes = Buffer.from('{"verified":true}\n', 'utf8');
  const receipt = {
    schemaVersion: 1,
    recordType: 'YANCE_PORTABLE_VERIFICATION_EVIDENCE_RECEIPT',
    repository: 'laiqian0239-glitch/yance',
    workPackage: 'PVEP',
    gateId: 'pvep-linux-selftest',
    baseCommit: BASE,
    headCommit: HEAD,
    adapterType: 'github-actions-v1',
    producer: {
      workflowRepository: 'laiqian0239-glitch/yance',
      workflowId: '98765',
      runId: 123456,
      runAttempt: 2,
      jobIds: [7001, 7002],
      runnerEnvironment: 'github-hosted:ubuntu-latest'
    },
    commandSet: { commandSetId: commandSet.commandSetId, commandSetDigest: digest, platform: 'linux' },
    execution: {
      startedAt: '2026-08-07T00:00:00.000Z',
      completedAt: '2026-08-07T00:01:00.000Z',
      commands: [{
        commandId: 'pvep-required-tests',
        argvDigest: canonicalSha256({ executable: commandSet.commands[0].executable, argv: commandSet.commands[0].argv }),
        exitCode: 0,
        startedAt: '2026-08-07T00:00:01.000Z',
        completedAt: '2026-08-07T00:00:59.000Z',
        stdoutSha256: 'a'.repeat(64),
        stderrSha256: 'b'.repeat(64)
      }]
    },
    workspace: {
      preHead: HEAD,
      postHead: HEAD,
      preTrackedDiffSha256: EMPTY,
      postTrackedDiffSha256: EMPTY,
      preUnexpectedUntrackedPathSetSha256: EMPTY_PATHS,
      postUnexpectedUntrackedPathSetSha256: EMPTY_PATHS,
      allowedGeneratedRootSetSha256: canonicalSha256(['.pvep-output'])
    },
    results: [{ commandId: 'pvep-required-tests', passed: true }],
    artifacts: [{
      artifactId: 'pvep-report',
      relativePath: '.pvep-output/pvep-report.json',
      sha256: sha256Hex(artifactBytes),
      sizeBytes: artifactBytes.length,
      mediaType: 'application/json',
      producerCommandId: 'pvep-required-tests'
    }],
    canonicalPayloadSha256: null,
    authenticity: {
      scheme: 'github-api-rebind',
      runId: 123456,
      runAttempt: 2,
      workflowId: '98765',
      jobIds: [7001, 7002],
      artifactIds: [8001]
    },
    receiptSha256: null
  };
  receipt.canonicalPayloadSha256 = computeCanonicalPayloadSha256(receipt);
  receipt.receiptSha256 = computeReceiptSha256(receipt);

  const client = {
    async getWorkflowRun(runId) {
      assert.equal(runId, 123456);
      return {
        id: 123456,
        run_attempt: 2,
        head_sha: HEAD,
        conclusion: 'success',
        workflow_id: 98765,
        repository: { full_name: 'laiqian0239-glitch/yance' }
      };
    },
    async getRunJobs(runId, attempt) {
      assert.equal(runId, 123456);
      assert.equal(attempt, 2);
      return { jobs: [{ id: 7001, conclusion: 'success' }, { id: 7002, conclusion: 'success' }] };
    },
    async getArtifact(artifactId) {
      assert.equal(artifactId, 8001);
      return { id: 8001, name: 'pvep-report', expired: false, workflow_run: { id: 123456 } };
    },
    async getArtifactBytes(artifactId) {
      assert.equal(artifactId, 8001);
      return artifactBytes;
    }
  };
  const expected = {
    repository: receipt.repository,
    workPackage: receipt.workPackage,
    gateId: receipt.gateId,
    baseCommit: BASE,
    headCommit: HEAD
  };
  return { receipt, commandSet, commandSetRegistry: { [commandSet.commandSetId]: commandSet }, client, expected, artifactBytes };
}

async function verify(context, overrides = {}) {
  return verifyGitHubActionsReceipt({
    receipt: context.receipt,
    expected: context.expected,
    commandSetRegistry: context.commandSetRegistry,
    client: context.client,
    ...overrides
  });
}

function reseal(receipt) {
  receipt.canonicalPayloadSha256 = computeCanonicalPayloadSha256(receipt);
  receipt.receiptSha256 = computeReceiptSha256(receipt);
}

test('complete GitHub API identity produces the normalized VERIFIED_PASS fact', async () => {
  const context = createContext();
  const result = await verify(context);
  assert.equal(result.pass, true);
  assert.equal(result.fact.verificationStatus, 'VERIFIED_PASS');
  assert.equal(result.fact.adapterType, 'github-actions-v1');
  assert.equal(result.fact.headCommit, HEAD);
});

test('receipt success never overrides API failure or identity mismatch', async () => {
  for (const mutate of [
    (run) => { run.conclusion = 'failure'; },
    (run) => { run.head_sha = '3'.repeat(40); },
    (run) => { run.repository.full_name = 'other/repo'; },
    (run) => { run.workflow_id = 999; },
    (run) => { run.run_attempt = 3; }
  ]) {
    const context = createContext();
    const base = context.client.getWorkflowRun;
    context.client.getWorkflowRun = async (id) => { const run = await base(id); mutate(run); return run; };
    const result = await verify(context);
    assert.equal(result.pass, false);
    assert.equal(result.reasonCode, 'EVIDENCE_GITHUB_API_IDENTITY_INVALID');
  }
});

test('missing or failed required jobs and missing artifacts fail closed', async () => {
  const missingJob = createContext();
  missingJob.client.getRunJobs = async () => ({ jobs: [{ id: 7001, conclusion: 'success' }] });
  assert.equal((await verify(missingJob)).reasonCode, 'EVIDENCE_GITHUB_API_IDENTITY_INVALID');

  const failedJob = createContext();
  failedJob.client.getRunJobs = async () => ({ jobs: [{ id: 7001, conclusion: 'success' }, { id: 7002, conclusion: 'failure' }] });
  assert.equal((await verify(failedJob)).reasonCode, 'EVIDENCE_GITHUB_API_IDENTITY_INVALID');

  const missingArtifact = createContext();
  missingArtifact.client.getArtifact = async () => null;
  assert.equal((await verify(missingArtifact)).reasonCode, 'EVIDENCE_GITHUB_API_IDENTITY_INVALID');
});

test('artifact bytes are rebound to the signed receipt digest when available', async () => {
  const context = createContext();
  context.client.getArtifactBytes = async () => Buffer.from('tampered', 'utf8');
  assert.equal((await verify(context)).reasonCode, 'EVIDENCE_ARTIFACT_DIGEST_MISMATCH');
});

test('unavailable client and receipt/API authenticity disagreement fail closed', async () => {
  const context = createContext();
  assert.equal((await verify(context, { client: null })).reasonCode, 'EVIDENCE_GITHUB_API_IDENTITY_INVALID');

  const disagreement = createContext();
  disagreement.receipt.authenticity.runAttempt = 3;
  reseal(disagreement.receipt);
  assert.equal((await verify(disagreement)).reasonCode, 'EVIDENCE_GITHUB_API_IDENTITY_INVALID');
});
