# Third-Party Notices

This file is generated deterministically from `third_party/provenance.json`.
The Yance project license decision remains unresolved; this notice records upstream attribution only.

## actions/checkout

- Registry ID: `actions-checkout`
- Upstream: https://github.com/actions/checkout
- Version: `v4.2.2`
- Commit: `11d5960a326750d5838078e36cf38b85af677262`
- Integration mode: `reference_only`
- License: `MIT`
- License evidence: `third_party/licenses/actions-checkout-MIT.txt`
- Modifications: No upstream source is vendored; workflows invoke the reviewed exact commit.
- Obligations: Retain the upstream MIT license and exact commit attribution.

## actions/setup-node

- Registry ID: `actions-setup-node`
- Upstream: https://github.com/actions/setup-node
- Version: `v4`
- Commit: `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`
- Integration mode: `reference_only`
- License: `MIT`
- License evidence: `third_party/licenses/actions-setup-node-MIT.txt`
- Modifications: No upstream source is vendored; workflows invoke the reviewed exact commit.
- Obligations: Retain the upstream MIT license and exact commit attribution.

## actions/upload-artifact

- Registry ID: `actions-upload-artifact`
- Upstream: https://github.com/actions/upload-artifact
- Version: `v4`
- Commit: `ea165f8d65b6e75b540449e92b4886f43607fa02`
- Integration mode: `reference_only`
- License: `MIT`
- License evidence: `third_party/licenses/actions-upload-artifact-MIT.txt`
- Modifications: No upstream source is vendored; workflows invoke the reviewed exact commit.
- Obligations: Retain the upstream MIT license and exact commit attribution.

## @whiskeysockets/baileys

- Registry ID: `baileys-7.0.0-rc13`
- Upstream: https://github.com/WhiskeySockets/Baileys
- Version: `7.0.0-rc13`
- Commit: `8053b086ecc97ec3f78299561de11959bab05d39`
- Integration mode: `patched_dependency`
- License: `MIT`
- License evidence: `third_party/licenses/baileys-MIT.txt`
- Modifications: Installed from the npm lockfile and patched only by the governed postinstall compatibility script.
- Obligations: Retain the upstream MIT license and exact release commit attribution.
