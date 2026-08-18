# Yance ACV2 — Mandatory Open-Source Adoption Gate

- Status: `PROPOSED_FOR_USER_REVIEW`
- Applies first to: `WP-B`
- Reusable template for: `WP-C` through `WP-G`
- Machine-readable authority: `governance/architecture-closure-v2/wp-b-open-source-adoption-gate.json`
- Temporary bypass: prohibited
- Warning-only completion: prohibited

## Normative sequence

Every third-party project, package, source file, algorithm implementation, test fixture, protocol, schema, or substantial adapted code must pass the following sequence in order:

```text
候选项目
→ 精确版本和许可证审查
→ 依赖与安全扫描
→ 确定直接依赖 / 源码移植 / 仅参考
→ 先写言策 RED 合同
→ 引入原始模块
→ 通过上游测试
→ 增加言策 Adapter
→ 通过 Ubuntu、Windows、故障注入
→ 记录版权、NOTICE、SBOM 和源码来源
→ 独立复审
```

No step may be reordered, merged away, marked complete without exact evidence, or replaced by a verbal assertion.

## Step gates

### 1. Candidate project

Record the upstream repository, project purpose, target Yance capability, target work package, maintenance activity, release activity, and why the candidate is preferable to building from scratch.

A popular repository is not automatically an acceptable candidate. Abandoned, unmaintained, unverifiable, or operationally incompatible projects fail here.

### 2. Exact version and license review

Pin an exact package version or commit, plus package/tree digest. Record the SPDX license, license-text digest, file-level or directory-level exceptions, restricted or enterprise paths, redistribution duties, attribution duties, and modification-disclosure requirements.

Branch names such as `main`, `master`, `latest`, or floating semver ranges are not acceptable provenance.

### 3. Dependency and security scan

Inspect the complete dependency graph, install/build lifecycle scripts, known vulnerabilities, transitive licenses, runtime compatibility, Node/Electron compatibility, and Windows behavior.

Unresolved critical or high findings block adoption. A risk cannot be reclassified to warning only to pass the gate.

### 4. Adoption-mode decision

Select exactly one mode:

- `DIRECT_DEPENDENCY` — use the pinned upstream package behind a Yance Adapter;
- `SOURCE_TRANSPLANT` — import only reviewed files with file-level provenance and patch disclosure;
- `REFERENCE_ONLY` — copy no implementation; derive Yance design and tests from documented semantics.

The record must define allowed responsibilities, forbidden responsibilities, Yance authority boundary, upgrade plan, rollback/removal plan, and why the other two modes were rejected.

### 5. Yance RED contract first

Before third-party production code or package changes enter the branch, commit the smallest Yance tests that express the required capability and authority boundaries. Capture command, exit code, logs, and digest proving failure because the capability is absent.

A test written after the module is introduced does not satisfy this gate.

### 6. Introduce the original module

Introduce the exact pinned package or reviewed source files. Record lockfile identity or blob digests, upstream-to-Yance file mapping, excluded restricted paths, and all local patches.

Silent modification, copied snippets without provenance, and unregistered vendored files are prohibited.

### 7. Upstream tests pass

Run the relevant upstream test suite or the closest reproducible upstream verification supported by the pinned artifact. Record runtime, command, PASS, FAIL, SKIP, logs, and digest.

Unexplained skips and tests disabled to fit Yance block adoption.

### 8. Add the Yance Adapter

Third-party code must sit behind a Yance-owned Adapter or pure boundary. The Adapter must prevent the dependency from becoming a second database writer, scheduler authority, retry authority, receipt issuer, credential owner, evidence truth, or business clock.

Direct calls that bypass the Adapter are source-closure violations.

### 9. Ubuntu, Windows, and fault injection

Run focused and affected regression suites on Ubuntu and Windows. Execute the work-package-specific fault matrix, including crashes, stale ownership, restart, malformed input, unavailable dependency, timeout, cancellation, and corrupted or incompatible state where applicable.

Upstream success alone never substitutes for Yance platform validation.

### 10. Copyright, NOTICE, SBOM, and provenance

Record copyright holders, license files, NOTICE obligations, SBOM entry, exact source/version/commit, package or file digests, imported paths, modifications, patches, and excluded paths.

The final source and distribution package must contain every required license and NOTICE artifact.

### 11. Independent review

An independent reviewer verifies the exact reviewed Head, source provenance, license conclusion, dependency/security scan, Adapter boundary, RED-before-introduction evidence, upstream tests, Yance test matrix, fault evidence, NOTICE, and SBOM.

Closure requires zero blockers and zero unresolved high findings. Review of an earlier Head does not authorize a later dependency or source change.

## WP-B candidates

### XState

Current status: `CANDIDATE_ONLY`.

Proposed mode: `DIRECT_DEPENDENCY` for pure lifecycle definition and model-based transition testing only. It may not own database state, leases, generation, fencing, timestamps, retries, receipts, or external I/O.

No production introduction is authorized until Steps 1–5 are complete and bound to the exact branch Head.

### Temporal

Current status: `CANDIDATE_ONLY`.

Proposed mode: `REFERENCE_ONLY` for workflow history, activity attempts, heartbeat, cancellation, deadline, retry, deterministic recovery, stale-worker rejection, continue-as-new, and uncertain-outcome semantics.

Temporal Server is not introduced into the Electron/Node/SQLite runtime.

## Milestone binding

Milestone 1 must complete Steps 1–8 for every dependency or transplanted source used by the WP-B core. Milestone 2 must complete Step 9 for the migrated business flows. Milestone 3 must complete Steps 10–11 and verify that no unregistered third-party code exists anywhere in the WP-B diff.

A candidate added after Milestone 1 reopens the relevant RED, security, license, Adapter, cross-platform, provenance, and independent-review gates. It cannot be treated as a minor dependency update.

## Closure truth

WP-B cannot close unless the machine-readable gate proves:

```text
allStepsCompleteInOrder=true
allEvidenceBoundToExactHead=true
thirdPartyIntroducedWithoutRedCount=0
unregisteredThirdPartySourceCount=0
restrictedLicensePathCount=0
unresolvedCriticalOrHighCount=0
noticeOrSbomOmissionCount=0
independentReview=APPROVED
```

This gate reduces duplicated engineering while preserving Yance's single-authority architecture. Mature upstream code is reused where safe; upstream maturity never overrides Yance's database, process, receipt, security, and governance boundaries.
