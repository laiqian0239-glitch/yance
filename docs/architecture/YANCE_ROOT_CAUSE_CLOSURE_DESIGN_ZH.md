# 言策 Root Cause Closure 总体设计与不可反复修复门禁

## 1. 基线与目的

本阶段从以下真实 Windows 候选源码建立：

```text
Branch=uat/root-cause-closure-20260722
ParentCommit=334f3622d244a7438679973a6ffa1e90306cb169
ParentTree=f476cd0407ecfe247001c31c838d00ecc5322946
RealWindowsEvidence=81 张截图
RealWindowsGlobalUAT=FAIL_WITH_MULTIPLE_CONFIRMED_DEFECTS
```

本阶段不把 18 个确认问题当成 18 个独立热修复，而是先关闭造成问题反复出现的共同根因：

1. 状态权威分裂；
2. 派生事件缺少数据库级幂等；
3. 真实旧数据库没有可回放、可重建和可核验机制；
4. 页面级 CSS 和字符串模板覆盖共享组件合同；
5. 后台任务、当前错误和健康分没有统一时间边界；
6. 源码测试等级被错误提升为真实 Windows 验收等级；
7. 证据包使用递归复制而不是白名单导出。

## 2. 冻结边界

继续冻结：

```text
WhatsApp=USER_CONFIRMED_REAL_WINDOWS_STAGE_PASS
Facebook=USER_CONFIRMED_REAL_WINDOWS_STAGE_PASS
Telegram=USER_CONFIRMED_REAL_WINDOWS_STAGE_PASS
Theme=USER_CONFIRMED_REAL_WINDOWS_STAGE_PASS
```

除非出现新的平台专项真实回归证据，不修改三平台适配器和主题色板。Root Cause Closure 允许修复全局 UI 组件如何使用主题变量，但不重新设计主题。

## 3. 五项身份合同

所有消息、媒体、翻译、AI Context、学习、草稿、未读和发送路由至少包含：

```text
platform
sourceAccountId
platformContactIdentity
conversationId
canonicalContactId
```

姓名和头像不得作为合并依据。客户档案可以跨平台关联，但底层会话和发送路由不得合并。

## 4. 唯一状态权威

机器可读清单：`governance/root-cause-closure/authority-and-writer-matrix.json`。

规则：

- 每个业务领域只有一个权威状态投影；
- UI 不得自行组合多个布尔值形成新的业务状态；
- 权威必须同时输出当前状态、最后成功、当前失败、重试条件和中文用户信息；
- 页面只消费权威投影，不读取并解释底层碎片状态。

优先顺序：

1. `ConversationLanguageAuthority`：修复错语言候选和发送前阻断；
2. `TranslationStateAuthority`：统一会话、档案和关系中文理解；
3. `ModelRuntimeAuthority`：统一资格、路由、最后成功和当前失败；
4. `RelationshipProjectionAuthority`：去重并确保投影收敛；
5. `SystemHealthAuthority`：健康分必须反映当前错误和降级状态。

SystemHealthAuthority 的运行规则：

- 诊断探针、完整性、核心操作失败和后台任务降级必须进入同一健康投影；
- 活动错误存在时健康分不得为 100；
- 当前活动、最近发生和历史记录必须有明确时间边界；
- 同一错误按根因、错误码和阶段聚合，主界面显示中文影响、次数、最近时间和建议；
- 原始技术字段只能放入可展开详情，不得用 `{}` 或转义 JSON 作为用户说明；
- 头像同步和媒体物化等底层任务失败仍需由后续 BackgroundJobAuthority 关闭，健康权威不得把“可观察”冒充“已恢复”。

## 5. 派生数据可重建合同

机器可读清单：`governance/root-cause-closure/idempotency-contract.json`。

原始消息是事实，译文、档案证据、关系事件、学习样本、健康统计和媒体索引都是可重建投影。每种投影必须：

- 具备数据库级唯一键或原子 upsert；
- 具备 `projectionVersion` 或等价版本；
- 支持 `dry_run / backup / rebuild / verify / rollback`；
- 在重复处理、重启、失败重试和并发执行后收敛到相同状态；
- 不得静默修改用户真实数据库。

## 6. UI 组件合同

第一批共享组件：

```text
PrimaryButton
SecondaryButton
DangerButton
DisabledButton
Tag
StatusBadge
ErrorCard
MetadataBar
ActionToolbar
```

每个组件必须规定最小高度、行高、可见文字、前景/背景对比、禁用态、加载态、长中文、德语长词、溢出和高 DPI 行为。

禁止：

- 正式按钮只有 `aria-label` 而没有可见文字；
- 固定高度承载可变中文文本；
- 页面通过新 `!important` 覆盖共享组件核心属性；
- 正式 UI 显示 `undefined`、`[object Object]`、内部枚举或原始供应商错误；
- 技术 ID 长期占用正式业务卡片。

## 7. 验收等级

机器可读清单：`governance/root-cause-closure/acceptance-levels.json`。

以后只允许使用：

```text
SOURCE_CONTRACT_PASS
UNIT_BEHAVIOR_PASS
REAL_DB_REPLAY_PASS
WINDOWS_RENDER_PASS
END_TO_END_TASK_PASS
USER_CONFIRMED_REAL_WINDOWS_PASS
FORMAL_RELEASE_PASS
```

不得跳级，不得用测试总数替代等级。

## 8. 证据白名单

机器可读清单：`governance/root-cause-closure/evidence-whitelist.json`。

证据包必须由白名单生成。禁止递归复制 `.tmp/source-uat-resources` 或任何运行资源目录；`platform-auth.json`、SQLite、Session、Token、Cookie、API Hash 和凭据保险库不得进入证据包。

## 9. 每批停止规则

每批最多关闭一个根因或一个完整用户任务。必须依次满足：

```text
源码合同
→ 单元行为
→ 真实数据库回放
→ Windows 渲染
→ 端到端用户任务
→ 用户确认
```

任一层失败，停留在当前批次，不进入下一阶段，不生成“最终”命名。

## 10. 当前第一批交付

本批只建立：

- 18 项真实 Windows 缺陷基线；
- 8 个权威状态域；
- 6 类派生数据幂等合同；
- 7 级验收模型；
- 证据导出白名单；
- 自动 Root Cause Gate。

本批不声明任何真实缺陷已修复。下一批只处理两个 P0：候选目标语言权威/发送前阻断，以及证据敏感字段白名单导出。

## 后台任务权威：头像同步与历史媒体恢复

后台任务不得再以进程内 `Map` 或队列作为唯一状态。`BackgroundJobAuthority` 使用 SQLite `background_job_state` 表保存唯一幂等键、租约、尝试次数、下次重试时间和最终结果。

统一状态为：`PENDING / RUNNING / SUCCEEDED / RETRY_WAIT / FAILED_FINAL / CANCELLED / SUPERSEDED`。应用重启时，陈旧 `RUNNING` 必须恢复为 `RETRY_WAIT`；同一任务在冷却期不得再次访问平台或媒体下载服务。系统健康读取持久化任务状态，因此日志轮转不能把尚未恢复的任务重新显示为健康。
## 数据保护展示权威

数据根的业务名称、容量统计和备份状态必须使用不同字段，不得复用 `label`：

```text
id
label
path
backupIncluded
bytes
files
sizeLabel
```

`DataProtectionAuthority` 负责把目录定义与统计结果投影为稳定合同。系统中心和其他正式页面只能读取该投影；缺失值必须转换为“数据目录”“0 B”“路径已隐藏”等明确中文状态，禁止显示 `undefined`、`null` 或字段名。

## 通知声音权威

`NotificationSoundAuthority` 是提示音目录、中文名称、事件映射和默认值的唯一来源。后端通知策略与 Electron 播放器不得再各自维护声音 ID。

正式配置入口统一为“系统中心 → 通知与声音”，覆盖：

- 11 套提示音；
- 新消息、发送成功、发送失败、联系人上线、联系人离线五类事件；
- 每类事件独立选择、保存和强制试听；
- 声音总开关、事件开关、音量与免打扰。

“设置与恢复”只显示当前通知摘要并跳转到唯一正式入口，避免平行写入面再次漂移。

## 业务展示权威

`BusinessPresentationAuthority` 是正式中文业务页面的唯一展示投影。它只负责把后端内部枚举和技术身份转换为用户可理解的中文状态与身份摘要，不得修改数据库、平台身份或发送路由。

统一规则：

- `declining / new / calm_natural / warm_calm` 等内部枚举必须映射为中文业务语义；
- JID、UUID、消息哈希、事件 ID 和内部复合键不得直接占用客户档案、关系轨迹、联系人卡片或学习卡片；
- 正式业务卡片显示可区分的身份摘要，精确值仅进入用户主动展开的“技术详情”或诊断视图；
- 发送确认仍必须保留精确的平台、账号实例和目标身份，展示层不得改写五项身份隔离合同；
- 已经是中文业务文本的值保持原样，禁止猜测性翻译或用姓名、头像替代真实身份。

当前累计权威域为 11 个；18 项已登记真实 Windows 缺陷均已有源码关闭检查点，但这只达到源码/单元/部分真实数据库回放等级，不能替代 `WINDOWS_RENDER_PASS` 或用户确认。
