# Yance V2.1 Media Brain P0 V1 implementation plan

## Frozen authorization

Implementation is limited to the 23 authorized paths with canonical path-set SHA-256 `5285766f6304074ecdeb098409b3b9fdadcd5be84c8acfdf0e2332dbad7aa5bf`. No package, lockfile, workflow, backend route or route-policy modification is authorized.

## Failure-first evidence

The immutable tests-only Head `de90127cd5864d041e4d0db28c2fe19ae254be56` established causal Stage RED: 243 tests, 234 pass, 9 fail; all failures were in the four new Media Brain contracts while route, sealed exports, Electron LFS, dependency install and pre-existing WP0 tests remained GREEN.

## Implementation closure

- Add exact Immich/ComfyUI provenance, license copies and authority descriptor.
- Add a dependency-free `electron/mediaBrainRuntime.js` HTTP adapter.
- Reuse the existing CredentialVault for upstream configuration/secrets.
- Add guarded Media IPC and preload projections.
- Add reviewed API-format ComfyUI generate/edit templates; Yance performs parameter substitution only.
- Add Element Media workspace for health, import, search/select, People, Albums, Generate/Edit, Preview, Save back and Send.
- Add Windows preflight for official ComfyUI portable/user-managed endpoints and user-managed Immich; do not install model/runtime dependencies.
- Keep generated outputs non-selectable until Immich save-back.
- Delegate final delivery to the existing Yance send-media-stream route.

## Verification

Run the four Media WP0 contracts first, then the full WP0 Stage suite, Layered CI and ACV2. Before final readiness, reconcile fresh main by ordinary forward merge only if main has advanced; effective diff must remain the exact authorized 23-path set and pass independent exact-Head review with P0/P1 zero.
