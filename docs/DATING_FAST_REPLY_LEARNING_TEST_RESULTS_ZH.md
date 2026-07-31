# 交友版快速回复与即时学习测试结果

测试日期：2026-07-18

## 实际执行

### 交友回复、即时学习和 WhatsApp 输入节奏

命令：

```powershell
npm run test:dating-fast-reply
```

结果：26/26 PASS。

覆盖：

- 极速/平衡单模型调用。
- SQLite 旧表原地迁移。
- 关系策略仅作为建议，不阻塞。
- Secret 技术检查。
- 连续消息 revision。
- 候选过期拒绝。
- 发送学习模式和来源。
- 发送成功后即时联系人示例。
- 下一次 Prompt 立即应用示例。
- 发送失败、取消和仅发送不学习。
- 学习版本清空和恢复。
- WhatsApp composing/paused 中断。
- 人工键盘接管。

### 前端会话、CSP、DOM 和主题回归

结果：35/35 PASS。

### Facebook Worker

命令：

```powershell
npm run test:facebook-worker
```

结果：49/49 PASS。

### Windows—Facebook Worker 合同

命令：

```powershell
npm run test:facebook-contracts
```

结果：48/48 PASS。

其中部分跨端合同测试会在 Worker 与合同命令中重复执行，因此不把各组简单相加声称为“唯一测试数量”。

### 账号、发送、关系窗口和升级包回归

结果：9/9 PASS。

### 静态检查

- 修改后的 JavaScript `node --check`：PASS。
- `git diff --check`：PASS。
- 前端高风险 DOM sink 审计：PASS。

## 环境限制

`backend/tests/personaBrain/candidateBinding.test.js` 在当前隔离环境未执行，因为当前 `node_modules` 缺少 `express`，测试文件在加载阶段即停止，未运行任何断言。该项必须在完整 Windows Builder 依赖环境中重新执行。

## 不代表

以上结果是源码级和合同级测试，不代表：

- 真实 Windows 安装后测试；
- 真实 WhatsApp 手机端节奏观察；
- 真实本地模型性能测试；
- 新 Commit 的 Round 1、Round 2 或正式 Builder PASS。
