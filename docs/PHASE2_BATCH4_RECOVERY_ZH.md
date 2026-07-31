# 言策 Windows Phase 2 Batch 4 重建说明

## 身份边界

本次工作从可验证的 Phase 2 Batch 3 检查点恢复：

```text
ParentCommit=44650398ebe78e8c035b29bf6d78a57a739a083e
ParentTree=b61d446a9d2a970cc0e3d927012952940fd14e29
RecoveryBranch=rebuild/windows-product-experience-closure-20260720-phase2-batch4-recovery
```

原 Batch 4 提交 `08d8220db27df4f4c99a8b555d0ae33f9a4bebd6` 及其 Tree
`f74665a7d91e3262fd939130bd029c7c7a214cce` 已丢失，无法逐字节恢复。本重建版只声明功能等价目标，绝不冒充原提交。

## 已重建范围

### 客户档案、关系轨迹与 Persona 双语展示

- 服务层将事实、推断、承诺、边界、里程碑、风险、建议和关系摘要整理成中文优先展示结构。
- 所有展示行同时保留 `sourceText`、`translatedZh`、翻译状态和原始来源。
- 没有中文理解时显示“中文理解待生成”，不把字段名、英文标题或猜测文本当作译文。
- 客户档案和关系轨迹增加中文理解卡片，并可展开查看外语原文。
- Persona 增加中文结构化可读卡片；权威 JSON 仍保留为高级编辑入口。
- 中文展示层不会覆盖权威原始数据，推断也不会被提升为事实。

### Telegram 原生贴纸与已保存 GIF 发送

- 继续通过当前登录的 GramJS 会话读取最近贴纸和已保存 GIF。
- 后端生成短时、账号隔离的 opaque 引用；前端不接触 `accessHash` 或 `fileReference`。
- 支持通过登录会话中的原生文档对象发送 WebP、TGS、WebM 贴纸和已保存 GIF。
- 引用过期、账号不匹配或类型不匹配时返回明确错误。
- 贴纸不能附带文字，发送后保留输入框文字；GIF 可使用输入框文字作为 caption。
- TGS 仍只显示格式图标，不伪装成已实现 Lottie 动画预览；WebM 使用媒体预览。

### Facebook 生产部署前置

新增 `tools/facebook/prepare-production-config.js`：

- 固定校验 Worker 名称与 URL、OAuth Callback、Webhook、Graph Version、Business Login Configuration ID、D1 和 R2 绑定。
- `--resolve-d1` 只调用已登录的 `wrangler d1 list --json` 查询现有 D1 ID。
- 只生成公开部署配置和预检报告，不执行部署，不创建 Worker、D1 或 R2。
- 不读取、不写入、不打印 Secret；输出配置会过滤 Secret/Token/Private Key 类字段。
- `pages_read_engagement` 仍被视为真实 OAuth 后才能判断的可选历史同步权限，预检不会冒充已经授权。

## 验证边界

本重建版执行的是源码和合同级门禁。它不等于：

- 真实 Windows Electron 逐页视觉 UAT；
- 真实 Telegram 账号的 WebP/TGS/WebM/GIF 发送；
- TGS Lottie 动画预览；
- Facebook Worker 生产部署；
- 真实 Facebook OAuth、主页选择、D1 三表和消息收发；
- 完整 Pipeline、WP7、STRICT Round 1/2 或 Builder。

只有完成对应真实环境验证后，才能声明平台或 Windows PASS。
