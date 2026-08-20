# V2.1 Product Experience Shell P0 — Real Windows UAT

## Status

- status: `PENDING_REAL_WINDOWS_UAT`
- formalRelease: false
- productionUseAuthorized: false
- publishAuthorized: false
- result: `NOT_YET_EXECUTED`

This document is the authorized real Electron/Windows UAT evidence path for V2.1 Product Experience Shell P0. Its presence does **not** constitute UAT PASS and does not substitute for automated gates.

## Exact-candidate admission contract

Real Windows UAT may begin only after all of the following are true for one exact Product candidate head:

- Stage 6.4.5.9 WP0 Architecture Gates is GREEN.
- V21 Product Experience Shell P0 Final Validation is GREEN.
- Frozen Element reproducibility is GREEN.
- Materialized Desktop UAT is GREEN and uploaded from that exact head.
- Materialized Matrix UAT is GREEN and uploaded from that exact head.
- Desktop and Matrix artifact metadata both bind the same exact Product candidate head.
- Artifact names, sizes and SHA-256 digests are recorded before download.

Artifacts from an earlier candidate head, a failed Stage run, or a superseded materialization must not be used as formal UAT input.

## Real Windows execution checklist

The operator must execute the materialized Desktop and Matrix/Element candidate on a real Windows host and record observable results here. At minimum, verify:

- application launch and backend readiness;
- unified Element/Matrix conversation shell availability;
- Product Experience relationship-first shell availability;
- People → relationship entry behavior;
- Element timeline and composer remain the conversation authority;
- Product overlays do not destroy the active conversation/composer state;
- keyboard navigation and visible focus behavior;
- reduced-motion behavior;
- exact sound-mode behavior (`Off`, `Essential only`, `Immersive`);
- restart persistence for the candidate state that is expected to persist;
- no unexpected duplicate runtime, conversation engine, overlay framework, or release authority appears.

## Evidence to record after execution

Do not fill these fields until the exact-head automated admission contract above is GREEN and the real Windows run has actually occurred.

```text
CANDIDATE_HEAD=
PRODUCT_FINAL_RUN_ID=
STAGE_RUN_ID=
DESKTOP_ARTIFACT_ID=
DESKTOP_ARTIFACT_SIZE=
DESKTOP_ARTIFACT_SHA256=
MATRIX_ARTIFACT_ID=
MATRIX_ARTIFACT_SIZE=
MATRIX_ARTIFACT_SHA256=
REAL_WINDOWS_HOST=
REAL_WINDOWS_UAT_RESULT=PENDING
```

Screenshots and diagnostic exports, if collected, must not contain credentials, tokens, cookies, credential-vault material, private message content beyond what is necessary for the acceptance step, or raw application databases.

Until every required real-Windows acceptance item is executed and recorded, this document remains `PENDING_REAL_WINDOWS_UAT`; no formal-release, publish, production-use, or promotion claim is authorized.
