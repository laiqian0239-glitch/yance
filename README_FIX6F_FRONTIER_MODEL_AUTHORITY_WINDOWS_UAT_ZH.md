# 言策 Yance Batch40 FIX6F Frontier Model Authority Windows 源码 UAT

本包是 FIX6E Champion Brain 的派生源码修复，不是 MSI/EXE 正式发布候选包。

## 修复范围
- 首选回复候选：`anthropic/claude-opus-5`
- 跨供应商备用候选：`openai/gpt-5.6-sol`
- 首选备用不可用时，备用仍必须来自不同供应商。
- Batch-only 模型禁止进入实时回复、OpenRouter smoke 与回复模型主网格。
- 源码 UAT 默认数据目录按派生源码身份隔离，避免跨版本复用旧 `MIGRATED_SAFE_MODE` 状态。
- `YANCE_DERIVED_SOURCE_IDENTITY.json` 绑定包内完整有效载荷，`YANCE_ARTIFACT_DESCRIPTOR.json` 不再沿用 FIX6D 身份。

## 启动
```powershell
node --version
npm.cmd --version
npm.cmd run install:start:source-uat
```

默认隔离目录：`%LOCALAPPDATA%\Yance-Source-UAT-<commit8>-<tree8>`。
真实已有数据只能显式执行 `npm.cmd run start:source-uat:existing`，且源码版与已安装版不得同时写同一数据库。

## 固定门禁
```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```
