# 言策 Round 7 · P0B 入站理解与客户档案闭环检查点

## 目标

修复“对方已经明确说出年龄、国家、地区和兴趣，但客户档案仍为空”的生产链断点。该检查点只声明源码、SQLite和正式事件接线结果；真实 Facebook / WhatsApp / Windows 界面仍待验收。

## 本批确认的根因

1. 自动会话分析先查找理解模型；没有合格模型时直接跳过，确定性事实也没有通过该路径补写。
2. 自动分析默认被旧配置限制为仅本地模型，即使已经授权 OpenRouter，也可能因本地理解模型不合格而长期不运行。
3. StoreManager 已经能够从真实入站消息提取事实和关系状态，但会话前端没有监听 `customer.facts.updated`，档案写入后界面不会立即刷新。
4. 旧兼容事件桥监听并重新发布同名事件，未来一旦出现旧事件发布者会形成递归风险；权威事件实际来自 `store:<eventType>`。

## 已修复

1. 新增 `persistDeterministicFactsForConversation`：不依赖大模型即可从真实入站消息提取并写入客户档案与证据表。
2. 自动入站处理先执行明确事实提取，再检查理解模型；即使没有模型，年龄、国家、地区和兴趣仍可进入档案。
3. 自动入站只处理最新一条对方消息，历史全量回填仍由人工分析承担，避免每次新消息重复扫描并重复增加档案版本。
4. 自动AI默认允许已授权云模型；只有用户明确切换“仅本地”后才保持本地限制。
5. 已预提取的明确事实传给后续理解任务，避免同一次处理重复写入。
6. 客户事实写入后发布 `workspace.profile.updated` 与 `workspace.deterministic-facts.updated`。
7. 会话前端监听 `customer.facts.updated`，立即重新读取 StoreManager 社交上下文和 Workspace 客户档案。
8. 旧兼容事件桥改为监听 `store:<eventType>`，不再监听并重发相同原始事件。
9. 回复大脑继续从 StoreManager 的已确认事实和长期兴趣读取上下文；无证据事实不会进入候选提示词。

## Kurt 固定样本结果

真实入站：

- `Bin 65 ...` → 年龄 65
- `Aus Österreich` → 国家 奥地利
- `In der Nähe von Wien` → 地区 维也纳附近
- `Hobbys Radfahren, Schwimmen, Lesen, Musik` → 骑行、游泳、阅读、音乐

真实我方外发：

- `Ich bin 41. Ich lebe in Berlin und arbeite als Modedesignerin.`

验证结果：

- 41岁、柏林、设计师没有写入 Kurt 档案；
- 所有自动确认事实均绑定 `peer / inbound`；
- 事实证据绑定正确平台、账号、会话和消息；
- 关系状态随消息更新；
- 回复大脑决策包可读取年龄和四项兴趣。

## 回归

- P0B 入站理解专项及相关AI/关系/学习回归：45/45 PASS
- 主题固定颜色审计：PASS，固定颜色债务0
- JavaScript语法检查：PASS

证据位于 `artifacts/round7-p0b/`。

## 未完成

- 真实 Facebook / WhatsApp 新入站消息触发验证
- Windows右侧档案无刷新切换情况下的实时显示
- 合格理解模型、关系分析模型和导演主备模型的商业评估
- 真实候选中引用Kurt兴趣的模型输出与反向证据展示
- Telegram真实登录与同链路验证

因此当前状态为：`SOURCE_AND_SQLITE_CHAIN_PASS / REAL_WINDOWS_AND_MODEL_UAT_PENDING`。
