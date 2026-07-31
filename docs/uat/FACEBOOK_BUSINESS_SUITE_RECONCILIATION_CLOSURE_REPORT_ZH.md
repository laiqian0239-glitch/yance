# 言策 Facebook Business Suite 外部会话双向对账真实 Windows 根因修复报告

## 一、范围与结论纠正

```text
FACEBOOK_STAGE_PASS：其余已确认能力继续冻结
REOPENED_SCOPE：Facebook Messenger 外部会话发现与双向 Reconciliation
```

对应缺陷：

- DEFECT-047｜Business Suite 中的新 Messenger 会话未进入言策
- DEFECT-048｜公共主页后台发送的消息 Echo 未同步
- DEFECT-049｜未知 Facebook 联系人首次消息没有创建会话
- DEFECT-050｜Facebook 外部操作缺少定期对账补偿

`7a09b7d` 只完成了联系人原子创建、Echo 写入、历史同步代码和定时器代码，但用户真实 Windows 截图与深度证据确认：Business Suite 中 Andreas Kogler、Dieter Kandels、Waldemar Lurtz、Michel Conrad、Sassi Gasmi 等会话仍未进入言策。因此 `7a09b7d` 必须判定为真实 Windows 失败，不能视为该能力已修复。

## 二、真实 Windows 证据锁定的最终根因

### 1. 对账代码存在，但启动时被权限门禁静默跳过

`7a09b7d` 的 Facebook 日志确认：

```text
worker-connected
contact-avatar-repair-scheduled
contact-avatar-repair-completed
```

但整个运行周期没有出现：

```text
external-conversation-reconciliation-completed
external-conversation-reconciliation-failed
```

连接成功后，源码会立即调用 `scheduleReconciliation()`。该函数当时唯一的静默退出条件是：

```text
historySyncAvailable !== true
```

而 `historySyncAvailable=false` 的来源是当前 Page 授权缺少：

```text
pages_read_engagement
```

因此真实断点不是“定时器没有写”，而是缺少会话读取权限时，言策仍把 Facebook 显示成已连接，却悄悄跳过 Business Suite 最近会话补拉。

### 2. 账号公共 API 丢弃了关键权限与对账状态

Facebook Adapter 已产生：

```text
missingOptionalPermissions
historySyncAvailable
historySyncReason
reconciliationActive
reconciliationRunning
reconciliationLastAt
reconciliationLastError
```

但 `accountManager.publicAccount()` 没有把这些字段传给前端。结果是：后端已经知道对账被权限阻断，账号中心却无法显示真实状态。

### 3. 不完整主页授权仍可被选择和保存

授权页会把 `pages_read_engagement` 标记为历史能力缺口，但桌面端此前仍允许用户选择该主页并保存绑定。于是形成：

```text
实时 Webhook 可能可用
旧会话仍可显示
Business Suite 最近线程无法主动读取
账号界面仍显示完整连接
```

这正是“Facebook 并非整体断线，但新联系人和外部后台消息选择性缺失”的直接原因。

### 4. `7a09b7d` 的联系人、Echo 和去重修复仍然保留

前一批已经确认并继续保留：

- 未知 PSID 首次消息原子创建联系人、会话与消息；
- `is_echo=true` 写为己方消息，不再丢弃；
- 本地发送、Webhook Echo 和历史补拉按 Meta message ID 去重；
- Page ID、PSID、来源账号与外部会话 ID 持久化。

本批是在这些能力之上修复“权限权威与真实状态不可见”，不是推翻前一批数据层修复。

## 三、本批修复

### A. 缺少历史权限时不再伪装完整连接

当实时 Relay 与 Webhook 可用、但缺少 `pages_read_engagement` 时：

```text
state=limited
canSend=true
canReceive=true
historySyncAvailable=false
reconciliationActive=false
reconciliationLastError=明确权限原因
```

账号仍可处理实时消息，但不会再被显示为 Facebook 完整通过。

### B. 对账阻断必须留下结构化证据

` scheduleReconciliation()` 不再静默返回，而会产生：

```text
FACEBOOK_HISTORY_PERMISSION_MISSING
external-conversation-reconciliation-blocked
facebook:reconciliation-blocked
```

并公开缺失权限、Page ID 和具体原因。

### C. 账号 API 完整暴露同步权威

账号中心现在可以读取：

```text
missingOptionalPermissions
newMessagingReady
historySyncAvailable
historySyncReason
reconciliationActive
reconciliationRunning
reconciliationLastAt
reconciliationLastError
reconciliationIntervalMs
```

### D. 禁止保存无法完成 Business Suite 对账的新绑定

重新授权后，如果主页仍缺少 `pages_read_engagement`：

- 主页选择按钮被禁用；
- 后端再次强校验并拒绝保存；
- 错误码为 `FACEBOOK_HISTORY_PERMISSION_MISSING`；
- 不会覆盖当前有效凭据或保存一个新的不完整绑定。

### E. 增加人工立即对账入口

账号中心“同步与队列”新增：

```text
立即执行会话对账
```

只有 `pages_read_engagement` 已授权时可用。手动对账与自动对账共用同一同步、入库和去重链路。

## 四、测试结果

```text
FACEBOOK_BACKEND_DESKTOP_WORKER_REGRESSION=107/107 PASS
ROOT_CAUSE_TARGETED_REGRESSION=36/36 PASS
JAVASCRIPT_SYNTAX_CHECK=PASS
GIT_DIFF_WHITESPACE_CHECK=PASS
```

覆盖：

- 缺少历史权限时状态必须为 `limited`；
- 对账阻断原因必须公开；
- 账号 API 不得丢弃对账字段；
- 缺少 `pages_read_engagement` 时主页选择必须被拒绝；
- 完整权限下 OAuth、Worker、Webhook、Echo、头像、历史补拉和发送链路保持通过；
- Business Suite Echo 继续进入 D1 和桌面端，不被过滤。

## 五、真实 Windows 必要条件

源码无法替用户或 Meta 自动授予权限。安装本候选后，当前既有 Facebook 账号预计会先显示“受限”和明确权限提示。必须使用拥有公共主页管理权限的个人账号重新授权，并确保授权结果包含：

```text
pages_show_list
pages_messaging
pages_manage_metadata
pages_read_engagement
```

若重新授权返回的主页仍显示缺少 `pages_read_engagement`，说明 Meta Business Login Configuration 尚未向该账号授予此权限；候选会阻止保存并准确显示阻断，不会再伪装为已修复。

## 六、当前验收等级

```text
SOURCE_ROOT_CAUSE_PASS=PASS
UNIT_BEHAVIOR_PASS=PASS
FACEBOOK_ADJACENT_REGRESSION_PASS=PASS
REAL_WINDOWS_FAILURE_EVIDENCE_REPLAYED=PASS
WINDOWS_RENDER_PASS=PENDING
META_REAUTHORIZATION_PASS=PENDING
BUSINESS_SUITE_REAL_E2E_PASS=PENDING
USER_CONFIRMED_REAL_WINDOWS_PASS=PENDING
FORMAL_RELEASE_PASS=PENDING
```

本批未修改 WhatsApp、Telegram、主题、AI Brain、Persona、翻译或学习功能，也未重新打开其他已冻结 Facebook 能力。
