# YANCE-MULTIBRIDGE-LAB — Facebook Public Runtime Deploy Handoff

Date: 2026-08-12
Branch: `lab/multibridge-recovery-plan-20260811`
Facebook Public deploy-source commit: `deccb7f157112cd866a1c9362f3197b53c4583d3`
Deploy-source tree: `987d714941fc49773170478413609d70799d668d`

## Authority override

This handoff supersedes older sequencing text in `STATUS.md` / the 2026-08-11 recovery plan that treats Facebook Personal as the current task or Facebook Page as a later task.

Current priority is **Facebook Public / Facebook Page**. Facebook Personal is frozen and MUST NOT be re-debugged while this Public deploy boundary is unresolved.

## OSS-fit authority

Facebook Public protocol / behavior authority remains pinned in `services/facebook-worker/upstream-authority.json`:

- Meta Messenger samples: `fbsamples/messenger-platform-samples@cc87d98775965f21e10ad42a619c057501774af9`
- Meta Graph schema authority: `facebook/facebook-nodejs-business-sdk@ebd272a36a1a54a10e846cc4c42200be54871f5a`
- Mature Page behavior reference: `chatwoot/chatwoot@3f4d28f77bc8352bafcaf4fce94ba939f4527064`
- `mautrix/meta` remains prohibited as Facebook Public runtime; it is Personal puppeting authority only.

No new Yance Facebook protocol stack was introduced.

## Architecture authority

Production Facebook Public remains:

`Meta Messenger -> Cloudflare Worker -> D1/R2 -> signed desktop relay -> FacebookAdapter -> local stores`

The Worker owns Meta App Secret / Page Access Token / Graph / Webhook / media. Windows/Electron remains fail-closed against direct Graph and MUST NOT store a Page Token.

## Completed in this work package

- Page webhook subscription now includes both `message_echoes` and `message_reactions`, matching already-supported desktop ingestion semantics.
- `/healthz` publishes the exact non-secret Page Messenger subscription contract for runtime attestation.
- Formal runtime verifier requires OAuth contract v6 plus the exact subscription contract.
- Canonical `services/facebook-worker/wrangler.jsonc` is deployable and bound to production D1 `9394aab2-8a7d-40fa-88b5-90455a7a0bbd`; the divergent legacy `wrangler.deploy.local.jsonc` was retired.
- Required Worker secret NAMES are declared separately in `services/facebook-worker/required-secrets.json`; no non-schema `secrets.required` field is used in Wrangler config.
- Windows production package verifies remote required secret names using official pinned `wrangler secret list`; secret values are never read or packaged.
- The Windows package is deploy-only and self-contained: repository-scoped tests are not copied or rerun inside the sealed package.
- GitHub Actions now validates both the repository Worker bundle and the sealed package Worker bundle with pinned `wrangler@4.121.0` dry-run before uploading the package.
- `actions/upload-artifact@v4` is configured with `include-hidden-files: true`, so `.gitignore` and safe `.dev.vars.example` survive the actual downloadable artifact and its SHA256 manifest remains valid.

## Fresh verification evidence

GitHub Actions run `31550855154` at source commit `deccb7f157112cd866a1c9362f3197b53c4583d3`:

- Facebook Worker tests: **71/71 GREEN**
- Facebook integration contracts: **73/73 GREEN**
- Canonical `wrangler@4.121.0 deploy --dry-run`: **GREEN**
- Sealed Windows package build: **GREEN**
- Wrangler dry-run from the sealed package directory: **GREEN**
- Artifact upload: **GREEN**, 40 files
- Live production runtime probe: **RED only**

Current live RED is exactly:

`FACEBOOK_FORMAL_WORKER_RUNTIME_CONTRACT_STALE`

The production Worker responds HTTP 200 but is older than the current OAuth/subscription runtime contract. Do not report production runtime GREEN until the canonical source is actually deployed and the strict live verifier passes.

## Verified Windows artifact

Valid artifact:

- GitHub artifact ID: `9124192551`
- artifact name: `YANCE_FACEBOOK_PUBLIC_WINDOWS_DEPLOY_deccb7f157112cd866a1c9362f3197b53c4583d3`
- artifact ZIP SHA-256: `2b854a04ef961d7a5976061ef1c964bdb679203071afe601733b11b90bfbc81c`
- retention expiry: `2026-08-19T00:38:13Z`

The exact downloaded ZIP was independently unpacked after Actions upload. `SHA256SUMS.txt` verified every packaged file; `.gitignore` and `.dev.vars.example` were present; no repository test directory, real `.dev.vars*`, legacy deploy config, Page Token, Meta secret, Cloudflare token, or hotfix deploy script was present.

DO NOT use older artifact `9124163245`; its GitHub upload omitted hidden files and therefore could not satisfy its own manifest after download.

## Hard authorization boundary / next action

The only remaining blocker in this work package is a real Cloudflare account authorization + production deploy. Run the verified Windows package `RUN.ps1` from its extracted root.

`RUN.ps1` performs, in order:

1. package SHA-256 verification;
2. Node >=22.19 check;
3. public production config preflight;
4. pinned Wrangler dry-run;
5. `wrangler whoami`, then official `wrangler login` only if authorization is absent;
6. remote required-secret NAME inventory and fail-closed comparison;
7. canonical production `wrangler deploy`;
8. strict live formal Worker verification;
9. writes `artifacts/facebook-public-deploy-evidence.json` only after GREEN.

This is a genuine human authorization boundary. Do not create a bypass, alternate deploy config, manual hotfix, or second deployment script.

## Resume after authorization

After the deploy package returns GREEN, continue directly with Facebook Page operator authorization / Page selection / real send+receive runtime acceptance. Do not return to Facebook Personal debugging.
