# 言策跨聊天执行入口

> **任何新聊天在修改仓库前，必须按以下顺序读取并 fresh 核验。**

## 0. 唯一稳定架构指令

首先读取 [`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md)。

该文件自 V2.1 起是 **Yance 唯一稳定架构与实施指令**。当前 V2.1 已吸收 `Relationship Intelligence Enhancement`，它是 V2.1 的严格超集增强，不是 V2.2，也不允许推倒已完成或已授权工作包重来。

冲突优先级固定为：

1. 当前远端 refs、正式治理凭据、exact Head、workflow、review、receipt；
2. `YANCE_IMPLEMENTATION_MASTER_PLAN.md` V2.1；
3. `PROJECT_CONTINUATION.md` 动态接续；
4. 明确声明只补充 V2.1 的专项合同；
5. Git 历史只用于审计，不作为当前执行指令。

## 1. 当前最高产品定位

Yance 固定为：

> **个人使用、开源、面向真实交友 / 情感 / 长期关系沟通的 AI 助手。**

不是 CRM、销售漏斗、营销自动化或客服工单产品。

用户只看到一个 Yance；底层允许成熟 OSS 分别拥有最适合的运行状态。Yance 保留单一产品身份、统一设置/通知体验、统一工作区、用户确认与最终发送决策，不为了“全部自己拥有”再复制成熟 OSS 已经提供的第二套状态机。

## 2. V2.1 能力不回退

后续升级必须覆盖并继续增强既有 V2.1：

- Matrix / Synapse / Element / mautrix 多平台；
- WhatsApp / Telegram / Signal / Facebook / Instagram / Google Messages 等平台目标；
- Letta + Graphiti 长期关系记忆；
- Parlant Relationship Goal/Journey；
- LiteLLM + RouteLLM；
- Langfuse + OpenTelemetry + DSPy + Promptfoo；
- SenseVoice / STT + CosyVoice VoiceProfile；
- Immich + ComfyUI；
- CyberVerse + LiveKit + Avatar backends；
- Docling / OCR / Retrieval / MCP；
- Windows / Electron / 安装 / 更新 / 备份 / UAT；
- exact upstream、license、SBOM、failure-first、exact-Head merge gate。

不得因为新增 Relationship Intelligence 而削弱这些能力。

## 3. 最高工程原则：成熟 OSS 默认接管

采用顺序：

```text
完整成熟开源产品
        ↓
完整成熟服务 / Sidecar
        ↓
成熟源码能力模块
        ↓
官方 SDK / 固定依赖
        ↓
极薄 Yance Adapter
        ↓
只有证明没有成熟 OSS 可满足时才允许最小自研
```

任何新的 Yance 自研基础设施必须先通过 V2.1 OSS-fit；存在成熟 OSS 可覆盖约 80% 以上核心需求时，原则上禁止重写等价基础设施。

继续永久禁止：临时绕过、弱化门禁、跳过测试、强推、amend/rebase 改写已发布历史、伪造成功状态。

## 4. 当前推进模式：完整工作包连续落地

当前采用**快速落地模式**，不是“小 Task 一步一请示”。

- 已正式授权的 work package：failure-first 成立后连续实施到完整 GREEN closure；
- CI 等待时并行做只读 upstream/license/diff/scope/review 核验；
- ordinary merge 必须保留 two-parent history；
- 不强推、不 rebase、不 amend published history；
- 不为了速度绕过 gate、吞错或缩测试。

### 4.1 standing owner authorization

用户已经给出持续 owner authorization：

> 对**已经正式授权且 scope 已冻结**的工作包，只要 merge-time fresh 核验仍满足 exact Head 无漂移、trusted base 无漂移、授权 path-set/digest 无漂移、适用永久门禁 GREEN、独立 review 完成且 0 unresolved P0/P1，就可以直接完成 routine source merge，**不需要再次停下来逐次请示**。

该持续授权**不等于**无限授权。遇到以下任一情况必须停在真实边界：

- 新 work package / 新路径 / scope expansion；
- 正式 authorization 缺失或需要升级；
- TRUE RED；
- license / security / privacy / credential authority 新边界；
- production release / publish / promotion；
- 需要弱化、绕过或改变现有治理规则。

## 5. 大文件固定交付规则

后续遇到大文件、二进制、超长源码、ZIP/tar/cache/bundle、Git LFS 对象或网页/GitHub connector 不适合可靠写入的文件：

1. **不要反复尝试网页大文件写入，也不要截断内容。**
2. 优先由 ChatGPT 生成/整理**完整本地文件、补丁、ZIP、bundle 或离线 cache 包**并提供给用户。
3. 用户在自己的电脑上把该文件上传到聊天或 GitHub。
4. 上传后必须重新做 byte/blob/hash 核验，再把远端文件作为事实来源。
5. 如果文件必须由 npm/系统包管理器在线生成，而执行环境无网络，则给用户精确本机命令，由用户生成后上传；不得手写 lock/integrity 冒充真实包管理器输出。
6. 大文件不得因为 connector 限制而改成临时架构绕过。

**跨聊天注意：** 当前聊天的 `/mnt/data` 是会话本地资产，新聊天不得假定仍能访问。需要继续使用时，必须由用户重新上传，或从 GitHub/正式 artifact 重新取得。

## 6. Relationship Intelligence 固定方向

当前新增但不替代旧 V2.1 的关系智能层包括：

- Persona / Style；
- Relationship Profile；
- confirmed fact / user fact / AI inference 分层；
- Important Moments / Relationship Timeline；
- Conversation Goal / Relationship Journey；
- 多方向 Reply Candidates；
- Emotion Context；
- 聊天后可证据化学习。

优先成熟 OSS：Letta、Graphiti、Parlant、SillyTavern 可许可模块、SenseVoice、CosyVoice、Immich、ComfyUI、Docling、MCP、pgvector/Qdrant、LiveKit/Pipecat 等。

## 7. Facebook 固定现代化方向

Facebook 必须区分：

- **Facebook Page / 公共主页**；
- **Facebook Personal / 个人账号**。

Page 后续不再默认扩大 Yance 自研 Facebook transport。独立工作包评估：

1. **Official Page Engine**：Chatwoot OSS Facebook Channel 可移植核心 + Meta 官方 API/SDK/schema；
2. **Optional Session Engine**：facebook-chat-api/FCA-compatible 账号/session 路线，仅在 2026 真实账号 + 真实 Page 登录、2FA、appState、收发、Business Suite echo、Page identity switch、重连和 Windows/Electron probe 通过后准入。

Session 方案不得长期保存明文密码；成功后只保存加密 session/appState。不能凭旧 README 支持 `pageID` 就宣称当前可用。

## 8. 当前精确动态状态

读取 [`PROJECT_CONTINUATION.md`](./PROJECT_CONTINUATION.md)，随后必须从 GitHub fresh 核验 main、PR、workflow、review、exact Head。`PROJECT_CONTINUATION.md` 可能滞后，实时 GitHub 事实永远优先。

当前已经完成的 Letta P0 v2 不得在新聊天重新实施；详见动态接续文件。

## 9. 工作包隔离

- 当前已经完成的 Communications P0 / Letta P0 v2 不得重做；
- Relationship Enhancement 不自动扩大任何旧 authorization；
- Facebook modernization、Graphiti、Parlant、SillyTavern、SenseVoice、CosyVoice、Docling、MCP、模型路由等必须各自走独立 OSS-fit / authorization / RED-GREEN / PR；
- 普通 merge 保留 two-parent history；
- standing owner authorization 只覆盖**已有正式 scope 的 routine source merge**，不覆盖新 scope 或 release/publish/promotion。

## 10. 旧开放 PR 的处理

仓库存在大量历史 Draft/open PR。**Open 不等于当前可执行。** 新聊天不得根据旧 PR 正文中的 SHA、状态或旧授权直接继续、合并或扩大范围。

对 #17、#20、#21、#23、#25、#28、#30、#33、#35、#37、#42、#43、#44、#50、#53、#54、#65、#67、#85、#92、#93 等旧线：

- 先 fresh 核验 remote refs / 当前 main / supersession；
- 默认视为历史或待重新评估状态；
- 未被当前 V2.1 active handoff 明确选为下一工作包前，不自动恢复执行；
- 不污染新 work package。

## 11. 固定分支

跨聊天稳定/状态文档固定在：

`project-state/active-handoff`
