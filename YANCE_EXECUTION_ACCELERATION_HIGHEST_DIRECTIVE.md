# Yance 最高执行加速指令

> **状态：永久生效；跨聊天强制读取。**
>
> 本文件是 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1 的**强制执行语义补充**，目标是在**完全不降低架构、安全、许可证、failure-first、exact-Head、独立 review、reproducibility 与 merge gates 强度**的前提下，最大限度消除重复下载、重复 materialization、重复全量验证和人工往返。
>
> 本文件不得用于扩大任何既有 work package scope，也不得覆盖实时 GitHub 事实、正式 authorization、许可证/安全边界或 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` 的架构决策。若需要修改当前 work package 之外的生产/治理路径，必须进入相应正式授权边界。

---

## 1. 最高目标：加速来自删除重复成本，不来自减少验证

固定原则：

> **保持门禁强度不变，优化等待时间、网络传输、重复 materialization、重复计算和人工往返。**

永久禁止用以下方式“加速”：

- 跳过 failure-first / TDD；
- 跳过或弱化 WP0 / Layered / ACV2 / exact-Head / final validation / reproducibility；
- 用 `continue-on-error`、吞错、宽松 patch、fallback bypass 或假 GREEN 掩盖真实 RED；
- 临时 patch、临时兼容层、旁路脚本长期代替底层修复；
- force push、squash、rebase/amend 已发布历史；
- 因本地/connector 限制而改成低可信手写 lock、integrity 或伪造 package-manager 结果。

---

## 2. 强制验证分层：开发快，封口严，最终完整

除正式治理另有更严格要求外，后续工作包默认按三层执行。

### 2.1 开发迭代层

目标：最快完成 causal RED → 最小 GREEN。

默认只运行：

- 当前 failure-first test；
- 受影响的 contract / WP0 tests；
- 受影响 package/module 的 lint / typecheck / build；
- 与当前根因直接相关的 architecture regression。

禁止每修一个小 RED 都无差别重复下载全部大型 OSS、重复完整 Windows UAT 或完整两轮 reproducibility。

### 2.2 工作包 closure 层

进入 package closure 时运行该 work package 所有正式适用门禁，例如：

- 完整相关 WP0；
- Layered / architecture gates；
- ACV2 / delegated policy gates；
- 对应平台 runtime / Windows gates；
- exact changed-path / scope / authority / license / provenance 核验。

### 2.3 最终 merge 边界层

最终 Ready / merge 前不得缩减验证，必须按 work package 正式合同执行：

- fresh live `main` / trusted base；
- exact Head；
- exact path-set / scope / digest；
- exact-source materialization；
- 正式要求的两轮 clean reproducibility；
- frozen dependency install；
- build / typecheck / runtime validation；
- final exact-head workflow；
- independent review 与 0 unresolved P0/P1；
- ordinary two-parent merge（适用时）。

**分层只改变“何时运行重门禁”，不改变最终必须通过哪些门禁。**

---

## 3. 外部成熟 OSS exact-pin materialization：禁止无意义 full-history clone

当目标只是验证/构建某个外部成熟 OSS 的**精确 40 位 commit**，且不需要完整历史时，默认 materialization 模式必须是：

```text
git init
→ git remote add origin <upstream>
→ git fetch origin <exact-40-char-SHA> --depth=1
→ git checkout --detach FETCH_HEAD
→ verify HEAD == exact SHA
```

禁止默认先做：

```text
git clone --no-checkout <large-upstream>
```

再补一个 `--depth=1` fetch，因为前面的 clone 已经可能下载大量无关历史。

只有以下情况可以使用更深历史：

- 上游构建/版本计算确实依赖历史；
- patch/provenance 验证明确要求 ancestry；
- 正式治理合同要求完整历史；
- shallow fetch 对该上游/commit 技术上不可行。

一旦例外成立，必须记录原因和实际需要的最小 history depth。

**本规则针对外部 OSS materialization；不得擅自降低 Yance 自身治理 workflow 为验证 ancestry、trusted base、merge-base 等所需要的 fetch depth。**

---

## 4. 两轮 clean reproducibility 允许复用不可变下载缓存

“clean”要求的是**两个独立、新建、无前轮可变工作状态污染的工作目录**，不等于必须把同一批不可变字节从互联网下载两次。

在不改变 source identity 的前提下，允许并鼓励复用：

- content-addressed Git object cache / mirror；
- pnpm content-addressed store；
- npm cache（正式 npm work package 适用时）；
- exact Node / pnpm / Python / uv 等已校验工具链；
- exact Electron / browser / model / OSS archive；
- 其它有完整 SHA-256 / upstream identity 的不可变 artifacts。

缓存硬要求：

1. key 必须绑定 exact version / commit / hash；
2. 复用前必须核验 identity/hash；
3. 不得复用前一轮的 mutable workspace、`node_modules` 工作树状态、构建输出或被 patch 后的 source tree 来冒充 clean materialization；
4. 两轮仍必须创建独立 fresh workdirs，并分别执行正式 patch replay / frozen install / build / typecheck；
5. 最终比较正式合同要求的 source/package/lock/build hashes；
6. cache miss 只能导致重新下载，不能导致 gate 被跳过。

---

## 5. 工具链与大型二进制：一次取得、精确校验、长期复用

对于 Node、pnpm、Electron、浏览器、Python/uv、模型文件、OSS tar/zip/bundle 等大文件：

- 首次取得后记录 exact upstream/version/SHA-256；
- 保存到明确的 content-addressed / versioned cache；
- 后续相同 identity 优先复用并重新 hash 验证；
- 不因小代码改动重复下载数百 MB/GB 的相同字节；
- 新版本或 hash 变化必须视为新 artifact，不可静默覆盖旧 cache；
- 用户已上传的 exact artifact / cache / bundle，只要重新验证身份，应优先复用，不要求重复上传或下载。

---

## 6. CI 等待期间必须并行推进可独立工作

等待 GitHub Actions、Windows runner、远端 artifact 或下载时，不得无意义停顿。

可并行执行：

- live main / exact Head / scope / changed paths 只读核验；
- upstream / license / provenance / OSS-fit 只读研究；
- review threads / P0/P1 独立审查；
- 下一步 failure-first test 设计；
- 不修改同一共享状态的独立证据整理；
- cache / materialization 性能根因分析。

禁止在 CI 未给出真实 RED 前猜测性修改 production。

---

## 7. 本机 Windows 协作：默认直接可复制命令，减少包装层

当 ChatGPT 当前执行环境确实缺少 Windows、GPU、私有二进制、大型网络下载或其它无法替代的本机能力时：

1. **优先给用户一段可直接复制粘贴的完整命令块**；
2. 命令必须包含 exact refs/versions/hashes、明确 GREEN/RED、失败位置和 evidence 输出；
3. 不要求用户逐条手工判断中间状态；
4. 不修改与当前工作线无关的 worktree；
5. 能由 ChatGPT/GitHub connector 完成的工作不得转嫁给用户；
6. 用户只需在真实环境边界提供必要运行结果、artifact 或最后错误证据。

只有当操作需要长期复用、命令长度/结构已不适合安全粘贴，或确实需要可重复工具时才生成脚本。此类脚本在交给用户前必须优先通过最小环境/参数/退出码自检；禁止为了“一键化”增加脆弱的 PowerShell/native-command 包装基础设施。

如果一次性直接命令已经更可靠、更快，就优先直接命令。

---

## 8. 真实 RED 与脚手架 RED 必须严格区分

后续任何失败必须先分类：

- **product/contract RED**：真实产品、依赖、runtime、architecture contract 不满足；
- **governance RED**：authorization/scope/gate/receipt 不满足；
- **environment/tooling RED**：runner、shell、下载、toolchain、脚手架自身失败。

环境/脚手架 RED 不得冒充 product RED，也不得因此修改产品代码。

连续出现脚手架失败时必须修脚手架根因或直接移除不必要的包装层，不得叠加 V1/V2/V3 临时绕过。

---

## 9. 性能问题也按底层根因修复

一旦发现测试/构建主要时间消耗来自重复 full clone、重复下载同一 artifact、无差别全量测试或人工往返：

- 将其记录为正式工程效率根因；
- 优先重构 materializer/cache/test routing；
- 不通过删测试或弱门禁解决；
- 如果修复路径超出当前 work package scope，则建立独立授权工作包，当前 work package 不偷改跨 scope 生产/治理路径。

当前已识别的典型反模式：外部大型 OSS materializer 先 full clone 再 exact-SHA shallow fetch。未来相关授权工作应迁移到本文件第 3 节的 exact-SHA shallow materialization 模式。

---

## 10. 新聊天强制恢复流程

任何新聊天开始 Yance 工作前，必须：

1. 读取 `START_HERE.md`；
2. 读取 `YANCE_IMPLEMENTATION_MASTER_PLAN.md`；
3. 读取本文件 `YANCE_EXECUTION_ACCELERATION_HIGHEST_DIRECTIVE.md`；
4. 读取 `PROJECT_CONTINUATION.md` 或当前 workline 专用 SSOT/handoff；
5. fresh 核验 live GitHub main / exact Head / PR / workflows / review / scope；
6. 从 SSOT 指定的唯一下一步继续，禁止重新猜测已经完成的排查。

本文件的目标不是让测试“少做”，而是让**同样严格的最终证据更快、更少重复地获得**。
