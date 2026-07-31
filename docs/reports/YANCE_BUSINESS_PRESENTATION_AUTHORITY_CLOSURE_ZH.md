# 言策 BusinessPresentationAuthority 根因收口报告

## 源码基线

```text
Branch=uat/root-cause-closure-20260722
Parent=830bbb6e2ac4b8fe99df7b73a247ee32def31ce9
```

## 关闭缺陷

- `DEFECT-017`：中文正式页面混入 `declining / new / calm_natural / warm_calm` 等内部枚举；
- `DEFECT-018`：客户档案、关系轨迹、联系人和账号绑定卡片直接显示 JID、UUID、消息哈希及内部会话标识。

## 深层根因

正式业务页面过去直接消费后端原始字段，没有唯一展示投影。不同页面各自决定是否翻译枚举、是否显示精确身份，导致中文泄漏、技术 ID 占用业务界面，以及为了隐藏 ID 而误伤发送路由的风险。

## 修复

建立唯一 `BusinessPresentationAuthority`：

- 关系阶段、互动风格、状态、来源、事件类型和学习范围统一映射为中文；
- JID、UUID、哈希和复合键在业务卡片中显示可区分摘要；
- 精确身份仅进入用户主动展开的技术详情；
- 发送路由、消息证据和数据库五项身份保持原值；
- 联系人详情使用安全 DOM 创建技术详情，存储型 XSS 仍保持 inert；
- 账号绑定、AI 学习材料、候选元数据、客户档案与关系轨迹统一消费同一权威。

## 定向证据

```text
BusinessPresentationAuthority：5/5 PASS
Root Cause Gate：2/2 PASS
组件可读性：6/6 PASS
关系权威与真实 SQLite：7/7 PASS
客户档案安全渲染：5/5 PASS
ActiveContact 相邻回归：13/13 PASS
合计：38/38 PASS
```

另外执行更宽的旧前端测试时发现 5 条失败；在父提交 `830bbb6` 上完全相同，属于既有断言/审计债务，本批没有新增失败。

## 准确验收等级

```text
SOURCE_CONTRACT_PASS=PASS
UNIT_BEHAVIOR_PASS=PASS
REAL_DB_REPLAY_PASS=由相邻关系权威保持通过
WINDOWS_RENDER_PASS=PENDING
END_TO_END_TASK_PASS=PENDING
USER_CONFIRMED_REAL_WINDOWS_PASS=PENDING
FORMAL_RELEASE_PASS=PENDING
```

18 项已登记截图缺陷现在均有源码关闭检查点，但不能据此宣布真实 Windows 已通过。下一门禁必须生成候选包，在真实 Windows 中重看原 81 张截图对应页面，并执行端到端任务。
