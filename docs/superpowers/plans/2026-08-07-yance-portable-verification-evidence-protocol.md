# Yance Portable Verification Evidence Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PVEP v1 so Yance governance can verify exact-SHA, cross-platform evidence through canonical receipts produced by GitHub Actions or independently trusted signed executors, without weakening any existing gate or modifying OSS-A PR #67.

**Architecture:** The implementation is a verification subsystem, not a product authority. RFC 8785 canonical bytes and exact digests form the evidence identity; adapter-specific verifiers prove authenticity and normalize receipts into restricted gate facts; an aggregator requires a complete exact-base/exact-head requirement set and fails closed on drift or trusted-source conflict. GitHub Actions and signed executors are peer evidence producers, while actual executor enrollment remains a separate governance change.

**Tech Stack:** Node.js >=22.5.0, npm >=10, CommonJS, `node:test`, Node built-in `crypto`/`child_process`/`fs`, exact dev dependency `canonicalize@2.1.0` (Apache-2.0, zero runtime dependencies, CommonJS entry point).

## Global Constraints

- Implementation begins only after the design/spec PR #93 is independently reviewed and merged through the ordinary protected path, or after a separate explicit implementation authorization establishes an equivalent trusted base.
- Create a fresh worktree with `superpowers:using-git-worktrees`; implementation branch name: `governance/portable-verification-evidence-protocol`.
- Re-resolve `origin/main` immediately before branch creation and record the exact trusted base SHA in the implementation PR body.
- Do not modify, merge, rebase, force-push, or otherwise touch PR #67 or branch `oss/a-supply-chain-foundation`.
- Do not modify `governance/layered-ci/oss-a-source-merge-candidate-seal.json` or change OSS-A final-candidate evidence semantics in this implementation PR.
- Do not start or authorize WP-B.
- No `--skip-verification`, `ALLOW_UNTRUSTED_EVIDENCE`, fallback-success, self-asserted GREEN, temporary bypass, or softened gate is permitted.
- Every implementation task follows causal RED -> minimal GREEN -> focused regression -> commit. RED commits must precede the implementation commits they authorize.
- `canonicalize` is pinned exactly to `2.1.0`; no semver range. No other new npm dependency is allowed in PVEP v1.
- `canonicalize@2.1.0` must be recorded as Apache-2.0, CommonJS, and zero runtime dependencies; `package-lock.json` remains the integrity authority for the exact tarball.
- Security-relevant JSON uses RFC 8785 JCS; ordinary `JSON.stringify` must never define a digest/signature preimage.
- Ed25519 private keys never enter the repository, worktree, environment variables, command arguments, stdout/stderr, receipt, or artifact.
- The repository runner never owns a production signing key. Production signing is detached and privilege-isolated; repository tooling only emits canonical payload bytes and assembles/verifies a detached signature.
- Command sets contain explicit argv arrays; the runner invokes executables with `shell: false` and exposes no arbitrary command-string CLI.
- Unknown schema fields, unknown adapters, unknown executors, revoked executors, wrong key generations, mixed Heads, dirty tracked source, unexpected untracked source, digest drift, missing gates, and trusted-source conflicts fail closed with stable reason codes.
- Linux evidence cannot satisfy a Windows requirement and Windows evidence cannot satisfy a Linux requirement.
- Exact base/head identity is mandatory; no branch-name substitution and no prior-Head evidence inheritance.
- Actual production executor registration/public keys are not added by the implementation PR. Enrollment is a later single-purpose governance PR using the shipped validation tooling and isolation evidence contract.

---

## File Structure

### Core libraries

- `shared/verification/jcs.js` — RFC 8785 wrapper, I-JSON input checks, UTF-8 canonical bytes and SHA-256 helpers.
- `shared/verification/reasonCodes.js` — frozen PVEP reason-code vocabulary.
- `shared/verification/canonicalEvidenceReceipt.js` — strict final-receipt schema, unsigned-candidate schema, payload digest, receipt digest, path/time/number checks.
- `shared/verification/commandSetRegistry.js` — strict command-set loading, schema checks, digest calculation.
- `shared/verification/executorRegistry.js` — trusted executor registry validation, status/generation/platform/isolation checks.
- `shared/verification/signedExecutorVerifier.js` — Ed25519 authenticity verification and normalized fact creation.
- `shared/verification/githubActionsVerifier.js` — GitHub API-bound identity verification through an injected client.
- `shared/verification/trustedEvidencePolicy.js` — adapter dispatch and normalized fact construction.
- `shared/verification/requirementAggregator.js` — complete requirement-set matching, deduplication and conflict fail-closed.
- `shared/verification/workspaceEvidence.js` — deterministic Git/workspace/path-set evidence helpers used by the runner.
- `shared/verification/commandSetRunner.js` — testable safe runner core; CLI is a thin wrapper, preventing recursive self-test coupling.

### Governance data

- `governance/verification/trusted-executors.json` — schema-valid registry with no ACTIVE production executor in the implementation PR.
- `governance/verification/command-sets/pvep-linux-selftest-v1.json` — Linux self-verification command set.
- `governance/verification/command-sets/pvep-windows-selftest-v1.json` — Windows self-verification command set.
- `governance/verification/third-party/canonicalize-2.1.0.json` — exact dependency provenance derived from the lock file and upstream package metadata.

### Tools

- `tools/verification/run-command-set.js` — thin CLI over `commandSetRunner`, emits an unsigned candidate.
- `tools/verification/assemble-signed-receipt.js` — combines an unsigned candidate and detached signature, verifies it, then writes the final signed receipt.
- `tools/verification/verify-receipt.js` — offline signed-executor receipt verifier.
- `tools/verification/verify-requirement-set.js` — verifies and aggregates a requirement manifest against receipt files.
- `tools/verification/run-required-tests.js` — deterministic explicit test-file runner used by command sets.
- `tools/verification/verify-jcs-dependency.js` — verifies the exact canonicalize package/lock/provenance contract.

### Tests and fixtures

- `tests/verification/jcs.test.js`
- `tests/verification/canonical-evidence-receipt.test.js`
- `tests/verification/command-set-registry.test.js`
- `tests/verification/executor-registry.test.js`
- `tests/verification/signed-executor-verifier.test.js`
- `tests/verification/runner.test.js`
- `tests/verification/github-actions-verifier.test.js`
- `tests/verification/requirement-aggregator.test.js`
- `tests/verification/cli.test.js`
- `tests/verification/adversarial.test.js`
- `tests/verification/fixtures/` — synthetic receipts, command sets, artifacts, and ephemeral test keys only.

### Documentation

- `docs/governance/PVEP_EXECUTOR_ENROLLMENT.md` — privilege-isolation and production executor enrollment procedure.
- `docs/governance/PVEP_OPERATIONS.md` — receipt production/verification operations and explicit non-authorities.

---

### Task 1: RFC 8785 Canonicalization and Exact Dependency Contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `shared/verification/jcs.js`
- Create: `tests/verification/jcs.test.js`
- Create: `governance/verification/third-party/canonicalize-2.1.0.json`
- Create: `tools/verification/verify-jcs-dependency.js`

**Interfaces:**
- Produces: `assertIJsonValue(value)`, `canonicalizeBytes(value) -> Buffer`, `sha256Hex(bytes) -> string`, `canonicalSha256(value) -> string`.
- Produces: `verifyJcsDependency({ repoRoot }) -> { pass, reasonCode, packageVersion, integrity }`.
- Consumes: no prior PVEP code.

- [ ] **Step 1: Write the failing JCS and dependency-contract tests**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { canonicalizeBytes, canonicalSha256 } = require('../../shared/verification/jcs');
const { verifyJcsDependency } = require('../../tools/verification/verify-jcs-dependency');

test('RFC 8785 sample canonicalizes byte-for-byte', () => {
  const input = {
    numbers: [333333333.33333329, 1E30, 4.50, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\"/",
    literals: [null, true, false]
  };
  const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}';
  assert.equal(canonicalizeBytes(input).toString('utf8'), expected);
});

test('canonical object order changes neither bytes nor digest', () => {
  assert.deepEqual(canonicalizeBytes({ b: 2, a: 1 }), canonicalizeBytes({ a: 1, b: 2 }));
  assert.equal(canonicalSha256({ b: 2, a: 1 }), canonicalSha256({ a: 1, b: 2 }));
});

test('non-I-JSON values fail closed', () => {
  for (const invalid of [NaN, Infinity, -Infinity, undefined, 1n]) {
    assert.throws(() => canonicalizeBytes({ value: invalid }), /EVIDENCE_SCHEMA_INVALID/);
  }
  assert.throws(() => canonicalizeBytes({ value: '\ud800' }), /EVIDENCE_SCHEMA_INVALID/);
});

test('canonicalize dependency is exactly pinned and lock-bound', () => {
  const result = verifyJcsDependency({ repoRoot: require('node:path').resolve(__dirname, '..', '..') });
  assert.equal(result.pass, true);
  assert.equal(result.packageVersion, '2.1.0');
  assert.match(result.integrity, /^sha512-/u);
});
```

- [ ] **Step 2: Run the test and verify causal RED**

```bash
node --test --test-concurrency=1 tests/verification/jcs.test.js
```

Expected: FAIL because `shared/verification/jcs.js` and the dependency verifier do not exist and `canonicalize@2.1.0` is not pinned.

- [ ] **Step 3: Commit the RED test only**

```bash
git add tests/verification/jcs.test.js
git commit -m "test(pvep): define RFC 8785 canonicalization contract"
```

- [ ] **Step 4: Install the exact CommonJS JCS package**

```bash
npm install --save-dev --save-exact canonicalize@2.1.0
```

Confirm `package.json` contains exactly `"canonicalize": "2.1.0"` and `package-lock.json` records `node_modules/canonicalize` version `2.1.0`, resolved tarball `https://registry.npmjs.org/canonicalize/-/canonicalize-2.1.0.tgz`, `sha512-...` integrity, and Apache-2.0 metadata.

- [ ] **Step 5: Implement the strict JCS wrapper**

```js
'use strict';
const crypto = require('node:crypto');
const canonicalize = require('canonicalize');

function fail() {
  const error = new Error('EVIDENCE_SCHEMA_INVALID');
  error.code = 'EVIDENCE_SCHEMA_INVALID';
  throw error;
}

function assertUnicodeScalarString(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) fail();
  }
}

function assertIJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') return assertUnicodeScalarString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return;
  }
  if (typeof value !== 'object') fail();
  if (seen.has(value)) fail();
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertIJsonValue(item, seen);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) fail();
    for (const [key, item] of Object.entries(value)) {
      assertUnicodeScalarString(key);
      assertIJsonValue(item, seen);
    }
  }
  seen.delete(value);
}

function canonicalizeBytes(value) {
  assertIJsonValue(value);
  return Buffer.from(canonicalize(value), 'utf8');
}

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalSha256(value) {
  return sha256Hex(canonicalizeBytes(value));
}

module.exports = { assertIJsonValue, canonicalizeBytes, sha256Hex, canonicalSha256 };
```

- [ ] **Step 6: Implement lock/provenance verification and checked-in metadata**

`verify-jcs-dependency.js` reads `package.json` and `package-lock.json`, requires exact `canonicalize === "2.1.0"`, exact lock entry version/resolved URL, `sha512-` integrity, and checked-in provenance metadata matching package/version/license/source/tag/module format/runtime dependency count.

`governance/verification/third-party/canonicalize-2.1.0.json`:

```json
{
  "schemaVersion": 1,
  "package": "canonicalize",
  "version": "2.1.0",
  "license": "Apache-2.0",
  "sourceRepository": "https://github.com/erdtman/canonicalize",
  "sourceTag": "v2.1.0",
  "moduleFormat": "commonjs",
  "runtimeDependencyCount": 0,
  "integrityAuthority": "package-lock.json"
}
```

- [ ] **Step 7: Run GREEN and focused dependency checks**

```bash
node --test --test-concurrency=1 tests/verification/jcs.test.js
node tools/verification/verify-jcs-dependency.js
npm ls canonicalize --depth=0
```

- [ ] **Step 8: Commit Task 1 GREEN**

```bash
git add package.json package-lock.json shared/verification/jcs.js tests/verification/jcs.test.js governance/verification/third-party/canonicalize-2.1.0.json tools/verification/verify-jcs-dependency.js
git commit -m "feat(pvep): add canonical RFC 8785 evidence bytes"
```

---

### Task 2: Strict Canonical Receipt Schema and Dual Digests

**Files:**
- Create: `shared/verification/reasonCodes.js`
- Create: `shared/verification/canonicalEvidenceReceipt.js`
- Create: `tests/verification/canonical-evidence-receipt.test.js`

**Interfaces:**
- Consumes: `canonicalizeBytes`, `sha256Hex` from Task 1.
- Produces: `validateUnsignedCandidate(candidate)`, `validateFinalReceipt(receipt)`, `canonicalPayloadBytes(value)`, `computeCanonicalPayloadSha256(value)`, `computeReceiptSha256(receipt)`, `verifyReceiptDigests(receipt)`.
- An unsigned candidate has the exact final top-level key set but `authenticity: null` and `receiptSha256: null`; it is never accepted by a final verifier.
- A final receipt requires adapter-specific authenticity plus lowercase 64-hex `receiptSha256`.

- [ ] **Step 1: Write failing tests for strict schema and digest separation**

Use a complete final fixture and assert:

```js
assert.equal(validateFinalReceipt(receipt).pass, true);
assert.equal(computeCanonicalPayloadSha256(receipt), receipt.canonicalPayloadSha256);
assert.equal(computeReceiptSha256(receipt), receipt.receiptSha256);

const unknown = structuredClone(receipt);
unknown.unrecognized = true;
assert.equal(validateFinalReceipt(unknown).reasonCode, 'EVIDENCE_SCHEMA_INVALID');

const pending = structuredClone(receipt);
pending.authenticity = null;
pending.receiptSha256 = null;
assert.equal(validateUnsignedCandidate(pending).pass, true);
assert.equal(validateFinalReceipt(pending).pass, false);

const tampered = structuredClone(receipt);
tampered.headCommit = 'f'.repeat(40);
assert.equal(verifyReceiptDigests(tampered).reasonCode, 'EVIDENCE_CANONICAL_DIGEST_MISMATCH');
```

Also cover invalid absolute/parent/backslash/control-character artifact paths, unsafe integers, non-UTC timestamps, duplicate command IDs, and invalid lowercase 40-hex base/head SHAs.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/canonical-evidence-receipt.test.js
git add tests/verification/canonical-evidence-receipt.test.js
git commit -m "test(pvep): define canonical receipt failure boundaries"
```

- [ ] **Step 3: Implement frozen reason codes and exact schema helpers**

`reasonCodes.js` exports every reason code from the approved spec, with no generic `UNKNOWN_ERROR` policy result.

Exact final top-level keys:

```js
const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'recordType', 'repository', 'workPackage', 'gateId',
  'baseCommit', 'headCommit', 'adapterType', 'producer', 'commandSet',
  'execution', 'workspace', 'results', 'artifacts',
  'canonicalPayloadSha256', 'authenticity', 'receiptSha256'
]);
```

`canonicalPayloadBytes(value)` removes only `canonicalPayloadSha256`, `authenticity`, and `receiptSha256` before JCS. `computeReceiptSha256(receipt)` removes only `receiptSha256` before JCS.

- [ ] **Step 4: Run GREEN and field-by-field mutation tests**

```bash
node --test --test-concurrency=1 tests/verification/canonical-evidence-receipt.test.js
```

- [ ] **Step 5: Commit Task 2 GREEN**

```bash
git add shared/verification/reasonCodes.js shared/verification/canonicalEvidenceReceipt.js tests/verification/canonical-evidence-receipt.test.js
git commit -m "feat(pvep): validate canonical evidence receipts"
```

---

### Task 3: Command-Set Registry and Exact Command Digest

**Files:**
- Create: `shared/verification/commandSetRegistry.js`
- Create: `governance/verification/command-sets/pvep-linux-selftest-v1.json`
- Create: `governance/verification/command-sets/pvep-windows-selftest-v1.json`
- Create: `tools/verification/run-required-tests.js`
- Create: `tests/verification/command-set-registry.test.js`

**Interfaces:**
- Consumes: Task 1 JCS helpers and Task 2 reason codes.
- Produces: `loadCommandSet({ repoRoot, commandSetId })`, `validateCommandSet(commandSet)`, `commandSetDigest(commandSet)`.
- Command object: `{ commandId, executable, argv, expectedExitCode, generatedRoots, artifacts }` with all paths repository-relative and platform `linux|windows`.

- [ ] **Step 1: Write failing registry tests**

Reject command sets containing shell strings/wrappers, duplicate command IDs, platform mismatch, parent traversal, wildcard argv that relies on shell expansion, or generated roots overlapping controlled source roots.

Explicitly reject:

```js
{ command: 'node --test tests/verification/*.test.js' }
{ executable: 'sh', argv: ['-c', 'node test.js'] }
{ executable: 'cmd.exe', argv: ['/c', 'node test.js'] }
{ executable: 'powershell.exe', argv: ['-Command', 'node test.js'] }
```

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/command-set-registry.test.js
git add tests/verification/command-set-registry.test.js
git commit -m "test(pvep): define immutable command-set contract"
```

- [ ] **Step 3: Implement deterministic registry loading**

Only load `governance/verification/command-sets/<commandSetId>.json` after validating `commandSetId` against `/^[a-z0-9][a-z0-9-]{2,63}$/u`. Never accept an arbitrary filesystem path from a receipt.

- [ ] **Step 4: Add platform self-test command sets**

Linux file:

```json
{
  "schemaVersion": 1,
  "commandSetId": "pvep-linux-selftest-v1",
  "platform": "linux",
  "commands": [
    {
      "commandId": "pvep-required-tests",
      "executable": "node",
      "argv": ["tools/verification/run-required-tests.js"],
      "expectedExitCode": 0,
      "generatedRoots": [".pvep-output"],
      "artifacts": []
    }
  ]
}
```

Windows file is byte-for-byte equivalent except `commandSetId` is `pvep-windows-selftest-v1` and `platform` is `windows`.

`run-required-tests.js` owns a literal frozen array of every PVEP test file and invokes each with `spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], { shell: false })`.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/command-set-registry.test.js
node tools/verification/run-required-tests.js
```

```bash
git add shared/verification/commandSetRegistry.js governance/verification/command-sets tools/verification/run-required-tests.js tests/verification/command-set-registry.test.js
git commit -m "feat(pvep): freeze verified command sets"
```

---

### Task 4: Trusted Executor Registry, Revocation and Isolation Contract

**Files:**
- Create: `shared/verification/executorRegistry.js`
- Create: `governance/verification/trusted-executors.json`
- Create: `tests/verification/executor-registry.test.js`
- Create: `docs/governance/PVEP_EXECUTOR_ENROLLMENT.md`

**Interfaces:**
- Produces: `validateExecutorRegistry(registry)`, `resolveActiveExecutor({ registry, executorId, keyGeneration, platform, commandSetDigest })`.
- Registry entry requires `executorId`, `platform`, `architecture`, `keyAlgorithm="Ed25519"`, `publicKeyPem`, `keyGeneration`, `status`, `validFrom`, `allowedCommandSetDigests`, and `signerIsolation`.
- `signerIsolation` requires `{ status: 'VERIFIED', runnerPrincipal, signerPrincipal, keyCustody, evidenceSha256 }`; runner/signer principals must differ.

- [ ] **Step 1: Write failing registry/revocation tests**

Generate an ephemeral Ed25519 public key in test setup and prove ACTIVE/exact generation/platform/command digest/VERIFIED isolation resolves. Cover unknown, REVOKED, wrong generation, wrong platform, missing/invalid isolation evidence, and non-Ed25519 key algorithms.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/executor-registry.test.js
git add tests/verification/executor-registry.test.js
git commit -m "test(pvep): define executor trust lifecycle"
```

- [ ] **Step 3: Implement fail-closed registry validation**

Production registry starts intentionally empty:

```json
{
  "schemaVersion": 1,
  "executors": []
}
```

No implementation commit self-authorizes a production executor.

- [ ] **Step 4: Write exact enrollment rules**

`PVEP_EXECUTOR_ENROLLMENT.md` requires distinct runner/signer principals, private-key custody inaccessible to runner code, public key/generation/platform/architecture binding, SHA-256 identity for ACL/service/isolation evidence, exact allowed command-set digests, independent enrollment PR/review, generation increments for replacement, and permanent rejection of REVOKED entries for new authorization.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/executor-registry.test.js
```

```bash
git add shared/verification/executorRegistry.js governance/verification/trusted-executors.json tests/verification/executor-registry.test.js docs/governance/PVEP_EXECUTOR_ENROLLMENT.md
git commit -m "feat(pvep): enforce trusted executor lifecycle"
```

---

### Task 5: Signed-Executor Authenticity Verification

**Files:**
- Create: `shared/verification/signedExecutorVerifier.js`
- Create: `tests/verification/signed-executor-verifier.test.js`
- Create: `tests/verification/fixtures/receiptFactory.js`

**Interfaces:**
- Consumes: final-receipt validation, canonical payload bytes/digests, executor registry and command-set registry.
- Produces: `verifySignedExecutorReceipt({ receipt, expected, executorRegistry, commandSetRegistry, artifactResolver = null }) -> { pass, reasonCode, fact? }`.
- Normalized fact exact fields: `repository`, `workPackage`, `gateId`, `baseCommit`, `headCommit`, `platform`, `commandSetId`, `commandSetDigest`, `verificationStatus`, `adapterType`, `receiptSha256`, `producerIdentity`.

- [ ] **Step 1: Write failing Ed25519 positive/negative tests**

Use Node `crypto.generateKeyPairSync('ed25519')` only inside tests. Sign `canonicalPayloadBytes(receipt)` with `crypto.sign(null, bytes, privateKey)` and assert valid verification. Then mutate signature, command argv digest, exit code, artifact digest, platform, base/head, key generation and executor ID. When an artifact resolver is supplied, return bytes that both match and mismatch the signed digest and assert the mismatch returns `EVIDENCE_ARTIFACT_DIGEST_MISMATCH`.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/signed-executor-verifier.test.js
git add tests/verification/signed-executor-verifier.test.js tests/verification/fixtures/receiptFactory.js
git commit -m "test(pvep): define signed executor authenticity contract"
```

- [ ] **Step 3: Implement cryptographic and policy verification**

```js
const verified = crypto.verify(
  null,
  canonicalPayloadBytes(receipt),
  executor.publicKeyPem,
  Buffer.from(receipt.authenticity.signatureBase64, 'base64')
);
if (!verified) return fail('EVIDENCE_SIGNATURE_INVALID');
```

Never sign or verify a hex digest string. Validate final receipt/digests before signature verification, resolve exact command set/executor, recompute every command success from exit code and command-set expectation, and verify artifact bytes when `artifactResolver` is supplied by the gate/CLI.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/signed-executor-verifier.test.js
```

```bash
git add shared/verification/signedExecutorVerifier.js tests/verification/signed-executor-verifier.test.js tests/verification/fixtures/receiptFactory.js
git commit -m "feat(pvep): verify detached Ed25519 executor evidence"
```

---

### Task 6: Clean-Workspace Safe Command-Set Runner

**Files:**
- Create: `shared/verification/workspaceEvidence.js`
- Create: `shared/verification/commandSetRunner.js`
- Create: `tools/verification/run-command-set.js`
- Create: `tests/verification/runner.test.js`
- Create: `tests/verification/fixtures/commands/pass.js`
- Create: `tests/verification/fixtures/commands/fail.js`
- Create: `tests/verification/fixtures/commands/write-artifact.js`

**Interfaces:**
- Produces `captureWorkspaceEvidence({ repoRoot, allowedGeneratedRoots })`.
- Produces `runRegisteredCommandSet({ repoRoot, baseCommit, headCommit, commandSet, outputPath }) -> unsignedCandidate`.
- CLI example: `node tools/verification/run-command-set.js --command-set-id pvep-linux-selftest-v1 --base 1111111111111111111111111111111111111111 --head 2222222222222222222222222222222222222222 --output .pvep-output/unsigned.json`.
- The only selectable execution identity is a registered command-set ID; there is no arbitrary command, shell, or registry-path argument.

- [ ] **Step 1: Write failing runner-core and CLI tests**

Use temporary Git repositories and injected fixture command sets against `runRegisteredCommandSet`; do not invoke the PVEP self-test command set from `runner.test.js`, preventing recursive `run-required-tests -> runner.test -> run-required-tests` coupling. Cover exact Head mismatch, tracked pre-diff, unexpected untracked path, allowed generated roots, stdout/stderr digests, non-zero exit, artifacts, post-run tracked mutation and CLI unknown/arbitrary-command flags.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/runner.test.js
git add tests/verification/runner.test.js tests/verification/fixtures/commands
git commit -m "test(pvep): define clean safe command execution"
```

- [ ] **Step 3: Implement deterministic Git/workspace evidence**

Use direct `spawnSync('git', argv, { cwd: repoRoot, shell: false })` for:

```text
git rev-parse HEAD
git diff --binary --no-ext-diff HEAD --
git ls-files --others --exclude-standard -z
```

Hash raw tracked-diff bytes. Parse untracked paths from NUL framing, normalize repository-relative paths, remove only entries under explicit generated roots, sort remaining paths and hash `paths.join('\n') + '\n'`.

- [ ] **Step 4: Implement safe child execution and unsigned-candidate generation**

```js
const child = spawnSync(command.executable, command.argv, {
  cwd: repoRoot,
  shell: false,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  env: sanitizedEnvironment(process.env)
});
```

The runner records no environment values. It writes an unsigned candidate with `authenticity: null` and `receiptSha256: null`; `validateUnsignedCandidate` must pass, while every final verifier must reject it until detached authenticity is assembled.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/runner.test.js
```

```bash
git add shared/verification/workspaceEvidence.js shared/verification/commandSetRunner.js tools/verification/run-command-set.js tests/verification/runner.test.js tests/verification/fixtures/commands
git commit -m "feat(pvep): run immutable command sets on clean workspaces"
```

---

### Task 7: Detached Signature Assembly Without Key Custody

**Files:**
- Create: `tools/verification/assemble-signed-receipt.js`
- Create: `tests/verification/cli.test.js`

**Interfaces:**
- CLI consumes an unsigned candidate and detached raw Ed25519 signature file; it never consumes a private key.
- Produces a final receipt with `{ scheme:'ed25519', executorId, keyGeneration, signatureBase64 }`, computes `receiptSha256`, immediately re-verifies against the trusted registry, then writes output.

- [ ] **Step 1: Write failing CLI tests**

Generate ephemeral test keys; write only public key to a temporary test registry and detached signature bytes to a file. Reject private-key/key flags, missing/malformed signature, wrong executor/generation, signature over digest text rather than canonical payload bytes, and any output that fails immediate final verification.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/cli.test.js
git add tests/verification/cli.test.js
git commit -m "test(pvep): forbid repository signing-key custody"
```

- [ ] **Step 3: Implement detached assembly and immediate verification**

Read candidate, resolve executor, insert signature, recompute full receipt digest, call `verifySignedExecutorReceipt`, and write only after `pass === true`. Production CLI always uses checked-in registry; test code reaches the assembler function with an injected synthetic registry rather than exposing an arbitrary registry CLI option.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/cli.test.js
```

```bash
git add tools/verification/assemble-signed-receipt.js tests/verification/cli.test.js
git commit -m "feat(pvep): assemble verified detached-signature receipts"
```

---

### Task 8: GitHub Actions API-Bound Adapter

**Files:**
- Create: `shared/verification/githubActionsVerifier.js`
- Create: `tests/verification/github-actions-verifier.test.js`

**Interfaces:**
- Consumes injected client methods: `getWorkflowRun(runId)`, `getRunJobs(runId, attempt)`, `getArtifact(artifactId)`, optional `getArtifactBytes(artifactId)`.
- Produces: `verifyGitHubActionsReceipt({ receipt, expected, commandSetRegistry, client }) -> { pass, reasonCode, fact? }`.
- Core verifier never reads `GITHUB_TOKEN` and never directly performs network I/O.

- [ ] **Step 1: Write failing API-binding tests**

Cover receipt-success/API-failure disagreement, wrong Head/repository/workflow/run attempt, missing/failed jobs, missing artifact, artifact digest drift, unavailable client and complete successful API identity.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/github-actions-verifier.test.js
git add tests/verification/github-actions-verifier.test.js
git commit -m "test(pvep): require GitHub API-bound evidence identity"
```

- [ ] **Step 3: Implement verifier with no self-authentication**

Ignore receipt-only `success: true` as authority. Re-query injected API facts, verify exact workflow/run/job/artifact identity, then emit the same normalized fact shape used by signed-executor verification.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/github-actions-verifier.test.js
```

```bash
git add shared/verification/githubActionsVerifier.js tests/verification/github-actions-verifier.test.js
git commit -m "feat(pvep): verify GitHub evidence through API identity"
```

---

### Task 9: Trusted Adapter Dispatch and Requirement Aggregation

**Files:**
- Create: `shared/verification/trustedEvidencePolicy.js`
- Create: `shared/verification/requirementAggregator.js`
- Create: `tests/verification/requirement-aggregator.test.js`

**Interfaces:**
- Produces `verifyEvidenceReceipt({ receipt, expected, registries, adapters })`.
- Produces `aggregateRequirementSet({ requirements, facts, expectedBaseCommit, expectedHeadCommit }) -> { pass, reasonCode, matchedFacts? }`.
- Requirement exact fields: `{ gateId, platform, commandSetDigest }`.

- [ ] **Step 1: Write failing aggregation/equivalence tests**

Cover missing requirement, Linux/Windows mismatch, mixed Heads, duplicate receipt identity, command-set drift, trusted-source conflict, semantic equivalence of GitHub/signed facts and complete Linux+Windows GREEN.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/requirement-aggregator.test.js
git add tests/verification/requirement-aggregator.test.js
git commit -m "test(pvep): define multi-adapter requirement closure"
```

- [ ] **Step 3: Implement strict dispatch and aggregation**

```js
const ADAPTERS = Object.freeze(new Set(['github-actions-v1', 'signed-executor-v1']));
```

Unknown adapter returns `EVIDENCE_ADAPTER_UNTRUSTED`. Group by exact `(repository, workPackage, gateId, baseCommit, headCommit, platform, commandSetDigest)` and fail `EVIDENCE_TRUSTED_SOURCE_CONFLICT` rather than choosing a greener fact.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/requirement-aggregator.test.js
```

```bash
git add shared/verification/trustedEvidencePolicy.js shared/verification/requirementAggregator.js tests/verification/requirement-aggregator.test.js
git commit -m "feat(pvep): aggregate exact-SHA trusted verification facts"
```

---

### Task 10: Offline Verification CLIs and Adversarial Closure

**Files:**
- Create: `tools/verification/verify-receipt.js`
- Create: `tools/verification/verify-requirement-set.js`
- Create: `tests/verification/adversarial.test.js`
- Create: `docs/governance/PVEP_OPERATIONS.md`
- Modify: `package.json`
- Modify: `tools/verification/run-required-tests.js`

**Interfaces:**
- Concrete signed-executor example: `node tools/verification/verify-receipt.js --receipt .pvep-output/windows-signed.json --expected-base 1111111111111111111111111111111111111111 --expected-head 2222222222222222222222222222222222222222`.
- Concrete aggregation example: `node tools/verification/verify-requirement-set.js --manifest governance/verification/requirements/pvep-selftest-v1.json --receipts .pvep-output --expected-base 1111111111111111111111111111111111111111 --expected-head 2222222222222222222222222222222222222222`.
- Neither CLI exposes success override or arbitrary registry path.

- [ ] **Step 1: Write failing adversarial tests**

Mutate schema/repository/base/head/adapter/executor/generation/signature/platform/command set/commands/exit code/stdout/stderr/workspace/artifact/canonical digest/full receipt digest/duplicate identity/mixed Head/source conflict. Every mutation returns a specific approved reason code.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/adversarial.test.js
git add tests/verification/adversarial.test.js
git commit -m "test(pvep): close adversarial evidence mutations"
```

- [ ] **Step 3: Implement offline CLIs, self-test requirement manifest and npm scripts**

Create `governance/verification/requirements/pvep-selftest-v1.json` with exactly two requirements: one Linux requirement bound to the checked-in Linux command-set digest and one Windows requirement bound to the checked-in Windows digest. The manifest generator/verification test recomputes both digests and fails on drift.

Add exact scripts:

```json
"test:pvep": "node tools/verification/run-required-tests.js",
"verify:pvep:jcs": "node tools/verification/verify-jcs-dependency.js",
"verify:pvep": "npm run verify:pvep:jcs && npm run test:pvep"
```

- [ ] **Step 4: Write operations documentation**

Document exact base/head resolution, registered command-set execution, privilege-isolated detached signing, assembly/offline verification, Linux+Windows aggregation, and explicit non-authorities. State that OSS-A PR #67 cannot consume PVEP until a separate post-merge governance authorization/migration exists.

- [ ] **Step 5: Run full PVEP GREEN**

```bash
npm run verify:pvep
```

- [ ] **Step 6: Commit Task 10 GREEN**

```bash
git add tools/verification/verify-receipt.js tools/verification/verify-requirement-set.js tools/verification/run-required-tests.js tests/verification/adversarial.test.js docs/governance/PVEP_OPERATIONS.md governance/verification/requirements/pvep-selftest-v1.json package.json
git commit -m "feat(pvep): expose offline fail-closed verification tooling"
```

---

### Task 11: Cross-Platform Self-Evidence Without Production Executor Enrollment

**Files:**
- Test: all `tests/verification/*.test.js`
- Use: `governance/verification/command-sets/pvep-linux-selftest-v1.json`
- Use: `governance/verification/command-sets/pvep-windows-selftest-v1.json`
- No production registry mutation.

**Interfaces:**
- Demonstrates the same runner/candidate/verification protocol on both platforms.
- Does not create ACTIVE production executor evidence; unsigned outputs are portability evidence only.

- [ ] **Step 1: Run exact-Head Linux verification on a clean worktree**

```bash
npm ci
npm run verify:pvep
BASE_SHA="$(git merge-base origin/main HEAD)"
HEAD_SHA="$(git rev-parse HEAD)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
node tools/verification/run-command-set.js --command-set-id pvep-linux-selftest-v1 --base "$BASE_SHA" --head "$HEAD_SHA" --output .pvep-output/linux-unsigned.json
```

- [ ] **Step 2: Run exact-Head Windows verification on a clean worktree**

```powershell
npm ci
npm run verify:pvep
$head = (git rev-parse HEAD).Trim()
$base = (git merge-base origin/main HEAD).Trim()
if ((git status --porcelain=v1 --untracked-files=all)) { throw 'workspace must be clean' }
node tools/verification/run-command-set.js --command-set-id pvep-windows-selftest-v1 --base $base --head $head --output .pvep-output/windows-unsigned.json
```

- [ ] **Step 3: Verify no private/product-secret leakage**

```bash
npm run security:scan-staged
```

Inspect generated candidates: no environment dump, absolute path, token, credential, private key or business content.

- [ ] **Step 4: Make no empty evidence commit**

If a portability defect exists, invoke `superpowers:systematic-debugging`, add a new causal failing test, implement the root fix, rerun both platforms, then commit only the causal fix. If there is no source defect, leave the exact Head unchanged.

---

### Task 12: Regression Gate, Independent Review, and Implementation PR Handoff

**Files:**
- No new feature files expected.
- Update implementation PR body only after verification facts are known.

**Interfaces:**
- Produces the reviewable exact-Head implementation candidate.
- Does not merge the implementation PR and does not migrate OSS-A.

- [ ] **Step 1: Run concrete regression gates**

```bash
npm run test:wp0
npm run test:security-scan
npm run verify:pvep
```

Do not substitute a larger unrelated UAT suite merely to create a GREEN badge. Any failure in these required gates is diagnosed via `superpowers:systematic-debugging` and fixed causally.

- [ ] **Step 2: Freeze exact implementation Head and changed-path set**

```bash
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git rev-parse HEAD
git merge-base origin/main HEAD
git diff --name-only "$(git merge-base origin/main HEAD)"..HEAD | LC_ALL=C sort
```

Record exact Head/base, changed-file count, and SHA-256 of the sorted newline-framed path set in the PR body or governance evidence.

- [ ] **Step 3: Request independent code review bound to exact Head**

Use `superpowers:requesting-code-review`; review must cover canonicalization/vectors, schema ambiguity, Ed25519 preimage/generation, signer isolation, command injection/path traversal, NUL-safe Git workspace evidence, GitHub self-authentication avoidance, conflict semantics and absence of PR #67/OSS-A migration changes. P0/P1 must be zero.

- [ ] **Step 4: Verify implementation PR non-authorities**

PR body must state exactly:

```text
PR #67 modification authorized: false
OSS-A evidence-policy migration authorized: false
production executor enrollment authorized: false
merge/release/publish/promotion authorized by PVEP receipt: false
WP-B authorized: false
```

- [ ] **Step 5: Stop before merge and enrollment**

Invoke `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Present exact Head, test results, review state, changed paths and remaining production-executor enrollment work. Do not merge without explicit user approval.

---

## Post-Implementation Work Explicitly Outside This Plan

1. **Production executor enrollment PR(s):** add ACTIVE Linux/Windows public keys plus independently reviewed signer-isolation evidence and exact allowed command-set digests.
2. **OSS-A PVEP migration authorization:** only after PVEP implementation is merged to trusted main, authorize OSS-A source-merge policy to consume PVEP requirement facts.
3. **OSS-A policy migration PR:** failure test first; preserve gate count, platform requirements, exact SHA, independent review, source/path seals and explicit user final merge approval.
4. **Fresh PR #67 receipts:** after migration, produce new receipts for the then-current exact PR #67 Head; never retro-convert prior local runs.

## Plan Self-Review Result

- Spec coverage: approved design sections 5-19 map to Tasks 1-12; section 17 OSS-A migration remains outside this plan.
- Placeholder scan: no TBD/TODO/skip/fallback-success remains; CLI syntax uses concrete examples and runtime-resolved exact SHAs only where execution necessarily determines them.
- Type consistency: Task 1 JCS -> Task 2 candidate/final receipt -> Tasks 3-4 registries -> Tasks 5/8 adapter verification -> Task 9 aggregation -> Task 10 CLIs.
- Runner recursion check: `runner.test.js` injects fixture command sets into `commandSetRunner`; self-test command sets are never called from that test.
- Unsigned/final distinction: only candidates may contain `authenticity:null`/`receiptSha256:null`; all final verifiers reject them.
- Scope: no product authority, PR #67 mutation, OSS-A seal migration, production executor registration, release authority or WP-B implementation is included.
