# Yance Final Conversation Implementation Handoff（ZH）

状态：READY FOR LOCAL IMPLEMENTATION / DESIGN ACCEPTED  
日期：2026-09-20  
权威：GitHub Issue #1051 最新 Controller State（本文件写入后更新为 V5.575）

## 1. Frozen Promotion State
- Repo: `laiqian0239-glitch/yance`
- main: `1bf91e4ca6800a4555db7890ad651f1269326d5a`
- frozen PR: #1283
- frozen branch: `fix/v21-product-final-experience-closure-p0-successor-v6`
- frozen exact head: `1d6288d3e36e72894ae3a11e959bcc33bbf91554`
- frozen tree: `3605b677d864521fd87264a6ba727b5d5b33ea0b`
- frozen Product Final run: `35415127800`, attempt 1, conclusion `skipped`
- CI / PR / Merge / RC / Windows UAT remain frozen until Local Closure and promotion admission.

## 2. Local Working State
- local UI/implementation worktree:
  `C:\Users\Public\Documents\yance-product-final-ui-local-20260919`
- worktree HEAD: `1d6288d3e36e72894ae3a11e959bcc33bbf91554`
- branch: detached
- current dirty entries: 61
- **DO NOT RESET / CLEAN / DISCARD** existing local changes.
## 3. Accepted Product Authority
Canonical spec:
`docs/FINAL_CONVERSATION_PRODUCT_AUTHORITY_ZH.md`

Current SHA256:
`9381DA875C19CE7926A2A7CD1354A270839EC000E0020BA0A34AB126B7F1A24F`

This spec is mandatory before every implementation mutation.

Accepted visual baseline:
- gen_id: `a81bd20e-1cd5-4152-b3ea-59aef9e64d47`
- artifact name in accepted conversation: `暮色露台上的暧昧对话.png`
- implementation may improve it, but may not reduce features or visual hierarchy.

## 4. Final Visual Details — Frozen
- Both sides of chat show avatars: peer left, owner right.
- Chat bubbles use the accepted rounded desktop bubble style with subtle tails/depth.
- Incoming foreign text keeps source text and directly shows Chinese meaning below; no literal “中文翻译” label.
- Conversation list preview is Chinese-first.
- Conversation list shows person avatar + name + age + nationality.
- Do not show WhatsApp/Telegram/Instagram/Facebook platform shortcut rows at bottom of Conversation List.
- No redundant full-width top strip/tool row.
- Left and right sidebar collapse controls use the user-specified **small square native desktop icon button**:
  dark/translucent surface, thin border, centered sidebar-rectangle glyph, same component on both sides.
- Never substitute large arrows, K-shaped symbols, double chevrons, or floating web CTA buttons.
- Button system must read as native desktop controls, not website pills/cards.
- Final brain-chat label: **和闺蜜大脑聊聊**.
- Preserve three strategy-level reply candidates.
- Preserve contextual refinements: 更暧昧 / 更温柔 / 更简短 / 深度想想.
- Preserve Rich Reply: Immich real photos + ComfyUI generation/edit + CosyVoice voice reply.
- Preserve Chinese composer -> peer-language final-send preview.

## 5. Required Capability Closure
Implementation must preserve and wire:
- SillyTavern Character Card / scoped Persona;
- Relationship Chemistry / stage / momentum / timeline;
- confirmed facts / recurring interests / open loops / promises / boundaries / sensitive topics;
- Daily Goal + long-term Relationship Goal;
- Reply Director + quick/deep reply;
- OpenRouter catalog + per-capability model binding + reasoning projection;
- mature LiteLLM physical routing;
- Reply Brain Chat durable correction path;
- L1/L2/L3 learning and next-turn consumption;
- HUMAN / AI_ASSIST / AI_AUTO;
- incoming Chinese understanding and outbound peer-language rendering;
- Element/Matrix/bridge mature composer/send/session/recovery authority.
## 6. Shadow Authority Retirement — Mandatory
Do not add new dependencies to Yance legacy model router.
Future cleanup in this causal batch must remove production use of:
- replyChampionAuthority
- aiRouteResolutionAuthority
- aiBrainRoleLifecycleAuthority
- modelPoolSegmentationAuthority
- aiWorkloadPlacementAuthority
- modelRoutingIntegrityService
- modelServiceTaskRoutingAuthority
- equivalent Yance-owned ranking/qualification/retry/fallback authority.

Voice:
- do not expand Yance-owned `voice-brain/profiles/<id>/profile.json + prompt.wav` lifecycle;
- converge voice profile lifecycle to mature CosyVoice/public seam when implementation boundary reaches it.

Media:
- filesystem owns originals;
- Immich owns media library/index/search/people/albums/thumbnails;
- ComfyUI owns generation/edit workflows;
- no Yance media index/watcher/face DB/thumb cache authority.

## 7. Current Root Cause
The production Conversation surface and wiring do not yet implement the accepted Final Conversation Product Authority as one coherent desktop experience; multiple existing capabilities are visually hidden, weakly projected, or not proven closed end-to-end, while legacy shadow model/voice authorities remain contamination risks.
## 8. Current Causal Batch
**FINAL_CONVERSATION_PRODUCT_AUTHORITY_CLOSURE**

One batch, not one symptom per round:
1. preserve current real chat/materialized Facebook/Matrix conversation flow;
2. implement accepted Conversation desktop UI without feature regression;
3. wire existing Character / Memory / Relationship / Goal / Reply Brain capabilities into the visible conversation flow;
4. wire Chinese-first translation presentation and outbound-language preview;
5. wire Rich Reply through mature Immich / ComfyUI / CosyVoice owners;
6. make Reply Brain Chat and learning next-turn consumption observable;
7. remove/retire shadow model-routing production dependencies when touched by this boundary;
8. prove 960×680 and wide-screen layouts;
9. materialize through the existing Element/Vite production-equivalent seam.

## 9. Local Acceptance
Do not claim Local Closure until all are true:
- accepted visual baseline matched or exceeded;
- no web-dashboard/button-wall regression;
- both sidebars collapse with accepted native control;
- Chinese-first list/message translation works;
- both avatars appear correctly;
- all required AI/Character/Memory/Goal/Rich Reply entry points are present;
- no fake contacts/chats/status;
- no new Shadow Authority;
- final materialized output matches source;
- affected Golden Journey is locally GREEN;
- unknownBlockers = 0 for the affected boundary.
## 10. Next Allowed Action
In the next chat:
1. perform **one** Fresh State Recovery from Issue #1051 latest Controller State;
2. do not broad-recover again;
3. open this spec + authority spec;
4. preserve the current dirty worktree — no reset/clean;
5. audit the current Conversation production implementation against the accepted baseline;
6. directly implement the full local causal batch;
7. materialize locally using the existing production-equivalent Element/Vite seam;
8. return the real Yance UI for user acceptance.

Forbidden until Local Closure:
- commit/push for promotion;
- CI;
- new PR;
- merge;
- RC;
- Windows UAT.

PROMOTION_UNKNOWN_BLOCKERS_ZERO = NO
READY_FOR_EXACT_HEAD = NO
READY_FOR_CI = NO
FINAL_CONVERSATION_DESIGN_ACCEPTANCE = GREEN
LOCAL_IMPLEMENTATION = NEXT
