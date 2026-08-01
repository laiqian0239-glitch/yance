# 言策 FIX6O Gate 0 Windows 源码 UAT 执行说明

## 执行环境

- Windows 10/11 x64
- Node.js 22.5.0 或更高版本
- npm 10 或更高版本
- 建议将源码解压到较短路径，例如 `C:\Yance\FIX6O-Gate0`

## 一键执行

双击：

`RUN_FIX6O_GATE0_WINDOWS_UAT.cmd`

启动器将按以下顺序执行：

1. 校验当前系统必须为 `win32/x64`；
2. 校验 307 个 npm 官方 tarball 与 `package-lock.json` 的版本、来源、SHA-256、SHA-512 integrity 和包内元数据；
3. 将受检 tarball 分批写入项目专属 npm cache，不修改 npm registry；
4. 执行一次干净 `npm ci`；
5. 校验并解压 `electron-v39.8.5-win32-x64.zip`；
6. 校验直接依赖和 Electron 可执行文件；
7. 使用隔离数据目录启动真实 Windows Electron 源码 UAT。

## 证据位置

- 安装日志：`.tmp\source-uat-install`
- 启动与身份收据：`.tmp\source-uat-resources`
- 项目专属 npm cache：`.yance-cache\npm`

## 安全边界

- 不使用 `--no-sandbox`；
- 不降低 lockfile integrity；
- 不覆盖 npm registry；
- 默认不读取或修改现有正式数据目录；
- 本包仅用于 Gate 0 Windows 源码 UAT，不代表正式发布或可晋级状态。

若启动失败，请把整个 `.tmp` 目录压缩后上传作为证据。

## V5E 运行监督器说明

V5E 将 Electron stdout/stderr 与 PowerShell 控制流分离。Chromium 自恢复诊断只写入 `runtime-logs/electron-stderr.log`，Gate 0 仅接受 `/api/health` 的可信 readiness 和身份绑定 `source-uat-launch.json`。详见 `YANCE_GATE0_RUNTIME_SUPERVISOR_V5E_REPORT_ZH.md`。
