# WP7 Implementation Plan V1 — Design Gate Revision Candidate

生成时间：`2026-07-05T10:12:44Z`

## 1. 身份与决定边界

```text
WP7 Activation identity binding commit:
4ac6d2185bed28823210849704f3850cd875b5fb

WP7 Activation binding source tree:
d7f64dbf602ded1075978c13bea8449d7ef7e5e2
```

正式Activation决定：`WP7_ACTIVATION_ACCEPTED`。

当前仅请求独立审核`WP7_DESIGN_GATE_CONFIRMED`，本候选不自行签发，不授权生产实现。

## 2. 三项阻断闭合

| 阻断 | 闭合文件 |
| --- | --- |
| WP7_ACCEPTANCE_CHECK_ID_MAPPING_MISSING | WP7_ACCEPTANCE_CHECK_MAPPING.json |
| WP7_REQUIRED_TEST_PHASE_CONTRADICTION | WP7_REQUIRED_TEST_PHASE_MODEL.json |
| WP7_WORKSTREAM_TRACEABILITY_INCOMPLETE | WP7_WORKSTREAM_TRACEABILITY.json |


## 3. WP7范围

### In scope
- Create the protected real final-build and installer pipeline only after separate WP7 activation acceptance.
- Freeze one WP7 implementation commit and source tree for Convergence Pre-Review.
- Build the application payload from a unique empty staging directory.
- Recompute payload-files.json, applicationPayloadSha256, payloadFilesSha256, release-manifest.json and release-manifest.sha256.
- Build one sealed Windows installer and calculate installer SHA256 before installation.
- Reject reuse of WP1 PIPELINE_TEST_ONLY artifacts, prior test installers, old staging outputs or development evidence.
- Perform designated-machine CLEAN_INSTALL validation and all ten Phase 1 checks.
- Regenerate final evidence only from the final installer.
- Package the complete 言策29 project source tree and complete Git history required by the accepted delivery model, not only WP7 changed files.
- Carry inherited risk acceptances exactly by ID and limitation.

### Out of scope
- Commercial Authenticode/code-signing acceptance
- Manifest digital signature acceptance
- Automatic update acceptance
- Upgrade/delta package acceptance
- Legacy test data migration
- Rollback to any legacy test version
- Microsoft Store or public-download reputation
- Enterprise/multi-user deployment
- Complete restoration of all deferred business features

## 4. 正式安装策略

```text
FINAL_INSTALLATION_MODE: CLEAN_INSTALL
LEGACY_TEST_DATA_MIGRATION_REQUIRED: false
LEGACY_TEST_VERSION_ROLLBACK_REQUIRED: false
```

## 5. 风险继承

- `WP2-API-SESSION-LEAK-SCANNER-COVERAGE-EXCEPTION`，不得扩大解释范围
- `WP3-WINDOWS-NAMED-MUTEX-VALIDATION-EXCEPTION`，不得扩大解释范围
- `WP4_WINDOWS_EVIDENCE_PASS_COMPLETENESS_EXCEPTION`，不得扩大解释范围
- `WP5_FINAL_PACKAGING_HANDOFF_STATUS_INCONSISTENCY_ACCEPTED`，不得扩大解释范围

## 6. A01-A10阶段级验收映射

| ID | 正式要求 | Tests | Evidence | PASS oracle | FAIL reason | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | After CLEAN_INSTALL, the final installed application starts, stops cleanly and starts again from the same sealed installer without legacy migration or rollback. | clean-install-start-stop-restart.test | evidence/wp7/clean-install.json, evidence/wp7/restart-cycle.json | Install status PASS; first start reaches local_ready; controlled stop confirms owner exit; restart reaches local_ready; installerSha256 and buildId are identical across all records; migrationAttempted=false; rollbackAttempted=false. | WP7_CLEAN_INSTALL_START_STOP_RESTART_FAILED, WP7_FIRST_START_NOT_CLEAN | FINAL_WINDOWS |
| A02 | Electron, backend, installer and diagnostics expose one identical buildId and one identical release identity tuple. | final-installer-build-id-consistency.test | evidence/wp7/build-identity.json, evidence/wp7/final-release-evidence.json, evidence/wp7/boot-failure-diagnostics.json | All four consumers report the same buildId, productVersion, stageVersion, sourceCommit, sourceTree and manifest SHA256, with zero mismatches. | BOOT_BUILD_ID_MISMATCH | PRE_REVIEW_AND_FINAL |
| A03 | Exactly one backend AppRuntime owns the installed business runtime at every observed point. | single-backend-installed-runtime.test, wp7-backend-crash-recovery-installed.test | evidence/wp7/runtime-ownership.json | Observed active AppRuntime owner count never exceeds one; crash/restart sequence yields one trusted replacement owner and zero overlapping owners. | WP7_INSTALLED_DUAL_RUNTIME_OWNER, WP7_BACKEND_CRASH_RECOVERY_FAILED | FINAL_WINDOWS |
| A04 | Installed runtime never reads or obeys any legacy safe-mode fallback source after accepted authority exists. | wp7-wp5-runtime-authority-installed-regression.test | evidence/wp7/safe-mode-removal.json | Legacy safe-mode file, environment, desktop settings, renderer storage and system-policy mutations produce zero authority changes; Yance29 SQLite remains sole authority. | WP7_LEGACY_MODE_FALLBACK_DETECTED | FINAL_WINDOWS |
| A05 | local_ready is impossible until credential hydration and all required authority projections agree. | wp7-wp4-credential-authority-installed-regression.test | evidence/wp7/credential-ready-gate.json | Every local_ready transition is preceded by successful credential hydration, trusted owner validation and projection agreement; injected early-ready mutation is rejected. | WP7_INSTALLED_READY_GATE_BYPASS, WP7_CREDENTIAL_OWNER_CONTAINMENT_BYPASS | FINAL_WINDOWS |
| A06 | The installed application reaches local_ready while offline and reports explicit, truthful capability state. | offline-installed-runtime-ready.test | evidence/wp7/offline-startup.json | With network unavailable, local_ready completes within the defined timeout; unavailable external capabilities are explicit; no false online capability is reported. | WP7_OFFLINE_STARTUP_FAILED | FINAL_WINDOWS |
| A07 | The final installed tree contains zero old runtime code, duplicate runtime entrypoints or forbidden legacy residue. | installed-tree-old-runtime-scan-zero.test, wp7-no-old-process-or-build-contamination.test | evidence/wp7/install-tree-inventory.json, evidence/wp7/no-contamination.json | Canonical installed-tree inventory and process/residual scan report zero forbidden files, zero duplicate runtime entrypoints and zero legacy runtime processes. | WP7_INSTALLED_LEGACY_RUNTIME_DETECTED, WP7_OLD_RUNTIME_PROCESS_RESIDUE | FINAL_WINDOWS |
| A08 | The final installer is produced from clean staging and never uses an old installer plus app.asar.unpacked overlay or post-install runtime patch. | final-build-clean-staging.test, wp1-artifact-reuse-denied.test, final-payload-recomputed.test, wp7-installer-seal-and-external-hash.test | evidence/wp7/build-provenance.json, evidence/wp7/build-session-integrity.json, evidence/wp7/final-release-evidence.json | Staging starts empty; every payload byte has current-session provenance; overlay/post-install patch scanners report zero hits; sealed installer hash remains unchanged. | FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT, WP0_OVERLAY_INSTALLER_PATTERN_DETECTED, WP7_CROSS_SESSION_ARTIFACT_REUSE | PRE_REVIEW_AND_FINAL |
| A09 | Every startup failure exposes machine-readable buildId, failedPhase and stable reasonCode. | wp7-boot-failure-diagnostics.test | evidence/wp7/boot-failure-diagnostics.json | Each injected startup failure produces valid JSON containing the exact buildId, non-empty failedPhase and allowlisted reasonCode; no narrative-only failure record is accepted. | WP7_BOOT_DIAGNOSTIC_INCOMPLETE | PRE_REVIEW_AND_FINAL |
| A10 | All stage-level release evidence is machine-readable JSON, schema-valid, SHA256-pinned and joined to one final identity tuple. | wp7-final-evidence-reference-only.test, acceptance-evidence-schema.test, wp7-evidence-cross-file-identity.test, wp7-acceptance-check-mapping.test | evidence/phase1-acceptance-evidence.json, evidence/wp7/final-release-evidence.json | A01-A10 each appear exactly once; every referenced child JSON parses and validates; every reference has SHA256; all records share source, buildSessionId, buildId and installerSha256; no development evidence is referenced. | WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION, WP7_EVIDENCE_IDENTITY_SPLIT, WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID | PRE_REVIEW_AND_FINAL |


## 7. Required Test规范阶段

| Phase | Meaning |
| --- | --- |
| PRE_REVIEW | Must execute and PASS before WP7 Convergence Pre-Review submission; no final installer or real-machine claim is permitted. |
| PRE_REVIEW_AND_FINAL | Must execute and PASS before Convergence Pre-Review using implementation/tooling fixtures, then execute again against the frozen final build or final evidence during Final Packaging. |
| FINAL_PACKAGING | Runs only after WP7_PREACCEPTED_FOR_FINAL_PACKAGING against final packaging identities or complete delivery closure; not required to enter Convergence Pre-Review. |
| FINAL_WINDOWS | Runs only during authorized real Windows CLEAN_INSTALL validation against the sealed final installer; not required to enter Convergence Pre-Review. |


Convergence Pre-Review执行`PRE_REVIEW`和`PRE_REVIEW_AND_FINAL`。Final Packaging重新执行`PRE_REVIEW_AND_FINAL`并执行`FINAL_PACKAGING`与`FINAL_WINDOWS`。

## 8. WS01-WS10工作流追踪

详见`WP7_WORKSTREAM_TRACEABILITY.json/.md`。每个工作流均包含entryConditions、exitConditions、faultIds、raceIds、crashIds、mutationIds、requiredTestIds、requiredEvidenceOutputs、blockingReasonCodes和requiredBeforePhase。

| WS | 名称 | Required before | Faults | Races | Crashes | Mutations | Tests | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WS01 | Activation baseline lock and implementation branch discipline | CONVERGENCE_PRE_REVIEW | 8 | 1 | 0 | 6 | 5 | 4 |
| WS02 | Release identity and manifest convergence | CONVERGENCE_PRE_REVIEW | 5 | 1 | 1 | 6 | 4 | 5 |
| WS03 | Protected real build/package/release pipeline | CONVERGENCE_PRE_REVIEW | 5 | 3 | 2 | 5 | 4 | 4 |
| WS04 | Empty staging, payload provenance and deterministic manifest | CONVERGENCE_PRE_REVIEW | 8 | 4 | 4 | 9 | 5 | 4 |
| WS05 | Deterministic installer build and sealing | PRE_REVIEW_FIXTURE_THEN_FINAL_PACKAGING | 4 | 2 | 3 | 4 | 3 | 4 |
| WS06 | Complete project source and Git delivery | CONVERGENCE_PRE_REVIEW_AND_FINAL_PACKAGING | 2 | 1 | 1 | 2 | 3 | 2 |
| WS07 | CLEAN_INSTALL uninstall and residual cleanup workflow | FINAL_WINDOWS | 7 | 4 | 2 | 6 | 6 | 3 |
| WS08 | First-start and installed-runtime verification | FINAL_WINDOWS_COMPLETION | 11 | 5 | 5 | 11 | 11 | 9 |
| WS09 | Machine-readable evidence and phase aggregate | CONVERGENCE_PRE_REVIEW_SCHEMA_AND_FINAL_PACKAGING_AGGREGATE | 7 | 3 | 2 | 7 | 9 | 4 |
| WS10 | Verification, mutation and adversarial closure | CONVERGENCE_PRE_REVIEW | 47 | 15 | 15 | 44 | 25 | 4 |


## 9. 状态机

- `ACTIVATION_ACCEPTED` → `DESIGN_GATE_CANDIDATE_PREPARING`：owner requests Design Gate candidate
- `DESIGN_GATE_CANDIDATE_PREPARING` → `DESIGN_GATE_CANDIDATE_PENDING_INDEPENDENT_REVIEW`：complete candidate, exact baseline binding, no tracked changes
- `DESIGN_GATE_CANDIDATE_PENDING_INDEPENDENT_REVIEW` → `DESIGN_GATE_CONFIRMED`：independent review issues WP7_DESIGN_GATE_CONFIRMED
- `DESIGN_GATE_CONFIRMED` → `IMPLEMENTATION_BASELINE_LOCKED`：clean branch starts from accepted Activation binding commit/tree
- `IMPLEMENTATION_BASELINE_LOCKED` → `IMPLEMENTATION_IN_PROGRESS`：productionImplementationAuthorized=true by formal Design Gate decision
- `IMPLEMENTATION_IN_PROGRESS` → `IMPLEMENTATION_FROZEN`：all planned implementation complete and source identity frozen
- `IMPLEMENTATION_FROZEN` → `CONVERGENCE_PRE_REVIEW_PENDING`：all pre-review tests/matrices/mutations/evidence/self-review pass and lightweight package complete
- `CONVERGENCE_PRE_REVIEW_PENDING` → `PREACCEPTED_FOR_FINAL_PACKAGING`：independent review issues WP7_PREACCEPTED_FOR_FINAL_PACKAGING
- `PREACCEPTED_FOR_FINAL_PACKAGING` → `FINAL_SOURCE_FROZEN`：preaccepted implementation commit/tree unchanged
- `FINAL_SOURCE_FROZEN` → `CLEAN_STAGING_VERIFIED`：unique empty staging and provenance gates pass
- `CLEAN_STAGING_VERIFIED` → `PAYLOAD_AND_MANIFEST_SEALED`：payload and manifest hashes recomputed and stable
- `PAYLOAD_AND_MANIFEST_SEALED` → `INSTALLER_SEALED`：one installer built and SHA256 fixed
- `INSTALLER_SEALED` → `CLEAN_INSTALL_ENVIRONMENT_VERIFIED`：old versions/data/processes/artifacts removed and inventories pass
- `CLEAN_INSTALL_ENVIRONMENT_VERIFIED` → `WINDOWS_FINAL_VALIDATION_RUNNING`：installer SHA256 reverified immediately before execution
- `WINDOWS_FINAL_VALIDATION_RUNNING` → `FINAL_PACKAGING_PENDING_INDEPENDENT_REVIEW`：all final Windows checks and machine-readable evidence pass
- `FINAL_PACKAGING_PENDING_INDEPENDENT_REVIEW` → `ACCEPTED`：independent final review issues WP7_ACCEPTED and stage-level decisions separately
- `*` → `IMPLEMENTATION_FAILED_SAFE`：implementation identity, test, mutation, runtime or evidence failure before preacceptance
- `*` → `BLOCKED`：missing authorization, scope drift or unmet phase gate

## 10. 不可破坏不变量

| ID | Invariant |
| --- | --- |
| DG-I01 | No production implementation starts until an independent decision explicitly issues WP7_DESIGN_GATE_CONFIRMED. |
| DG-I02 | The first implementation commit must descend from the accepted WP7 Activation identity binding commit 4ac6d2185bed28823210849704f3850cd875b5fb. |
| DG-I03 | Design Gate candidate generation creates no Git commit and changes no tracked source tree. |
| DG-I04 | Required-test names, matrices and evidence obligations defined here are requirements, not PASS claims. |
| DG-I05 | Any implementation discovery requiring database schema, runtime authority or API contract semantic changes stops for a Design Amendment. |
| DG-I06 | Convergence Pre-Review remains lightweight and cannot contain a final installer or Final Delivery identity. |
| DG-I07 | Final Packaging cannot begin before WP7_PREACCEPTED_FOR_FINAL_PACKAGING. |
| DG-I08 | Computer cleanup and final Windows installation occur only in the authorized final validation workflow, not during Design Gate or initial implementation. |
| G01 | This Readiness result does not activate WP7; WP7 remains inactive until a separate exact-parent activation workflow. |
| G02 | WP6 Activation identity remains historical and is never substituted for the WP6 accepted implementation or Final Delivery identity. |
| G03 | Package-local historical status never overrides a later formal audit decision. |
| G04 | Final Packaging is forbidden before WP7_PREACCEPTED_FOR_FINAL_PACKAGING. |
| S01 | The final installer is built from exactly one preaccepted frozen commit and tree. |
| S02 | Any production/build-tool/schema/test change after preacceptance invalidates preacceptance. |
| S03 | Real build starts from an empty unique staging root and never reuses an unsealed session. |
| S04 | WP1 PIPELINE_TEST_ONLY artifacts and protected hashes cannot enter final staging or evidence. |
| I01 | Electron, backend, installer and diagnostics consume the same verified release manifest and buildId. |
| I02 | Manifest protocol versions truthfully equal accepted runtime protocol constants. |
| I03 | sourceCommit equals gitCommit and frozenSourceCommit; sourceTree equals frozenSourceTree. |
| I04 | Payload and installer hashes are recomputed in the final build session and cannot be copied from development evidence. |
| P01 | Payload path canonicalization rejects traversal, absolute paths, symlinks, NFC collisions and Windows case collisions. |
| P02 | release manifest, detached hash, release evidence and installer are outside application payload aggregation. |
| W4-01 | Installed credential hydration, custody, idempotency, containment and projection agreement preserve accepted WP4 invariants. |
| W5-01 | Installed runtime uses Yance29 SQLite runtime_state as the sole operating-mode authority. |
| W5-02 | Yance27 is read-only and no safe-mode fallback source can affect the accepted runtime. |
| W6-01 | Installed Electron is DesktopHost only and backend is the sole business runtime. |
| W6-02 | API v2 event gaps force snapshot refetch and old runtime source/install residue is zero. |
| E01 | Every final evidence file joins on one frozen source, buildSessionId, buildId and installerSha256. |
| E02 | Phase1 aggregate references only final evidence under evidence/wp7 and never substitutes development evidence. |
| E03 | No screenshot or narrative claim substitutes for required machine-readable JSON evidence. |
| R01 | LOCAL_PRIVATE_UNSIGNED is truthful; missing Authenticode is not a Phase 1 failure. |
| R02 | Automatic update, upgrade-package and public-release acceptance cannot be claimed. |
| R03 | Inherited accepted risk records remain disclosed and are never silently closed. |
| C01 | Final Delivery contains the complete project source tree and complete source identity; incremental-only source is invalid. |
| C02 | The supplementary patch never substitutes for the complete source ZIP or complete Git bundle. |
| CI01 | FINAL_INSTALLATION_MODE is CLEAN_INSTALL. |
| CI02 | Legacy test data migration is neither required nor attempted. |
| CI03 | Rollback or downgrade to a legacy test version is neither required nor attempted. |
| CI04 | No old installed runtime, old process, old installer, old configuration, test database, cache, staging output or shortcut may influence final validation. |
| CI05 | Installer SHA256 is verified immediately before installation and bound to every final evidence record. |
| CI06 | First start initializes fresh state and must not silently consume a legacy test data root. |
| U01 | WP6 accepted runtime protocol version 3 is release truth; version 2 in historical reference material cannot enter the final manifest. |
| U02 | WP6 accepted unknown Windows limitations are converted into required WP7 final-machine evidence, not reported as already proven. |


## 11. 故障矩阵

| ID | Class | Injection | Expected | Reason code | Phase |
| --- | --- | --- | --- | --- | --- |
| F01 | governance | WP7 activation parent is not the WP6 Accepted Final Delivery HEAD | block activation | WP7_ACTIVATION_PARENT_MISMATCH | ENTRY |
| F02 | governance | WP6 Activation identity is substituted for the accepted WP6 implementation or Final Delivery identity | fail binding | WP7_WP6_ACTIVATION_NOT_FINAL_IDENTITY | ENTRY |
| F03 | source-freeze | dirty repository or untracked release surface | fail closed | WP7_SOURCE_NOT_CLEAN | BOTH |
| F04 | source-freeze | HEAD or tree changes after preacceptance | invalidate preacceptance | WP7_PREACCEPTED_SOURCE_DRIFT | BOTH |
| F05 | source-freeze | real build executed from a branch rejected by WP0 gate | fail closed | WP7_WP0_GATE_BRANCH_MISMATCH | BOTH |
| F06 | pipeline | real build/package/release target remains unconfigured | no build | WP0_PROTECTED_COMMAND_TARGET_NOT_CONFIGURED | BOTH |
| F07 | staging | staging directory is not empty | fail closed | FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT | BOTH |
| F08 | staging | WP1 marker, protected artifact hash or pipeline-test evidence is present | fail closed | FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT | BOTH |
| F09 | staging | required WP1 provenance index missing | fail closed | WP1_PROVENANCE_INDEX_REQUIRED | BOTH |
| F10 | identity | manifest sourceCommit does not equal frozen commit | fail closed | WP7_SOURCE_FREEZE_MISMATCH | BOTH |
| F11 | identity | manifest sourceTree does not equal frozen tree | fail closed | WP7_SOURCE_TREE_MISMATCH | BOTH |
| F12 | identity | productVersion, stageVersion, phase or buildId differ among consumers | fail closed | BOOT_BUILD_ID_MISMATCH | BOTH |
| F13 | identity | release manifest credentialProtocolVersion differs from the accepted runtime protocol | fail closed | WP7_PROTOCOL_VERSION_BINDING_MISMATCH | ENTRY |
| F14 | payload | absolute, drive, UNC, traversal, NFC duplicate or Windows case collision | fail closed | WP1_PAYLOAD_PATH_INVALID | BOTH |
| F15 | payload | symlink or unsupported file type enters payload | fail closed | WP1_PAYLOAD_SYMLINK_REJECTED | BOTH |
| F16 | payload | payload byte changes after payload-files generation | fail closed | WP7_PAYLOAD_HASH_MISMATCH | BOTH |
| F17 | payload | manifest, detached hash, release evidence or installer enters application payload aggregation | fail closed | WP7_PAYLOAD_SCOPE_VIOLATION | BOTH |
| F18 | installer | installer changes after release evidence generation | fail closed | WP7_INSTALLER_HASH_MISMATCH | BOTH |
| F19 | pipeline | old installer overlay or post-install runtime patch detected | fail closed | WP0_OVERLAY_INSTALLER_PATTERN_DETECTED | BOTH |
| F20 | installed-tree | old Electron runtime residue or duplicate runtime entrypoint remains | fail closed | WP7_INSTALLED_LEGACY_RUNTIME_DETECTED | FINAL |
| F21 | runtime | two backend AppRuntime owners observed | fail closed | WP7_INSTALLED_DUAL_RUNTIME_OWNER | FINAL |
| F22 | runtime | event sequence gap does not force snapshot recovery | fail closed | WP7_EVENT_GAP_RECOVERY_BYPASS | FINAL |
| F23 | runtime | backend crash does not recover through the accepted single-runtime chain | fail closed | WP7_BACKEND_CRASH_RECOVERY_FAILED | FINAL |
| F24 | credential | local_ready occurs before credential hydration and projection agreement | fail closed | WP7_INSTALLED_READY_GATE_BYPASS | BOTH |
| F25 | credential | rejected credential owner remains live or containment is bypassed | fail closed | WP7_CREDENTIAL_OWNER_CONTAINMENT_BYPASS | BOTH |
| F26 | runtime-state | legacy safe-mode file, environment, desktop settings, renderer storage or system policy affects mode | fail closed | WP7_LEGACY_MODE_FALLBACK_DETECTED | BOTH |
| F27 | runtime-state | legacy migration source is modified | fail closed | WP7_LEGACY_SOURCE_MUTATED | BOTH |
| F28 | offline | network unavailable and local_ready does not complete with explicit capabilities | fail closed | WP7_OFFLINE_STARTUP_FAILED | BOTH |
| F29 | diagnostics | boot diagnostics omit buildId, failedPhase or reasonCode | fail closed | WP7_BOOT_DIAGNOSTIC_INCOMPLETE | BOTH |
| F30 | evidence | aggregate references WP1/WP3/WP4/WP5/WP6 development evidence directly | fail closed | WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION | BOTH |
| F31 | evidence | two evidence files use different buildSessionId or installerSha256 | fail closed | WP7_EVIDENCE_IDENTITY_SPLIT | BOTH |
| F32 | policy | lack of Authenticode is treated as Phase 1 failure | policy failure | WP7_UNSIGNED_POLICY_MISAPPLIED | BOTH |
| F33 | scope | automatic update, upgrade package, manifest digital signature or public-release claim is included | scope failure | WP7_DEFERRED_SCOPE_CLAIMED | BOTH |
| F34 | governance | accepted risk record omitted or reported closed | fail governance | WP7_INHERITED_RISK_RECORD_MISMATCH | BOTH |
| F35 | governance | package-local preacceptance status overwrites formal acceptance status | fail governance | WP7_STATUS_AUTHORITY_PRECEDENCE_VIOLATION | BOTH |
| F36 | delivery-source | Final source ZIP contains only WP7 changed files | fail packaging | WP7_COMPLETE_PROJECT_SOURCE_REQUIRED | FINAL |
| F37 | delivery-source | Git bundle omits accepted WP6 ancestry or cannot resolve the final tree | fail packaging | WP7_COMPLETE_GIT_HISTORY_REQUIRED | FINAL |
| F38 | clean-install | Legacy/test 言策 version remains installed | fail before install | WP7_LEGACY_TEST_INSTALLATION_RESIDUE | FINAL |
| F39 | clean-install | Old test installer or release output remains in validation paths | fail cleanup | WP7_OLD_INSTALLER_RESIDUE | FINAL |
| F40 | clean-install | Old configuration, test database, cache or prior staging remains | fail cleanup | WP7_LEGACY_TEST_DATA_RESIDUE | FINAL |
| F41 | clean-install | Old runtime process, startup entry, service, task or lock remains | fail cleanup | WP7_OLD_RUNTIME_PROCESS_RESIDUE | FINAL |
| F42 | clean-install | Installer or first start attempts legacy test data migration | fail policy | WP7_LEGACY_TEST_DATA_MIGRATION_FORBIDDEN | FINAL |
| F43 | clean-install | Validation requires or performs rollback to a legacy test version | fail policy | WP7_LEGACY_TEST_VERSION_ROLLBACK_FORBIDDEN | FINAL |
| F44 | installer | Installer SHA256 differs immediately before execution | abort install | WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH | FINAL |
| F45 | first-start | Fresh configuration/database initialization is absent or consumes an old data root | fail first start | WP7_FIRST_START_NOT_CLEAN | FINAL |
| F46 | evidence | Uninstall and residual cleanup lack machine-readable before/after inventory | fail evidence | WP7_CLEAN_INSTALL_EVIDENCE_INCOMPLETE | FINAL |
| F47 | staging | Artifact from an earlier WP7 build session is copied into final staging | fail build | WP7_CROSS_SESSION_ARTIFACT_REUSE | BOTH |


## 12. 并发与竞态矩阵

| ID | Scenario | Expected | Reason code |
| --- | --- | --- | --- |
| C01 | Two final builds target the same staging root | One exclusive build lease; second process fails before writing | WP7_BUILD_SESSION_BUSY |
| C02 | Two builds use the same frozen source but different buildSessionId values | Artifacts remain isolated; cross-session copy is rejected | WP7_BUILD_SESSION_ID_MISMATCH |
| C03 | Source checkout changes while payload enumeration is active | Pre/post HEAD and tree comparison fails the build | WP7_SOURCE_CHANGED_DURING_BUILD |
| C04 | Payload file changes between enumeration and hashing | Read-back size/hash mismatch fails the build | WP7_PAYLOAD_RACE_DETECTED |
| C05 | Evidence assembler and installer writer run concurrently | Evidence waits for sealed installer then verifies immutable hash | WP7_INSTALLER_NOT_SEALED |
| C06 | Two clean-install validators use the same test data root | Exclusive validation environment or unique data root required | WP7_INSTALL_VALIDATION_ENV_BUSY |
| C07 | Second backend starts during first backend takeover/stop | WP3/WP4 ownership and fencing deny the second owner | WP7_INSTALLED_DUAL_RUNTIME_OWNER |
| C08 | Credential mutation races application shutdown | WP4 application lease prevents crossing the commit boundary | WP7_CREDENTIAL_SHUTDOWN_RACE_BLOCKED |
| C09 | Operating-mode transition races runtime shutdown | WP5 denies new transaction and returns durable non-success | WP7_MODE_SHUTDOWN_RACE_BLOCKED |
| C10 | Evidence aggregate generated twice concurrently | Single canonical aggregate or exact byte-identical result | WP7_EVIDENCE_ASSEMBLY_BUSY |
| C11 | Uninstall/cleanup starts while an old runtime process is still exiting | Wait for verified process exit; otherwise fail cleanup | WP7_OLD_RUNTIME_PROCESS_RESIDUE |
| C12 | Two clean-install validations target the same Windows machine/data root | Exclusive machine-validation lease | WP7_INSTALL_VALIDATION_ENV_BUSY |
| C13 | Installer file is replaced between SHA256 verification and execution | Open/execute the verified sealed file or rehash and abort | WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH |
| C14 | Old auto-start runtime races the first launch of the final installer | Residual scan and ownership gate reject validation | WP7_OLD_RUNTIME_PROCESS_RESIDUE |
| C15 | Evidence cleanup inventory is generated while cleanup is still mutating paths | Inventory only after cleanup lease closes and filesystem settles | WP7_CLEAN_INSTALL_EVIDENCE_INCOMPLETE |


## 13. 崩溃矩阵

| ID | Crash point | Recovery | Proof |
| --- | --- | --- | --- |
| K01 | After empty-staging check before first copy | delete session directory and restart from empty staging | no reusable partial artifact |
| K02 | During payload copy | session remains unsealed; next run refuses reuse and recreates staging | partial payload cannot be promoted |
| K03 | After payload-files.json before release-manifest.json | discard session or recompute every downstream artifact | no manifest is accepted without current payload hash |
| K04 | After release-manifest.json before detached hash | recompute manifest and detached hash in the same session | manifest without detached hash cannot package |
| K05 | During installer build | partial installer is deleted and cannot be hashed as final | sealed installer marker absent |
| K06 | After installer build before external release evidence | verify sealed installer and generate evidence; never rebuild in place | installer hash bound once |
| K07 | During installation | record failed install, clean test environment, reinstall from same installer | failed tree never counted as clean install |
| K08 | Backend crashes after install before local_ready | exercise accepted runtime recovery and record reasonCode/buildId | no false ready |
| K09 | Electron crashes during credential hydration | WP4 owner-exit recovery and transaction recovery complete before retry | authority projections remain consistent |
| K10 | During aggregate evidence write | atomic rewrite from already hashed child evidence | truncated aggregate is invalid |
| K11 | During legacy test-version uninstall | Resume cleanup from machine-readable inventory; do not install until absence is proven | No partial uninstall is accepted as clean |
| K12 | During deletion of old configuration/database/cache/staging | Repeat idempotent cleanup and regenerate before/after inventory | No residue is silently ignored |
| K13 | After installer SHA256 verification but before launch | Reverify SHA256 before a later launch | Time gap cannot bypass integrity |
| K14 | During first-start fresh-state initialization | Mark environment failed, clean it again, reinstall from the same sealed installer | Partially initialized state cannot count as clean first start |
| K15 | During final full-source ZIP generation | Discard partial archive and rebuild from final Git tree | Archive closure and SHA256 must be recomputed |


## 14. Mutation矩阵

| ID | Target | Mutation | Kill oracle | Reason code |
| --- | --- | --- | --- | --- |
| M01 | upstream binding | replace WP6 accepted implementation/Final Delivery identity with Activation identity | binding validator rejects | WP7_WP6_ACTIVATION_NOT_FINAL_IDENTITY |
| M02 | status authority | restore obsolete WP4 ACTIVE or WP5 BLOCKED status | formal status precedence test rejects | WP7_STATUS_AUTHORITY_PRECEDENCE_VIOLATION |
| M03 | source freeze | dirty one tracked file after preacceptance | source freeze test rejects | WP7_PREACCEPTED_SOURCE_DRIFT |
| M04 | WP0 gate | run real build from non-authorized branch | WP0 gate rejects | WP7_WP0_GATE_BRANCH_MISMATCH |
| M05 | staging | prepopulate staging with benign file | empty staging test rejects | FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT |
| M06 | staging | rename a WP1 manifest or evidence file | content/provenance hash scan rejects | FINAL_BUILD_REUSED_PIPELINE_TEST_ARTIFACT |
| M07 | staging | remove provenance index | post-generation provenance gate rejects | WP1_PROVENANCE_INDEX_REQUIRED |
| M08 | release identity | alter sourceCommit only | manifest/source binding rejects | WP7_SOURCE_FREEZE_MISMATCH |
| M09 | release identity | alter sourceTree only | manifest/source binding rejects | WP7_SOURCE_TREE_MISMATCH |
| M10 | release identity | change one consumer buildId | four-consumer identity test rejects | BOOT_BUILD_ID_MISMATCH |
| M11 | release identity | leave credentialProtocolVersion=2 while runtime protocol is 3 | protocol binding test rejects | WP7_PROTOCOL_VERSION_BINDING_MISMATCH |
| M12 | payload paths | inject absolute/traversal/NFC/case-collision path | canonicalization rejects | WP1_PAYLOAD_PATH_INVALID |
| M13 | payload | inject symlink | payload scanner rejects | WP1_PAYLOAD_SYMLINK_REJECTED |
| M14 | payload | change one byte after manifest generation | rehash rejects | WP7_PAYLOAD_HASH_MISMATCH |
| M15 | payload scope | add release-manifest or installer to payload records | scope audit rejects | WP7_PAYLOAD_SCOPE_VIOLATION |
| M16 | installer | replace installer after evidence | external hash check rejects | WP7_INSTALLER_HASH_MISMATCH |
| M17 | pipeline | restore overlay copy or post-install patch path | WP0 scan rejects | WP0_OVERLAY_INSTALLER_PATTERN_DETECTED |
| M18 | installed tree | inject old Electron runtime file | inventory rejects | WP7_INSTALLED_LEGACY_RUNTIME_DETECTED |
| M19 | installed runtime | allow second backend owner | ownership test rejects | WP7_INSTALLED_DUAL_RUNTIME_OWNER |
| M20 | API v2 events | ignore event gap and continue incremental processing | event-gap test rejects | WP7_EVENT_GAP_RECOVERY_BYPASS |
| M21 | credentials | force local_ready before hydration | ready gate rejects | WP7_INSTALLED_READY_GATE_BYPASS |
| M22 | credentials | skip rejected-owner termination | containment test rejects | WP7_CREDENTIAL_OWNER_CONTAINMENT_BYPASS |
| M23 | runtime state | re-enable safe-mode file or environment fallback | fallback scan/runtime test rejects | WP7_LEGACY_MODE_FALLBACK_DETECTED |
| M24 | legacy migration | write one byte to Yance27 source | read-only fingerprint test rejects | WP7_LEGACY_SOURCE_MUTATED |
| M25 | offline startup | block network and make external worker failure block local_ready | offline test rejects | WP7_OFFLINE_STARTUP_FAILED |
| M26 | diagnostics | remove failedPhase or reasonCode | schema test rejects | WP7_BOOT_DIAGNOSTIC_INCOMPLETE |
| M27 | evidence | reference WP4/WP5 development evidence directly | allowlist rejects | WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION |
| M28 | evidence | change buildSessionId in one child evidence | identity join rejects | WP7_EVIDENCE_IDENTITY_SPLIT |
| M29 | policy | require Authenticode in Phase 1 | unsigned policy test rejects | WP7_UNSIGNED_POLICY_MISAPPLIED |
| M30 | scope | claim automatic update or upgrade package PASS | scope validator rejects | WP7_DEFERRED_SCOPE_CLAIMED |
| M31 | governance | delete WP2/WP3/WP4/WP5 risk entries | risk binding test rejects | WP7_INHERITED_RISK_RECORD_MISMATCH |
| M32 | crash recovery | reuse unsealed partial staging after crash | session seal test rejects | WP7_PARTIAL_BUILD_REUSE_DENIED |
| M33 | complete source delivery | replace full source ZIP with WP7 changed files only | source closure rejects | WP7_COMPLETE_PROJECT_SOURCE_REQUIRED |
| M34 | complete Git delivery | prune accepted WP6 parent history from bundle | bundle ancestry validator rejects | WP7_COMPLETE_GIT_HISTORY_REQUIRED |
| M35 | clean install | leave one old test executable installed | residual inventory rejects | WP7_LEGACY_TEST_INSTALLATION_RESIDUE |
| M36 | clean install | leave one old config/database/cache path | cleanup oracle rejects | WP7_LEGACY_TEST_DATA_RESIDUE |
| M37 | clean install | enable legacy test data migration on first start | migration-negative oracle rejects | WP7_LEGACY_TEST_DATA_MIGRATION_FORBIDDEN |
| M38 | clean install | require rollback/downgrade to old test version | rollback-negative oracle rejects | WP7_LEGACY_TEST_VERSION_ROLLBACK_FORBIDDEN |
| M39 | installer integrity | skip immediate preinstall SHA256 verification | integrity test rejects | WP7_PREINSTALL_INSTALLER_SHA256_MISMATCH |
| M40 | first start | reuse old database while reporting fresh initialization | first-start inventory rejects | WP7_FIRST_START_NOT_CLEAN |
| M41 | build session | copy prior session payload into empty final session and regenerate only manifest | provenance and file-origin oracle rejects | WP7_CROSS_SESSION_ARTIFACT_REUSE |
| M42 | runtime contamination | allow old auto-start backend to survive cleanup | process/ownership scan rejects | WP7_OLD_RUNTIME_PROCESS_RESIDUE |
| M43 | release protocol | retain credentialProtocolVersion 2 in release source while accepted runtime is 3 | release/runtime protocol consistency test rejects | WP7_PROTOCOL_VERSION_BINDING_MISMATCH |
| M44 | clean-install evidence | omit before/after cleanup inventory | evidence schema rejects | WP7_CLEAN_INSTALL_EVIDENCE_INCOMPLETE |


## 15. Required Tests

| Test ID | Phase | Purpose / Boundary | Status |
| --- | --- | --- | --- |
| final-build-clean-staging.test | PRE_REVIEW_AND_FINAL | Implementation harness before pre-review; repeat in the final sealed build session. | NOT_STARTED |
| final-build-source-freeze-match.test | PRE_REVIEW_AND_FINAL | Implementation source-freeze harness before pre-review; repeat against preaccepted/final source identities. | NOT_STARTED |
| wp1-artifact-reuse-denied.test | PRE_REVIEW_AND_FINAL | Negative provenance tests before pre-review; repeat against final staging. | NOT_STARTED |
| final-payload-recomputed.test | PRE_REVIEW_AND_FINAL | Deterministic payload fixture before pre-review; repeat in final build session. | NOT_STARTED |
| final-installer-build-id-consistency.test | PRE_REVIEW_AND_FINAL | Non-release installer/build-identity fixture before pre-review; repeat against sealed final installer. | NOT_STARTED |
| clean-install-start-stop-restart.test | FINAL_WINDOWS | Requires sealed final installer and authorized real Windows CLEAN_INSTALL machine. | NOT_STARTED |
| single-backend-installed-runtime.test | FINAL_WINDOWS | Requires installed final runtime on real Windows. | NOT_STARTED |
| offline-installed-runtime-ready.test | FINAL_WINDOWS | Requires installed final runtime and controlled offline Windows environment. | NOT_STARTED |
| installed-tree-old-runtime-scan-zero.test | FINAL_WINDOWS | Requires final installed tree and residual inventory. | NOT_STARTED |
| wp7-final-evidence-reference-only.test | PRE_REVIEW_AND_FINAL | Validate allowlist/schema using PRE_REVIEW_ONLY evidence; repeat against final evidence aggregate. | NOT_STARTED |
| acceptance-evidence-schema.test | PRE_REVIEW_AND_FINAL | Validate schema and A01-A10 contract before pre-review; repeat against final machine-readable evidence. | NOT_STARTED |
| wp7-upstream-accepted-binding.test | PRE_REVIEW | WP0-WP5 accepted identities and risk records match formal decisions. | NOT_STARTED |
| wp7-wp6-final-binding-required.test | PRE_REVIEW | WP6 accepted implementation and Final Delivery identity are required; Activation identity substitution is rejected. | NOT_STARTED |
| wp7-release-protocol-version-consistency.test | PRE_REVIEW_AND_FINAL | Manifest protocol versions equal accepted runtime constants. | NOT_STARTED |
| wp7-wp0-real-build-branch-gate.test | PRE_REVIEW_AND_FINAL | Real build runs on a branch accepted by WP0 gate. | NOT_STARTED |
| wp7-build-session-exclusive.test | PRE_REVIEW_AND_FINAL | Concurrent build sessions cannot share staging/output. | NOT_STARTED |
| wp7-build-crash-recovery.test | PRE_REVIEW | Unsealed partial build cannot be resumed or promoted. | NOT_STARTED |
| wp7-installer-seal-and-external-hash.test | PRE_REVIEW_AND_FINAL | Installer is sealed before external evidence and hash remains stable. | NOT_STARTED |
| wp7-wp4-credential-authority-installed-regression.test | FINAL_WINDOWS | Installed runtime preserves accepted WP4 hydration, transaction and containment invariants. | NOT_STARTED |
| wp7-wp5-runtime-authority-installed-regression.test | FINAL_WINDOWS | Installed runtime preserves WP5 single authority, read-only migration and fallback deletion. | NOT_STARTED |
| wp7-api-v2-event-gap-snapshot-recovery.test | FINAL_WINDOWS | Installed runtime refetches snapshot on event gap. | NOT_STARTED |
| wp7-backend-crash-recovery-installed.test | FINAL_WINDOWS | Installed single runtime recovers without dual ownership. | NOT_STARTED |
| wp7-unsigned-policy-truthfulness.test | PRE_REVIEW_AND_FINAL | LOCAL_PRIVATE_UNSIGNED is represented truthfully and absence of Authenticode is not a failure. | NOT_STARTED |
| wp7-deferred-scope-claim-denied.test | PRE_REVIEW_AND_FINAL | No auto-update, upgrade-package, public-release or digital-signature acceptance claim. | NOT_STARTED |
| wp7-inherited-risk-register.test | PRE_REVIEW_AND_FINAL | Accepted exceptions remain disclosed and unmodified. | NOT_STARTED |
| wp7-evidence-cross-file-identity.test | PRE_REVIEW_AND_FINAL | All evidence joins on the same source, build session, buildId and installer hash. | NOT_STARTED |
| wp7-final-packaging-change-boundary.test | FINAL_PACKAGING | Post-preacceptance commits change only authorized packaging/governance evidence. | NOT_STARTED |
| wp7-complete-project-source-delivery.test | PRE_REVIEW_AND_FINAL | Complete source ZIP equals the entire final Git tree, not only WP7 changes. | NOT_STARTED |
| wp7-complete-bundle-parent-chain.test | PRE_REVIEW_AND_FINAL | Final bundle contains accepted WP6 ancestry and resolves all WP7 delivery identities. | NOT_STARTED |
| wp7-clean-install-old-version-uninstall.test | FINAL_WINDOWS | All legacy/test versions are uninstalled before final installation. | NOT_STARTED |
| wp7-clean-install-residual-removal.test | FINAL_WINDOWS | Old installers, config, test DB, cache, staging, shortcuts and runtime residue are absent. | NOT_STARTED |
| wp7-clean-install-no-legacy-migration.test | FINAL_WINDOWS | No legacy test data migration is required or attempted. | NOT_STARTED |
| wp7-clean-install-no-legacy-rollback.test | FINAL_WINDOWS | No legacy test version rollback/downgrade is required or attempted. | NOT_STARTED |
| wp7-installer-sha256-preinstall.test | FINAL_WINDOWS | Sealed installer SHA256 is verified immediately before execution. | NOT_STARTED |
| wp7-first-start-clean-initialization.test | FINAL_WINDOWS | First start creates fresh state without consuming old data roots. | NOT_STARTED |
| wp7-no-old-process-or-build-contamination.test | FINAL_WINDOWS | No old process, runtime, installer, staging or build output influences validation. | NOT_STARTED |
| wp7-clean-install-evidence-completeness.test | PRE_REVIEW_AND_FINAL | Before/after cleanup, install, first-start and residual scans are machine-readable. | NOT_STARTED |
| wp7-release-source-runtime-protocol-convergence.test | PRE_REVIEW_AND_FINAL | Release source and final manifest bind accepted runtime credentialProtocolVersion 3. | NOT_STARTED |
| wp7-boot-failure-diagnostics.test | PRE_REVIEW_AND_FINAL | Verify startup failures always expose machine-readable buildId, failedPhase and reasonCode; repeat against final installed runtime diagnostics. | NOT_STARTED |
| wp7-acceptance-check-mapping.test | PRE_REVIEW_AND_FINAL | Verify A01-A10 are each defined exactly once and map to tests, evidence, PASS oracle, FAIL reason code and phase. | NOT_STARTED |
| wp7-workstream-traceability.test | PRE_REVIEW | Verify WS01-WS10 each contain entry, exit, matrix, test, evidence and blocking-reason mappings with no dangling IDs. | NOT_STARTED |


历史回归：
- WP0 required tests and protected gate
- WP1 release identity and pipeline boundary
- WP2 API session security with accepted scanner coverage limitation
- WP3 ownership/API v2 with accepted Windows mutex limitation
- WP4 credential authority and application lifecycle
- WP5 runtime-state authority and legacy cutover
- WP6 accepted 34-test suite, 32 fault checks, 20 concurrency/crash checks, 35 killed mutations and five canonical evidence outputs

## 16. Evidence Schema

最终aggregate必须逐项包含A01-A10，每项包含：`acceptanceId`、`formalRequirement`、`requiredTestIds`、`requiredEvidenceFiles`、`passOracle`、`failReasonCodes`、`applicablePhase`、`status`和`evidenceReferences`。所有child evidence必须为JSON、SHA256固定并共享同一最终身份元组。

最终evidence outputs：
- `evidence/wp7/source-freeze.json`
- `evidence/wp7/final-release-evidence.json`
- `evidence/wp7/clean-install.json`
- `evidence/wp7/restart-cycle.json`
- `evidence/wp7/build-identity.json`
- `evidence/wp7/runtime-ownership.json`
- `evidence/wp7/safe-mode-removal.json`
- `evidence/wp7/credential-ready-gate.json`
- `evidence/wp7/offline-startup.json`
- `evidence/wp7/install-tree-inventory.json`
- `evidence/wp7/build-provenance.json`
- `evidence/wp7/boot-failure-diagnostics.json`
- `evidence/wp7/upstream-contract-binding.json`
- `evidence/wp7/protocol-version-binding.json`
- `evidence/wp7/build-session-integrity.json`
- `evidence/phase1-acceptance-evidence.json`
- `evidence/wp7/full-source-delivery-closure.json`
- `evidence/wp7/legacy-cleanup-inventory.json`
- `evidence/wp7/preinstall-installer-sha256.json`
- `evidence/wp7/first-start-initialization.json`
- `evidence/wp7/no-contamination.json`

## 17. 开发者对抗式自审

必须完成`WP7_DEVELOPER_ADVERSARIAL_SELF_REVIEW_REQUIREMENTS.json/.md`全部挑战，包括A01-A10缺失/重复、测试阶段错配、WS追踪断链。当前执行状态：`NOT_STARTED`。

## 18. Convergence Pre-Review入口

- Implementation commit descends from accepted Activation binding commit and repository is clean.
- WS01-WS10 obligations whose requiredBeforePhase includes CONVERGENCE_PRE_REVIEW are complete.
- release/release-source.json and all generated consumers converge to credentialProtocolVersion 3.
- WP0 protected real build/package/release target exists and branch gate passes.
- Every PRE_REVIEW and PRE_REVIEW_AND_FINAL test has a pre-review PASS record.
- No FINAL_WINDOWS or FINAL_PACKAGING result is claimed as already executed.
- Fault, concurrency, crash and mutation suites pass with zero survivors/invalid/timeouts/signals/harness errors.
- Developer adversarial self-review passes every mandatory challenge with evidence pointers.
- A01-A10 mapping and WS01-WS10 traceability validators pass.
- Pre-review evidence is PRE_REVIEW_ONLY and cannot be presented as final installed-release evidence.

## 19. Final Packaging入口与退出

入口：
- Preaccepted implementation commit and tree remain byte-for-byte unchanged.
- All PRE_REVIEW and PRE_REVIEW_AND_FINAL pre-review executions remain PASS and no unresolved defect exists.
- Final build begins from a clean checkout and unique empty staging root.
- Complete source and Git history delivery tooling is ready and validated.
- Final Windows validation machine is reserved under an exclusive lease; cleanup has not been performed before authorization.
- Packaging commits are limited to authorized packaging, evidence and governance files.

退出：
- Every PRE_REVIEW_AND_FINAL test is rerun against final identities or final artifacts and passes.
- Every FINAL_PACKAGING test passes.
- Every FINAL_WINDOWS test passes on the designated machine against the sealed installer.
- A01-A10 each resolve to PASS using their normative test/evidence/oracle mapping.
- Complete bundle, patch, source ZIP, installer, evidence and SHA256 manifests bind to one Final Delivery identity.
- FINAL_INSTALLATION_MODE=CLEAN_INSTALL; legacy migration=false; legacy rollback=false.
- Installer SHA256 is verified immediately before execution.
- First start initializes fresh state; zero legacy/test residue remains.
- Independent final review is required before WP7_ACCEPTED or stage acceptance.

## 20. 本次禁止事项

- 不修改生产代码、运行时、数据库迁移、Electron/backend/frontend/shared协议。
- 不实现安装程序，不生成最终安装包。
- 不执行required tests，不声明任何测试PASS。
- 不清理Windows旧版本或残留。
- 不创建Convergence Pre-Review或Final Packaging。
- 不签发`WP7_DESIGN_GATE_CONFIRMED`、`WP7_ACCEPTED`或阶段级接受token。
