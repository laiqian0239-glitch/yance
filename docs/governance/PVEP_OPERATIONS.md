# PVEP GitHub/Sigstore Operations

PVEP no longer treats a Yance-generated receipt, detached Ed25519 signature, executor registry, JCS implementation, or GitHub API rebind as a cryptographic trust root. GitHub Artifact Attestations and Sigstore provide authenticity; Yance keeps only exact repository, base/head, workflow/source identity, and Linux/Windows requirement policy.

## Trusted producer

`.github/workflows/pvep-attested-evidence.yml` is loaded from the pull request base through `pull_request_target`. Candidate code runs only in the Linux and Windows verification jobs with read-only repository permission. The OIDC/attestation job never checks out or executes candidate code. It runs only after both verification jobs succeed and attests a subject binding the exact base, exact head, and the two base-owned command-set SHA-256 digests.

The required policy is `governance/verification/requirements/pvep-selftest-v1.json`.

## Online verification

Use GitHub CLI as the Sigstore verifier through the Yance policy wrapper:

```bash
node tools/verification/verify-attestation.js \
  --requirements governance/verification/requirements/pvep-selftest-v1.json \
  --repository laiqian0239-glitch/yance \
  --base <trusted-main-base-sha> \
  --head <reviewed-pr-head-sha>
```

The wrapper invokes `gh attestation verify` with the exact repository, signer workflow, signer digest, source digest, `refs/heads/main`, PVEP predicate type, `--deny-self-hosted-runners`, and JSON output. It then requires a verified timestamp and validates the authenticated predicate against the exact Yance requirement set.

## Offline verification

On an online machine, reconstruct the deterministic subject and download the GitHub attestation bundle:

```bash
BASE=<trusted-main-base-sha> HEAD=<reviewed-pr-head-sha> node - <<'NODE' > subject.txt
const fs = require('node:fs');
const { buildSubject } = require('./shared/verification/githubAttestationVerifier');
const requirementSet = JSON.parse(fs.readFileSync('governance/verification/requirements/pvep-selftest-v1.json', 'utf8'));
process.stdout.write(buildSubject(requirementSet, {
  repository: 'laiqian0239-glitch/yance',
  baseCommit: process.env.BASE,
  headCommit: process.env.HEAD
}));
NODE

gh attestation download subject.txt \
  --repo laiqian0239-glitch/yance \
  --predicate-type https://yance.dev/attestations/pvep-verification/v1

gh attestation trusted-root > trusted_root.jsonl
```

Move the downloaded bundle, `trusted_root.jsonl`, the trusted Yance verifier/requirements, and the expected base/head values into the offline environment. Then run:

```bash
node tools/verification/verify-attestation.js \
  --requirements governance/verification/requirements/pvep-selftest-v1.json \
  --repository laiqian0239-glitch/yance \
  --base <trusted-main-base-sha> \
  --head <reviewed-pr-head-sha> \
  --bundle <downloaded-attestation-bundle.jsonl> \
  --trusted-root trusted_root.jsonl
```

Refresh the GitHub/Sigstore trusted-root material whenever new signed evidence is imported into an offline environment. Yance does not maintain a parallel root-key lifecycle.

## Fail-closed rules

Verification fails when GitHub/Sigstore verification fails, no verified timestamp is present, base/head identity drifts, the signer/source policy drifts, either platform is missing or duplicated, a command-set digest differs, an unexpected requirement appears, or multiple cryptographically verified attestations disagree on the trusted fact.

PR #100's custom receipt/JCS/Ed25519 executor/GitHub-rebind trust stack is superseded by this OSS-backed path and must not be imported into the active implementation.
