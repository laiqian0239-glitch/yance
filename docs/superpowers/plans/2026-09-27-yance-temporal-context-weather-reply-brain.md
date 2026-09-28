# 言策时间语境与柏林实时首页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首页“早上好”替换为 Berlin 实时时间/天气，并让回复大脑基于消息时间、当前时间与联系人可信时区避免过期问候和时间语义错位。

**Architecture:** 继续以 `contextAwareReplyBrain.buildTemporalContext()` 为回复时间语境唯一入口，在同一文件增加确定性表达识别、mode resolver 与候选时间一致性校验；天气通过一个薄 Open-Meteo provider + 现有 system route / Electron Store bridge 投影到 Home。首页只显示时间与天气，不成为时间、天气或联系人事实 authority。

**Tech Stack:** Node.js/CommonJS backend, Express, Electron IPC/preload, React/TypeScript Element module, Intl.DateTimeFormat, Open-Meteo Forecast API, node:test/Nx/Vite.

**Spec:** `docs/superpowers/specs/2026-09-27-yance-temporal-context-weather-reply-brain-design.md`

## Global Constraints

- Home display zone 固定为 IANA `Europe/Berlin`；DST 必须由 `Intl.DateTimeFormat` 处理，禁止固定 UTC offset。
- 联系人时区只消费联系人 authority：`socialContext.customer.timezone`（或同一联系人 canonical fact projection）；不得把 owner Persona residence 当成联系人时区。
- 联系人时区 unknown 时，允许计算绝对 elapsed，但禁止断言对方当前是早/午/晚。
- 时间语境扩展现有 `buildTemporalContext()`，不得新增第二个回复时间 owner。
- 天气使用 Open-Meteo `/v1/forecast` 当前条件 seam；只请求 Berlin `temperature_2m,weather_code,is_day`，10 分钟 TTL。
- 天气失败不得阻断 Home 或回复生成；过期缓存不得冒充“实时”。
- 天气默认不进入回复 Prompt；只有后续独立话题相关 gate 明确成立时才可消费。本 work package 不扩展天气话题分类器。
- 不改变模型路由、Persona、关系/记忆、Outbox、学习晋升、平台发送或自动发送权限。
- 实施前必须通过 repository-owned mature-authority admission；真实 Windows/UI 验收前后必须走 windows-visual-closure 与 frozen acceptance entrypoints。

## Review Focus

1. DST 边界：Berlin 春秋切换前后时间/日期必须正确，不可出现固定 +1/+2 偏差。
2. 时间戳异常：缺失/非法 `sentAt` 不生成假 elapsed，也不阻断候选。
3. 时区边界：联系人 timezone 非法或缺失时降级 unknown，绝不 fallback 成 Berlin 后假称“下午好”。
4. 网络边界：Open-Meteo 超时/400/无 current payload 时 Home 只显示“天气暂不可用”。
5. UI 生命周期：分钟 tick、窗口重新 focus、组件卸载不能堆叠 timer 或重复 weather 请求。

---
### Task 1: TemporalContextV2 deterministic resolver

**Files:**
- Modify: `backend/services/contextAwareReplyBrain.js:160-195, 940-955, module.exports`
- Create: `backend/tests/contextAwareReplyBrain.temporalContext.test.js`

**Interfaces:**
- Consumes: `incomingMessage.text`, `incomingMessage.sentAt || timestamp`, `socialContext.customer.timezone`, `input.now`.
- Produces: `buildTemporalContext(input)` with `ownerTimeZone`, `ownerLocalDate`, `ownerLocalTime`, `ownerDaypart`, `contactTimeZone`, `contactTimeZoneConfidence`, `incomingMessageInstant`, `incomingDaypart`, `elapsedSeconds`, `temporalExpressions`, `temporalMismatch`, `replyTemporalMode`.
- Produces helpers exported for focused tests: `extractTemporalExpressions(text)`, `validateTemporalCandidate(text, temporalContext)`.

- [ ] **Step 1: Write failing unit tests for Berlin clock, DST, elapsed and temporal modes**

Test exact cases: Berlin DST dates, `08:20 早上好 -> 15:40` = `acknowledge_previous_time`, cross-day `晚安/今晚/明天`, invalid/missing `sentAt`, and unknown contact timezone = `neutral_due_to_unknown_zone` when a current-daypart assertion would otherwise be required.

- [ ] **Step 2: Run RED**

Run: `node --test backend/tests/contextAwareReplyBrain.temporalContext.test.js`
Expected: FAIL because TemporalContextV2 fields/expression resolver/validator are absent.

- [ ] **Step 3: Extend `buildTemporalContext(input = {})` without creating a second owner**

Use `Intl.DateTimeFormat` with `Europe/Berlin` for owner/display time. Read contact zone only from explicit input supplied from contact social context; validate IANA zone by attempting `Intl.DateTimeFormat`. Parse message instant only from `sentAt || timestamp`; invalid/missing remains empty/null. Add deterministic expression matching and finite `replyTemporalMode` enum from the approved spec.

- [ ] **Step 4: Wire canonical inputs at the existing generation seam**

Change the call near candidate generation to `buildTemporalContext({ ...input, incomingMessage, contactTimeZone: socialContext.customer?.timezone, contactTimeZoneConfidence: socialContext.customer?.timezone ? 'high' : 'unknown' })` before Social Decision Packet serialization.

- [ ] **Step 5: Run GREEN and commit**

Run: `node --test backend/tests/contextAwareReplyBrain.temporalContext.test.js`
Expected: PASS.
Commit: `feat: add temporal context v2`

### Task 2: Reply prompt + candidate temporal consistency gate

**Files:**
- Modify: `backend/services/contextAwareReplyBrain.js` (`buildModelMessages`, candidate validation/repair path, candidate generation metadata)
- Modify: `backend/store/commands/registerAiReplyCommands.js` only where existing generation metadata allowlist/projection must preserve temporal fields
- Create: `backend/tests/contextAwareReplyBrain.temporalCandidate.test.js`

**Interfaces:**
- Consumes: Task 1 `temporalContext` and `validateTemporalCandidate(text, temporalContext)`.
- Produces: hard prompt instruction, temporal candidate validation receipt, and metadata fields `replyTemporalMode`, `elapsedBucket`, `contactTimeZoneConfidence`, `temporalValidation`.

- [ ] **Step 1: Write failing tests for prompt and candidate behavior**

Pin: old “早上好” at 15:40 cannot pass as direct current greeting; “刚看到你早上的消息” can pass; unknown contact zone cannot pass unsupported `下午好/晚上好`; cross-day expired-plan wording is rejected; ordinary timeless replies remain unchanged.

- [ ] **Step 2: Run RED**

Run: `node --test backend/tests/contextAwareReplyBrain.temporalCandidate.test.js`
Expected: FAIL because prompt rule/temporal validation receipt are absent.

- [ ] **Step 3: Add temporal instruction to the existing model-message builder**

Add one bounded instruction derived from `replyTemporalMode`; do not add a second system prompt or alternate generation path. The instruction must say that stale time expressions cannot be mirrored as current facts and unknown contact zone requires neutral phrasing.

- [ ] **Step 4: Compose temporal validation with the existing candidate quality gate**

After normal language/style validation but before candidate is accepted/sent to persistence, call `validateTemporalCandidate`. On failure use the existing repair/regeneration path; do not bypass Outbox or silently accept the candidate.

- [ ] **Step 5: Preserve audit metadata without raw-text expansion**

Persist only mode/confidence/elapsed bucket/validation result in existing generation metadata. Do not duplicate message bodies or create a new learning store.

- [ ] **Step 6: Run GREEN plus existing reply-brain regression**

Run: `node --test backend/tests/contextAwareReplyBrain.temporalCandidate.test.js backend/tests/datingFastReplyLearning.test.js`
Expected: PASS.
Commit: `feat: enforce temporal consistency in reply candidates`

### Task 3: Thin Berlin weather projection

**Files:**
- Create: `backend/services/berlinWeatherService.js`
- Modify: `backend/routes/system.js`
- Modify: `electron/r32StoreBridge.js`
- Modify: `electron/preload.js`
- Modify: `integration/element-module/src/product-experience/experienceProjection.ts`
- Modify: `integration/element-module/src/product-experience/experienceTypes.ts`
- Create: `backend/tests/berlinWeatherService.test.js`
- Create: `tests/wp0/v4-home-berlin-weather-bridge-20260927.test.js`

**Interfaces:**
- `berlinWeatherService.getCurrent({ now? }) -> Promise<BerlinWeatherProjection>`.
- `BerlinWeatherProjection = { available, city:'Berlin', timeZone:'Europe/Berlin', observedAt, fetchedAt, stale, temperatureC, weatherCode, conditionLabelZh, isDay, source:'open-meteo' }`.
- Renderer bridge: `window.yanceDesktop.getBerlinWeather() -> Promise<Record<string, unknown>>`.
- Element projection: `loadBerlinWeather() -> Promise<BerlinWeatherProjection>`.

- [ ] **Step 1: Write failing service tests**

Cover fresh success, WMO-code label mapping, 10-minute cache reuse, cache expiry followed by network failure = unavailable (no stale temperature presented), malformed payload, and request failure.

- [ ] **Step 2: Run RED**

Run: `node --test backend/tests/berlinWeatherService.test.js`
Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement the narrow Open-Meteo seam**

Request `https://api.open-meteo.com/v1/forecast` with Berlin coordinates `52.52,13.405`, `current=temperature_2m,weather_code,is_day`, `timezone=Europe/Berlin`, Celsius. Inject `fetchImpl`/clock in tests; keep only an in-memory 10-minute fresh cache; never persist weather.

- [ ] **Step 4: Add read-only backend/IPC/projection path**

Add `GET /system/weather/berlin`; add Store channel `store:system-berlin-weather`; expose `getBerlinWeather` in preload; add the matching typed desktop API + `loadBerlinWeather()` projection. No command/mutation endpoint is added.

- [ ] **Step 5: Prove bridge shape and failures**

Run: `node --test backend/tests/berlinWeatherService.test.js tests/wp0/v4-home-berlin-weather-bridge-20260927.test.js`
Expected: PASS and no credential/API-key requirement.
Commit: `feat: project Berlin weather to Home`

### Task 4: Home Hero Berlin time/weather UI

**Files:**
- Modify: `integration/element-module/src/product-experience/PeopleSurface.tsx:1-20, Home section around 563-575`
- Modify: `integration/element-module/src/product-experience/ProductExperienceShell.css` Home Hero rules
- Create: `tests/wp0/v4-home-berlin-time-weather-20260927.test.js`

**Interfaces:**
- Consumes: Task 3 `loadBerlinWeather()` and browser/system clock.
- Produces: two-line Hero header: primary `HH:mm` in `Europe/Berlin`; secondary `Berlin · <condition> · <rounded temperature>°` or `Berlin · 天气暂不可用`.

- [ ] **Step 1: Write failing Home source/runtime contract test**

Assert the old `☀ + 早上好` copy is removed, Berlin formatter uses IANA zone, weather fallback copy exists, Hero actions/right quote remain present, and 920×620 compact rules do not increase Hero row height.

- [ ] **Step 2: Run RED**

Run: `node --test tests/wp0/v4-home-berlin-time-weather-20260927.test.js`
Expected: FAIL while old greeting remains.

- [ ] **Step 3: Add minute clock lifecycle**

In `PeopleSurface`, keep one timer that aligns to minute boundaries and refreshes Berlin display time; add `focus` listener to correct immediately after laptop sleep/window restore; clean both on unmount.

- [ ] **Step 4: Load optional weather without blocking Home**

Request weather on mount and on focus only when current projection is absent/expired; render unavailable copy on failure. Do not poll weather every minute.

- [ ] **Step 5: Style the compact temporal header**

Primary time 24–26px semibold; secondary 11–12px muted with a small condition glyph. Preserve current Hero background, actions, quote, and 920×620 height/cropping authority.

- [ ] **Step 6: Run GREEN and Element type/build checks**

Run: `node --test tests/wp0/v4-home-berlin-time-weather-20260927.test.js`
Then: `corepack pnpm nx run yance-element-module:lint:types` and `corepack pnpm nx run yance-element-module:build` in the admitted Element workspace.
Expected: PASS/GREEN.
Commit: `feat: show Berlin time and weather on Home`

### Task 5: Integrated regression, metadata proof, and Windows acceptance

**Files:**
- Modify only if assertions expose a real gap: affected files from Tasks 1–4
- Create: `tests/wp0/v4-temporal-reply-home-integration-20260927.test.js`
- Reuse: current Home focused tests for search, separator, platform truth, 920×620 layout

**Interfaces:**
- Consumes: TemporalContextV2, candidate temporal gate, Berlin weather projection, Home temporal header.
- Produces: one integrated local-closure proof and real Windows visual evidence.

- [ ] **Step 1: Add integration regression**

Assert TemporalContextV2 survives Social Decision Packet compaction/serialization and candidate metadata persistence; Home still reads 3/4 real platform authority independently of weather availability; search dismiss/rail separator/Hero background contracts remain unchanged.

- [ ] **Step 2: Run affected local suite**

Run the new temporal tests, Berlin weather tests, existing reply-brain regressions, and current Home focused suite. Expected: all affected tests GREEN; unrelated pre-existing WIP/governance REDs are recorded, not masked.

- [ ] **Step 3: Run repository-required mature-authority proof**

Use the exact admission manifest created before Task 1 mutation; run `corepack npm run prove:yance-mature-authority -- --manifest <manifest.json> --admission <admission.json>`. Any changed owner topology/scope requires a fresh admission before continuing.

- [ ] **Step 4: Materialize only through the frozen acceptance authority**

Before build/materialization run `corepack npm run admit:ui-acceptance:runtime` and, if a build is required, `corepack npm run admit:ui-acceptance:build`. Do not direct-CDP reload or restart the acceptance runtime.

- [ ] **Step 5: Safe reload and real Windows acceptance**

Use `corepack npm run reload:ui-acceptance:safe`, then windows-visual admission/proof. Verify 920×620: Berlin time visible, no old greeting/sun, weather or unavailable fallback visible, Hero/background/buttons unchanged, no clipping, search behavior unchanged, rail remains hairline, platform truth remains real.

- [ ] **Step 6: Manual reply-brain behavioral proof**

With a deterministic fixture or approved local test seam, prove `08:20 早上好` + `15:40` does not yield current “早上好”; prove neutral handling when contact timezone is unknown. No message is physically sent during proof.

- [ ] **Step 7: Final verification and commit**

Run `git diff --check`, affected tests, typecheck/build hashes, and repository visual proof. Commit only this feature's files: `feat: make reply brain time aware`.

## Execution Gates Before Task 1 Mutation

1. Read `skills/yance-mature-authority-audit/SKILL.md` completely enough for this exact causal batch.
2. Create a manifest covering only temporal reply logic, Berlin weather projection, Home temporal UI, Electron read-only bridge, and their tests.
3. Run `corepack npm run admit:yance-mature-authority -- --manifest <manifest.json> --output <admission.json>`; RED blocks mutation.
4. Before any owner-visible Windows UI proof, read `skills/yance-windows-visual-closure/SKILL.md` and use the mandatory frozen acceptance commands from `AGENTS.md`.
5. Do not rebuild/restart bridge/platform account runtime; this feature must not disturb the existing 3/4 account truth state.

## Self-Review Result

- Spec coverage: all sections are mapped to Tasks 1–5; weather-to-reply-topic injection is intentionally excluded because the spec marks weather as weak context and this work package has no approved topic classifier.
- Step scan: each task has a RED, minimal production seam, GREEN, and commit boundary.
- Type consistency: `BerlinWeatherProjection`, `TemporalContextV2`, `replyTemporalMode`, and validation metadata names are consistent across producer/consumer tasks.
- Review Focus coverage: DST/invalid timestamp/unknown zone/network failure/timer lifecycle each has a named owning task/test.
- Authority correction: owner Persona residence is not a contact-timezone source in the current codebase; implementation uses contact social-context timezone only, otherwise `unknown`.
- Proportion: no new state database, scheduler, router, weather framework, or reply generator is introduced.
