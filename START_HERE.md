# 言策跨聊天执行入口

> **任何新聊天在修改仓库前，必须按以下顺序读取并核验。**

## 1. 当前精确状态

读取 [`PROJECT_CONTINUATION.md`](./PROJECT_CONTINUATION.md)：

- 当前任务、阻塞和下一步；
- 精确分支、commit SHA、workflow run/job；
- 授权路径、receipt 与正式门禁；
- 禁止绕过、强推、历史改写和弱化门禁规则。

## 2. 稳定总实施方案

读取 [`YANCE_IMPLEMENTATION_MASTER_PLAN.md`](./YANCE_IMPLEMENTATION_MASTER_PLAN.md)：

- “尽快让言策真实落地”的最高指标；
- OSS-A～OSS-G 总路线；
- PR #17 资产提取与 PR #19 总设计顺序；
- 成熟开源模块的完整移植、固定依赖、Sidecar 和行为合同规则；
- 唯一 ChannelDriver、Canonical 数据层、Capability Manifest；
- WhatsApp、Telegram、Signal、Meta、LINE、KakaoTalk、iMessage、Google Messages；
- 手机与 macOS Companion Host；
- 欧美、日本、韩国 Dating Companion Mode；
- 单一言策会话中心、联系人体系和 AI 回复界面；
- WP-B 持久执行、AI 模型栈、关系图、Style Genome、学习成长和统一 UI；
- 并行实施线路与固定验收门禁。

## 3. 冲突处理

- 当前远端 refs、正式治理凭据、精确 Actions 证据高于状态文档；
- `PROJECT_CONTINUATION.md` 高于旧聊天中的临时状态描述；
- `YANCE_IMPLEMENTATION_MASTER_PLAN.md` 是稳定范围和路线，具体实施仍受工作包授权与路径清单约束；
- 发现文档与远端事实冲突时，先停止修改、核验事实，再用普通提交更新状态文档；不得 amend、rebase 或 force push。

## 4. 固定分支

所有跨聊天状态文档固定保存在：

`project-state/active-handoff`
