# Yance OSS-First 开发最高指令

> **状态：永久生效；跨聊天强制读取；适用于所有未来开发、修复、UAT、runtime、packaging、tooling、governance work package。**
>
> 本文件强化 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1 的“成熟 OSS Mandatory Adoption”原则。它不是建议，而是开发准入顺序。任何开发者、Agent、聊天、CI 设计或 work package 都不得先写 Yance 自研方案，再在出问题后补做 OSS 调研。

## 1. 第一问固定为：成熟 OSS 是否已经拥有这个能力？

任何新 work package、任何新功能、任何 RED 修复、任何 UAT/runtime/packaging/tooling 问题，在设计实现之前必须先回答：

1. 是否存在成熟 OSS 完整产品可以直接拥有该能力？
2. 是否存在成熟 OSS Sidecar / service 可以直接拥有该能力？
3. 是否存在成熟上游源码模块可以直接移植？
4. 是否存在官方 SDK / CLI / native prebuild / packaging/runtime 工具可以直接采用？
5. 仓库是否已经存在成熟 OSS seam 或已验证的 upstream runtime，可以复用而不是再造一套？
6. 当前 Yance 是否已经有同类自研实现；若成熟 OSS 可接管，是否应退休该自研实现？

在这些问题没有形成可审计结论前，**禁止进入 production implementation**。

## 2. 采用顺序是硬顺序

```text
完整成熟 OSS 产品
  ↓
成熟 OSS Sidecar / 服务
  ↓
成熟上游源码模块整块移植
  ↓
官方 SDK / CLI / native prebuild / packaging runtime
  ↓
复用仓库已有成熟 OSS seam
  ↓
极薄 Yance adapter / branding / config / permission / projection
  ↓
只有经过 OSS-fit 证明仍有真实缺口时，才允许最小 Yance 自研
```

禁止：

- 参考上游后用 Yance 重写一遍；
- 因为“现在已经有一套 Yance 代码”就继续修补，而不重新评估是否应该直接退休；
- 为一次 UAT、安装、runtime、下载、缓存、native build 问题再造新的 installer/runtime/package-manager/download framework；
- 把用户开发机已有 Node/Python/VS/SDK/系统工具链变成产品运行时依赖，只为了延续 Yance 自研 delivery 路径；
- 在成熟 OSS 已提供 prebuild、portable runtime、installer、bundle、SDK、protocol、state machine 时，再写等价 Yance engine。

## 3. RED 修复也必须先重新做 OSS-fit

出现真实 RED 后，固定顺序为：

```text
定位 causal RED
→ 判断失败属于 product / governance / environment/tooling
→ 重新检查成熟 OSS 是否已经解决该类问题
→ 如果有：优先迁移/替换/复用成熟 OSS seam
→ 退休被替代的 Yance 自研路径
→ failure-first 证明迁移前缺口
→ 最小 glue GREEN
→ 正式 closure gates
```

**禁止**默认采用：

```text
RED
→ 在当前 Yance 自研链路加一个补丁
→ 又出现 RED
→ 再加一层脚本/配置/fallback
```

连续两次 environment/tooling RED 指向同一 Yance 自研 runtime/installer/materializer/package wrapper 时，必须触发一次强制 OSS-fit 复审，优先判断是否应删除该包装层。

## 4. 每个未来 authorization 必须有 OSS-fit 证据

任何新的正式 work package authorization 必须记录至少：

- `ossFit.decision`；
- `ossFit.reviewedCandidates`；
- 每个候选的来源/仓库或现有 repository seam；
- license；
- adoption mode；
- FIT/GAP 结论；
- `selectedAdoptionMode`；
- `matureOssAvailable`；
- `newGeneralPurposeInfrastructure`；
- 如果仍需 Yance 自研：明确真实 uncovered gap，以及为什么完整产品 / Sidecar / 源码模块 / 官方 SDK / native prebuild / 极薄 adapter 都无法满足；
- 如果已有等价 Yance 自研：明确 `retireOrAvoid` 计划。

缺少这些证据时，authorization 必须 fail-closed，不得进入 implementation。

## 5. Yance 允许拥有的代码边界

默认允许：

- Branding / product composition；
- 用户设置、权限、最终发送决策；
- 极薄 adapters / projections；
- OSS 配置和 exact-pin materialization；
- compatibility / security / identity tests；
- 必要的 upstream patch；
- 经 OSS-fit 证明不存在成熟方案后的最小真实 gap。

默认禁止新增第二套：

- communications transport；
- memory / relationship graph；
- Agent runtime / chat streaming / tool protocol；
- model gateway/router；
- learning/training/eval/observability framework；
- STT/TTS/image/photo/WebRTC/avatar engine；
- workflow engine；
- installer / package manager / native build framework；
- downloader/cache/materializer framework；
- runtime state machine；
- OSS 已经提供的 packaging/prebuild/runtime delivery engine。

## 6. UAT / Windows / packaging 特别规则

UAT 的目标是验证**真实产品候选**，不是维护第二套源码运行环境。

默认优先：

- 上游官方 portable runtime / prebuilt binaries；
- Electron/Node/原生依赖的官方或上游 prebuild；
- CI 中完成 frozen dependency materialization 和 native binary closure；
- 将可运行候选交给真实 Windows，只做 hash/identity verify → launch → UAT → evidence。

除非正式 OSS-fit 证明不可行，否则禁止要求 UAT 用户机器现场：

- `npm ci` / `pnpm install`；
- `node-gyp rebuild`；
- 安装 Visual Studio build tools / Spectre SDK；
- 编译 native addon；
- 下载本应由候选携带的 runtime；
- 修复开发工具链才能启动产品。

## 7. 速度原则

成熟 OSS 优先也是速度规则：

- 先整块采用经过社区验证的实现，再做薄集成；
- 不把一晚时间花在维护可以被成熟 OSS 删除的自研链路；
- CI 等待期间优先完成 OSS-fit、upstream exact pin、license/provenance、source-module boundary；
- 如果成熟 OSS 已经解决问题，删除/退休自研代码通常优先于继续修补。

## 8. 与现有 V2.1 的关系

本文件：

- 不削弱任何 failure-first、WP0、Layered、ACV2、exact-Head、review、reproducibility、license、安全门禁；
- 不自动扩大既有 work package scope；
- 不要求已正确完成的成熟 OSS 集成重新实施；
- 只把“成熟 OSS Mandatory Adoption”前移为**所有未来开发和修复的第一准入步骤**；
- 与 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` 冲突时，架构事实仍以 Master Plan 为准；本文件负责强制执行 OSS-first 顺序。

## 9. 固定执行口令

所有未来工作包开始时，执行者必须先问：

> **“这个能力现在是谁在成熟 OSS 中已经做成熟了？我们能不能整块移植/采用？如果能，为什么还要写 Yance 自研？”**

如果回答不出来，**不进入实现。**
