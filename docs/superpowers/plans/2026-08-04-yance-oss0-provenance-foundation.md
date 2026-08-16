# Yance OSS-0 Provenance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, machine-enforced source provenance and license foundation that must pass before any copied, forked, patched, or sidecar open-source code can enter Yance.

**Architecture:** A canonical `third_party/provenance.json` registry records one approved upstream identity per integration, including a 40-character commit, license evidence, source paths, Yance paths, modification summary, obligations, and review evidence. A dependency-free CommonJS verifier validates the registry and the generated human-readable notice offline; a permanent GitHub Actions gate runs the verifier on every pull request. This slice changes no production runtime behavior and does not decide the final Yance umbrella license.

**Tech Stack:** Node.js 22.5+, CommonJS, `node:test`, `node:assert/strict`, GitHub Actions, JSON, Markdown.

## Global Constraints

- Do not modify `main` directly; implement on `oss/0-provenance-foundation` created from `plan/open-source-acceleration` exact Head.
- PR #17 remains frozen, Draft, unmerged, and receives no OSS-0 commits.
- No temporary bypass, warning-only closure, swallowed verifier errors, disabled workflow, or permissive fallback is allowed.
- Every copied, modified, forked, patched, or sidecar source integration must identify one upstream repository and one exact 40-character commit.
- A tag, npm version, branch name, short SHA, or URL without a full commit is not sufficient provenance.
- Every record must identify a license evidence file stored under `third_party/licenses/` and explicit distribution obligations.
- External source code may not directly write Yance canonical identity, contact, relationship, message, ledger, Outbox, retention, or audit authorities.
- This plan does not import Chatwoot, SillyTavern, TDLib, LiteLLM, Graphiti, Monica, or any other new runtime.
- Existing Electron startup, platform connectivity, AI replies, contacts, relationships, settings, and stored data must remain unchanged.
- Initial project-license status remains `UNRESOLVED`; actual copyleft source import is prohibited until a separate explicit Yance license decision is approved.

---

## File Structure

- Create `third_party/provenance.json`: canonical machine-readable registry and policy.
- Create `third_party/licenses/baileys-MIT.txt`: exact upstream license evidence for the first existing patched dependency record.
- Create `THIRD_PARTY_NOTICES.md`: deterministic human-readable projection of the registry.
- Create `tools/third-party/provenance.js`: parsing, validation, notice rendering, and filesystem checks.
- Create `tools/third-party/verify-provenance.js`: CLI entry point; exits non-zero on any defect.
- Create `tests/third-party/provenance.test.js`: positive and adversarial behavior contracts.
- Create `.github/workflows/oss-provenance.yml`: permanent Linux and Windows gate.
- Modify `package.json`: add `test:third-party` and `verify:third-party` scripts only; preserve all existing keys and dependency versions.

---

### Task 1: Establish the RED provenance contract

**Files:**
- Create: `tests/third-party/provenance.test.js`
- Test target not yet present: `tools/third-party/provenance.js`

**Interfaces:**
- Consumes: repository root path.
- Produces contract for `verifyRepository(repoRoot) -> { ok, errors, warnings, projects, notice }` and `renderNotice(registry) -> string`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  verifyRepository,
  validateRegistry,
  renderNotice
} = require('../../tools/third-party/provenance');

function makeRegistry(overrides = {}) {
  return {
    schemaVersion: 1,
    projectLicenseDecision: {
      status: 'UNRESOLVED',
      approvedSpdx: null
    },
    policy: {
      exactCommitRequired: true,
      approvedRecordRequired: true,
      allowedIntegrationModes: [
        'dependency',
        'patched_dependency',
        'sidecar',
        'controlled_fork',
        'source_port',
        'reference_only'
      ]
    },
    projects: [],
    ...overrides
  };
}

test('canonical repository provenance is valid and notice is deterministic', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const report = verifyRepository(repoRoot);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.deepEqual(report.errors, []);
  assert.equal(report.notice, renderNotice(report.registry));
});

test('registry rejects short SHA, missing license evidence, unapproved review, and traversal paths', () => {
  const invalid = makeRegistry({
    projects: [{
      id: 'invalid',
      name: 'Invalid',
      upstreamRepository: 'https://github.com/example/project',
      upstreamCommit: '8053b08',
      upstreamVersion: '1.0.0',
      integrationMode: 'source_port',
      license: { spdx: 'MIT', evidenceFile: '../LICENSE' },
      sourcePaths: ['src/index.js'],
      yancePaths: ['../backend/index.js'],
      modifications: ['copied'],
      obligations: ['retain notice'],
      review: { status: 'PENDING', reviewedAt: null, evidence: [] }
    }]
  });
  const errors = validateRegistry(invalid);
  assert.ok(errors.some(error => error.code === 'UPSTREAM_COMMIT_INVALID'));
  assert.ok(errors.some(error => error.code === 'LICENSE_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'YANCE_PATH_INVALID'));
  assert.ok(errors.some(error => error.code === 'REVIEW_NOT_APPROVED'));
});

test('notice ordering is stable regardless of project input order', () => {
  const project = id => ({
    id,
    name: id.toUpperCase(),
    upstreamRepository: `https://github.com/example/${id}`,
    upstreamCommit: '0123456789abcdef0123456789abcdef01234567',
    upstreamVersion: '1.0.0',
    integrationMode: 'reference_only',
    license: { spdx: 'MIT', evidenceFile: `third_party/licenses/${id}.txt` },
    sourcePaths: ['README.md'],
    yancePaths: [],
    modifications: ['No code imported.'],
    obligations: ['Retain attribution.'],
    review: {
      status: 'APPROVED',
      reviewedAt: '2026-08-04',
      evidence: ['manual-license-review']
    }
  });
  const first = renderNotice(makeRegistry({ projects: [project('zeta'), project('alpha')] }));
  const second = renderNotice(makeRegistry({ projects: [project('alpha'), project('zeta')] }));
  assert.equal(first, second);
  assert.ok(first.indexOf('ALPHA') < first.indexOf('ZETA'));
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test --test-concurrency=1 tests/third-party/provenance.test.js
```

Expected: FAIL with `Cannot find module '../../tools/third-party/provenance'`.

- [ ] **Step 3: Commit the RED contract**

```bash
git add tests/third-party/provenance.test.js
git commit -m "test(oss): define provenance foundation contracts"
```

---

### Task 2: Implement the registry validator and deterministic notice renderer

**Files:**
- Create: `tools/third-party/provenance.js`
- Create: `third_party/provenance.json`
- Create: `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Produces `validateRegistry(registry) -> Array<{ code, path, message }>`.
- Produces `renderNotice(registry) -> string`.
- Produces `verifyRepository(repoRoot) -> { ok, errors, warnings, projects, registry, notice }`.

- [ ] **Step 1: Implement the validator**

Implement `tools/third-party/provenance.js` with no external dependencies. Required exported API:

```js
module.exports = {
  loadRegistry,
  validateRegistry,
  renderNotice,
  verifyRepository,
  isSafeRepositoryPath
};
```

Required validation rules:

```js
const FULL_SHA = /^[0-9a-f]{40}$/u;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]*$/u;
const REVIEW_STATUSES = new Set(['APPROVED']);

function isSafeRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (path.isAbsolute(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  return !normalized.split('/').includes('..');
}
```

The validator must reject:

- unsupported `schemaVersion`;
- duplicate project IDs;
- non-HTTPS or non-GitHub upstream repository URLs;
- short or non-hex commits;
- integration modes outside the policy list;
- missing SPDX identifier;
- unsafe or missing license evidence path;
- empty `sourcePaths` for modes other than `dependency`;
- unsafe `sourcePaths` or `yancePaths`;
- empty modification summary;
- empty obligations;
- review status other than `APPROVED`;
- missing review date or review evidence.

`verifyRepository(repoRoot)` must additionally verify that every license evidence file and every listed Yance path exists, and that `THIRD_PARTY_NOTICES.md` exactly equals `renderNotice(registry)`.

- [ ] **Step 2: Add the empty canonical registry**

Create `third_party/provenance.json`:

```json
{
  "schemaVersion": 1,
  "projectLicenseDecision": {
    "status": "UNRESOLVED",
    "approvedSpdx": null
  },
  "policy": {
    "exactCommitRequired": true,
    "approvedRecordRequired": true,
    "allowedIntegrationModes": [
      "dependency",
      "patched_dependency",
      "sidecar",
      "controlled_fork",
      "source_port",
      "reference_only"
    ]
  },
  "projects": []
}
```

- [ ] **Step 3: Generate the initial notice from the registry**

The exact output for an empty registry must be:

```markdown
# Third-Party Notices

This file is generated from `third_party/provenance.json`.
Do not edit it manually.

Yance project license decision: **UNRESOLVED**

No third-party source integrations are registered.
```

- [ ] **Step 4: Run the focused test**

```bash
node --test --test-concurrency=1 tests/third-party/provenance.test.js
```

Expected: PASS, 3 tests, 0 failures.

- [ ] **Step 5: Commit the validator foundation**

```bash
git add tools/third-party/provenance.js third_party/provenance.json THIRD_PARTY_NOTICES.md tests/third-party/provenance.test.js
git commit -m "feat(oss): add deterministic provenance registry"
```

---

### Task 3: Register the existing Baileys patched dependency

**Files:**
- Create: `third_party/licenses/baileys-MIT.txt`
- Modify: `third_party/provenance.json`
- Regenerate: `THIRD_PARTY_NOTICES.md`
- Existing integration path: `scripts/dependencies/apply-baileys-profile-picture-token-fix.js`

**Interfaces:**
- Consumes Baileys release `v7.0.0-rc13` exact commit `8053b086ecc97ec3f78299561de11959bab05d39`.
- Produces one approved `patched_dependency` record.

- [ ] **Step 1: Add official MIT license evidence**

Copy the exact MIT license text from the official `WhiskeySockets/Baileys` repository at commit `8053b086ecc97ec3f78299561de11959bab05d39` into `third_party/licenses/baileys-MIT.txt`. Do not paraphrase or omit the copyright notice.

- [ ] **Step 2: Add the Baileys provenance record**

Append this project object to `projects`:

```json
{
  "id": "baileys-7.0.0-rc13",
  "name": "WhiskeySockets Baileys",
  "upstreamRepository": "https://github.com/WhiskeySockets/Baileys",
  "upstreamCommit": "8053b086ecc97ec3f78299561de11959bab05d39",
  "upstreamVersion": "7.0.0-rc13",
  "integrationMode": "patched_dependency",
  "license": {
    "spdx": "MIT",
    "evidenceFile": "third_party/licenses/baileys-MIT.txt"
  },
  "sourcePaths": [
    "package.json",
    "LICENSE"
  ],
  "yancePaths": [
    "scripts/dependencies/apply-baileys-profile-picture-token-fix.js"
  ],
  "modifications": [
    "Yance applies a deterministic postinstall compatibility patch to the installed Baileys package; the patch is maintained in Yance and does not replace the upstream package authority."
  ],
  "obligations": [
    "Retain the Baileys copyright and MIT permission notice in distributed copies or substantial portions.",
    "Preserve the upstream disclaimer that Baileys is unofficial and usage remains subject to WhatsApp terms and account risk."
  ],
  "review": {
    "status": "APPROVED",
    "reviewedAt": "2026-08-04",
    "evidence": [
      "official-release-v7.0.0-rc13",
      "official-license-at-8053b086ecc97ec3f78299561de11959bab05d39",
      "existing-yance-postinstall-patch"
    ]
  }
}
```

- [ ] **Step 3: Regenerate the notice with `renderNotice`**

Use a one-shot Node command:

```bash
node -e "const fs=require('node:fs');const path=require('node:path');const p=require('./tools/third-party/provenance');const r=p.loadRegistry(process.cwd());fs.writeFileSync(path.join(process.cwd(),'THIRD_PARTY_NOTICES.md'),p.renderNotice(r),'utf8')"
```

- [ ] **Step 4: Run the focused test**

```bash
node --test --test-concurrency=1 tests/third-party/provenance.test.js
```

Expected: PASS, 3 tests, 0 failures, and report contains one registered project.

- [ ] **Step 5: Commit the first real provenance record**

```bash
git add third_party/provenance.json third_party/licenses/baileys-MIT.txt THIRD_PARTY_NOTICES.md
git commit -m "docs(oss): register existing Baileys integration"
```

---

### Task 4: Add the strict verifier CLI and adversarial mutations

**Files:**
- Create: `tools/third-party/verify-provenance.js`
- Modify: `tests/third-party/provenance.test.js`

**Interfaces:**
- Produces CLI exit code `0` only when `verifyRepository(process.cwd()).ok === true`.
- Supports `--json` for machine-readable output; no bypass flags.

- [ ] **Step 1: Add failing CLI behavior tests**

Add tests that create temporary repositories and assert failures for:

- missing `third_party/provenance.json`;
- notice drift;
- missing license evidence;
- missing Yance path;
- duplicate project ID;
- short commit SHA;
- `PENDING` review;
- path traversal;
- unsupported integration mode.

Use `fs.mkdtempSync(path.join(os.tmpdir(), 'yance-provenance-'))` and spawn the CLI with `process.execPath`.

- [ ] **Step 2: Verify the new tests are RED**

```bash
node --test --test-concurrency=1 tests/third-party/provenance.test.js
```

Expected: FAIL because `tools/third-party/verify-provenance.js` does not exist.

- [ ] **Step 3: Implement the strict CLI**

```js
#!/usr/bin/env node
'use strict';

const { verifyRepository } = require('./provenance');

const json = process.argv.includes('--json');
const report = verifyRepository(process.cwd());

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else if (report.ok) {
  process.stdout.write(`OSS provenance verified: ${report.projects.length} project(s).\n`);
} else {
  for (const error of report.errors) {
    process.stderr.write(`[${error.code}] ${error.path}: ${error.message}\n`);
  }
}

process.exitCode = report.ok ? 0 : 1;
```

Do not add `--force`, `--warn-only`, `--skip-license`, or any other bypass.

- [ ] **Step 4: Run RED/GREEN verification**

```bash
node --test --test-concurrency=1 tests/third-party/provenance.test.js
node tools/third-party/verify-provenance.js
node tools/third-party/verify-provenance.js --json
```

Expected: all commands exit `0`; the JSON report has `ok: true`, `errors: []`, and one Baileys project.

- [ ] **Step 5: Commit CLI and mutation coverage**

```bash
git add tools/third-party/verify-provenance.js tests/third-party/provenance.test.js
git commit -m "feat(oss): enforce provenance with strict CLI"
```

---

### Task 5: Make provenance a permanent cross-platform gate

**Files:**
- Modify: `package.json`
- Create: `.github/workflows/oss-provenance.yml`

**Interfaces:**
- Produces npm scripts:
  - `test:third-party`: `node --test --test-concurrency=1 tests/third-party/provenance.test.js`
  - `verify:third-party`: `npm run test:third-party && node tools/third-party/verify-provenance.js`

- [ ] **Step 1: Modify `package.json` without reformatting unrelated content**

Add only:

```json
"test:third-party": "node --test --test-concurrency=1 tests/third-party/provenance.test.js",
"verify:third-party": "npm run test:third-party && node tools/third-party/verify-provenance.js"
```

Do not change dependency versions, `private`, engines, package manager, build, package, release, prepack, or prepublish controls.

- [ ] **Step 2: Add the permanent workflow**

Create `.github/workflows/oss-provenance.yml`:

```yaml
name: OSS Provenance

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

jobs:
  provenance:
    strategy:
      fail-fast: false
      matrix:
        os:
          - ubuntu-latest
          - windows-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22.5.0'
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run verify:third-party
```

The workflow must run on every pull request, not only when provenance files change, so imported code cannot bypass the gate by omitting registry updates.

- [ ] **Step 3: Run local verification**

```bash
npm run verify:third-party
node tools/third-party/verify-provenance.js --json
```

Expected: PASS with one approved Baileys project and zero errors.

- [ ] **Step 4: Run existing focused non-regression tests**

```bash
npm run test:root-cause-closure
npm run test:component-readability
npm run test:human-typing
```

Expected: all commands exit `0` with zero failures.

- [ ] **Step 5: Commit the permanent gate**

```bash
git add package.json .github/workflows/oss-provenance.yml
git commit -m "ci(oss): require provenance on Linux and Windows"
```

---

### Task 6: Final exact-branch verification and PR preparation

**Files:**
- No new production files.
- Update PR body only after commands pass.

- [ ] **Step 1: Review the exact diff**

```bash
git diff --check plan/open-source-acceleration...HEAD
git diff --stat plan/open-source-acceleration...HEAD
git status --short
```

Expected: no whitespace errors; only OSS-0 files and the two package scripts changed; clean working tree.

- [ ] **Step 2: Run the complete OSS-0 command set fresh**

```bash
npm run verify:third-party
npm run test:root-cause-closure
npm run test:component-readability
npm run test:human-typing
```

Expected: every command exits `0` with zero test failures.

- [ ] **Step 3: Verify branch isolation**

```bash
git merge-base --is-ancestor plan/open-source-acceleration HEAD
git log --oneline --decorate plan/open-source-acceleration..HEAD
```

Expected: first command exits `0`; log contains only OSS-0 commits.

- [ ] **Step 4: Open a Draft stacked PR**

Base: `plan/open-source-acceleration`  
Head: `oss/0-provenance-foundation`  
Title: `[Draft][OSS-0] Enforce third-party source provenance and licenses`

The PR body must state:

```text
runtimeBehaviorChanged=false
productionUseAuthorized=false
mergeIntoMainAuthorized=false
warningOnlyClosureAllowed=false
temporaryBypassAllowed=false
```

It must also list the exact Baileys upstream commit and all executed verification commands.

- [ ] **Step 5: Do not merge or mark ready**

Keep the PR Draft until independent review confirms schema strictness, path traversal rejection, exact commit enforcement, notice determinism, Linux/Windows CI, and absence of bypass flags.
