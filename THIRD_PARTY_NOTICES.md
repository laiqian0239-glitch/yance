# Third-Party Notices

This file is generated from `third_party/provenance.json`.
Do not edit it manually.

Yance project license decision: **UNRESOLVED**

## GitHub Actions Checkout

- Registry ID: `actions-checkout`
- Upstream: https://github.com/actions/checkout
- Version: `v4.4.0`
- Commit: `11d5960a326750d5838078e36cf38b85af677262`
- Integration mode: `dependency`
- License: `MIT`
- License evidence: `third_party/licenses/actions-checkout-MIT.txt`
- Upstream source paths:
  - None recorded for dependency-only integration.
- Yance integration paths:
  - `.github/workflows/oss-provenance.yml`
- Modifications:
  - Yance invokes the upstream Action at the reviewed exact commit and explicitly disables persisted checkout credentials.
- Distribution obligations:
  - Retain the upstream MIT copyright, permission notice and disclaimer in distributed copies or substantial portions.
- Review: `APPROVED` on `2026-08-06`

## GitHub Actions Setup Node

- Registry ID: `actions-setup-node`
- Upstream: https://github.com/actions/setup-node
- Version: `v6.4.0`
- Commit: `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`
- Integration mode: `dependency`
- License: `MIT`
- License evidence: `third_party/licenses/actions-setup-node-MIT.txt`
- Upstream source paths:
  - None recorded for dependency-only integration.
- Yance integration paths:
  - `.github/workflows/oss-provenance.yml`
- Modifications:
  - Yance invokes the upstream Action at the reviewed exact commit without vendoring or modifying its source.
- Distribution obligations:
  - Retain the upstream MIT copyright, permission notice and disclaimer in distributed copies or substantial portions.
- Review: `APPROVED` on `2026-08-06`

## GitHub Actions Upload Artifact

- Registry ID: `actions-upload-artifact`
- Upstream: https://github.com/actions/upload-artifact
- Version: `v4.6.2`
- Commit: `ea165f8d65b6e75b540449e92b4886f43607fa02`
- Integration mode: `dependency`
- License: `MIT`
- License evidence: `third_party/licenses/actions-upload-artifact-MIT.txt`
- Upstream source paths:
  - None recorded for dependency-only integration.
- Yance integration paths:
  - `.github/workflows/wp3-windows-named-mutex.yml`
- Modifications:
  - Yance invokes the upstream Action at the reviewed exact commit without vendoring or modifying its source.
- Distribution obligations:
  - Retain the upstream MIT copyright, permission notice and disclaimer in distributed copies or substantial portions.
- Review: `APPROVED` on `2026-08-06`

## WhiskeySockets Baileys

- Registry ID: `baileys-7.0.0-rc13`
- Upstream: https://github.com/WhiskeySockets/Baileys
- Version: `7.0.0-rc13`
- Commit: `8053b086ecc97ec3f78299561de11959bab05d39`
- Integration mode: `patched_dependency`
- License: `MIT`
- License evidence: `third_party/licenses/baileys-MIT.txt`
- Upstream source paths:
  - `package.json`
  - `LICENSE`
- Yance integration paths:
  - `scripts/dependencies/apply-baileys-profile-picture-token-fix.js`
- Modifications:
  - Yance applies a deterministic postinstall compatibility patch to the installed Baileys package; the patch is maintained in Yance and does not replace the upstream package authority.
- Distribution obligations:
  - Retain the Baileys copyright and MIT permission notice in distributed copies or substantial portions.
  - Preserve the upstream disclaimer that Baileys is unofficial and usage remains subject to WhatsApp terms and account risk.
- Review: `APPROVED` on `2026-08-04`
