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

Exact Parlant/uv/python-build-standalone runtime pins are recorded in `config/upstreams/v21-parlant-p0.json`. Runtime materialization must verify the pinned asset sizes/hashes and the exact Parlant lock before producing a distributable runtime.
