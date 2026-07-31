# 言策品牌重构零遗漏矩阵

本矩阵是从 `07d37a4fc088897a7d4ef9f236fc631202b7dfaf` 建立 CLEAN descendant 的品牌、迁移与 Windows 内测发布总清单。任何条目未绑定自动化或 Windows 实机证据时，不得默认为通过。

状态语义：

- `VERIFIED_SOURCE`：当前源码工作树已有自动化证据；提交后仍须在 CLEAN HEAD 重新绑定验证。
- `BLOCKED_PENDING_WINDOWS`：源码侧已实现或具备门禁，但必须由真实 Windows fresh clone、构建或 UAT 签退。
- `DEFERRED_NO_COST`：当前内测阶段不购买相关付费能力，不得伪装为已完成，也不得阻塞本地内测。
- `BLOCKED_EXTERNAL`：需要用户尚未配置的外部平台或公网基础设施，必须如实记录。

| 问题族 | 源码状态 | 源码/自动化证据 | Windows/真人证据 | 当前判定 |
|---|---|---|---|---|
| 公共名称统一（言策 / Yance） | VERIFIED_SOURCE | release source、UI、Electron、NSIS、`public-brand-surface`、源码品牌审计 | 任务栏、托盘、安装器、Apps & Features、错误弹窗截图 | BLOCKED_PENDING_WINDOWS |
| `Yance.exe` 与版本化安装器命名 | VERIFIED_SOURCE | release identity、builder/NSIS tests、安装器命令测试 | 真实产物文件名及 VersionInfo | BLOCKED_PENDING_WINDOWS |
| 单一品牌真相源 | VERIFIED_SOURCE | `release/release-source.json`、manifest schema、WP1 identity tests | 构建产物回读 | BLOCKED_PENDING_WINDOWS |
| 正式 SVG/PNG/ICO 品牌资产 | VERIFIED_SOURCE | `npm run verify:branding`、Manifest SHA-256、多尺寸 ICO 解析 | 16/20/24/32/48/64/128/256 实机显示 | BLOCKED_PENDING_WINDOWS |
| Windows fresh-clone 行尾可移植性 | VERIFIED_SOURCE | 根目录 `.gitattributes` 强制文本 LF；品牌测试验证 Manifest 内 SVG 的 Git `eol=lf` 属性及零 CR 字节 | 在 `core.autocrlf=true` 的 Windows 环境直接 fresh clone 后运行首个品牌门禁 | BLOCKED_PENDING_WINDOWS |
| Windows 两轮受控 Runner 可解析性与身份绑定 | VERIFIED_SOURCE | `tools/release-closure/RUN_WINDOWS_VERIFY_ROUND.ps1`；`${code}:` 变量定界；Bundle SHA-256、Branch/Commit/Tree、Node/npm、独立目录、CLEAN/fsck 契约测试 | Windows PowerShell 5.1 或 PowerShell 7 实际执行两轮 | BLOCKED_PENDING_WINDOWS |
| 品牌资产可复现生成 | VERIFIED_SOURCE | `build-yance-assets.js`、路径化字标、无字体二进制、资产来源记录 | 不适用 | PASS_SOURCE |
| 产品标准版与展示版隔离 | VERIFIED_SOURCE | product/presentation 独立目录，UI 只引用标准版测试 | 启动页/任务栏/托盘截图 | BLOCKED_PENDING_WINDOWS |
| 用户可见旧名称清零 | VERIFIED_SOURCE | `audit-yance-brand.js`：未解释命中 0、用户可见白名单 0 | 安装后系统入口与最终目录扫描 | BLOCKED_PENDING_WINDOWS |
| 旧名称精确白名单与退出周期 | VERIFIED_SOURCE | `yance-legacy-brand-whitelist.json`，逐文件/正则/原因/测试/epoch | 升级后确认旧名称不再显示 | BLOCKED_PENDING_WINDOWS |
| `resources/app` 组装层品牌门禁 | VERIFIED_SOURCE | WP1 runtime payload gate、PACKAGED scope 负向测试 | Windows Builder 实际组装目录报告 | BLOCKED_PENDING_WINDOWS |
| 安装后最终产物品牌门禁 | VERIFIED_SOURCE | INSTALLED scope 路径/内容负向测试及 Windows harness 契约 | 安装目录、注册表、快捷方式、VersionInfo 实测 | BLOCKED_PENDING_WINDOWS |
| 新旧安装目录分离 | VERIFIED_SOURCE | 独立 `installDirectoryName`；NSIS 不复用旧 InstallLocation；安装器回归测试 | 从旧内测版覆盖升级 | BLOCKED_PENDING_WINDOWS |
| 旧安装项和系统入口清理 | VERIFIED_SOURCE | NSIS 先完整暂存并验证、保留现有安装回滚目录，再精确清理旧 EXE、快捷方式、开始菜单和卸载键 | 旧版安装后的真实升级截图/注册表证据 | BLOCKED_PENDING_WINDOWS |
| 卸载保留用户数据 | VERIFIED_SOURCE | NSIS 明确不删除 `%APPDATA%\\Yance` 和迁移源目录；测试防回归 | 卸载后账号/人设/设置数据检查 | BLOCKED_PENDING_WINDOWS |
| 旧数据目录迁移 | VERIFIED_SOURCE | copy/verify/atomic promote、并发首启胜者接管、旧源迁移后变化检测、备份、回滚、幂等、split-brain tests | 真实旧数据升级与中断恢复 | BLOCKED_PENDING_WINDOWS |
| 账号/凭据/会话数据保护 | VERIFIED_SOURCE | 迁移保留策略、凭据标记兼容、日志脱敏测试 | WhatsApp/Telegram 真实账号升级后复用 | BLOCKED_PENDING_WINDOWS |
| 旧进程/Mutex/注册表兼容 | VERIFIED_SOURCE | NSIS 进程停止、旧标识检测、runtime mutex tests | 旧版运行时覆盖安装、短路径/第二实例/端口 27632 | BLOCKED_PENDING_WINDOWS |
| 旧深链和本地存储兼容 | VERIFIED_SOURCE | 只读旧标识并写入新标识的回归测试 | 已有用户配置升级验证 | BLOCKED_PENDING_WINDOWS |
| 可迁移备份无编号命名 | VERIFIED_SOURCE | 新写 `.yancebackup`，旧扩展名仅导入兼容测试 | 导出、导入和保存对话框实测 | BLOCKED_PENDING_WINDOWS |
| 迁移/错误文案不暴露历史编号品牌 | VERIFIED_SOURCE | branding regression 覆盖迁移器和运行时错误文本 | 故障注入弹窗/日志截图 | BLOCKED_PENDING_WINDOWS |
| 安装器估算大小和卸载元数据 | VERIFIED_SOURCE | Builder 动态计算 EstimatedSize；NSIS Apps & Features 字段测试 | Apps & Features 实机截图 | BLOCKED_PENDING_WINDOWS |
| 安装完成页自动启动与就绪回执 | VERIFIED_SOURCE | NSIS + post-install receipt tests | 安装完成页、主窗口可见、Backend/Renderer ready | BLOCKED_PENDING_WINDOWS |
| 无服务器内测更新策略 | VERIFIED_SOURCE | `MANUAL_INSTALLER_ONLY`、在线轮询关闭、update policy tests | 更新页面截图和手动覆盖升级 | BLOCKED_PENDING_WINDOWS |
| 零新增付费成本 | VERIFIED_SOURCE | 无字体文件、无付费素材/云依赖、LOCAL_PRIVATE_UNSIGNED 策略 | 未签名提醒记录 | PASS_INTERNAL_POLICY |
| 代码签名与 SmartScreen 信誉 | DEFERRED_NO_COST | 内测不购买证书，禁止宣称已签名 | 未执行 | NOT_REQUIRED_FOR_INTERNAL_TEST |
| Facebook 公网回调/平台审核闭环 | BLOCKED_EXTERNAL | 本地 gateway 单测与能力边界 | 需外部平台配置或公网回调 | NOT_REQUIRED_FOR_LOCAL_ONLY |
| 两轮独立 Windows `verify:wp7` | NOT_EXECUTED | 不得继承 `07d37a4` 或脏工作树结果 | 两个独立 fresh clone、Node 22.16.0、Exit 0 | BLOCKED |
| Windows Final Builder | NOT_EXECUTED | 只能从新 CLEAN descendant 构建 | 真实 NSIS/PE/安装器 SHA-256 | BLOCKED |
| Windows Electron UAT | NOT_EXECUTED | Linux 不可代替 | 安装、启动、最小化、托盘、第二实例、升级、卸载 | BLOCKED |
| WhatsApp/Telegram/Ollama/动态人设 UAT | NOT_EXECUTED | 需真实账号和本地模型 | 真人收发、重连、退出、人设即时生效/回滚 | BLOCKED |
| 正式公网发布 | BLOCKED | `formalPublicReleaseAuthorized=false` | 未执行 | BLOCKED |

## CLEAN descendant 提交前硬门禁

```text
git diff --check=PASS
NodeSyntaxCheck=PASS
BrandAssets=PASS
BrandAuditSource=PASS
UnexplainedActiveLegacyMatches=0
UserVisibleLegacyAllowances=0
BrandMigrationTests=PASS
InstallerBrandingTests=PASS
RelevantWorkPackageTests=PASS
```

## 内部测试安装包授权条件

```text
OpenSourceDefects=0
OpenBrandItems=0
UnexplainedActiveLegacyMatches=0
UserVisibleLegacyAllowances=0
BrandAssetVerificationFailures=0
MissingSourceEvidence=0
Repository=CLEAN
WindowsVerifyWp7Round1=PASS
WindowsVerifyWp7Round2=PASS
WindowsInstallerBuiltFromNewBrandCommit=true
WindowsElectronUatFailures=0
formalPublicReleaseAuthorized=false
releaseStatus=INTERNAL_TEST_ONLY
```

任何 `SKIP`、`NOT_APPLICABLE`、`DEFERRED` 或 `BLOCKED` 必须单独计数并说明原因，禁止混入 `PASS`。
