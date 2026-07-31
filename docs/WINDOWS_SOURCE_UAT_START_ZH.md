# 言策 Windows 源码 UAT 直接启动

本入口用于先启动真实 Electron、逐页检查并立即修复，不会运行完整 Pipeline、WP7、STRICT 或 Builder，也不会生成安装包或声明正式发布通过。

## 首次启动

源码仓库不再保留多个可误点的根目录启动器。工程师在源码环境使用权威命令：

```powershell
npm run install:start:source-uat -- --largest-existing-data
```

只做隔离数据基础检查时使用：

```powershell
npm run install:start:source-uat
```

它只执行：

1. 最多重试3次执行 `npm ci --no-audit --no-fund`，每次保存独立 stdout/stderr 日志；
2. 校验所有直接依赖的 `package.json` 和 Electron 可执行文件，依赖缺失或半安装时拒绝启动；
3. 根据当前 Commit/Tree 生成 `.tmp/source-uat-resources/release-manifest.json` 和独立 SHA-256；
4. 复制经过 SHA-256 校验的公开平台配置，不读取或输出 Secret；
5. 使用隔离目录 `%LOCALAPPDATA%\Yance-Source-UAT` 启动 Electron。

Electron 默认由 npm 安装脚本下载。若当前网络无法访问 GitHub，可采用以下任一可信方式后再次运行：

- 将 `electron-v39.8.5-win32-x64.zip` 放到源码根目录；工具会按 `release/electron-distribution-trust.json` 中的 SHA-256 校验后解压；
- 设置 `YANCE_ELECTRON_ZIP` 为本地 ZIP 的绝对路径；
- 设置 `YANCE_ELECTRON_MIRROR` 为你信任的 Electron 镜像根地址。

任何本地 ZIP 校验不一致都会被拒绝。

后续依赖已经存在且通过完整性校验时使用：

```powershell
npm run start:source-uat
```

## 使用现有账号和数据进行真实平台 UAT

先完全退出已安装的言策，再使用：

```powershell
npm run start:source-uat -- --largest-existing-data
```

该命令会在可信候选目录中选择包含最大现有 SQLite 数据库的数据根。需要固定使用 `%APPDATA%\Yance` 时，使用 `npm run start:source-uat:existing`。最终Windows UAT材料包会另行生成唯一安装入口，源码根目录不保留多个历史启动器。它不会复制或导出账号凭据，但源码和已安装版本不得同时运行，也不得同时写入同一个数据库。

## 启动保护

- 需要 Node.js `>=22.5.0`；
- 默认端口为 `27632`，端口被占用时拒绝启动，不会夺取或杀死已有进程；
- Git 工作树不干净时拒绝生成可信 UAT 身份；
- `node_modules` 目录存在但依赖不完整时同样拒绝启动，不再把半安装状态当作可用；
- 安装日志写入 `.tmp/source-uat-install`，便于工程师定位网络、锁文件或Electron下载问题；
- 无 `.git` 的源码 ZIP 必须包含 `YANCE_SOURCE_CHECKPOINT.json`；
- 生成身份固定标记为 `SOURCE_UAT_ONLY`，不等于安装包或发布证据；
- 默认关闭 WhatsApp 自动启动，进入界面后由用户明确连接；
- 所有启动记录均写入 `.tmp/source-uat-resources`，不写入 Secret。

## 命令行

```powershell
npm run prepare:source-uat
npm run start:source-uat
npm run start:source-uat:existing
npm run install:start:source-uat

# 使用本地 Electron ZIP
node tools/runtime-delivery/start-source-uat.js --install --electron-zip=D:\\Downloads\\electron-v39.8.5-win32-x64.zip
```
