# Gate 0 Clean Install Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以锁文件绑定的可信依赖缓存种子修复内部镜像缺少 `yauzl@2.10.0` 的确定性安装失败，并生成不可误报的干净安装收据。

**Architecture:** 新增独立 DependencyInstallAuthority，验证 policy、package-lock 与 vendor tarball 的三方一致性，再把可信 tarball 种入本次安装专属 npm cache。现有 Source UAT 安装入口只消费该权威输出，仍执行完整 `npm ci` 和依赖完整性校验。

**Tech Stack:** Node.js 22、CommonJS、npm 10、Node TAP、SHA-256、npm SHA-512 integrity、Electron 39.8.5。

## Global Constraints

- 禁止临时绕过，必须底层重构。
- 先写失败测试并确认 RED，再写生产实现。
- 不得降低校验、放宽正式资格或用文案掩盖失败。
- 非 Windows 环境不得签发真实 Windows UAT 收据。
- 当前版本保持 `PARTIAL`、`readyForPromotion=false`、`formalRelease=false`。

---

### Task 1: 可信依赖种子验证

**Files:**
- Create: `backend/tests/cleanInstallAuthority.test.js`
- Create: `tools/runtime-delivery/dependency-install-authority.js`
- Create: `governance/dependency-install-policy.json`
- Create: `vendor/npm/yauzl-2.10.0.tgz`
- Create: `vendor/npm/README.md`

**Interfaces:**
- Produces: `verifyTrustedDependencySeeds(repoRoot, options): VerifiedSeedSet`
- Produces: `seedTrustedDependencyCache(repoRoot, options): CacheSeedReceipt`

- [ ] Write tests for lock/policy/archive mismatch and successful cache seeding.
- [ ] Run tests and confirm RED because the authority module is absent.
- [ ] Add the policy-bound vendor artifact and minimal authority implementation.
- [ ] Run focused tests and confirm GREEN.

### Task 2: Source UAT installation integration

**Files:**
- Modify: `tools/runtime-delivery/source-uat-delivery.js`
- Modify: `tools/runtime-delivery/start-source-uat.js`
- Modify: `tests/runtime-delivery/source-uat-delivery.test.js`

**Interfaces:**
- Consumes: `seedTrustedDependencyCache()`.
- Produces: `installDependencies(...).cleanInstallReceipt`.

- [ ] Write failing integration tests that require private npm cache, `prefer-offline`, seed receipts and fail-closed errors.
- [ ] Run tests and confirm RED.
- [ ] Integrate the authority before every npm ci path without changing registry semantics.
- [ ] Run focused and regression tests.

### Task 3: Windows verifier and evidence

**Files:**
- Create: `tools/uat/verify-clean-windows-install.js`
- Create: `backend/tests/cleanWindowsInstallVerifier.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `CLEAN_INSTALL_RECEIPT.json` with install and launch state.

- [ ] Write a failing test for non-Windows non-promotion and receipt schema.
- [ ] Implement verifier with explicit Windows gate and no false launch claims.
- [ ] Run focused tests.
- [ ] Run source UAT delivery suite and package-level verification.
