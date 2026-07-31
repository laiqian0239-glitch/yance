# 言策 f25fe2e 修复 Batch 20 源码变更摘要

## 身份

- Branch：`development/windows-uat-f25fe2e-repair-batch20-ai-ux-readability`
- Implementation Commit：`2ea0b43cc6cff09b88a889ac60284c14a7f7a660`
- Implementation Tree：`f31522bbfcab7fd4fe63ee1e232c68b17f029f66`
- Logical Parent Commit：`d06ee1183fa5973cf092bcc553aa06d0b5d6a88b`
- Logical Parent Tree：`b4b1fdddaa62276681e53684ad71de00e0545d47`

## 本批范围

1. 快捷候选、生成状态、微调、证据和重试迁移到右侧 AI 回复大脑。
2. 会话输入区压缩为两条单行控制，删除重复说明，发送路由改为能力状态胶囊。
3. OpenRouter 接入拆分为安全存储、鉴权、目录、两个独立云模型最小真实调用、条件路由和正式商业评估；不再把保存 Key 或拉取目录冒充接入成功。
4. AI 候选生成新增可观察任务操作、模型回执、成功/失败状态和重试入口。
5. Persona 读取增加超时、重试和中文恢复提示，不再直接显示 `Failed to fetch`。
6. WhatsApp、Telegram 登录确认成功后停止旧二维码任务，显示成功/同步并自动关闭或跳转。
7. 阅读与界面密度升级为全平台字体、密度和对比度权威并持久化。
8. 继续继承 Batch 19 平面文档流，防止主要生产页面重新出现固定高度嵌入式工作台。
9. 保留“平台确认发送成功后才学习”的治理口径。

## 自动回归

- Batch 20 直接契约：11/11 PASS
- Chromium 平面布局与可读性矩阵：81/81 PASS
- 全后端分片：159 个测试文件，938/938 PASS
- UAT：142/142 PASS
- 源码 UAT 交付：33/33 PASS
- Round 13 AI 质量：24/24 PASS
- 交友快速回复与学习：27/27 PASS
- 主题审计：PASS，固定颜色债务 0

## 未由本源码环境证明

- 未重新执行一次干净 `npm ci`，Windows 一键启动器会在本机执行锁定依赖安装。
- 未取得真实 Windows Electron 截图、操作与 DPI 证据。
- 未使用用户真实 OpenRouter Key 完成真实鉴权、目录、两个独立云模型调用及正式商业评估。
- 未取得 WhatsApp、Facebook、Telegram 真实入站、发送、失败发送、学习与重启持久化证据。

治理状态保持：`REPAIR_ATTEMPT_IN_PROGRESS / WINDOWS_UAT_BLOCKED / formalRelease=false / readyForPromotion=false`。
