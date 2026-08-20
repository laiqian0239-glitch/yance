# 言策（Yance）全面现状审计报告

> 审计时间：2026-08-20（UTC）
> 审计范围：GitHub `laiqian0239-glitch/yance` 全仓库（main + 全部开放 PR/issue）+ 本地 `D:\模型\yance` 构建/测试健康度
> 审计性质：只读现状盘点，不含任何实现/合并/授权动作

---

## 一、结论摘要

项目处于 **Stage 6.4.5.9「WP7 生产依赖绑定刷新」授权已合并、实现 PR 已就绪但尚未合入 main** 的关口。全仓库有且仅有一个真正「可合并」的 PR（#529），其余 9 个开放 PR 全部被同一根因（`implementation-branch-policy` 委托治理不可变性断言）或 draft/dirty 状态卡住。本地 main 已出现 1 个真实的源码级 RED（生产依赖绑定 SHA 过期），该 RED 的修复体正是 PR #529。

**下一步最明确、风险最低的动作是：按普通合并（Create a merge commit）把 PR #529 合入 main。** 其余工作线（#431 Graphiti 切换 P0、失败 PR 的复活）都需要先走新的授权或复用 #529 已合并的授权修复。

---

## 二、仓库结构盘点

| 目录 | 文件数 | 体积 | 说明 |
|---|---|---|---|
| `backend/` | 756 | 7.1 MB | Node 后端，~270 个服务模块（AI 路由/学习/三平台适配/durable execution 等） |
| `tests/` | 561 | 2.4 MB | 顶层测试（532 个 `*.test.js`） |
| `backend/tests/` | 338 | — | 后端测试（338 个 `*.test.js`） |
| `frontend/` | 275 | 20.9 MB | 旧手写 SPA + r32 系列 UI（`index.html` + `js/` + 大量 `r32-*.css/js`） |
| `vendor/` | 335 | 114.6 MB | `npm/`（674 包）、`sillytavern/`、`assistant-ui-tool-ui/`、`rcedit/` |
| `release/` | 13 | 20.8 MB | `production-dependency-binding.json`（20.75 MB，本轮焦点）+ 发布配置 |
| `governance/` | 311 | 3.4 MB | 307 个 JSON（授权/基线/政策/闭包）+ 4 个 MD |
| `tools/` | 301 | 3.0 MB | WP0–WP7 / M1 / ACV2 / UAT / runtime-delivery 等工具链 |
| `docs/` | 178 | 1.5 MB | 架构/治理/发布/各 workline 设计文档 |
| `electron/` | 77 | 1.2 MB | 主进程、Graphiti/Parlant/Voice/Media 等 runtime |
| `services/` | 49 | 0.3 MB | `facebook-gateway`、`facebook-worker`、`matrix` |
| 根目录 | — | — | 大量 `ROUND*`/`BATCH*`/`FIX6*` 中文报告 + `AGENTS.md` |

- 提交总量 **2510**，全部集中在 2026-08（仅 1 个在 2026-07），说明这是一个在极短时间内高频推进的单一所有者治理项目。
- 语言：后端纯 CommonJS JavaScript，无 TypeScript。
- 产品身份：`release/release-source.json` 定义 `productName=言策`、`publicVersion=1.0.0`、内部版本 `29.2.7`、`distributionMode=LOCAL_PRIVATE_UNSIGNED`（私有单用户，非公开、非签名）。

---

## 三、main 分支状态

- `main` HEAD：`fc5b7ef2ab998e17b82d23e63368755cb95d708a`
  - 标题：`[Product][WP7] Authorize production dependency binding refresh v2 successor`
  - 时间：2026-08-20 00:18 UTC
- main 最近 10+ 提交全为 **授权类**提交（`Authorize ...`），符合 AGENTS.md 的「授权先行、实现随后」模式。
- 无标签（tag）存在于本地可见历史。

**关键发现（本地真实 RED）**：在 `main` 上运行 `npm run test:wp0`，86 项测试中有 2 个失败：

1. `implementation-branch-policy.test`（**环境相关，非源码缺陷**）——因为本地 checkout 的是 `main` 分支，而政策只接受 `stage/6.4.5.9-architecture-closure`、`rebuild/windows-release-closure-*` 或精确授权分支。这是「在错误分支上跑测试」的预期失败。
2. `v21-production-dependency-binding-lifecycle.test`（**真实源码缺陷**）——`release/production-dependency-binding.json` 内的 `packageJsonSha256`（`b1c3f414...`）与当前根 `package.json` 的实际 SHA256（`8c6e5384...`）不一致。

结论：**main 上的生产依赖绑定已过期**，需要重新生成 binding 才能通过 WP7 生命周期门禁。而 PR #529 的 diff 恰好只改 `release/production-dependency-binding.json` 这一个文件（+158936 / -136465 行），正是修复此 RED 的实现。

---

## 四、开放 PR 全景（10 个）

按「能否合并」分类：

### 4.1 ✅ 唯一可合并：PR #529

- 标题：`[Product][WP7] Close reviewed production dependency binding refresh v2`
- head：`84301621550fb05af75309938a547372a4eadd4a`
- `mergeable_state=clean`，`draft=False`
- 17 项检查：**12 success + 5 skipped，0 失败**
- diff：恰好 1 个文件 `release/production-dependency-binding.json`
- 拓扑：main 是 #529 head 的祖先（`main-ancestor-of-529=yes`，`529-ancestor-of-main=no`）→ **无漂移，可直接普通合并**
- PR 正文明确要求：普通合并（ordinary/Create merge commit），不 squash/rebase/force-push

### 4.2 🔴 已被 #529 取代：PR #525

- `[Product][WP7] Refresh reviewed production dependency binding`
- 2 项失败：`wp0-gates` + `wp0-product`
- 失败根因：`tests/wp0/implementation-branch-policy.test.js:1148` 断言失败（`expected true / actual false`），即委托治理（delegated-governance）不可变性判定问题；另有 `Electron official Release trust authority mismatch` 告警。
- 结论：已被 #529（successor）取代，无需单独处理。

### 4.3 🔴 AI Auto 对话 P0 系列（#517 → #519 → #521 三代 successor）

| PR | head | 失败 | 根因 |
|---|---|---|---|
| #521 | `7d65f04` | `wp0-gates` | `wp0-product` job 超时（25 分钟上限） |
| #519 | `4329a96` | `wp0-gates` + `wp0-product` | `implementation-branch-policy.test` 断言失败（同 #525 根因） |
| #517 | `3d650a0` | `wp0-gates` + `wp0-product` | 同上 |

三者的共同根因都是 #525/#519/#517 时代的 **delegated-governance 不可变性判定缺陷**，该缺陷的授权修复已合并到 main（`fc5b7ef` 等）并被 #529 的 successor 实现承载。**一旦 #529 合入，这一系列 PR 需要基于新 main 重新 rebase/forward-continue 才能复绿**（且必须遵守普通合并、不 force-push）。

### 4.4 🔴 预发布约会 AI 授权（PR #481）

- 1 项失败：`layered-ci-l2-governance / layered-ci-l2-portable-windows-latest`
- 失败根因：`real historical delegated L2 V2 head fails closed when canonical base no longer equals its authorization merge`（`trusted Git identity preparation must resolve current main and the preserved delegated L2 V2 ref`，`expected true / actual undefined`）。
- 性质：跨平台（仅 Windows 腿失败，Ubuntu 腿通过），属于 L2 委托治理身份解析的 Windows 路径问题。

### 4.5 🔴 ACV2 WP-B（PR #471）

- 17 项失败（`wp0-product`、`wp-b-validation-gate`、`wp-b-m2/m3-*`、`wp-b-governance-*` 等）
- 主根因：`implementation-branch-policy.test` 断言失败（同 #525/#519/#517），连带拖垮整个 WP-B 门禁矩阵。
- 另有独立 PR #466（`draft=True`，该 PR 的 scope amendment 授权）尚未生效。

### 4.6 ⚪ draft / dirty（PR #474、#466、#67）

- #474 `[Governance] Authorize prelaunch relationship tool route closure`：`draft=True`
- #466 `[Governance][ACV2 WP-B] Authorize source-closure scope amendment 2`：`draft=True`
- #67 `feat(oss-a): establish supply-chain implementation baseline`：`draft=True`，`mergeable_state=dirty`（长期挂起的 OSS 基线）

---

## 五、开放 issue 缺口（7 个）

| # | 标题 | 性质 | 与现状的关系 |
|---|---|---|---|
| **431** | V21 Graphiti relationship inference authority cutover P0 | **最新 P0 缺口**：`relationshipProjectionAuthority.js` 在无 Graphiti 推理行时仍回退 `legacy_projection` 并本地 `ruleProjection()`，产出 `social_rule_projection`/`message_baseline` 声明 | 需独立授权 + failure-first + 精确路径实现，不能复用现有任何授权 |
| 407 | V2.1 最终架构 & OSS 一致性闭环（能力完备性/唯一性/来源采纳） | 仓库级能力级闭环 | 长期目标，需逐能力审计 |
| 406 | 产品表面权威闭环——退役可达的旧 Web UI、审计重复运行时表面 | 后端仍发布旧 `frontend/` SPA + catch-all GET | 与 #431 类似，是待清理的「第二用户可达产品表面」 |
| 405 | Workline Reconciliation Closure——历史 backlog 去重与缺口闭环 | 对历史开放 workline 逐一终态分类 | 治理账务类，非代码 |
| 178 | V2.1 Parallel Workline Registry | 跨会话协调索引（非授权源） | 索引类 |
| 18 | [NEXT] OSS 加速（渠道/模型路由/reply brain） | 战略路线 | 长期 |
| 1 | FIX6J 隔离模型 Worker 去 SQLite 化 | 已标记「源码闭环，等待真实 Windows UAT」 | 源码已完成，卡在真实 UAT |

**最值得立即推进的是 #431**（有明确的源码级根因、明确的 target closure、无新依赖要求），但它要求「单独授权、failure-first、精确路径、普通合并」，是一个全新的 work package。

---

## 六、本地构建/测试健康度

| 检查项 | 结果 |
|---|---|
| Node / npm | `v24.18.0` / `11.16.0`（满足 `engines: node>=22.19`） |
| `npm ci --ignore-scripts` | ✅ 成功（613 包 / 16 秒，npm 公共源，无内部仓库 503 问题） |
| `npm run test:security-scan` | ✅ 6/6 PASS |
| `npm run test:wp0`（main 上） | 🔴 84/86 PASS，2 失败（见第三节） |
| git 工作树 | ✅ 干净 |
| git 身份/凭据 | `来钱 <laiqian0239@gmail.com>`；`gh` 已登录 `laiqian0239-glitch`（`repo`/`workflow` 权限） |
| 本地可 push | ✅ `git ls-remote origin HEAD` 正常 |

本地环境**足以运行全量后端回归与 WP0 门禁**（前提是在正确的授权分支上，而不是 `main`）。

---

## 七、治理协议执行状态

- 治理文件齐备：`governance/stage-policy.json`（Stage 6.4.5.9 FREEZE-POLICY）、`rejected-baselines/stage-6.4.5.8.json`、`repository-scope-policy.json`、`risk-acceptance-register.json` 等 307 个 JSON。
- `stage-policy.json` 关键约束：
  - `distributionMode=LOCAL_PRIVATE_UNSIGNED`，`privateSingleOwner=true`，`publicRelease=false`
  - 实现顺序固定：WP0→WP1→…→WP7
  - 禁止 4 类旧 release 机制（overlay installer、post-install patch 等）
  - 授权重建分支模式：`^rebuild/windows-release-closure-YYYYMMDD...$`
- AGENTS.md 强制：Fast Landing 批量因果闭环、failure-first、普通合并、不可变拓扑预检、合并边界需 owner 授权。
- **本轮审计发现的治理风险**：`implementation-branch-policy.test` 的委托治理不可变性判定在历史一段时间内错误放行/拒绝，导致 #525/#519/#517/#471 等一串 PR 在同一根因上反复 RED。该根因已在 main（`fc5b7ef`）修复，但**修复未随任何实现合入 main，因此 main 自身仍在 WP7 binding 生命周期上 RED**。

---

## 八、下一步行动建议（按优先级）

1. **【立即 · 低风险】普通合并 PR #529 到 main**
   - 唯一 `clean` 且无漂移的 PR，diff 仅 1 个文件，修复 main 上真实的 binding SHA 过期 RED。
   - 合并方式必须是 ordinary merge commit（符合 AGENTS.md 与 PR 自身要求），不 squash/rebase。
   - 合并后 main 的 WP7 生命周期门禁应复绿。

2. **【随后 · 中风险】让 AI Auto 系列（#521/#519/#517）基于新 main 重新 forward-continue**
   - 复用已修复的 delegated-governance 判定，用普通合并重建 successor，避免旧 RED 反复。

3. **【新 work package · 需授权】推进 issue #431 Graphiti 关系推断权威切换 P0**
   - 走完整 failure-first：单独授权 → tests-only 首提交 → 因果 RED → Closure Matrix → 生产实现 → 普通合并。

4. **【账务 · 低风险】处理 #405 Workline Reconciliation**，对历史 backlog 逐一终态分类。

5. **【战略 · 长期】#407 / #18 / #406**：能力级 OSS 闭环与旧 UI 退役，适合分批。

---

## 九、本次审计的动作边界说明

本报告为**只读审计**：未创建分支、未提交、未合并、未修改任何仓库文件（唯一新增物即本报告文件本身，属审计交付物，不计入源码门禁）。所有仓库改动建议均需在后续明确授权后按 AGENTS.md 协议执行。
