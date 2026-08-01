# FIX6G AI Brain Role Lifecycle Authority V2 Windows 源码 UAT

## 本轮目标

FIX6G 将模型接入、任务评测、角色资格、冠军/亚军、生产激活和降级撤销统一为任务级生命周期权威，解决以下真实 Windows 问题：

- GPT-5.6 Sol 从手动备用切换为自动后被静默清空；
- 测试单条任务前先提交全部路由，导致其他残留无效路由阻断当前任务；
- 同一供应商或同一 Ollama 故障域被错误称为“独立备用”；
- `MODEL_EXECUTION_TERMINATED` 丢失 exitCode、signal、超时/取消来源和 provider requestId；
- 目录中的大量模型被平铺成同等级回复候选；
- 模型离线基准被误与 WhatsApp、Telegram、Facebook 登录绑定。

## 启动

1. 校验交付 ZIP 的 SHA256。
2. 解压到短路径，例如 `C:\Yance-UAT\FIX6G`。
3. 在源码根目录运行：

```powershell
npm.cmd run install:start:source-uat
```

隔离数据目录由派生源码身份自动生成，不会复用 FIX6F 或其他版本的固定 UAT 数据目录。

## 重点验收

1. OpenRouter 鉴权、目录和双模型 smoke 均通过并保留真实 requestId。
2. Claude Opus 5 可作为首轮主候选，GPT-5.6 Sol 可作为跨供应商备用候选；它们仍需正式任务评测才能取得冠军/亚军资格。
3. 将备用从手动切换为“自动”后：
   - `requested.fallback.mode` 保持 `auto`；
   - 若 GPT-5.6 Sol 已满足当前任务门槛，`resolved.fallback.modelId` 应解析为该模型；
   - 若无独立合格备用，应显示明确 reasonCode，不得静默保存空值并伪装成功。
4. 点击某一任务“测试当前配置”时，只保存/测试该任务草稿，其他任务的无效历史路由不得阻断它。
5. 正式回复及发送级翻译的主备必须位于不同供应商故障域。
6. 模型中心按库存、后台、多模态、挑战者、资格、冠军和 Batch-only 分区，不得把全部目录模型显示为同等级回复候选。
7. 隔离评测失败时，诊断应包含脱敏的 executionId、correlationId、exitCode、signal、terminationReason 和 providerRequestId；不得只显示通用 terminated。
8. 未登录三平台时，离线德国/欧洲聊天基准仍可执行；三平台登录只影响端到端平台 UAT 和最终发布门禁。

## 门禁

本包仅用于源码 UAT。即使源码自动化全部通过，真实 Windows、真实 OpenRouter 正式专项和三平台 UAT 未闭环前，以下门禁保持不变：

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```
