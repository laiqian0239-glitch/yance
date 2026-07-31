# 言策 Round 13｜AI 超时恢复与自动学习综合闭环检查点

> 文档性质：源码与自动化闭环检查点，不是 OpenRouter 商业模型质量通过报告。

## 源码身份

- Branch：`architecture/system-round12-13-remaining-closure-20260727`
- Implementation Commit：`ad75c51c44ad980bca21e02c1ac8818c56036903`
- Implementation Tree：`23eb54576e519faa5201511e4c74919b1ee06eff`
- Parent：`e447d62b1b78196cf5e8fe8dec81534b868ffba3`
- Tag：`architecture-round12-round13-remaining-closure-implementation-20260727`

## AI 超时恢复

高能力模型超时时，AI Gateway 现在按固定顺序处理：

1. 保留 System、已确认事实、必须记忆、边界和最近消息；
2. 删除低价值 raw/debug/完整历史字段并压缩上下文；
3. 使用同一个高能力模型重试一次；
4. 仍失败后才切换同档备用模型；
5. 不允许弱模型冒充高质量连续性。

回执记录原始/缩减字符数、哈希、缩减比例、恢复阶段和模型尝试。应急结果继续与长期学习隔离。

## L2/L3 自动综合

新增 `LearningSynthesisSchedulerAuthority`：

- 合格、非应急 L1 信号写入后触发防抖调度；
- 每 15 分钟执行一次兜底扫描；
- 单客户或关系范围达到至少 5 个合格样本后自动综合 L2；
- 跨至少 3 个联系人且底层样本不少于 25 时，自动生成 L3 Persona 提案；
- L3 只允许 `pending-approval`，必须人工批准后才能 active；
- 综合调用使用 `learning_synthesis` 高能力任务池和质量回执；
- 幂等键绑定证据集合，避免重复晋升。

已增加状态、手动运行和 L3 批准接口，并纳入 AppRuntime 生命周期。

## 自动化结果

- Round 13：`24/24 PASS`
- 剩余闭环专项：`8/8 PASS`
- CandidateBinding：`3/3 PASS`
- 全部后端：`867/867 PASS`
- Round 11 UI 契约：`6/6 PASS`

## 当前边界

源码层已关闭“超时前没有上下文缩减”和“L2/L3 没有自动综合调度”两项缺口。真实 OpenRouter 模型是否在真实超时、429、下架和质量场景下保持同档能力，以及真实用户反馈能否形成正确 L2/L3，仍需 Windows/OpenRouter UAT。
