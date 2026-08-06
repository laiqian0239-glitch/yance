# PVEP v1 Operations

PVEP verifies exact-SHA evidence from registered immutable command sets. It does not grant product, merge, release, publish, promotion, or OSS-A authority by itself.

## Resolve exact identity

Resolve and record the repository base and implementation Head before execution:

```bash
git rev-parse HEAD
git merge-base main HEAD
```

Branch names are never evidence identities. Receipts bind lowercase 40-hex commit SHAs.

## Execute a registered command set

Only a checked-in command-set ID may select execution. Arbitrary shell commands and arbitrary registry paths are not accepted.

```bash
node tools/verification/run-command-set.js \
  --command-set-id pvep-linux-selftest-v1 \
  --base <40-hex-base> \
  --head <40-hex-head> \
  --output .pvep-output/linux-unsigned.json
```

The runner uses direct argv spawning with `shell:false`, validates clean tracked/untracked state, records stdout/stderr digests, and emits an unsigned candidate. An unsigned candidate is never a final verification fact.

## Detached signing

Runner code must not possess the Ed25519 private key. The signer must be privilege-isolated according to `PVEP_EXECUTOR_ENROLLMENT.md`. Sign the raw RFC 8785 canonical payload bytes, not the hexadecimal payload digest. Provide only the raw 64-byte detached signature to the repository assembler:

```bash
node tools/verification/assemble-signed-receipt.js \
  --candidate .pvep-output/linux-unsigned.json \
  --signature .pvep-output/linux-signature.bin \
  --output .pvep-output/linux-signed.json
```

The assembler immediately verifies the resulting final receipt against the checked-in executor and command-set registries before writing it.

## Offline signed-receipt verification

```bash
node tools/verification/verify-receipt.js \
  --receipt .pvep-output/linux-signed.json \
  --expected-base <40-hex-base> \
  --expected-head <40-hex-head>
```

The production CLI exposes no private-key, success-override, or arbitrary registry option. GitHub Actions receipts require an API-backed integration client and cannot self-authenticate offline.

## Linux + Windows requirement aggregation

The self-test requirement manifest is `governance/verification/requirements/pvep-selftest-v1.json`. Its Linux and Windows requirement digests are recomputed from the checked-in command sets before aggregation.

```bash
node tools/verification/verify-requirement-set.js \
  --manifest governance/verification/requirements/pvep-selftest-v1.json \
  --receipts .pvep-output \
  --expected-base <40-hex-base> \
  --expected-head <40-hex-head>
```

Every required gate/platform/command-set digest must have a `VERIFIED_PASS` fact on the same exact base and Head. Mixed Heads, duplicate receipt identity, or conflicting trusted sources fail closed.

## Non-authorities

PVEP v1 implementation does **not** authorize any of the following:

- modification or merge of PR #67;
- OSS-A evidence-policy migration;
- production executor enrollment;
- merge, release, publish, or promotion based solely on a PVEP receipt;
- WP-B work.

PR #67 cannot consume PVEP until PVEP is merged to trusted `main` and a separate, explicitly authorized post-merge governance migration is reviewed and approved. Existing historical/local evidence is not retroactively converted into PVEP authority.
