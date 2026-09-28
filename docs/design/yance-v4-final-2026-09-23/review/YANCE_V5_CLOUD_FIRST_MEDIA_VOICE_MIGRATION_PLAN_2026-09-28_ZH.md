# 言策 V5｜Cloud-first Voice / Image / Video 迁移计划

日期：2026-09-28  
状态：`DESIGN / MIGRATION PLAN ONLY`  
生产实施：`BLOCKED UNTIL CURRENT CONVERSATION ROOT LOCAL CLOSURE`

## 1. 为什么必须迁移

当前 Voice / Media 生产能力大量依赖本地 runtime：

- TTS / voice clone：CosyVoice sealed runtime。
- ASR：SenseVoice sealed runtime。
- 图片生成/编辑：ComfyUI。
- 媒体资产：Immich。
- Live：CyberVerse + LiveKit。

这些本地能力本身成熟且有价值，但把 TTS、图片生成、未来视频生成继续作为默认 Windows Release 必备前置，会把 GPU、模型 materialization、Python/runtime 完整性、磁盘资源和本地生成模型状态重新变成 Product 启动/聊天能力的阻断面。

目标不是删除成熟本地能力，而是把**重型生成执行**改成 Cloud-first，并把本地能力降为用户明确选择的 Offline Mode。

## 2. 迁移后的 Authority Topology

```text
                   ┌───────────────────────┐
                   │ Yance Product Intent  │
                   │ scene / reply / style │
                   └───────────┬───────────┘
                               │ thin intent
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
 LiteLLM Model Brain    Cloud Voice Authority   Cloud Media Authority
 (LLM routing)          ElevenLabs target       fal.ai target
        │                      │                      │
        │                      ▼                      ▼
        │                audio artifact       image/video artifact
        │                      │                      │
        └──────────────┬───────┴──────────────┬──────┘
                       ▼                      ▼
               existing send-media       Immich asset authority
                       │                      │
                       └──────────┬───────────┘
                                  ▼
                         existing platform send
```

Local Offline Mode：

```text
Explicit Offline Mode
├─ Voice → CosyVoice
└─ Image/Edit → ComfyUI
```

**Cloud 与 Local 不允许 silent fallback 或同时竞争同一个 Product intent。**

## 3. 目标 Provider

### 3.1 Voice：ElevenLabs

目标使用范围：

- Text-to-Speech
- Instant / supported voice cloning
- multilingual speech
- streaming/low-latency speech where appropriate

设计依据：
- ElevenLabs 官方 API 已提供 TTS。
- 官方 Voice Cloning API 提供 IVC/PVC 等克隆能力。
- API key 适合由 server/backend 托管，不应暴露到 renderer。

选它的原因是：Voice 能力可以直接作为成熟服务 owner，避免 Yance 自建 TTS engine、voice model lifecycle、GPU runtime 或动态模型安装。

### 3.2 Image / Video：fal.ai

目标使用范围：

- text-to-image
- image editing
- image-to-video / video generation
- provider-native queue / status / result

设计依据：
- fal.ai 官方 API 已提供 FLUX 系列图片生成/编辑能力。
- 官方 API 已提供 image-to-video / video model endpoints。
- 长任务官方支持 queue/request id/status/result，并明确建议客户端不要暴露 `FAL_KEY`，而应走 server-side proxy。

选它的原因是：一个成熟 Cloud Media execution owner 可以覆盖图片和视频执行，而不需要 Yance 为每个模型重新设计生命周期。

## 4. Credential Custody

强制规则：

1. ElevenLabs / fal.ai API key 不进入 renderer。
2. 不进入 URL、argv、日志、截图、Product state。
3. 由现有 Electron/backend credential authority 保存并在受信进程读取。
4. renderer 只看到：
   - `ready`
   - `unavailable`
   - `credential_required`
   - capability list
   - safe display name
5. Provider 请求由 backend/main 发起。
6. Product error 不回显 provider raw secret/request envelope。

## 5. Cloud Voice 最薄接口

建议 Product contract：

```ts
type VoiceGenerateIntent = {
  text: string;
  language: string;
  voiceProfileId: string;
  style?: {
    warmth?: string;
    pace?: string;
    energy?: string;
  };
};

type VoiceGenerationProjection = {
  requestId: string;
  state: "queued" | "generating" | "ready" | "failed" | "cancelled";
  durationMs?: number;
  previewArtifactRef?: string;
  reasonCode?: string;
};
```

这里的 `requestId/state` 是 provider operation 的**薄投影**，不是 Yance 第二套 scheduler。

生成完成后：
- 结果落入现有受控 generated-artifact boundary。
- 试听后走现有 `send-media-stream`。
- Voice adapter 不拥有最终 send。

## 6. Cloud Image / Video 最薄接口

建议逻辑 Intent：

```text
GENERATE_SCENE_IMAGE
EDIT_SCENE_IMAGE
GENERATE_SCENE_VIDEO
```

输入只包含完成当前场景所需的最小数据：

- scene prompt / structured scene intent
- selected reference asset(s)
- aspect / duration 等 Product 约束
- 当前 Persona 中允许进入生成 prompt 的表达信息

禁止直接把整段私密聊天历史无差别上传给媒体 provider。

返回投影：

```ts
type MediaGenerationProjection = {
  requestId: string;
  kind: "image" | "video";
  state: "queued" | "generating" | "ready" | "failed" | "cancelled";
  progress?: number;
  providerArtifactRef?: string;
  reasonCode?: string;
};
```

ready 后：

```text
provider artifact
→ validate mime/size/type
→ import/save to Immich
→ Product preview
→ canonical route-bound media send
```

## 7. No-shadow Lifecycle Rule

Yance 允许保存：
- intent receipt
- provider request identity
- Product-visible result/failure receipt

Yance 不允许拥有：
- 自己的 provider scheduler
- 自己的 retry queue
- 自己的 image/video inference state machine
- provider failover router
- second media library
- second voice profile engine
- second send queue

长任务优先消费 provider-native queue/webhook/status seam。

## 8. Failure Semantics

### Cloud unavailable
UI：
`照片生成暂不可用` / `声音暂不可用` / `视频生成暂不可用`

不做：
- 自动改走 ComfyUI。
- 自动改走 CosyVoice。
- 假装已生成。
- 无限轮询。

### Credential invalid
UI：
`云端声音需要重新连接` / `云端媒体需要重新连接`

入口跳高级设置；不在 Conversation 暴露 key。

### Timeout / provider error
保留用户当前 draft、timeline scroll、selected contact、scene intent。  
提供 `重试` 的前提必须是成熟 provider/API seam支持且请求 identity 明确；不得自己实现无界 retry。

### User cancel
取消 Product wait/preview；若 provider 提供 cancel seam 则使用 provider seam。没有 cancel seam 时不伪造“远端已取消”，只能标记“本地不再等待”。

## 9. Offline Mode

Offline Mode 是高级设置中的显式选择：

```text
生成方式
● 云端（推荐）
○ 本机离线
```

只有选择“本机离线”后：
- Voice 才启用 CosyVoice execution。
- Image/Edit 才启用 ComfyUI execution。

切换 owner 前必须结束/隔离当前未完成 generation intent，禁止同一 intent 跨 owner 继续。

## 10. Conversation UX

### Voice

```text
文字候选
→ 用我的声音说
→ 生成
→ 试听
→ 重生成 / 发送
```

### Scene Photo

```text
Reply Brain：这一刻适合发一张“今晚在家”的生活照
→ [已有素材] [生成场景照]
→ Preview
→ 保存到素材库
→ 发送
```

### Video

```text
Reply Brain：这一刻视频不是必要 / 适合一段 5–8 秒短视频
→ [使用当前照片] [选择素材]
→ Generate
→ queued / generating
→ Preview
→ 保存
→ 发送
```

视频只有 capability ready 时出现为 active action。

## 11. 首页 UX

普通首页不暴露技术 runtime：

```text
AI模型        已就绪
声音          已就绪
照片生成      已就绪
视频生成      已就绪 / 暂不可用
素材库        已就绪
实时陪伴      已就绪
```

高级设置才显示：

```text
语言模型：LiteLLM / OpenRouter
声音：Cloud Voice
媒体生成：Cloud Media
素材库：Immich
离线能力：可选
```

工程细节如 GPU、Python、ComfyUI URL、CosyVoice runtime、模型下载等只属于“高级系统支持”，不能成为普通用户信息架构。

## 12. Migration Sequence

### Phase A — 当前 Release root
只关闭当前 Conversation Product-primary / presentation root。
- 不接 Cloud provider。
- 不增加依赖。
- 不改 Voice/Media runtime topology。
- 不把本计划混入当前 Exact Head。

### Phase B — Cloud Voice 独立 causal batch
1. 现有 Voice authority topology audit。
2. ElevenLabs credential/readiness seam。
3. 最薄 TTS/clone adapter。
4. 复用现有 preview/artifact/send-media-stream。
5. Cloud-only local proof。
6. 明确 no-silent-fallback proof。
7. UI projection。

### Phase C — Cloud Image 独立 causal batch
1. 现有 Immich/ComfyUI/MediaWorkspace topology audit。
2. fal.ai credential/readiness seam。
3. Generate/Edit thin adapter。
4. provider output → Immich。
5. Immich → existing send。
6. Cloud-only failure/cancel proof。
7. UI scene-photo mini-flow。

### Phase D — Cloud Video 独立 causal batch
1. 选择 mature fal video endpoint capability。
2. provider-native long-job queue/status。
3. preview + asset validation。
4. save-back Immich。
5. existing send path。
6. 920×620 video state proof。

### Phase E — Offline Mode
Cloud path GREEN 后再决定：
- 保留 CosyVoice/ComfyUI 为 explicit Offline Mode；
- 或单独退休。
不得用 Offline Mode 修补 Cloud path 的失败。

## 13. Local Acceptance for Each Cloud Batch

每个 batch 至少证明：

- provider credential 不在 renderer/log。
- provider unavailable 不启动 Local fallback。
- same intent 只有一个 execution owner。
- response/job id 可审计。
- cancellation semantics 与 provider 能力一致。
- generated artifact type/size/mime 校验。
- 图片/视频保存到 Immich 后再发送。
- Voice artifact 通过现有受控目录/stream send。
- canonical conversation route 未丢失。
- draft / scroll / contact / Persona 不因 generation overlay 丢失。
- 920×620 不挤压真实聊天。
- 100% / 125% / 150% visual proof。

## 14. Promotion Rule

Cloud batch 的晋级仍按：

```text
Root Cause
→ One Causal Batch
→ Local Closure
→ affected Golden Journey
→ unknownBlockers 0
→ Exact Head
→ One CI
→ ordinary Merge
→ RC
→ Full Windows UAT
```

Cloud migration 不得以“为了避免以后阻断”为理由绕过 Mature Authority、Local Closure 或 Exact Head 规则。
