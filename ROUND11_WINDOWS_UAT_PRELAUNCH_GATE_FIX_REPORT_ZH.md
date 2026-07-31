# 言策 Round 11｜Windows UAT 预启动门禁失败闭环报告

## 真实 Windows 证据

在 Round 11 修正版候选 `ad12da5` 的真实 Windows 预启动中，依赖安装与完整性检查通过，主题颜色审计通过，但 `round11-production-gates` 为 `67/68 PASS`，因此 Electron 按门禁规则未启动。

唯一失败项：

- `backend/tests/personaBrain/candidateBinding.test.js`
- 错误码：`AI_DIRECTOR_LANGUAGE_UNVERIFIED`

## 根因

该测试只验证“候选绑定活跃 Persona 版本和策略哈希”，测试场景没有任何已确认的联系人目标语言；但其模拟导演仍固定返回 `targetLanguage: en`。生产代码会在目标语言未知时阻止导演自行猜测语言，因此真实 Windows 完整依赖环境第一次执行该历史测试后，正确触发了语言真实性门禁。

这不是用户环境、Node 24、依赖安装、真实数据库或主题造成的失败，也不应通过放宽生产语言门禁来绕过。

## 修复

- 保留生产代码的 `AI_DIRECTOR_LANGUAGE_UNVERIFIED` 阻断规则；
- 将无语言证据的 Persona 绑定测试模拟导演改为返回 `targetLanguage: unknown`；
- 测试继续验证 Persona 版本和策略哈希绑定，不再违反其无关的语言权威前置条件；
- 更新 Round 11 UAT 标签身份，生成新的不可变候选。

## 关闭标准

新候选必须在真实 Windows 完整依赖环境中重新运行同一组预启动门禁；只有 `round11-production-gates` 与主题审计均通过后，才允许启动 Electron 并继续界面验收。
