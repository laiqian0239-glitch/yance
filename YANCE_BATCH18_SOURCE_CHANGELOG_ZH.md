# 言策 f25fe2e Windows UAT 修复｜Batch 18 源码变更说明

## 修复范围

1. 新增候选生成代次与最新入站消息指纹权威。新消息到达后，旧分析与旧候选任务即使稍后返回，也不能覆盖最新候选。
2. 账号路由拆分为“身份绑定冲突”和“平台发送能力阻断”。已绑定但 `canSend` 尚未确认不再显示为来源冲突；只有明确的 `reauthorize`、凭据过期或登出状态才提示重新授权。
3. 账号别名解析补充 `snake_case`、Page ID、Source Account ID、Adapter/Auth Account ID 等生产字段。
4. 修复联系人、客户档案、关系洞察、AI 回复大脑、账号中心、系统中心、设置与恢复及阅读密度面板的首屏可达性、头部内层滚动和按钮遮挡。
5. 保留 Batch 17 的低信息问候理解、3–5 条候选、发送成功后学习及下一轮读取逻辑。

## 本地证据

- Batch 17/18 与学习闭环定向行为回归：31/31 PASS。
- UAT 诊断：126/126 PASS。
- 生产页面 Chromium 首屏矩阵：81/81 PASS（3 个视口 × 3 个缩放 × 9 个页面）。
- 独立布局几何断言：摘要单行、系统入口可达、详情头部无内层滚动、阅读面板无遮挡、AI 入口无重叠。
- 主题审计：PASS，固定颜色债务 0。

## 未关闭

真实 Windows Electron、真实 OpenRouter 模型路由、WhatsApp/Telegram/Facebook 真实入站与发送、发送结果驱动学习、失败发送不学习、重启持久化仍必须在用户电脑上验证。

```text
REPAIR_ATTEMPT_IN_PROGRESS
WINDOWS_UAT_BLOCKED
formalRelease=false
readyForPromotion=false
```
