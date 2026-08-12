# YANCE-MULTIBRIDGE-LAB — Facebook Public Runtime Deploy Handoff

Date: 2026-08-12
Branch: `lab/multibridge-recovery-plan-20260811`
Facebook Public deploy-source commit: `deccb7f157112cd866a1c9362f3197b53c4583d3`
Deploy-source tree: `987d714941fc49773170478413609d70799d668d`

## Authority override

This handoff supersedes older sequencing text in `STATUS.md` / the 2026-08-11 recovery plan that treats Facebook Personal as the current task or Facebook Page as a later task.

Current priority is **Facebook Public / Facebook Page**. Facebook Personal is frozen and MUST NOT be re-debugged in this stream.

## OSS-fit authority — FROZEN

Facebook Public protocol / behavior authority remains pinned in `services/facebook-worker/upstream-authority.json`:

- Meta Messenger samples: `fbsamples/messenger-platform-samples@cc87d98775965f21e10ad42a619c057501774af9`
- Meta Graph schema authority: `facebook/facebook-nodejs-business-sdk@ebd272a36a1a54a10e846cc4c42200be54871f5a`
- Mature Page behavior reference: `chatwoot/chatwoot@3f4d28f77bc8352bafcaf4fce94ba939f4527064`
- `mautrix/meta` remains prohibited as Facebook Public runtime; it is Personal puppeting authority only.

No new Yance Facebook bridge, connector, protocol stack or acceptance infrastructure is permitted unless a future V2.1 OSS-fit explicitly authorizes it.

## Architecture authority

Production Facebook Public remains:

`Meta Messenger -> Cloudflare Worker -> D1/R2 -> signed desktop relay -> FacebookAdapter -> local stores`

The Worker owns Meta App Secret / Page Access Token / Graph / Webhook / media. Windows/Electron remains fail-closed against direct Graph and MUST NOT store a Page Token.

## Source / package closure — GREEN

GitHub Actions run `31550855154` at source commit `deccb7f157112cd866a1c9362f3197b53c4583d3` established:

- Facebook Worker tests: **71/71 GREEN**
- Facebook integration contracts: **73/73 GREEN**
- canonical `wrangler@4.121.0 deploy --dry-run`: **GREEN**
- sealed Windows package build: **GREEN**
- Wrangler dry-run from the sealed package directory: **GREEN**
- package upload: **GREEN**, 40 files

The Page webhook subscription contract is exact:

- `messages`
- `message_echoes`
- `message_reactions`
- `messaging_postbacks`
- `messaging_referrals`
- `message_deliveries`
- `message_reads`

Canonical `services/facebook-worker/wrangler.jsonc` is bound to production D1 `9394aab2-8a7d-40fa-88b5-90455a7a0bbd`. Required Worker secret **names** remain separately declared in `services/facebook-worker/required-secrets.json`; secret values are never read by the package or stored in the repository.

## User-machine canonical deploy — COMPLETED

The verified Windows deploy package was run on the real Windows machine. It proved remote required-secret name inventory GREEN and completed canonical `wrangler@4.121.0 deploy` to:

`https://yance-facebook-gateway.wangyi198675.workers.dev`

Wrangler reported deployed Worker version ID:

`5fb99e4e-730f-4c42-a47c-fe72e14f523b`

The package's immediate post-deploy verifier observed `FACEBOOK_FORMAL_WORKER_RUNTIME_CONTRACT_STALE` with HTTP 200. No hotfix or alternate deploy path was introduced. Because the canonical deploy itself had succeeded, the exact same canonical GitHub Actions job was rerun after the runtime had time to converge.

## Formal production runtime — GREEN

Rerun job `94003930971` under run `31550855154` completed **SUCCESS** without source changes. The final strict live runtime probe passed at server time `2026-08-12T03:50:11.173Z` and attested:

- service: `yance-facebook-gateway`
- Graph version: `v25.0`
- OAuth contract version: `6`
- D1 schema version: `6`
- exact seven Page Messenger subscribed fields listed above
- callback: `https://yance-facebook-gateway.wangyi198675.workers.dev/oauth/facebook/callback`

Therefore the Facebook Public production Worker deployment boundary is **CLOSED GREEN**. The earlier immediate RED is superseded by the later strict live PASS; there is no evidence requiring a source-level Worker repair.

## Deployment artifact authority

The real deployment used verified artifact ID `9124192551`:

- name: `YANCE_FACEBOOK_PUBLIC_WINDOWS_DEPLOY_deccb7f157112cd866a1c9362f3197b53c4583d3`
- ZIP SHA-256: `2b854a04ef961d7a5976061ef1c964bdb679203071afe601733b11b90bfbc81c`

Do not use superseded artifact `9124163245`.

The CI rerun emitted another artifact instance only because the workflow reran; it is not required for the completed production deployment.

## Next hard human authorization boundary

Continue directly with the repository's existing formal Windows source-UAT flow. Do **not** create a new UAT harness.

Existing authority:

- `docs/FACEBOOK_FORMAL_WORKER_WINDOWS_INTEGRATION_ZH.md`
- `tools/runtime-delivery/start-source-uat.js`
- package script `start:source-uat`

Required real acceptance sequence:

1. launch the real Windows Electron source UAT with the sealed production platform-auth resources;
2. Account Center -> Facebook -> official browser Business Login;
3. complete Meta operator authorization;
4. return to Yance and select the intended public Page;
5. prove device registration and Page webhook subscription;
6. send a real message to the Page from an external Facebook identity and prove Worker -> D1 -> signed desktop polling -> `FacebookAdapter` -> local SQLite -> ACK;
7. send a real reply from Yance and prove delivery through the Worker-owned Page Token path;
8. collect non-secret runtime evidence only.

Meta login, Page selection and the external real-account message are genuine human authorization/external-runtime boundaries. No Page Token, Meta App Secret or Cloudflare token should be copied into chat or Windows configuration.
