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
