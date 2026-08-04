# Third-Party Notices

This file is generated from `third_party/provenance.json`.
Do not edit it manually.

Yance project license decision: **UNRESOLVED**

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

