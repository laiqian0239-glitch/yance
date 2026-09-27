# 言策时间语境与柏林实时首页设计

日期：2026-09-27  
状态：待用户审阅书面设计  
范围：首页 Hero 实时时间/天气 + 回复大脑时间语境增强  

## 1. 目标

把“时间”从首页装饰升级为回复大脑的真实上下文能力。

首页把现有“☀ + 早上好”替换为极简柏林实时信息：

```text
16:45
Berlin · 晴 · 23°
```

回复大脑在每轮候选生成前判断：消息发送时间、当前回复时间、已过去时长、联系人时区置信度、消息中的时间性表达，以及当前时段是否已经变化。

核心产品规则：

> AI 回复必须以“发送回复这一刻”的真实时间语境为准，不能机械延续原消息发送时的时间语境。

## 2. 现有 authority 与复用边界

现有 `backend/services/contextAwareReplyBrain.js` 已包含 `buildTemporalContext()`，并把 `temporalContext` 写入 Social Decision Packet 与模型上下文。该能力继续作为回复链唯一时间语境入口，不新增第二个回复时间 owner。

现有联系人上下文已经暴露 `timezone`，来源包括客户社会上下文与 Persona/事实投影。联系人时区继续由这些现有身份/事实 authority 提供，时间语境层只消费，不建立独立联系人数据库。

现有消息/会话投影负责提供真实消息时间戳；时间语境层不得用 DOM 顺序、页面显示时间或本地假时间推断历史消息发生时间。

首页只消费时间/天气的只读 projection。首页组件不得成为天气、时区或联系人时间事实的业务 authority。

本设计不改变：模型路由、Persona、关系事实、记忆、Outbox、学习晋升、平台物理发送和自动发送权限。

## 3. `TemporalContextV2`

在现有 `buildTemporalContext()` 上扩展结构，不改变其 owner：

```text
nowInstant
ownerTimeZone
ownerLocalDate
ownerLocalTime
ownerDaypart
contactTimeZone
contactTimeZoneConfidence
incomingMessageInstant
incomingDaypart
elapsedSeconds
temporalExpressions[]
temporalMismatch
replyTemporalMode
authority
```

### 3.1 Owner 时区

当前首页产品要求固定展示柏林实时时间，因此本阶段 owner/display zone 使用 IANA `Europe/Berlin`，必须通过 `Intl.DateTimeFormat` 或等价标准时区实现处理 DST，禁止写死 `UTC+1/UTC+2`。

未来如用户设置已有 canonical residence/timezone，可把 `Europe/Berlin` 改为设置投影，但本 work package 不扩展设置系统。

### 3.2 联系人时区优先级

联系人时区只从已有可信事实读取，优先级：

1. 联系人 canonical social context 的显式 `timezone`；
2. Persona/truth-safe residence 的已确认 timezone；
3. 现有联系人事实中明确且可验证的 timezone；
4. 否则 `unknown`。

不得仅凭姓名、语言、电话号码、平台或一次聊天内容猜时区。

置信度：显式已确认事实=`high`；已存在但来源较弱的投影=`medium`；没有事实=`unknown`。

联系人时区 unknown 时，系统仍可计算绝对 elapsed，但不得假装知道对方当前是上午、下午或晚上。

## 4. 时间性表达与冲突判断

时间语境层只做结构化判定，不生成回复文本。初始高价值表达至少覆盖：

- 早上好 / good morning；
- 下午好 / good afternoon；
- 晚上好 / good evening；
- 晚安 / good night；
- 今晚 / tonight；
- 明天 / tomorrow；
- 今天 / today；
- 一会儿 / 待会 / later / in a bit；
- 周末 / weekend；
- 刚下班 / just got off work 等明显短时效表达。

冲突判断必须区分“原话发生在旧时段”与“当前回复时段”。示例：

```text
incoming: 08:20 “早上好呀”
now:      15:40
elapsed:  7h20m
mode:     acknowledge_previous_time
```

此时禁止候选直接以“早上好”作为当前问候。允许：

- “刚看到你早上的消息……”；
- “早上的问候我下午才接住 😄”；
- 使用完全中性的承接句。

如果联系人时区 unknown，优先选择中性承接，不直接按柏林时间称呼对方“下午好/晚上好”。

## 5. `replyTemporalMode`

第一版采用有限枚举，避免把判断留给自由文本 Prompt：

- `current`：原时间语境仍有效，可自然回应；
- `acknowledge_previous_time`：原问候/时段已经过去，应承认延迟或自然过渡；
- `neutral_due_to_unknown_zone`：联系人时区未知，避免对其当前时段作断言；
- `expired_plan_reference`：今晚、待会、明天等计划性表达已经过期或日期语义变化；
- `cross_day`：跨日回复，应避免把昨日表达当成今日事实。

枚举由确定性 resolver 产生，模型只能消费，不能自行改写 authority。

## 6. 回复大脑集成

`TemporalContextV2` 必须在 Director 和候选生成之前形成，并与当前 Social Decision Packet 一起进入现有模型上下文。

Prompt 规则新增硬约束：

> 当原消息中的时间性表达与当前回复时段不一致时，不得机械镜像旧问候；应承认时间已经过去、自然过渡，或使用中性表达。

仅靠 Prompt 不足以作为验收。候选输出还要经过轻量时间一致性校验：

- `acknowledge_previous_time` 下，候选不得把已经失效的问候当作“现在”的直接开场；
- 允许引用旧问候，例如“刚看到你早上的消息”；
- `neutral_due_to_unknown_zone` 下，不得无依据声称对方当前是早上/下午/晚上；
- `cross_day` 与 `expired_plan_reference` 下，应识别明显日期错位表达并要求重新生成/修复。

该校验只做时间一致性，不成为第二个语言模型、第二个关系判断器或第二个风格 authority。

候选 metadata 与学习证据要保留本轮 `replyTemporalMode`、timeZone source/confidence 与 elapsed bucket，便于未来验证“延迟回复是否更自然”；不得保存额外原始私聊文本。

## 7. 首页柏林实时时间与天气

Hero 左上替换现有“☀ + 早上好 + 副标题”为：

```text
16:45
Berlin · 晴 · 23°
```

主时间使用 24 小时制，约 24–26px；第二行约 11–12px。天气图标使用小型细线状态图标，不再使用大号装饰太阳。

时间每分钟刷新一次；窗口恢复焦点时立即校正。时间源只依赖系统时钟 + `Europe/Berlin` IANA zone，不需要网络。

天气是可选增强，不得阻断首页或回复生成：

- 使用成熟公共天气服务的最窄只读 seam；
- 后端只做薄 provider projection 与短时缓存，不建立天气数据库；
- 建议缓存约 10 分钟，避免每次 render 请求；
- 失败时显示 `Berlin · 天气暂不可用`；
- 不得显示上一次成功结果为“实时”而不标记 stale。

本阶段天气只显示：当前 condition + temperature。湿度、风、降雨概率、日出日落不进入 Hero。

## 8. 天气与回复大脑的边界

时间是强上下文；天气是弱上下文。

默认回复生成不应突然引用天气。仅当当前对话明显涉及天气、出门、穿衣、旅行、户外安排、约会地点等主题时，才允许通过现有上下文装配把相关天气 projection 提供给模型。

天气不可用于推断联系人位置。联系人位置/时区仍以现有联系人事实 authority 为准。

首页柏林天气只是 owner/dashboard projection，不代表联系人的天气。

## 9. 失败语义

- 系统时钟不可读：回复大脑保留现有生成能力，但 temporal authority 标记 unavailable；不得伪造当前时段。
- 联系人时区未知：使用 `neutral_due_to_unknown_zone`，不阻断候选生成。
- 消息时间戳缺失：不计算假 elapsed；只使用当前时间与明确文本表达的安全规则。
- 天气服务失败：首页显示“天气暂不可用”，回复大脑不消费天气。
- 时间一致性校验失败：该候选进入现有 repair/regeneration 路径，不自动发送错误候选。

## 10. 测试与验收

必须先以 RED→GREEN 覆盖以下行为：

1. `Europe/Berlin` 在 DST 切换前后时间正确，禁止固定 UTC offset。
2. 08:20 收到“早上好”，15:40 生成时进入 `acknowledge_previous_time`。
3. 上述场景候选不能把“早上好”当作当前直接问候，但允许“刚看到你早上的消息”。
4. 联系人时区 unknown 时，不输出无依据的“下午好/晚上好”。
5. 已知联系人时区时，当前 daypart 按联系人时区计算，而不是强行使用柏林时区。
6. 跨日回复能识别“今晚/明天/晚安”等已变化语义。
7. 缺失消息时间戳时 fail-open，不伪造 elapsed。
8. TemporalContextV2 进入 Director 与候选生成 packet，并写入候选 metadata/receipt。
9. 时间一致性校验失败走现有 repair/regeneration，不绕过 Outbox/发送门禁。
10. 首页时间每分钟刷新并在窗口 focus 时校正。
11. 首页天气请求失败时只显示不可用，不显示假温度。
12. 天气结果有缓存/新鲜度语义，stale 结果不能冒充实时。
13. 920×620 首页布局不因新时间天气头而增高或裁切。
14. 现有 3/4 平台真实连接、联系人、Hero 背景和搜索行为不得回归。

## 11. 非目标

- 不做完整天气应用；
- 不新增联系人位置数据库；
- 不根据手机号、语言或姓名猜测时区；
- 不让天气成为回复的默认话题；
- 不改变最终发送权限或自动发送规则；
- 不重新设计模型路由、记忆或 Persona；
- 不以单次 temporal 判断直接写回长期联系人事实；
- 不为了“像真人”故意制造欺骗性延迟或虚构刚看到消息。
