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
