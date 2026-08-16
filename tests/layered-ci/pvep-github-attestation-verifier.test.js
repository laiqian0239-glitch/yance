'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyGitHubAttestation,
  buildSubject,
  REASON_CODES
} = require('../../shared/verification/githubAttestationVerifier');
const {
  parseArgs
} = require('../../tools/verification/verify-attestation');

const PREDICATE_TYPE = 'https://yance.dev/attestations/pvep-verification/v1';
const REPOSITORY = 'laiqian0239-glitch/yance';
const SIGNER_WORKFLOW = 'laiqian0239-glitch/yance/.github/workflows/pvep-attested-evidence.yml';
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const LINUX_DIGEST = '34bbd06526e6da8ddd8c8bb1daec1a98b57698ed9d6f71040973f737d4c47a27';
const WINDOWS_DIGEST = '3af8ad25fa600975af87dfa2656ea8ecd2c3ee7e683f19ab8cdb8443112eb447';

function requirementSet() {
  return {
    schemaVersion: 1,
    requirementSetId: 'pvep-selftest-v1',
    repository: REPOSITORY,
    workPackage: 'PVEP',
    predicateType: PREDICATE_TYPE,
    signerWorkflow: SIGNER_WORKFLOW,
    sourceRef: 'refs/heads/main',
    requirements: [
      {
        gateId: 'pvep-linux-selftest',
        platform: 'linux',
        commandSetPath: 'governance/verification/command-sets/pvep-linux-selftest-v1.json',
        commandSetSha256: LINUX_DIGEST
      },
      {
        gateId: 'pvep-windows-selftest',
        platform: 'windows',
        commandSetPath: 'governance/verification/command-sets/pvep-windows-selftest-v1.json',
        commandSetSha256: WINDOWS_DIGEST
      }
    ]
  };
}

function predicate(overrides = {}) {
  return {
    schemaVersion: 1,
    recordType: 'YANCE_PVEP_ATTESTED_VERIFICATION',
    repository: REPOSITORY,
    workPackage: 'PVEP',
    trustedPolicyCommit: BASE,
    baseCommit: BASE,
    headCommit: HEAD,
    verificationStatus: 'VERIFIED_PASS',
    requirements: [
      {
        gateId: 'pvep-linux-selftest',
        platform: 'linux',
        commandSetPath: 'governance/verification/command-sets/pvep-linux-selftest-v1.json',
        commandSetSha256: LINUX_DIGEST,
        verificationStatus: 'VERIFIED_PASS',
        evidenceSource: 'github-job-result'
      },
      {
        gateId: 'pvep-windows-selftest',
        platform: 'windows',
        commandSetPath: 'governance/verification/command-sets/pvep-windows-selftest-v1.json',
        commandSetSha256: WINDOWS_DIGEST,
        verificationStatus: 'VERIFIED_PASS',
        evidenceSource: 'github-job-result'
      }
    ],
    ...overrides
  };
}

function verifiedEntry(predicateValue = predicate(), timestamps = [{ source: 'rekor' }]) {
  return {
    verificationResult: {
      signature: { certificate: { subjectAlternativeName: 'trusted-workflow' } },
      verifiedTimestamps: timestamps,
      statement: {
        predicateType: PREDICATE_TYPE,
        predicate: predicateValue
      }
    }
  };
}

function successfulRunner(entries = [verifiedEntry()], calls = []) {
  return ({ command, args }) => {
    calls.push({ command, args: [...args] });
    return { status: 0, signal: null, error: null, stdout: JSON.stringify(entries), stderr: '' };
  };
}

function verify(overrides = {}) {
  return verifyGitHubAttestation({
    requirementSet: requirementSet(),
    expected: {
      repository: REPOSITORY,
      baseCommit: BASE,
      headCommit: HEAD
    },
    ghRunner: successfulRunner(),
    ...overrides
  });
}

test('verified GitHub attestation is accepted only through strict Sigstore identity flags', () => {
  const calls = [];
  const result = verify({ ghRunner: successfulRunner([verifiedEntry()], calls) });
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  const args = calls[0].args;
  for (const [flag, value] of [
    ['--repo', REPOSITORY],
    ['--signer-workflow', SIGNER_WORKFLOW],
    ['--signer-digest', BASE],
    ['--source-digest', BASE],
    ['--source-ref', 'refs/heads/main'],
    ['--predicate-type', PREDICATE_TYPE],
    ['--format', 'json']
  ]) {
    const index = args.indexOf(flag);
    assert.notEqual(index, -1, `${flag} missing`);
    assert.equal(args[index + 1], value, `${flag} drift`);
  }
  assert.ok(args.includes('--deny-self-hosted-runners'));
  assert.equal(result.fact.repository, REPOSITORY);
  assert.equal(result.fact.baseCommit, BASE);
  assert.equal(result.fact.headCommit, HEAD);
  assert.equal(result.fact.verificationStatus, 'VERIFIED_PASS');
});

test('subject is deterministic and binds exact repository/base/head plus both command-set digests', () => {
  assert.equal(buildSubject(requirementSet(), { repository: REPOSITORY, baseCommit: BASE, headCommit: HEAD }),
    `YANCE_PVEP_SUBJECT_V2\nrepository=${REPOSITORY}\nbase=${BASE}\nhead=${HEAD}\nlinuxCommandSetSha256=${LINUX_DIGEST}\nwindowsCommandSetSha256=${WINDOWS_DIGEST}\n`);
});

test('gh verification failure, malformed output and missing transparency timestamp fail closed', () => {
  const failedGh = verify({
    ghRunner: () => ({ status: 1, signal: null, error: null, stdout: '', stderr: 'verification failed' })
  });
  assert.equal(failedGh.pass, false);
  assert.equal(failedGh.reasonCode, REASON_CODES.EVIDENCE_ATTESTATION_VERIFICATION_FAILED);

  const malformed = verify({ ghRunner: () => ({ status: 0, signal: null, error: null, stdout: '{', stderr: '' }) });
  assert.equal(malformed.pass, false);
  assert.equal(malformed.reasonCode, REASON_CODES.EVIDENCE_ATTESTATION_OUTPUT_INVALID);

  const noTimestamp = verify({ ghRunner: successfulRunner([verifiedEntry(predicate(), [])]) });
  assert.equal(noTimestamp.pass, false);
  assert.equal(noTimestamp.reasonCode, REASON_CODES.EVIDENCE_ATTESTATION_TIMESTAMP_MISSING);
});

test('predicate base/head/work-package/status and Linux/Windows requirement drift fail closed', () => {
  const cases = [
    [predicate({ baseCommit: '3'.repeat(40) }), REASON_CODES.EVIDENCE_BASE_MISMATCH],
    [predicate({ headCommit: '3'.repeat(40) }), REASON_CODES.EVIDENCE_HEAD_MISMATCH],
    [predicate({ workPackage: 'OTHER' }), REASON_CODES.EVIDENCE_SCHEMA_INVALID],
    [predicate({ verificationStatus: 'VERIFIED_FAIL' }), REASON_CODES.EVIDENCE_ATTESTATION_STATUS_INVALID],
    [predicate({ requirements: [predicate().requirements[0]] }), REASON_CODES.EVIDENCE_REQUIREMENT_SET_MISMATCH],
    [predicate({ requirements: [
      { ...predicate().requirements[0], commandSetSha256: 'f'.repeat(64) },
      predicate().requirements[1]
    ] }), REASON_CODES.EVIDENCE_REQUIREMENT_SET_MISMATCH],
    [predicate({ requirements: [predicate().requirements[0], predicate().requirements[0]] }), REASON_CODES.EVIDENCE_REQUIREMENT_SET_MISMATCH]
  ];
  for (const [candidate, reasonCode] of cases) {
    const result = verify({ ghRunner: successfulRunner([verifiedEntry(candidate)]) });
    assert.equal(result.pass, false, JSON.stringify(candidate));
    assert.equal(result.reasonCode, reasonCode, JSON.stringify(result));
  }
});

test('multiple cryptographically verified attestations must agree on the same trusted fact', () => {
  const result = verify({
    ghRunner: successfulRunner([
      verifiedEntry(),
      verifiedEntry(predicate({ headCommit: '4'.repeat(40) }))
    ])
  });
  assert.equal(result.pass, false);
  assert.equal(result.reasonCode, REASON_CODES.EVIDENCE_TRUSTED_SOURCE_CONFLICT);
});

test('offline verification delegates bundle and trusted-root handling to GitHub CLI', () => {
  const calls = [];
  const result = verify({
    bundlePath: '/evidence/bundle.jsonl',
    trustedRootPath: '/evidence/trusted_root.jsonl',
    ghRunner: successfulRunner([verifiedEntry()], calls)
  });
  assert.equal(result.pass, true, JSON.stringify(result));
  const args = calls[0].args;
  assert.equal(args[args.indexOf('--bundle') + 1], '/evidence/bundle.jsonl');
  assert.equal(args[args.indexOf('--custom-trusted-root') + 1], '/evidence/trusted_root.jsonl');
});

test('CLI parser requires exact trust inputs and supports online or offline verification', () => {
  const online = parseArgs([
    '--requirements', 'governance/verification/requirements/pvep-selftest-v1.json',
    '--repository', REPOSITORY,
    '--base', BASE,
    '--head', HEAD
  ]);
  assert.equal(online.repository, REPOSITORY);
  assert.equal(online.bundlePath, null);

  const offline = parseArgs([
    '--requirements', 'requirements.json',
    '--repository', REPOSITORY,
    '--base', BASE,
    '--head', HEAD,
    '--bundle', 'bundle.jsonl',
    '--trusted-root', 'trusted_root.jsonl'
  ]);
  assert.equal(offline.bundlePath, 'bundle.jsonl');
  assert.equal(offline.trustedRootPath, 'trusted_root.jsonl');

  assert.throws(() => parseArgs(['--requirements', 'requirements.json', '--repository', REPOSITORY]), /arguments/u);
  assert.throws(() => parseArgs([
    '--requirements', 'requirements.json', '--repository', REPOSITORY, '--base', BASE, '--head', HEAD,
    '--bundle', 'bundle.jsonl'
  ]), /trusted-root/u);
});
