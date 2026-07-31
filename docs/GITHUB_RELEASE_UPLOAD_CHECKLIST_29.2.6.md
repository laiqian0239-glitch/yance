# 言策29 v29.2.6 — GitHub Releases 人工上传清单

> 目的：把 v29.2.6 安装包与更新元数据发布到 GitHub Releases，
> 供客户端自动更新（electron-updater `github` provider）拉取。
> 本清单可在任意有网络与 GitHub 权限的机器上执行，**不需要在本开发客户端内完成**。

## 前置条件
- 已用 WP7 构建器产出安装包 `Yance-29-Setup-29.2.6-x64.exe`（来自 commit 1884ae4 基础上的 v29.2.6 构建）。
- 已固定 `release-source.json` 的 `productVersion` 为 `29.2.6`（本仓库提交）。
- 拥有 `wangyi198675-coder/Yance29-Releases` 仓库的 Release 发布权限（token 仅用于上传，不写入客户端）。

## 步骤（可复现）

### 1. 生成更新元数据（本地，无需 GitHub）
```powershell
# 使用仓库内自包含工具（不依赖 electron-builder）
node tools/wp7/generate-release-artifacts.js `
  --installer "D:\Yance29-Evidence\Builder-...\Yance-29-Setup-29.2.6-x64.exe" `
  --version 29.2.6 `
  --channel stable `
  --prerelease false `
  --out "D:\Yance29-Release-29.2.6" `
  --notes "D:\Yance29-Release-29.2.6\RELEASE_NOTES_29.2.6.md"
```
产出：`latest.yml`、`Yance-29-Setup-29.2.6-x64.exe.blockmap`、`SHA256SUMS.txt`、`RELEASE_NOTES_29.2.6.md`、`release-metadata.json`。

### 2. 校验元数据一致性
```powershell
# 确认 latest.yml 的 path/size/sha512 与安装包完全匹配
(Get-Content D:\Yance29-Release-29.2.6\SHA256SUMS.txt)
```
- `latest.yml.path` == 安装包文件名
- `latest.yml.size` == 安装包字节数
- `latest.yml.sha512` == `base64(sha512(installer))`

### 3. 创建 GitHub Release（需 token，可人工在网页完成）
- 仓库：`wangyi198675-coder/Yance29-Releases`
- Tag：`v29.2.6`
- Title：`言策29 29.2.6`
- 类型：Stable（非 Pre-release）
- 上传资产（必选）：
  1. `Yance-29-Setup-29.2.6-x64.exe`
  2. `latest.yml`（**必须**，github provider 据此校验）
  3. `Yance-29-Setup-29.2.6-x64.exe.blockmap`（增量更新）
  4. `SHA256SUMS.txt`
  5. `RELEASE_NOTES_29.2.6.md`

### 4. 客户端验证（目标机器，已装 v29.2.5）
1. 启动言策29 → 系统中心 → 检查更新。
2. 预期：`发现新版本 · v29.2.6` → 下载 → `正在校验更新` → `更新已就绪`。
3. 若存在未保存内容/待确认回复：安装被拦截，提示先完成。
4. 确认安装 → 重启 → 版本变为 29.2.6，快捷方式与数据保留。

### 5. 安全拒绝回归（可选，演示用）
- 篡改 `Yance-29-Setup-29.2.6-x64.exe` 任一字节后重命名放回 → 客户端应显示
  `更新被拒绝：安装包校验失败…`（phase=rejected，不安装）。

## 已知限制（本客户端不执行）
- **不创建 GitHub Release**：需要 token 与网络凭据，按安全边界在受信任环境/人工上传。
- **不代码签名**：内部测试构建未签名；生产发布前须由证书持有者签名，
  并在 `production` 模式下启用 `YANCE_UPDATE_TRUSTED=1`（未签名将被拒绝）。
- **不跑真实平台/AI/GUI 截图/4 小时稳定性测试**：无头环境无凭据，由验收流程覆盖。

## 回滚
- 客户端拒绝降级（allowDowngrade=false）；如需回退，由用户手动重装 v29.2.5。
