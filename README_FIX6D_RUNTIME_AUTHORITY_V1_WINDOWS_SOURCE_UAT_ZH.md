# 言策 Yance FIX6D Runtime Authority V1 Windows 源码验收

本包是在已通过排版验收的 FIX6D V5 源码上，修复 OpenRouter 凭据结果、模型能力、双模型 smoke、正式角色收据、安全模式分域和安全模式原因原子性。

## 身份

- Branch：`fix6d-runtime-authority-v1`
- Commit：`91096c2eb1a9e289b1a68b351a326166cf9c379d`
- Tree：`de013fcf1f2547cdc48874976f2a719f9c73f57c`
- 上游：`514dc7a45e4891ed96c00a9046702676b9fe6d2c` / `c594b6848c6bf588ec72eba6308eef21090cc5ec`

本包不是正式安装候选包：

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

## Windows 安装启动

需要 Windows 10/11 x64、Node.js >=22.5.0、npm >=10。

在源码目录 PowerShell 执行：

```powershell
node --version
npm --version
npm run install:start:source-uat
```

读取现有最大数据目录进行真实验收：

```powershell
npm run start:source-uat -- --largest-existing-data
```

固定使用 `%APPDATA%\Yance`：

```powershell
npm run start:source-uat:existing
```

源码版与已安装版不能同时写同一数据库。

## 本轮重点

按 `YANCE_BATCH40_FIX6D_RUNTIME_AUTHORITY_V1_WINDOWS_UAT_CHECKLIST_ZH.md` 验收 OpenRouter 双模型、角色收据、AI 域隔离和全局安全模式。排版仍按三档 Windows 缩放做防回归。

StubEngine 当前账户没有可用组织，包内没有模拟 endpoint；所有 OpenRouter 通过结论必须来自真实服务。
