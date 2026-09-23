# Yance v21 新聊天强制交接 — 2026-09-22

> 这是下一聊天的执行入口，不是状态说明文。
> 用户已明确指出：规则已经写进仓库，但本轮没有严格执行，导致重复偏离、倒退和时间浪费。
> 新聊天必须以仓库规则为执行权威，不能再依赖聊天记忆、旧总结或“先做一点再补规则”。

## 0. 第一原则：先执行仓库规则，再做任何动作

新聊天第一步必须读取：
- `AGENTS.md`
- `skills/yance-release-controller/SKILL.md`
- 若要改任何 production bytes：`skills/yance-mature-authority-audit/SKILL.md`
- 若要做真实 Windows/UI 验收：`skills/yance-windows-visual-closure/SKILL.md`

Superpowers / GitHub / Remote Desktop Commander / Canva 都不能覆盖上述 repository-owned skills。
Repository policy 与 Issue #1051 最新 Controller State 优先于聊天总结。
## 1. Fresh-chat mandatory recovery

这是新的 continuity break。禁止凭本文件直接开始改代码。

必须按 `yance-release-controller` 做一次且仅一次 Fresh State Recovery：
1. 从 GitHub 完整读取 Issue #1051 comments，确认最新可解析 Controller State。
2. 当前已知最新 Controller 是 `V5.576 — FROZEN ACCEPTANCE RUNTIME / UI ACCEPTANCE FAST LOOP IS NOW NON-WAIVABLE`，comment `5749840761`；新聊天仍须 fresh verify，不能只信本交接。
3. 绑定 exact local Git identity、dirty state、Controller comment body 和完整 comments snapshot。
4. 运行 repository skill 规定的 `admit:yance-release-controller` 与 `prove:yance-release-controller`。
5. GREEN 后只执行 proof 输出中的 `NEXT ALLOWED ACTION`；同一 continuity segment 不得重复 broad recovery。

禁止把 Fresh State Recovery 当作项目进展；它只恢复执行权威。
## 2. Exact local state at handoff

- Worktree: `C:\Users\Public\Documents\yance-product-final-ui-local-20260919`
- Branch: `checkpoint/yance-v21-closure-20260922`
- HEAD: `ac98f9c75ae513f978c77a7967660024c283f193`
- Controller issue: GitHub `laiqian0239-glitch/yance#1051`
- Current worktree is dirty. **Never reset / clean / stash / discard unrelated changes.**
- Tracked modified paths at handoff:
  - `backend/services/platformDriverRegistry.js`
  - `backend/tests/accountManagerProvisioningDirectChat.test.js`
  - `integration/element-module/src/index.tsx`
  - `integration/element-module/src/product-experience/ProductExperienceShell.tsx`
  - `shared/core/contracts.js`
  - `tests/wp0/v21-mautrix-direct-chat-command-wiring-local.test.js`
  - `tests/wp0/v21-mautrix-mature-authority-cutover-local.test.js`
- New focused RED test: `tests/wp0/v21-product-contact-directory-authority-local.test.js`
- There are many pre-existing/untracked `.tmp-*`, `.local-corepack-shims`, runtime/materialization directories. Do not clean them as part of this batch.
## 3. What is actually closed vs not closed

### R2 direct-chat wiring

R2 command / IPC / driver proxy wiring reached **CODE-GREEN**, not CLOSED.
Known source closure includes:
- `account.provisioning.directChat.ensure` command registration;
- platform driver proxy `ensureDirectChat(...)`;
- Product direct-chat path can request official mautrix portal and re-resolve exact room authority;
- raw Element navigation must not become Product primary navigation.

Do not reopen this wiring casually. The remaining Product problem is not “command missing” anymore.

### Current Product RED — contact directory completeness

Owner-visible Product symptom remains open:
- Facebook mature bridge space currently has **26** `m.space.child` edges in Synapse authority data. This is a room-hierarchy count, **not yet a proven unique-contact count**.
- Current Yance People, after mature bridge observation is restored, shows **14** relationships total; only **6 Facebook DM rooms** are materialized/joined and visible through current projection, while invite-only Facebook children remain absent.
- Product rule remains: `REMOTE CONTACT != MATRIX ROOM`.
## 4. Current root cause is already bounded — do not re-audit broadly

Exact evidence already obtained in the frozen local runtime:
- Connected Facebook mature account: `fa-mautrix-62e324637ef9b4bb8b56b8a4`.
- Authority: `mautrix-meta`.
- Login id: `100078602384050`.
- Space room: `!mejOITxoTetwtIOdos:yance.local`.
- Synapse authority shows **26** `m.space.child` events for that space; do not equate this raw room-edge count with unique Product contacts before mature-owner summary/dedup projection.
- Existing Product loader calls Element public seam `getSpaceHierarchyRoomIds(spaceRoom)` and receives room IDs.
- For invite-only child rooms, Element does not necessarily have a materialized `Room` object available through `getRoom(roomId)` / current room list.
- Product projection therefore drops those invite-only contacts even though the mature Matrix hierarchy already knows they exist.

Current causal root:
`Element public hierarchy seam returns only IDs -> invite-only children have no Room materialization -> Yance projection cannot obtain hierarchy summary/name -> invite-only contacts disappear from People`.

Do not replace this with another contact census, database rewrite, bulk join, or local shadow address book.
## 5. Fresh RED already exists for the current root

Focused test file at handoff:
`tests/wp0/v21-product-contact-directory-authority-local.test.js`

Latest focused result before handoff:
- 4 tests total
- 2 PASS
- 2 RED

The two REDs intentionally require:
1. Element module public API exposes a read-only Matrix space hierarchy room summary seam, not only room IDs;
2. Yance `loadMatrixDirectRooms` consumes hierarchy summaries so invite-only contacts can project without bulk joining every room.

This is the current failure-first evidence. Do **not** weaken/delete these REDs merely to restore GREEN.
Do not add implementation until the repository-owned mature-authority admission for the expanded owner seam is GREEN.
## 6. Next allowed implementation shape — only after admission

The current mature owner is **Element / Matrix**. Lifecycle/state/retry/recovery stay there.
The intended narrow seam is a read-only hierarchy summary projection, conceptually:
`getSpaceHierarchyRooms(spaceRoomId) -> [{ roomId, name, ...summary fields already owned by Matrix hierarchy }]`.

Yance may only consume that summary as a stateless Product projection:
- exact `roomId` remains Matrix identity;
- summary name/avatar metadata remains mature-owner data;
- directory enumeration must **not** call `ensureRoomJoined` for every contact;
- clicking one invite-only contact may lazily use mature Element `ensureRoomJoined(exactRoomId)` and then bind the real RoomView;
- no duplicate room provisioning when the exact invited room already exists;
- no local-only fake remote contact;
- no second timeline/composer/state/retry authority.

Because this requires expanding the mature-owner public API, create a **new causal-batch mature-authority manifest/admission**. The old v3 admission only covered integration paths and is not authority to mutate Element owner API files.
## 7. Frozen acceptance runtime rules are not optional

Controller V5.576 and `AGENTS.md` are mandatory during owner UI acceptance. Keep the same Docker Compose project, Synapse/Element origins, host ports, Product data root and Electron profile. Do not rebuild/recreate Docker or re-login Matrix for a Product projection fix.

Use only the repository admission entrypoints named in `AGENTS.md` for runtime admission, build admission and safe reload. Do not use direct renderer reload or ad-hoc lifecycle commands.

Do not show raw Element primary navigation to the owner. Final primary navigation remains `Yance People / Relationship World`; the real Element timeline/composer stays embedded as the conversation authority.
## 8. Execution deviation from this chat — DO NOT REPEAT

This chat violated the repository frozen-acceptance discipline while recovering CDP: Electron was relaunched through an ad-hoc local command instead of staying exclusively on the repository admission/safe-reload path. During that relaunch, mautrix provisioning secret-file environment was initially not inherited, temporarily causing mature bridge observation to report `MAUTRIX_PROVISIONING_SECRET_UNAVAILABLE` and People to fall back to 8 relationships.

The same existing secret files and bridge host ports were later restored, without creating new secrets or recreating Docker, and mature bridge observation again showed Telegram/Facebook connected; Product People then showed 14 relationships. This recovery does **not** excuse the process violation.

New chat rule: never copy that recovery technique. If an acceptance helper/CDP is RED, classify it under `AGENTS.md`; do not repair helper infrastructure by mutating/restarting the frozen Product runtime unless a genuine runtime FIRST RED explicitly authorizes it.
## 9. Evidence already consumed — do not rerun merely for reassurance

- Runtime admission was GREEN after the frozen runtime was restored; Yance route was `#/yance`, Matrix user `@tester01:yance.local`, device `VVSOCENLTA`.
- Facebook mature login observation: connected, one bridge login, space room `!mejOITxoTetwtIOdos:yance.local`.
- Telegram mature login observation: connected, login id `8638095739`, space room `!iFErZCplVeOhLUAQjd:yance.local`.
- WhatsApp mature bridge remained logged out/pending real pairing.
- The five existing Element/Synapse/mautrix Docker containers were preserved during the last runtime recovery.
- `git diff --check` at handoff showed no diff errors, only CRLF/LF advisory warnings.

These are handoff facts, not HUMAN-ACCEPTED closure. Re-run only when required by the next repository gate or after relevant bytes/runtime state change.
## 10. Product Final contact gaps remain RED

GitHub #1051 comment `5776333870` records two non-controller Product Final REDs and remains applicable:
- **RED H — Contact directory completeness:** platform contacts must be visible independently of joined/existing Matrix rooms.
- **RED I — First-class Add Contact:** Yance People has no real `添加联系人 / 新建联系` entry yet.

Do not solve either with raw Element `+ / invite / room` UI.
Do not create local-only fake remote contacts.
Add-contact semantics must remain platform/account scoped and use the strongest legitimate mature platform/bridge operation; where a provider cannot truly add a remote contact, present the supported lookup/start-conversation path honestly.

Current execution priority is RED H root closure first. RED I follows after directory identity/projection is correct, so the add flow does not create another contact authority.
## 11. Next chat exact execution sequence

After one-shot Fresh State Recovery, and only if the recovered Controller still points to this same root:
1. Read exact current Element public API/implementation bytes for the hierarchy seam and the current Product loader bytes. No broad audit.
2. Build a new `yance-mature-authority-audit` manifest covering the required owner API path(s), persistent upstream patch/materialization path(s) if applicable, Yance integration path(s), and focused test path(s). Run admission before production mutation.
3. Keep the existing 2 RED hierarchy-summary tests as failure-first evidence; add only the minimum exact-owner behavior test required by the admitted seam.
4. Implement the narrowest read-only Element/Matrix hierarchy summary public seam and the thinnest Yance projection. No bulk join.
5. Run focused RED→GREEN suite, mature-authority proof, typecheck, and only the repository-authorized affected build path.
6. Before touching/showing the frozen Windows UI, run the mandatory runtime/build/visual admissions from `AGENTS.md`; materialize only affected Yance/Element module bytes through the existing authority and use safe reload only.
7. Real Product proof: People must expose the complete legitimate Facebook contact scope derivable from mature-owner hierarchy summaries without pre-joining all rooms; the final unique-contact count must come from owner data/dedup, not a hardcoded 26; click an invite-only contact and prove lazy exact-room join + Yance Conversation Surface + embedded real Element timeline/composer, with no generic Element primary navigation.
8. Only after that may RED H move beyond CODE-GREEN. HUMAN-ACCEPTED still requires owner confirmation.
## 12. Status language and progress reporting

Only use:
`RED -> CODE-GREEN -> DATA-GREEN (when applicable) -> HUMAN-ACCEPTED -> CLOSED`.

Never report test count, controller comments, helper output, or root-cause discovery alone as Product progress.
A user-visible progress unit is a stable Product behavior the owner can observe and accept.
Automated GREEN never substitutes for HUMAN-ACCEPTED.

Do not end a work cycle with another explanation when an already-authorized deterministic production action remains. Conversely, stop immediately at a new FIRST RED, scope/authority change, or owner-only boundary instead of improvising around repository policy.

## 13. New-chat opening instruction

`@Superpowers @GitHub @Remote Desktop Commander 继续言策项目收尾。先严格读取仓库 AGENTS.md 和 repository-owned yance-release-controller skill，按仓库规则做一次 Fresh State Recovery；不要相信旧聊天状态，不要重新泛化盘点。恢复后若 Controller 仍指向当前 causal batch，直接从 Facebook 26 个 Matrix space children 只有 6 个已 materialized/joined、invite-only child 因 hierarchy seam 只有 room ID 而未进入 Yance People 的 RED 开始。任何 production mutation 前先过 yance-mature-authority-audit admission；冻结 acceptance runtime，不准 ad-hoc restart/reload、Docker 重建、Matrix 重登、清 SQLite。目标是一个可人工验收的完整 Product 闭环，不以测试数量冒充进展。`

## Continuation note — R2 is DATA-GREEN in the same frozen runtime

This note supersedes any remaining wording that treats R2 command/join wiring as the current Product RED; it does not change the priority of RED H / RED I and does not authorize promotion.

- Exact Frode room: `!cuBzJhZKiBqXQKnuAQ:yance.local`; tester membership is now `join` through mature Element `ensureRoomJoined -> MatrixClient.joinRoom`.
- Mature room state proves Telegram receiver `8638095739`, peer `user:6472340049`, and both `m.bridge` / `uk.half-shot.bridge` authority events.
- Same frozen runtime `admit:ui-acceptance:runtime` is GREEN with embedded Element conversation presentation and Composer active; no raw Element primary navigation is exposed.
- R2 focused direct-chat wiring is fresh **6 / 6 GREEN**; frozen acceptance admission regression is fresh **6 / 6 GREEN**; `git diff --check` is GREEN.
- Telegram historical backfill remains mature-owner configured `enabled: false`; do not enable it or fabricate history merely to make an invite-only portal look populated.
- Current R2 status: **DATA-GREEN → HUMAN-ACCEPTED pending**. Do not claim CLOSED until the owner accepts the real frozen Windows UI.

## 2026-09-23 continuity update — supersedes the RED-H execution target above

The earlier sections remain historical recovery context. The current causal-batch state is now:

- Fresh State Recovery and mature-authority admission/proof were completed before the owner-seam closure batch.
- RED H hierarchy-summary implementation is persistent through Element patch `0021-yance-space-hierarchy-summary.patch` and bootstrap materialization.
- Invite-only hierarchy contacts can project from mature Matrix summaries without directory-wide auto-join; exact contact selection still delegates join/render authority to Element/Matrix.
- The People ↔ Relationship main scene no longer uses `AnimatePresence mode="wait"`; this fixes the real frozen-runtime case where session state returned Home but stale Relationship World blocked People mounting.
- Current frozen-runtime data reconciliation: 8 backend direct relationships + 35 hierarchy-owned Matrix rooms - 6 canonical route overlaps = 37 Product relationships; rendered People count is also 37.
- Fresh focused suite: 32 / 32 GREEN. Fresh Yance Element module typecheck: GREEN. Runtime admission: GREEN. Safe renderer reload: GREEN.
- Frozen acceptance health admission now uses the existing acceptance-ready timeout for the large `/api/health` diagnostic projection, preventing the generic 4-second helper timeout from creating a false HARNESS_RED under load.
- Do not include or infer closure from unrelated Telegram backfill configuration changes; they are outside the admitted/validated batch.
- Current status language: **R2 DATA-GREEN; RED H DATA-GREEN; HUMAN-ACCEPTED pending.** The owner still decides final real-UI acceptance.

Next allowed work after this checkpoint is not another broad contact census. Continue from owner visual/behavior acceptance or the next separately admitted Product RED (including RED I Add Contact) only after current bytes/branch/controller state are freshly recovered.
