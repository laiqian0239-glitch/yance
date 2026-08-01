# 言策 Yance Batch40 FIX6J V2 Windows 源码 UAT

## 本轮底层重构

FIX6J V2 将隔离模型 Worker 从 SQLite、DocumentStore、Store Singleton、系统策略仓储、路由仓储、资格仓储与执行证据仓储中彻底分离。

执行链现为：

```text
桌面主进程（唯一 SQLite 所有者）
  → 解析模型凭据、策略、路由与资格收据
  → 生成 schemaVersion=1、canonical SHA256 绑定的不可变执行信封
  → 启动 YANCE_PROCESS_ROLE=model-execution-worker
  → Worker 校验信封与 deadline 后调用供应商
  → Worker 仅返回结果、token 与 providerRequestId
  → 主进程 exactly-once 写入执行证据
```

Worker 环境固定：

```text
YANCE_PROCESS_ROLE=model-execution-worker
YANCE_SQLITE_ACCESS=forbidden
```

即使未来依赖误触存储公共入口，也会以 `MODEL_WORKER_SQLITE_ACCESS_FORBIDDEN` fail-closed，SQLite ownership/fencing 本身未被删除、放宽或绕过。

## Windows 启动

在源码根目录运行：

```powershell
npm.cmd run install:start:source-uat
```

## 真实 Windows UAT 重点

1. 主进程持有真实 `yance-r32.db` 时测试 Claude Opus 5 与 GPT-5.6 Sol。
2. 两个模型均应出现 `workerStarted=true`。
3. 真实调用应返回非空 `providerRequestId`。
4. 不应再出现 `SQLITE_OWNERSHIP_CONFLICT`。
5. 导出的脱敏诊断不得出现 API Key、Authorization Bearer 或 credentialRef 原文。
6. 主备并发不能产生重复、撕裂或跨任务执行收据。
7. 超时、调用者取消、供应商失败与非法存储访问必须分别分类。

## 发布门禁

```text
windowsUiUat=false
readyForPromotion=false
formalRelease=false
candidatePackageGenerated=false
```

本包仅用于 Windows 源码 UAT，不是正式安装器或发布候选包。
