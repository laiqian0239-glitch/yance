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
- `shared/verification/canonicalEvidenceReceipt.js` — strict receipt schema, payload digest, receipt digest, path/time/number checks.
- `shared/verification/commandSetRegistry.js` — strict command-set loading, schema checks, digest calculation.
- `shared/verification/executorRegistry.js` — trusted executor registry validation, status/generation/platform/isolation checks.
- `shared/verification/signedExecutorVerifier.js` — Ed25519 authenticity verification and normalized fact creation.
- `shared/verification/githubActionsVerifier.js` — GitHub API-bound identity verification through an injected client.
- `shared/verification/trustedEvidencePolicy.js` — adapter dispatch and normalized fact construction.
- `shared/verification/requirementAggregator.js` — complete requirement-set matching, deduplication and conflict fail-closed.
- `shared/verification/workspaceEvidence.js` — deterministic Git/workspace/path-set evidence helpers used by the runner.

### Governance data

- `governance/verification/trusted-executors.json` — schema-valid registry with no ACTIVE production executor in the implementation PR.
- `governance/verification/command-sets/pvep-linux-selftest-v1.json` — Linux self-verification command set.
- `governance/verification/command-sets/pvep-windows-selftest-v1.json` — Windows self-verification command set.
- `governance/verification/third-party/canonicalize-2.1.0.json` — exact dependency provenance derived from the lock file and upstream package metadata.

### Tools

- `tools/verification/run-command-set.js` — safe direct-argv runner that emits an unsigned receipt.
- `tools/verification/assemble-signed-receipt.js` — combines an unsigned receipt and detached signature, verifies it, then writes the final signed receipt.
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

Run:

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

Run:

```bash
npm install --save-dev --save-exact canonicalize@2.1.0
```

Then confirm `package.json` contains exactly:

```json
"canonicalize": "2.1.0"
```

and `package-lock.json` records `node_modules/canonicalize` version `2.1.0`, an npm registry resolved tarball, an `sha512-...` integrity value, and Apache-2.0 metadata.

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

`tools/verification/verify-jcs-dependency.js` must read `package.json` and `package-lock.json`, require exact `canonicalize === "2.1.0"`, require the lock entry version `2.1.0`, require an `https://registry.npmjs.org/canonicalize/-/canonicalize-2.1.0.tgz` resolved URL, require `sha512-` integrity, and require checked-in provenance metadata to match package/version/license/source/tag/lock integrity.

`governance/verification/third-party/canonicalize-2.1.0.json` must contain:

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

Expected: all PASS; npm reports exactly `canonicalize@2.1.0`.

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
- Produces: `validateReceiptShape(receipt)`, `canonicalPayloadBytes(receipt)`, `computeCanonicalPayloadSha256(receipt)`, `computeReceiptSha256(receipt)`, `verifyReceiptDigests(receipt)`.
- Produces reason codes including `EVIDENCE_SCHEMA_INVALID`, `EVIDENCE_CANONICAL_DIGEST_MISMATCH`, `EVIDENCE_RECEIPT_DIGEST_MISMATCH`, `EVIDENCE_BASE_MISMATCH`, `EVIDENCE_HEAD_MISMATCH`.

- [ ] **Step 1: Write failing tests for strict schema and digest separation**

Use a complete fixture with all required v1 top-level fields and assert:

```js
assert.equal(validateReceiptShape(receipt).pass, true);
assert.equal(computeCanonicalPayloadSha256(receipt), receipt.canonicalPayloadSha256);
assert.equal(computeReceiptSha256(receipt), receipt.receiptSha256);

const unknown = structuredClone(receipt);
unknown.unrecognized = true;
assert.equal(validateReceiptShape(unknown).reasonCode, 'EVIDENCE_SCHEMA_INVALID');

const tampered = structuredClone(receipt);
tampered.headCommit = 'f'.repeat(40);
assert.equal(verifyReceiptDigests(tampered).reasonCode, 'EVIDENCE_CANONICAL_DIGEST_MISMATCH');
```

Also cover invalid absolute/parent/backslash/control-character artifact paths, unsafe integers, non-UTC timestamps, duplicate command IDs, and `baseCommit`/`headCommit` values that are not lowercase 40-hex SHAs.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/canonical-evidence-receipt.test.js
git add tests/verification/canonical-evidence-receipt.test.js
git commit -m "test(pvep): define canonical receipt failure boundaries"
```

Expected test status before commit: FAIL because receipt modules do not exist.

- [ ] **Step 3: Implement frozen reason codes and schema helpers**

`reasonCodes.js` exports a frozen object containing every reason code from the approved spec, with no generic policy result such as `UNKNOWN_ERROR`.

`canonicalEvidenceReceipt.js` must declare the exact top-level key set:

```js
const TOP_LEVEL_KEYS = Object.freeze([
  'schemaVersion', 'recordType', 'repository', 'workPackage', 'gateId',
  'baseCommit', 'headCommit', 'adapterType', 'producer', 'commandSet',
  'execution', 'workspace', 'results', 'artifacts',
  'canonicalPayloadSha256', 'authenticity', 'receiptSha256'
]);
```

`canonicalPayloadBytes(receipt)` removes only `canonicalPayloadSha256`, `authenticity`, and `receiptSha256` before JCS. `computeReceiptSha256(receipt)` removes only `receiptSha256` before JCS.

- [ ] **Step 4: Run GREEN and mutation-style digest tests**

```bash
node --test --test-concurrency=1 tests/verification/canonical-evidence-receipt.test.js
```

Add a loop that mutates each security field one at a time and asserts either canonical-payload digest or full-receipt digest verification fails.

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

Assert a valid registry file receives a stable SHA-256 JCS digest and reject command sets containing any of:

```js
{ command: 'node --test tests/verification/*.test.js' }
{ executable: 'sh', argv: ['-c', 'node test.js'] }
{ executable: 'cmd.exe', argv: ['/c', 'node test.js'] }
{ executable: 'powershell.exe', argv: ['-Command', '...'] }
```

Reject duplicate command IDs, platform mismatch, `..` paths, wildcard argv that depend on shell expansion, generated roots that are `.` or overlap protected roots such as `shared/`, `backend/`, `electron/`, `tests/`, `tools/`, or `governance/`.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/command-set-registry.test.js
git add tests/verification/command-set-registry.test.js
git commit -m "test(pvep): define immutable command-set contract"
```

- [ ] **Step 3: Implement deterministic registry loading**

Only load `governance/verification/command-sets/<commandSetId>.json` after validating `commandSetId` against `/^[a-z0-9][a-z0-9-]{2,63}$/u`. Never accept an arbitrary filesystem path from the receipt.

- [ ] **Step 4: Add platform self-test command sets**

Both files invoke exactly one direct command:

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

The Windows file is identical except `commandSetId` is `pvep-windows-selftest-v1` and `platform` is `windows`.

`run-required-tests.js` owns a literal array of every PVEP test file; it invokes Node directly once per file with `spawnSync(process.execPath, ['--test', '--test-concurrency=1', file], { shell: false })`. No directory glob is delegated to a shell.

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
- `signerIsolation` requires `{ status: 'VERIFIED', runnerPrincipal, signerPrincipal, keyCustody, evidenceSha256 }` and runner/signer principals must differ.

- [ ] **Step 1: Write failing registry/revocation tests**

Generate an ephemeral Ed25519 public key in test setup and assert:

- ACTIVE + exact generation/platform/command digest + VERIFIED isolation resolves;
- unknown executor -> `EVIDENCE_EXECUTOR_UNKNOWN`;
- REVOKED -> `EVIDENCE_EXECUTOR_REVOKED` even when receipt time predates `revokedAt`;
- generation mismatch -> `EVIDENCE_KEY_GENERATION_INVALID`;
- platform mismatch -> `EVIDENCE_PLATFORM_MISMATCH`;
- same runner/signer principal or missing evidence digest -> `EVIDENCE_SIGNER_ISOLATION_INVALID`;
- keyAlgorithm other than Ed25519 -> schema failure.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/executor-registry.test.js
git add tests/verification/executor-registry.test.js
git commit -m "test(pvep): define executor trust lifecycle"
```

- [ ] **Step 3: Implement fail-closed registry validation**

Production `trusted-executors.json` starts as:

```json
{
  "schemaVersion": 1,
  "executors": []
}
```

This is intentional: software implementation does not self-authorize a production executor. A later enrollment PR adds a public key only after platform-specific privilege-isolation evidence is independently reviewed.

- [ ] **Step 4: Write exact enrollment rules**

`PVEP_EXECUTOR_ENROLLMENT.md` must require:

1. dedicated runner principal and distinct signer principal/service;
2. signing key in OS keystore, privileged service, HSM, or equivalent custody inaccessible to the runner principal;
3. no private key bytes/path material in repository/config/env/argv/log/artifact;
4. recorded platform/architecture/public key/generation;
5. a SHA-256 identity for privilege/ACL/service configuration evidence;
6. allowed command-set digests resolved from checked-in registry files;
7. independent governance PR and review for ACTIVE enrollment;
8. generation increment for key replacement; REVOKED entries are never reused.

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
- Consumes: canonical payload bytes/digests, executor registry, command-set registry.
- Produces: `verifySignedExecutorReceipt({ receipt, expected, executorRegistry, commandSetRegistry }) -> { pass, reasonCode, fact? }`.
- Normalized fact exact fields: `repository`, `workPackage`, `gateId`, `baseCommit`, `headCommit`, `platform`, `commandSetId`, `commandSetDigest`, `verificationStatus`, `adapterType`, `receiptSha256`, `producerIdentity`.

- [ ] **Step 1: Write failing Ed25519 positive/negative tests**

Use Node `crypto.generateKeyPairSync('ed25519')` only inside tests. Sign `canonicalPayloadBytes(receipt)` with `crypto.sign(null, bytes, privateKey)` and assert valid verification. Then mutate individually:

- signature byte;
- command argv digest;
- command exit code;
- artifact digest;
- platform;
- base/head;
- key generation;
- executor ID.

Expected reason codes include `EVIDENCE_SIGNATURE_INVALID`, `EVIDENCE_COMMAND_FAILED`, `EVIDENCE_ARTIFACT_DIGEST_MISMATCH`, `EVIDENCE_PLATFORM_MISMATCH`, `EVIDENCE_BASE_MISMATCH`, `EVIDENCE_HEAD_MISMATCH`.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/signed-executor-verifier.test.js
git add tests/verification/signed-executor-verifier.test.js tests/verification/fixtures/receiptFactory.js
git commit -m "test(pvep): define signed executor authenticity contract"
```

- [ ] **Step 3: Implement cryptographic and policy verification**

Core signature check:

```js
const verified = crypto.verify(
  null,
  canonicalPayloadBytes(receipt),
  executor.publicKeyPem,
  Buffer.from(receipt.authenticity.signatureBase64, 'base64')
);
if (!verified) return fail('EVIDENCE_SIGNATURE_INVALID');
```

Never sign or verify the hex digest string. Validate receipt digests before signature verification, resolve the exact command set and executor, recompute every command success from `exitCode === expectedExitCode`, and emit `VERIFIED_PASS` only when all checks pass.

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
- Create: `tools/verification/run-command-set.js`
- Create: `tests/verification/runner.test.js`
- Create: `tests/verification/fixtures/commands/pass.js`
- Create: `tests/verification/fixtures/commands/fail.js`
- Create: `tests/verification/fixtures/commands/write-artifact.js`

**Interfaces:**
- Produces `captureWorkspaceEvidence({ repoRoot, allowedGeneratedRoots })`.
- Runner CLI: `node tools/verification/run-command-set.js --command-set-id <registered-id> --base <40hex> --head <40hex> --output <repo-relative-json>`.
- The only user-selectable execution identity is a registered command-set ID; there is no `--command`, `--shell`, or arbitrary command file path.

- [ ] **Step 1: Write failing runner tests**

Create temporary Git repositories in test setup and assert:

- exact `HEAD` mismatch fails before execution;
- tracked pre-diff fails `EVIDENCE_WORKSPACE_DIRTY`;
- unexpected untracked path fails;
- allowed generated root is excluded from unexpected set but still recorded in `allowedGeneratedRootSetSha256`;
- a passing child records stdout/stderr SHA-256, exit code, timestamps and argv digest;
- a failing child records non-zero exit and the receipt cannot become GREEN;
- artifact path/digest/size are recorded;
- post-run tracked mutation fails even if command exit code is zero;
- CLI rejects unknown flags and has no arbitrary command option.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/runner.test.js
git add tests/verification/runner.test.js tests/verification/fixtures/commands
git commit -m "test(pvep): define clean safe command execution"
```

- [ ] **Step 3: Implement deterministic Git/workspace evidence**

Use `spawnSync('git', [...], { cwd: repoRoot, shell: false, encoding: 'utf8' })` only with literal argv. Required commands:

```text
git rev-parse HEAD
git diff --binary --no-ext-diff HEAD --
git ls-files --others --exclude-standard -z
```

Hash the raw tracked-diff bytes. Parse untracked paths from NUL framing, normalize repository-relative paths, remove only entries under explicitly allowed generated roots, sort remaining paths, and hash `paths.join('\n') + '\n'`.

- [ ] **Step 4: Implement safe child execution and unsigned receipt generation**

For each registered command:

```js
const child = spawnSync(command.executable, command.argv, {
  cwd: repoRoot,
  shell: false,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
  env: sanitizedEnvironment(process.env)
});
```

`sanitizedEnvironment` must remove known secret-bearing variables from child evidence metadata; the receipt records no environment values. The runner writes only the unsigned receipt where `authenticity` is `{ scheme: 'detached-ed25519-pending' }` and does not claim `VERIFIED_PASS`.

- [ ] **Step 5: Run GREEN and commit**

```bash
node --test --test-concurrency=1 tests/verification/runner.test.js
```

```bash
git add shared/verification/workspaceEvidence.js tools/verification/run-command-set.js tests/verification/runner.test.js tests/verification/fixtures/commands
git commit -m "feat(pvep): run immutable command sets on clean workspaces"
```

---

### Task 7: Detached Signature Assembly Without Key Custody

**Files:**
- Create: `tools/verification/assemble-signed-receipt.js`
- Create: `tests/verification/cli.test.js`

**Interfaces:**
- CLI consumes an unsigned receipt file and a detached raw Ed25519 signature file; it never consumes a private key.
- Produces a final receipt whose `authenticity` is `{ scheme:'ed25519', executorId, keyGeneration, signatureBase64 }`, then computes `receiptSha256` and immediately re-verifies the result against the trusted registry before writing output.

- [ ] **Step 1: Write failing CLI tests**

Generate ephemeral keys inside the test process, write only the public key to a temporary test registry, write a detached signature file, and assert successful assembly. Assert the CLI rejects:

- `--private-key`, `--key`, or unknown key-like flags;
- missing signature file;
- malformed base64/raw signature;
- wrong executor/generation;
- signature over a digest string instead of canonical payload bytes;
- any output receipt that fails immediate re-verification.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/cli.test.js
git add tests/verification/cli.test.js
git commit -m "test(pvep): forbid repository signing-key custody"
```

- [ ] **Step 3: Implement detached assembly and immediate verification**

The tool reads the unsigned receipt, resolves the trusted executor, inserts the detached signature, recomputes `receiptSha256`, calls `verifySignedExecutorReceipt`, and writes only after `pass === true`. It never imports a private key API.

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
- Consumes injected client methods: `getWorkflowRun(runId)`, `getRunJobs(runId, attempt)`, `getArtifact(artifactId)` and optional `getArtifactBytes(artifactId)`.
- Produces: `verifyGitHubActionsReceipt({ receipt, expected, commandSetRegistry, client }) -> { pass, reasonCode, fact? }`.
- Core verifier never reads `GITHUB_TOKEN` and never directly performs network I/O.

- [ ] **Step 1: Write failing API-binding tests**

Fake client scenarios must cover:

- receipt says success but API conclusion is failure;
- API run head SHA differs;
- repository differs;
- workflow ID/path differs;
- run attempt differs;
- required job ID missing;
- job conclusion not success;
- artifact ID missing;
- downloaded artifact digest differs;
- client throws/unavailable;
- complete API identity produces `VERIFIED_PASS`.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/github-actions-verifier.test.js
git add tests/verification/github-actions-verifier.test.js
git commit -m "test(pvep): require GitHub API-bound evidence identity"
```

- [ ] **Step 3: Implement verifier with no self-authentication**

The verifier must ignore any receipt-only `success: true` as authority. It verifies API facts, then recomputes command-set/result requirements and emits the same normalized fact shape used by the signed-executor verifier.

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

- [ ] **Step 1: Write failing aggregation and adapter-equivalence tests**

Cover:

- missing one requirement -> `EVIDENCE_REQUIREMENT_SET_INCOMPLETE`;
- Linux fact for Windows requirement -> `EVIDENCE_PLATFORM_MISMATCH`;
- mixed Heads -> `EVIDENCE_MIXED_HEADS`;
- duplicate receipt SHA does not count twice;
- command-set digest drift is rejected;
- two trusted facts for same gate/head/command set with contradictory verification outcome -> `EVIDENCE_TRUSTED_SOURCE_CONFLICT`;
- valid GitHub and signed-executor facts for the same gate differ only in `adapterType`, `receiptSha256`, and `producerIdentity`;
- complete Linux + Windows requirement set passes.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/requirement-aggregator.test.js
git add tests/verification/requirement-aggregator.test.js
git commit -m "test(pvep): define multi-adapter requirement closure"
```

- [ ] **Step 3: Implement strict dispatch and aggregation**

Allowed adapter types are exactly:

```js
const ADAPTERS = Object.freeze(new Set(['github-actions-v1', 'signed-executor-v1']));
```

Unknown adapter -> `EVIDENCE_ADAPTER_UNTRUSTED`. Aggregation groups by exact `(repository, workPackage, gateId, baseCommit, headCommit, platform, commandSetDigest)` and never chooses the greener of conflicting trusted facts.

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
- `verify-receipt.js --receipt <repo-relative-file> --expected-base <sha> --expected-head <sha>` verifies `signed-executor-v1` fully offline using checked-in registries.
- `verify-requirement-set.js --manifest <repo-relative-json> --receipts <repo-relative-directory> --expected-base <sha> --expected-head <sha>` aggregates already-verifiable receipt files.
- Neither CLI has a success override or arbitrary registry path.

- [ ] **Step 1: Write failing adversarial tests**

Create a table-driven mutation suite that starts from a valid synthetic signed receipt and mutates every one of these classes:

```text
schema / repository / base / head / adapter / executor / generation / signature
platform / command-set identity / command list / exit code / stdout digest / stderr digest
workspace pre/post head / tracked diff / untracked set / artifact path / artifact digest
canonical payload digest / full receipt digest / duplicate receipt / mixed head / source conflict
```

Every mutation must fail with a specific PVEP reason code; no test accepts a generic error as the policy result.

- [ ] **Step 2: Run and commit causal RED**

```bash
node --test --test-concurrency=1 tests/verification/adversarial.test.js
git add tests/verification/adversarial.test.js
git commit -m "test(pvep): close adversarial evidence mutations"
```

- [ ] **Step 3: Implement offline CLIs and explicit npm scripts**

Add exact scripts:

```json
"test:pvep": "node tools/verification/run-required-tests.js",
"verify:pvep:jcs": "node tools/verification/verify-jcs-dependency.js",
"verify:pvep": "npm run verify:pvep:jcs && npm run test:pvep"
```

Update `run-required-tests.js` to include every PVEP test file explicitly in a frozen ordered array.

- [ ] **Step 4: Write operations documentation**

`PVEP_OPERATIONS.md` must state:

- how to resolve exact base/head before execution;
- how to run a registered command set;
- how a privilege-isolated signer receives only canonical payload bytes and returns a detached signature;
- how to assemble and offline-verify a receipt;
- how to aggregate Linux + Windows requirements;
- that a PVEP receipt is evidence only and does not authorize merge/release/publish/promotion/WP-B;
- that OSS-A PR #67 cannot consume PVEP until a separate post-merge governance migration explicitly authorizes it.

- [ ] **Step 5: Run full PVEP GREEN**

```bash
npm run verify:pvep
```

Expected: all PVEP tests and dependency checks PASS.

- [ ] **Step 6: Commit Task 10 GREEN**

```bash
git add tools/verification/verify-receipt.js tools/verification/verify-requirement-set.js tools/verification/run-required-tests.js tests/verification/adversarial.test.js docs/governance/PVEP_OPERATIONS.md package.json
git commit -m "feat(pvep): expose offline fail-closed verification tooling"
```

---

### Task 11: Cross-Platform Self-Evidence Without Production Executor Enrollment

**Files:**
- Test: all `tests/verification/*.test.js`
- Use: `governance/verification/command-sets/pvep-linux-selftest-v1.json`
- Use: `governance/verification/command-sets/pvep-windows-selftest-v1.json`
- No production registry mutation in this task.

**Interfaces:**
- Demonstrates that the same runner/receipt/verifier protocol functions on both Linux and Windows.
- Does not create an ACTIVE production executor; ephemeral test keys remain test-only.

- [ ] **Step 1: Run exact-Head Linux verification on a clean checkout/worktree**

Resolve:

```bash
git rev-parse HEAD
git merge-base origin/main HEAD
git status --porcelain=v1 --untracked-files=all
```

Require clean status. Run:

```bash
npm ci
npm run verify:pvep
node tools/verification/run-command-set.js --command-set-id pvep-linux-selftest-v1 --base "$(git merge-base origin/main HEAD)" --head "$(git rev-parse HEAD)" --output .pvep-output/linux-unsigned.json
```

Do not treat the unsigned file as trusted evidence; it proves runner portability only.

- [ ] **Step 2: Run exact-Head Windows verification on a clean checkout/worktree**

In PowerShell, resolve exact SHAs with fixed Git commands and run:

```powershell
npm ci
npm run verify:pvep
$head = (git rev-parse HEAD).Trim()
$base = (git merge-base origin/main HEAD).Trim()
node tools/verification/run-command-set.js --command-set-id pvep-windows-selftest-v1 --base $base --head $head --output .pvep-output/windows-unsigned.json
```

Again, unsigned output is portability evidence, not merge authority.

- [ ] **Step 3: Verify no product/private-key leakage**

Run repository secret scanning and inspect generated receipts to confirm there is no environment dump, absolute path, token, credential, private key, or business content.

```bash
npm run security:scan-staged
```

- [ ] **Step 4: Commit only if a portability defect required a causal source fix**

If no source change is required, make no empty commit. If a real defect is found, follow systematic-debugging + a new failing test before the fix, then rerun both platforms.

---

### Task 12: Regression Gate, Independent Review, and Implementation PR Handoff

**Files:**
- No new feature files expected.
- Update implementation PR body only after verification facts are known.

**Interfaces:**
- Produces the reviewable exact-Head implementation candidate.
- Does not merge the implementation PR and does not migrate OSS-A.

- [ ] **Step 1: Run baseline governance regressions**

```bash
npm run test:wp0
npm run test:security-scan
npm run verify:pvep
```

If `npm run verify:all` is executable in the clean environment without requiring external product/UAT state, run it too; any real failure is diagnosed via `superpowers:systematic-debugging`, never bypassed.

- [ ] **Step 2: Freeze exact implementation Head and changed-path set**

```bash
git status --porcelain=v1 --untracked-files=all
git rev-parse HEAD
git merge-base origin/main HEAD
git diff --name-only "$(git merge-base origin/main HEAD)"..HEAD | LC_ALL=C sort
```

Require clean status. Record exact Head, base, changed-file count, and SHA-256 of the NUL-safe/sorted changed-path set in the PR body or attached governance evidence.

- [ ] **Step 3: Request independent code review bound to the exact Head**

Use `superpowers:requesting-code-review` and require review scope to cover:

- canonicalization correctness and vectors;
- schema ambiguity/unknown-field behavior;
- Ed25519 preimage and key-generation rules;
- signer-isolation trust boundary;
- command injection and path traversal;
- Git workspace evidence and NUL-safe paths;
- GitHub self-authentication avoidance;
- requirement conflict semantics;
- absence of PR #67 / OSS-A migration changes.

P0/P1 must be zero before the implementation candidate is considered review-complete.

- [ ] **Step 4: Verify implementation PR scope**

The implementation PR must explicitly state:

```text
PR #67 modification authorized: false
OSS-A evidence-policy migration authorized: false
production executor enrollment authorized: false
merge/release/publish/promotion authorized by PVEP receipt: false
WP-B authorized: false
```

- [ ] **Step 5: Stop before merge and before executor enrollment**

At this point invoke `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Present exact Head, tests, review state, changed paths, and any remaining external platform/enrollment work. Do not merge the implementation PR without explicit user approval.

---

## Post-Implementation Work Explicitly Outside This Plan

The following are separate governance changes and must not be folded into the PVEP implementation PR:

1. **Production executor enrollment PR(s):** add an ACTIVE Linux and/or Windows executor public key plus independently reviewed signer-isolation evidence and exact allowed command-set digests.
2. **OSS-A PVEP migration authorization:** only after PVEP implementation is merged to trusted main, create a dedicated authorization that permits the OSS-A source-merge policy to consume PVEP requirement facts.
3. **OSS-A policy migration PR:** failure test first, preserving the original gate count, Linux/Windows requirements, exact SHA, independent review, source/path seals, and explicit user final merge approval.
4. **Fresh PR #67 receipts:** after migration, produce new receipts for the then-current exact PR #67 Head; never retro-convert prior local runs into trusted receipts.

## Plan Self-Review Result

- Spec coverage: all approved design sections 5-19 map to Tasks 1-12; OSS-A migration remains explicitly outside this plan as required by section 17.
- Placeholder scan: no `TBD`, `TODO`, skip switch, fallback success, or unspecified implementation branch remains.
- Type/interface consistency: canonical bytes/digests flow from Task 1 -> receipt Task 2 -> registries Tasks 3-4 -> adapter verification Tasks 5/8 -> dispatch/aggregation Task 9 -> CLIs Task 10.
- Scope: one verification subsystem only; no product authority, PR #67 change, final-candidate seal change, release authority, or WP-B implementation is included.
