# Third-Party Notices

Yance V2.1 communication P0 integrates the following mature open-source projects as runtime authorities. Yance does not replace their messaging, bridge, or synchronization state machines.

## Element Web

- Project: Element Web
- Upstream: `https://github.com/element-hq/element-web.git`
- Version: `v1.12.25`
- Exact commit: `a2a996ae50d802878bf48e4bbf3730004bdcc55c`
- License used by this integration: `AGPL-3.0-only`
- License copy: `third_party/licenses/element-web-AGPL-3.0.txt`
- Yance integration: official Element module plus the replayable patch `upstream-patches/element-web/0001-yance-global-right-workspace.patch`, which only exposes the missing persistent global right-panel workspace slot.

## Synapse

- Project: Synapse
- Upstream: `https://github.com/element-hq/synapse.git`
- Version: `v1.158.0`
- Exact commit: `7a3e98b6f77ee3a5fe4dbeb934b0a0c1721e6afe`
- License used by this integration: `AGPL-3.0-or-later`
- License copy: `third_party/licenses/synapse-AGPL-3.0.txt`
- Yance integration: Synapse remains the Matrix state authority.

## mautrix-whatsapp

- Project: mautrix-whatsapp
- Upstream: `https://github.com/mautrix/whatsapp.git`
- Version: `v0.2607.0`
- Exact commit: `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`
- License used by this integration: `AGPL-3.0-or-later WITH upstream-exceptions`
- License copy: `third_party/licenses/mautrix-whatsapp-AGPL-3.0.txt`
- Upstream exceptions copy: `third_party/licenses/mautrix-whatsapp-LICENSE.exceptions.txt`
- Yance integration: mautrix-whatsapp remains the WhatsApp bridge authority.

Exact source pins are recorded in `config/upstreams/v21-comms-p0.json`; `tools/matrix/bootstrap.js` materializes those commits and fails closed on commit or Element patch drift.

## Letta Agent SDK

- Project: Letta Agent SDK
- Upstream: `https://github.com/letta-ai/letta-agent-sdk.git`
- Version: `v0.6.2`
- Exact commit: `c48df1693731443682fe8c7f356ef9b8a33df6c0`
- Package: `@letta-ai/letta-agent-sdk@0.6.2`
- License: `Apache-2.0`
- License copy: `third_party/licenses/letta-agent-sdk-Apache-2.0.txt`
- Yance integration: public remote `LettaAgentClient` management projection only; Letta remains the agent, memory, conversation, and compaction authority.

## Letta Code

- Project: Letta Code
- Upstream: `https://github.com/letta-ai/letta-code.git`
- Version: `v0.30.5`
- Exact commit: `3e5ead65dcf3b7fdf1e2da595660eb85063a9722`
- Package: `@letta-ai/letta-code@0.30.5`
- License: `Apache-2.0` for the code used by Yance; upstream brand assets remain excluded as stated by upstream.
- License copy: `third_party/licenses/letta-code-Apache-2.0.txt`
- Yance integration: Yance supervises the official `letta server --backend local --listen ws://127.0.0.1:0` child and stores its local backend under the Yance data root.

Exact Letta source pins are recorded in `config/upstreams/v21-letta-p0.json`. Yance does not copy the Letta launcher or access private Agent SDK lifecycle fields.

## Parlant

- Project: Parlant
- Upstream: `https://github.com/emcie-co/parlant.git`
- Version: `v3.3.2`
- Exact commit: `61bba3b2b3fffd677d345e393e8c942dbd400297`
- License: `Apache-2.0`
- License copy: `third_party/licenses/parlant-Apache-2.0.txt`
- Upstream dependency lock: exact `uv.lock` Git blob `aa2f7de8e858f19296df58efec56d72c8d3f50a5`
- Yance integration: Parlant remains the relationship Journey, Goal graph, session-processing, progress/backtracking/skipping, and conversation-event authority. Yance exposes only a contact-scoped projection and retains unique final send authority.

## uv

- Project: uv
- Upstream: `https://github.com/astral-sh/uv.git`
- Version: `0.12.3`
- Exact commit: `507230998c9541d67814b57463ac00e454ff6991`
- License: `MIT OR Apache-2.0`
- License copies: `third_party/licenses/uv-MIT.txt`, `third_party/licenses/uv-Apache-2.0.txt`
- Yance integration: build/sealing tool only. It is not shipped as an application runtime dependency resolver.

## python-build-standalone

- Project: python-build-standalone
- Upstream: `https://github.com/astral-sh/python-build-standalone.git`
- Release: `20260807`
- Exact commit: `00c8a06113f11220667c3bcf5fab1672ff9e78ef`
- License: `MPL-2.0`
- License copy: `third_party/licenses/python-build-standalone-MPL-2.0.txt`
- Yance integration: provides the pinned Windows x64 CPython runtime asset used to materialize the sealed Parlant sidecar.

## CPython

- Project: CPython
- Version: `3.12.13`
- Runtime asset: `cpython-3.12.13+20260807-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`
- Runtime asset SHA-256: `18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d`
- License: Python Software Foundation License Version 2 (plus bundled historical/third-party notices in the CPython distribution)
- License copy: `third_party/licenses/cpython-PSF-2.0.txt`
- Yance integration: bundled interpreter for the offline Parlant sidecar; no system Python dependency is permitted.


## tiktoken and o200k_base tokenizer data

- Project: tiktoken
- Upstream: `https://github.com/openai/tiktoken.git`
- Version: `0.12.0`
- Exact commit: `97e49cbadd500b5cc9dbb51a486f0b42e6701bee`
- License: `MIT`
- Exact upstream LICENSE Git blob: `83ed1036f70d4f419307e8a044a35e163cc35201`
- Runtime data: `o200k_base.tiktoken` from `https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken`
- Runtime data SHA-256: `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`
- tiktoken cache key (SHA-1 of the source URL): `fb374d419588a4632f3f557e76b4b70aebbca790`
- License evidence: `dotnet/machinelearning@7bf1b4d28f49b04fd0b511298f41202ed0b454d7`, `src/Microsoft.ML.Tokenizers.Data.O200kBase/Microsoft.ML.Tokenizers.Data.O200kBase.csproj` (blob `701ec1fd4ead088ffeef61f52bcb831b55ff0115`) explicitly identifies this data file as MIT-licensed.
- Yance integration: tiktoken remains the tokenizer implementation selected transitively by Parlant's exact `uv.lock`. The build seal pre-materializes only the exact `o200k_base` data through tiktoken's native `TIKTOKEN_CACHE_DIR` protocol, verifies its official hash, includes it in runtime SBOM/tree sealing, and fails closed if the shipped cache is missing or altered. No runtime tokenizer-data download fallback is permitted.

Exact Parlant/uv/python-build-standalone runtime pins are recorded in `config/upstreams/v21-parlant-p0.json`. Runtime materialization must verify the pinned asset sizes/hashes and the exact Parlant lock before producing a distributable runtime.

## Graphiti

- Project: Graphiti
- Upstream: `https://github.com/getzep/graphiti.git`
- Version: `v0.29.3`
- Exact commit: `021d3a57d511f21b10adaf7fa923bd5c1fce5e9d`
- License: `Apache-2.0`
- License copy: `third_party/licenses/graphiti-Apache-2.0.txt`
- Upstream dependency lock: exact `uv.lock` Git blob `871ec1a85fbcfc80b3919f4178818301981e43e2`
- Yance integration: Graphiti remains the authoritative temporal relationship graph for extracted edge records, episode provenance, validity/invalidation and supersession. Graphiti upstream names extracted edges `facts`; Yance classifies automatically extracted Graphiti edges as AI inference unless the user explicitly confirms or supplies the fact. Upstream v0.29.3 does not expose calibrated confidence on `EntityEdge`, so Yance records such projections as unscored rather than fabricating numeric certainty. Yance provides only a relationship-specific loopback lifecycle/projection adapter and does not copy or reimplement Graphiti's temporal algorithms.

## Neo4j Community

- Project: Neo4j Community Edition
- Upstream source: `https://github.com/neo4j/neo4j.git`
- Version / source tag: `2026.07.1`
- Exact source commit: `f213380f812b820a1b312e2ea52cb3d8f1931ccc`
- Windows runtime artifact: `https://dist.neo4j.org/neo4j-community-2026.07.1-windows.zip`
- First-party checksum: `https://dist.neo4j.org/neo4j-community-2026.07.1-windows.zip.sha256`
- SHA-256: `d70f2019c7a53b6ed5ac61a027a9884a5dbcf714d52e941249036d02d7886162`
- License: `GPL-3.0`
- License copy: `third_party/licenses/neo4j-GPL-3.0.txt`
- Corresponding source: the exact upstream `2026.07.1` source tag above; Yance ships the unmodified Community distribution as Graphiti's local graph store.
- Yance integration: authenticated Bolt on loopback only. Neo4j HTTP/HTTPS connectors are disabled, and Neo4j is not a Yance data-authority replacement outside Graphiti.

## Eclipse Temurin / OpenJDK 21

- Project: Eclipse Temurin 21
- Binary upstream: `https://github.com/adoptium/temurin21-binaries.git`
- Version: `jdk-21.0.11+10`
- Binary release commit: `a056bdb4513e0acd462e16c6f2dd3520306f730e`
- Windows x64 asset: `OpenJDK21U-jdk_x64_windows_hotspot_21.0.11_10.zip`
- SHA-256: `d3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64`
- OpenJDK 21u source commit: `d8615be992082324aaeb01bd6db275e30485aeea`
- License: `GPL-2.0-with-Classpath-Exception`
- License copy: `third_party/licenses/temurin-GPL-2.0-with-Classpath-Exception.txt`
- Yance integration: the verified prebuilt Java 21 runtime is bundled only to run the sealed Neo4j Community process; application startup never downloads Java.

Exact Graphiti, Neo4j Community, Temurin, uv and python-build-standalone pins are recorded in `config/upstreams/v21-graphiti-p0.json`. The Graphiti runtime seal must verify the first-party Neo4j checksum before extraction, must preserve license/source provenance, and must not perform package/source/runtime downloads after sealing.

## SillyTavern

- Project: SillyTavern
- Upstream: `https://github.com/SillyTavern/SillyTavern.git`
- Release: `1.18.0`
- Exact commit: `51ad27fb86d39a3daca3adaa970375c9670c12df`
- License: `AGPL-3.0`
- License copy: `vendor/sillytavern/1.18.0/LICENSE`
- Provenance manifest: `vendor/sillytavern/1.18.0/UPSTREAM.json`
- Yance integration: adopts the pinned Character Card parser/validator/PNG helpers and exact Prompt/Persona/Example Dialogue/Author Note/World Info source regions with mechanical CommonJS and lexical-binding adaptation only. Yance does not import the SillyTavern UI, provider/model gateway, server shell, global chat state, swipe UI, or recursive World Info token-budget engine.
- Authority boundary: SillyTavern supplies Persona/Character/Prompt composition semantics only; Letta remains memory authority, Graphiti remains temporal relationship-fact authority, Parlant remains Goal/Journey authority, and Yance retains its existing model gateway and unique final send authority.

## Immich

- Project: Immich
- Upstream: `https://github.com/immich-app/immich.git`
- Version: `v3.1.0`
- Exact commit: `8aa95c67470a02a8ddedf03c2e52963af33065ff`
- License: `AGPL-3.0`
- License copy: `third_party/licenses/immich-AGPL-3.0.txt`
- Yance integration: unmodified user-managed/self-hosted Immich remains the sole Media Brain authority for asset upload/import, metadata/original/thumbnail retrieval, smart search, people and albums. Yance does not create a parallel asset catalog, search index, face/person index or media database.

## ComfyUI

- Project: ComfyUI
- Upstream: `https://github.com/Comfy-Org/ComfyUI.git`
- Version: `v0.31.0`
- Exact commit: `43cb4fffc89bba20ab7bd61467a36d0339338dab`
- License: `GPL-3.0`
- License copy: `third_party/licenses/comfyui-GPL-3.0.txt`
- Yance integration: unmodified official Windows portable or user-managed ComfyUI remains the sole Media Brain image workflow/model execution authority. Yance performs only HTTP coordination and parameter substitution; generated/edited outputs must be imported into Immich before becoming selectable or sendable.

Exact Media Brain pins and authority boundaries are recorded in `config/upstreams/v21-media-brain-p0.json`.

## LiveKit Server

- Project: LiveKit Server
- Upstream: `https://github.com/livekit/livekit.git`
- Version: `v1.13.5`
- Exact commit: `3b9f118327b257301083a7c4aa46076c8012918a`
- License: `Apache-2.0`
- License copy: `third_party/licenses/livekit-Apache-2.0.txt`
- Yance integration: LiveKit remains the sole realtime WebRTC room/session/media transport server authority. Yance does not implement a second WebRTC server or participant-token signer.

## LiveKit Client SDK JS

- Project: LiveKit Client SDK JS
- Upstream: `https://github.com/livekit/client-sdk-js.git`
- Version: `v2.21.0`
- Exact commit: `15ca5f8180ab8939c3a5a4dfee1d5e44f62f71cf`
- Package: `livekit-client@2.21.0`
- License: `Apache-2.0`
- License copy: `third_party/licenses/livekit-client-Apache-2.0.txt`
- Yance integration: the official client is used directly by the Element Presence workspace for room, microphone and camera lifecycle; no Yance WebRTC client implementation is introduced.

## CyberVerse

- Project: CyberVerse
- Upstream: `https://github.com/Lynpoint/CyberVerse.git`
- Exact commit: `459abae601411d191a1f4c99fe55b60d59e59305`
- License: `GPL-3.0`
- License copy: `third_party/licenses/cyberverse-GPL-3.0.txt`
- Replayable patch: `upstream-patches/cyberverse/0001-yance-external-audio-ingress.patch`
- Yance integration: CyberVerse remains the sole digital-human/avatar/lip-sync/AV-pacing runtime and its existing LiveKit media-peer/participant-token authority. The patch adds only a session-scoped external AudioChunk ingress inside CyberVerse so already-synthesized Yance Voice audio enters CyberVerse's existing avatar/media primitives.

## SoulX-FlashHead

- Project: SoulX-FlashHead
- Upstream: `https://github.com/Soul-AILab/SoulX-FlashHead.git`
- Exact commit: `9bc03de06bb0de82cd6bc477804512ae06144bf2`
- Weights: `Soul-AILab/SoulX-FlashHead-1_3B`
- License: `Apache-2.0`
- License copy: `third_party/licenses/soulx-flashhead-Apache-2.0.txt`
- Yance integration: the model remains CyberVerse-executed. Yance does not copy its inference engine, lip-sync implementation, weights runtime, or avatar state machine into Electron.

Exact Presence / Avatar pins and authority boundaries are recorded in `config/upstreams/v21-presence-avatar-p0.json`.

## SenseVoice

- Project: SenseVoice
- Upstream: `https://github.com/QwenAudio/SenseVoice.git`
- Release: `runtime-llamacpp-v0.1.9`
- Exact source commit: `73ccdd3577db37e92dbf22a4a9fc323b038cf13b`
- Windows x64 AVX2 runtime asset: `funasr-llamacpp-windows-x64-avx2.zip`
- Runtime asset SHA-256: `f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c`
- License: `MIT`
- License copy: `third_party/licenses/sensevoice-MIT.txt`
- Yance integration: sole local Voice Brain ASR and language-detection authority. Legacy Whisper ASR discovery, CLI, installer and fallback authority are retired.

## SenseVoice / FunASR model

- Model repository used for sealed GGUF runtime: `FunAudioLLM/SenseVoiceSmall-GGUF`
- Exact model revision: `90c1c61912018b70ada0fcc024ea24aca62f2e63`
- Sealed q8 model SHA-256: `4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5`
- Source model license evidence: FunASR Model Open Source License Agreement, version 1.1
- License copy: `third_party/licenses/funasr-model-license.txt`
- Yance integration: model weights are used only by the verified local SenseVoice runtime; model/source attribution is retained separately from the GGUF repository's distribution metadata.

## CosyVoice

- Project: CosyVoice
- Upstream: `https://github.com/QwenAudio/CosyVoice.git`
- Exact source commit: `074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc`
- License: `Apache-2.0`
- License copy: `third_party/licenses/cosyvoice-Apache-2.0.txt`
- Yance integration: sole Voice Brain TTS, zero-shot voice-cloning and cross-lingual speech authority. The sealed runtime carries the exact upstream source tree and initialized `third_party/Matcha-TTS` source subtree; Yance provides only a thin local process adapter.

## Fun-CosyVoice3-0.5B-2512 model

- Model repository: `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`
- Exact model revision: `29e01c4e8d000f4bcd70751be16fa94bf3d85a18`
- License: `Apache-2.0`
- License copy: `third_party/licenses/cosyvoice3-model-Apache-2.0.txt`
- Yance integration: exact local model snapshot for cloned/cross-lingual speech. The application does not download this model at startup.

## Voice runtime dependencies

- ONNX Runtime version: `1.18.0`
- ONNX Runtime license: `MIT`
- License copy: `third_party/licenses/onnxruntime-MIT.txt`
- PyTorch / torchaudio version: `2.3.1`
- PyTorch license copy: `third_party/licenses/pytorch-BSD-3-Clause.txt`
- CosyVoice upstream dependency `openai-whisper==20231117` is sealed only for CosyVoice prompt-audio mel feature extraction. It is not a Yance ASR authority and must not be used for transcription, model discovery, CLI installation or fallback routing.
- Voice Python dependency closure is defined only by `runtime/voice-brain/cosyvoice/pyproject.toml` plus its exact `uv.lock`, then materialized at build time using the already-noticed `uv` and `python-build-standalone` supply chain with `--frozen --offline` semantics.

Exact Voice Brain source, model and build-tool pins are recorded in `config/upstreams/v21-voice-brain-p0.json`. Voice profiles and prompt samples remain local/private; final Voice sending delegates to the existing Yance `send-media-stream` authority rather than creating a second send queue or outbox.

## Agent Lightning

- Project: Microsoft Agent Lightning
- Upstream: `https://github.com/microsoft/agent-lightning.git`
- Version: `v0.3.0`
- Exact commit: `3b5d733861cf313fc09821a23240bbdf3cb2ee5b`
- Package: `agentlightning[apo]==0.3.0`
- License: `MIT`
- License copy: `third_party/licenses/agent-lightning-MIT.txt`
- Upstream dependency lock: exact `uv.lock` Git blob `5a98a2ac121b050b0a82f6ac8dc207577ce3af4e`
- Yance integration: source-module CORE + APO only, downstream of Learning and Model Brain authority, returning `CANDIDATE_ONLY`.
## Vowpal Wabbit

- Project: Vowpal Wabbit
- Upstream: `VowpalWabbit/vowpal_wabbit`
- Version: `9.11.2`
- Frozen commit: `122bae254a5b8bc2b774d13b33d53e6dbc2cfba7`
- License: `BSD-3-Clause`
- License copy: `third_party/licenses/vowpal-wabbit-BSD-3-Clause.txt`
- Yance integration: sealed Learning runtime contextual-bandit ADF policy head only. P1 is deterministic (`actionProbability=1.0`, `exploration=false`); Model Brain/LiteLLM remains the final reply-generation authority.


## mautrix/meta
- Upstream: https://github.com/mautrix/meta
- Version: v0.2607.0
- Commit: `ed37c9e6ce47e83dc75b9abea7b636302715b9bc`
- License: GNU AGPL v3 with upstream `LICENSE.exceptions` for Beeper and Element.
- Adoption: unmodified sidecar protocol/login/session authority for Facebook Personal Messenger (`messenger-lite`).

## matrix-js-sdk
- Upstream: https://github.com/matrix-org/matrix-js-sdk
- Version: 42.0.0
- Commit: `85362b92fabe6009bc1a86b63d046263b1dc66b3`
- License: Apache-2.0.
- Adoption: Matrix client/sync/event/send/media/typing/read-receipt boundary; Yance does not implement a second Matrix `/sync` engine.

## llama.cpp

- Project: ggml-org/llama.cpp
- Upstream: `https://github.com/ggml-org/llama.cpp.git`
- Version/tag: `b10336`
- Exact commit: `f401bb139016c7994298d21ebb1d07b8f9e4d50b`
- License: `MIT`
- License copy: `third_party/licenses/llama.cpp-MIT.txt`
- Yance integration: user-materialized native Windows / loopback OpenAI-compatible runtime. llama.cpp remains the inference, quantized-model execution and CPU/GPU scheduling authority; Yance only plans from measured evidence and invokes its loopback API.

## KTransformers

- Project: kvcache-ai/ktransformers
- Upstream: `https://github.com/kvcache-ai/ktransformers.git`
- Exact commit: `95009ea6856c0799e517e93cb12be5e8494bc7ce`
- License: `Apache-2.0`
- License copy: `third_party/licenses/ktransformers-Apache-2.0.txt`
- Yance integration: user-managed WSL/loopback OpenAI-compatible runtime for CPU/GPU hybrid and MoE execution. Native Windows support is not claimed. KTransformers remains the expert/tensor scheduling and inference authority.

## AirLLM

- Project: lyogavin/airllm
- Upstream: `https://github.com/lyogavin/airllm.git`
- Package version: `3.1.0`
- Exact commit: `cfe456e5e1c28ea046f16cc835743f141e8ac9b8`
- License: `Apache-2.0`
- License copy: `third_party/licenses/airllm-Apache-2.0.txt`
- Yance integration: optional user-materialized background/extreme local worker. AirLLM retains layer-streaming/model execution authority; Yance only owns process lifecycle, evidence projection and user-visible status.

Exact adaptive-local runtime pins and materialization boundaries are recorded in `config/upstreams/v21-adaptive-local-llm-runtime-p0-v1.json`. Yance does not commit model/runtime binaries and does not download these OSS runtimes through connector flows; installation is explicit, local, disk-preflighted and SHA-256 fail-closed.
