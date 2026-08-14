# Yance Learned Policy 最高专项指令

> **状态：V2.1 强制架构补充；跨聊天持续有效。**
>
> 本文件冻结 Yance Learning / Deep Training 的长期产品目标，防止后续聊天重新把“学习成长”误解为训练一个低端本地聊天模型去替代最新 OpenAI / Anthropic frontier model。
>
> 本文件是 `YANCE_IMPLEMENTATION_MASTER_PLAN.md` 中 Model Brain / Learning Brain / Relationship Intelligence 的**严格专项补充**，不推翻已经完成的 V2.1 基础设施，不扩大任何历史 authorization。发生冲突时，实时远端治理事实优先；对 Learning / Deep Training 产品语义，本专项指令优先于旧 PR、旧 Deep Training P2 草案和旧聊天。

---

## 1. 唯一目标

Yance 的长期学习目标固定为：

> **Frontier models 负责通用智能和最终语言生成；Yance Learning 负责越来越懂这个人、这段关系、当前情境应该给哪个模型什么上下文、采用什么沟通策略、选择哪个候选，并从真实后续结果持续改进。**

默认生产路径不得变成：

```text
conversation
  -> local low-capability LLM
  -> final reply
```

目标路径固定为：

```text
Conversation / Relationship / Persona / Memory
        ↓
Canonical Yance Decision State
        ↓
Yance Learned Policy
        ↓
context / memory / strategy / candidate / model decision
        ↓
Existing Model Brain
        ↓
OpenAI / Anthropic frontier generator
        ↓
reply candidate / final user-controlled send
        ↓
real human outcome
        ↓
Canonical Learning evidence
        ↓
policy/program update
```

生产最终发送仍保留用户控制与既有安全/权限/最终发送 authority。

---

## 2. 本地模型的永久定位

小型或本地 LLM 不再被定义为 Yance Learning 的默认产品目标。

### 2.1 禁止的默认目标

禁止把以下目标作为后续 Learning / Deep Training 默认路线：

- 训练 `Qwen2.5-1.5B`、`Qwen3-8B`、`14B` 或其他本地模型来替代最新 ChatGPT / Claude 作为主力最终回复 Generator；
- 用参数量升级掩盖错误的产品学习目标；
- 因为已经接入 Agent Lightning，就把所有学习问题转换成 RL fine-tuning；
- 为了证明训练流水线可运行而把训练 checkpoint 冒充 Yance 产品能力提升。

### 2.2 允许的本地模型用途

本地模型只有在独立 OSS-fit / authorization 后，才允许作为：

- bootstrap training fixture；
- bounded evaluator / ranker / state model；
- 明确窄任务的 learned policy component；
- 隐私/离线场景的可选能力；
- 未来在已有大量高质量 Yance 私有领域数据后进行的独立 distillation/challenger workline。

任何 bootstrap fixture checkpoint **不得**作为 Yance reply-capability promotion evidence。

---

## 3. 必须学习的中间决策层

Yance Learning 的核心对象不是“谁来重新写最终句子”，而是下列可解释、可版本化、可评估的 policy heads。

### 3.1 Relationship State

学习/推断可包括：

- relationship stage；
- recent tension / repair state；
- interaction energy；
- initiation balance；
- communication preference；
- current uncertainty/confidence。

必须保持 `confirmed fact / user fact / AI inference` 分层；推断不得静默升级为事实。

### 3.2 Context / Memory Selection

学习本轮真正应该送给 frontier model 的上下文：

- 哪些 confirmed facts 相关；
- 哪些 relationship events 相关；
- 哪些 boundaries / sensitive topics 必须带入；
- 哪些旧信息应排除；
- context package 必须最小化且具 provenance。

不得为了方便直接把长期聊天历史整体塞给 provider。

### 3.3 Structured Reply Strategy

学习结构化沟通 action，而不是先学习自由文本生成，例如：

```text
warmth
initiative
brevity
directness
flirtation ceiling
question policy
pace
conversation goal alignment
memory bundle
candidate branch
```

这些 action 必须有明确 bounded schema，便于离线评估、shadow、回滚和真实 outcome attribution。

### 3.4 Candidate Preference / Ranking

当 Model Brain 通过 OpenAI / Anthropic 产生多个候选时，Yance 可以学习：

- 哪个更像当前用户本人；
- 哪个更适合当前 relationship state；
- 哪个更符合当前 goal / boundary；
- 哪个在历史相似情境中产生更好的真实结果。

候选排序不得建立第二套通用 Generator。

### 3.5 Model / Reasoning Routing

Yance 可以学习：

- 当前场景应该使用哪个现有 Model Brain logical route；
- 何时需要更高 reasoning tier；
- 何时低成本模型已经足够；
- 历史真实质量 / latency / cost / task capability 如何影响 route。

物理 provider credential、provider SDK、健康检查、生产 execution 仍由现有 Model Brain / LiteLLM authority 管理；Learning 不建立第二 provider gateway。

---

## 4. Canonical Decision → Outcome Contract

后续所有 learned policy 的共同底座固定为一个 canonical causal seam，而不是每个功能各建一套训练数据结构。

### 4.1 Decision Record

每个可学习生产决策必须能绑定至少：

```text
DecisionRecord
- decisionId
- scopeType / scopeId
- contactId / conversationId
- stateSnapshotRef / stateVersion
- contextCandidateRefs
- allowedActionSet
- chosenAction
- actionProbability / propensity when applicable
- strategyVersion
- promptProgramVersion
- modelLogicalRoute
- candidateIds
- selectedCandidateId
- sentCandidateId when user sends
- decisionTraceId
- createdAt
```

`actionProbability / propensity` 在 contextual-bandit / off-policy evaluation 场景必须保留，不得事后猜测。

### 4.2 Outcome Vector

真实世界结果先作为向量保留，不直接硬编码成单一 reward：

```text
OutcomeVector
- replyLatency
- replyLengthDelta
- conversationContinued
- newTopicInitiated
- questionReturned
- nextDayReinitiation
- userAcceptedCandidate
- userEditedCandidate
- userRejectedCandidate
- userTakeover
- relationshipStateDelta
- explicitUserFeedback
- other provenance-backed outcome signals
```

不能简单写成 `reply fast = good`、`no reply = bad`。

### 4.3 Learning-approved Reward

只有 canonical Learning authority 可以把 Outcome Vector、用户反馈、Langfuse Score、实验结果等转成 approved reward / evaluation evidence。

禁止 Deep Training、policy learner、Model Brain 或单个 adapter 自行发明第二 reward authority。

---

## 5. OSS-first 固定组合

任何能力落地前仍需独立 V2.1 OSS-fit，冻结 exact repository / release / commit / license / runtime / SBOM / rollback；但默认方向如下。

### 5.1 REUSE — 已有 Yance authority，不得重复开发

- **Model Brain / LiteLLM**：所有正常生产模型 execution、provider credential、physical routing、health/fallback authority；
- **RouteLLM**：现有/后继 logical routing OSS source；
- **Langfuse + OpenTelemetry**：trace、dataset、score、experiment evidence；
- **DSPy + GEPA**：prompt/program/context/strategy optimization；
- **Promptfoo + Langfuse experiments**：regression / benchmark / shadow evidence；
- **Learning proposal / evaluation / promotion / rollback seams**：继续复用现有 Learning authority；
- **Letta**：long-term agent / memory；
- **Graphiti**：temporal relationship facts；
- **Parlant**：Goal / Journey；
- **Persona authority**：用户 persona/style authority；
- **Agent Lightning P1**：仅作为未来确有需要的 bounded training execution engine，不自动拥有任何新 policy head。

### 5.2 OSS-FIT CANDIDATE — 先整块评估，不允许先自研

- **Vowpal Wabbit contextual bandits**：bounded `state -> action -> outcome` online/offline policy learning；
- 成熟 reranker / embedding / classifier / pairwise preference OSS：candidate/context ranking；
- 其他能完整覆盖特定 policy head 的成熟 OSS。

### 5.3 禁止新增的 Yance 基础设施

除非 V2.1 OSS-fit 给出真实缺口证据，否则禁止新增第二套：

- model gateway / provider router；
- experiment platform / dataset platform；
- tracing / telemetry platform；
- prompt optimizer；
- generic RL trainer；
- reward framework；
- memory system；
- relationship graph；
- Journey engine；
- scheduler；
- generic evaluator；
- feature store / model registry；
- generic policy serving framework。

Yance-owned代码默认只允许：thin contract、projection、adapter、configuration、policy schema、compatibility tests、product projection 与 formally proven minimal gap。

---

## 6. Reuse / Retire / New Matrix

任何 successor spec / plan / authorization 必须附下表，防止重复功能开发。

| Capability | Disposition |
|---|---|
| OpenAI/Anthropic final generation | REUSE existing Model Brain |
| Provider credentials/execution | REUSE LiteLLM / Model Brain |
| Long-term memory | REUSE Letta |
| Relationship facts | REUSE Graphiti |
| Goal/Journey | REUSE Parlant |
| Persona/style authority | REUSE existing Persona authority |
| Trace/score/dataset/experiment | REUSE Langfuse + OTel |
| Program/context optimization | REUSE DSPy + GEPA |
| Regression/shadow | REUSE Promptfoo + Learning evaluation |
| Promotion/rollback | REUSE Learning promotion authority |
| Agent Lightning P1 | REUSE as dormant bounded training executor |
| Qwen local reply-generator product target | RETIRE / DO NOT PURSUE |
| Agent Lightning VERL reply-model P2 | RETIRE / SUPERSEDED |
| DecisionRecord schema/binding | NEW THIN CANONICAL CONTRACT |
| OutcomeVector binding | NEW THIN CANONICAL CONTRACT |
| Decision ↔ Outcome provenance | NEW THIN CANONICAL CONTRACT |
| Contextual policy learner | OSS-FIT FIRST; default candidate VW |
| Policy adapter into existing Brain | NEW THIN ADAPTER only |

任何新的 `NEW` 行若不是 thin adapter/contract，都必须重新做 OSS-fit 并证明无成熟 OSS。

---

## 7. Agent Lightning P1 的后续定位

已经完成的 Agent Lightning P1 不废弃、不重做。

它以后只能在满足以下条件时参与：

1. 已先定义明确的 bounded policy head；
2. 已有 canonical Decision → Outcome evidence；
3. 已证明 simpler OSS learner / DSPy / ranker / contextual bandit 不足；
4. Learning 明确授权训练目标与 reward；
5. 输出仍是 candidate/policy artifact，不自我 promotion；
6. 不接管 Model Brain production provider authority。

P1 的价值是成熟 training execution seam，不是 Yance 的最终产品学习目标。

---

## 8. #367 与旧 VERL/Qwen P2 的永久状态

PR `#367`：

- 状态：**SUPERSEDED — DO NOT MERGE**；
- 不得作为后续 implementation authority；
- 历史 commit/设计保留用于审计；
- 不 rebase / amend / force-push 改写历史；
- Qwen2.5-1.5B 只可在未来独立授权下作为 bootstrap fixture，不是正式 reply capability candidate。

后续任何聊天若看到 #367 或旧 `V21-DEEP-TRAINING-P2-AGENT-LIGHTNING-VERL-CANDIDATE-V1`，必须先读取本文件，并视旧 P2 产品语义为已退休。

---

## 9. 下一正式工作包

新的第一优先 Learning successor 固定为：

`V21-LEARNING-POLICY-P1-DECISION-OUTCOME-CLOSED-LOOP-V1`

目标只做 canonical data/authority seam，不一次性实现所有 policy heads。

推荐顺序：

1. fresh-main source audit；
2. DecisionRecord / OutcomeVector / attribution contract design；
3. OSS-fit：确认现有 Langfuse / DSPy / Promptfoo / RouteLLM / LiteLLM / Learning seams 可直接复用；
4. 对 contextual policy learner 评估 Vowpal Wabbit 等成熟 OSS；
5. exact route / dependency / license scope；
6. failure-first causal RED；
7. thin canonical contract + adapters GREEN；
8. offline experiment / shadow / rollback closure；
9. 再授权第一个真实 policy head；
10. Agent Lightning 或本地模型只有在后继 OSS-fit 证明必要时才进入。

不得在第一个 work package 中同时重写 Relationship State、Context Ranker、Strategy Policy、Candidate Ranker、Model Router 五套系统。

---

## 10. 最终验收语义

只有满足下列事实，才允许宣称“Yance 已经能在 ChatGPT / Claude 基础上学习成长”：

1. 最终回复仍由当前配置的 frontier generator 通过现有 Model Brain 产生；
2. Yance 在调用 frontier model 前形成可版本化 learned decision；
3. learned decision 能实际控制至少一个真实 policy dimension；
4. 生产 decision 与后续真人 outcome 具有 canonical provenance binding；
5. outcome 能进入 Learning/Langfuse evidence；
6. 新 evidence 能实际改变后续 policy/program artifact；
7. 同一用户/关系后续决策能消费新版 policy；
8. 新 policy 在 promotion 前经过 regression / offline experiment / shadow；
9. rollback 可以恢复上一版 policy；
10. 没有低端本地 reply model 绕过/替代 OpenAI / Anthropic 主力 production generator。

系统第一天具备的是**真实学习机制**，长期 personalization 强度随真实 Decision → Outcome 数据积累增长；不得把“已有学习机制”夸大成“尚未积累数据就已经达到长期最优策略”。

---

## 11. 跨聊天恢复规则

任何新聊天涉及以下关键词时必须先读取本文件：

- Learning / Learning Growth；
- Deep Training；
- Agent Lightning；
- VERL / RL / SFT / distillation；
- Qwen / local model；
- reply ranking；
- context compiler；
- model router；
- relationship policy；
- outcome / reward；
- personalization / 学习成长。

恢复时必须先说明：

> `Frontier Generator + Yance Learned Policy` 是当前有效产品方向；旧 Qwen reply-generator P2 已 superseded。

不得因为聊天上下文丢失而重新启动旧 P2。
