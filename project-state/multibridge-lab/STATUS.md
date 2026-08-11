# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:29 +07:00
Branch: `lab/multibridge-recovery-plan-20260811`
Plan: `docs/superpowers/plans/2026-08-11-yance-multibridge-lab-recovery.md`

## Operating rule

Authoritative Lab execution ledger. Update after every real state transition. Do not repeat completed work unless regression is recorded here.

## Frozen completed work

- WhatsApp authority frozen: mautrix-whatsapp v0.2607.0 / `a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2`, PR #112 ordinary merged.
- Telegram real-device GREEN: HEAD `c85b03d37107a211075aece254c031ec5cff3586`, image `sha256:e064d991e9aefb9eee3c0ecc9615e601c73687ea2f0d493730dddb3dd6403084`.
- Synapse exact pin/image/account frozen; credentials local only.
- R12 readiness revoked for five bridges; R13–R13.3 retired.

## Frozen root-cause entrance

Five bridges restart-loop exit 11 while Synapse stays healthy; DNS failure is downstream. Upstream bridgev2 exit 11 is configuration validation failure. No bridge config changes before exact sanitized validator evidence.

## Collector/native-process TDD — GREEN

- Native-process Windows GREEN `31473597261` / `93722164048`.
- Clean collector nonzero causal RED `31474915060` / `93726291605`.
- Shared root repair `537159b9238dee82b207d131151ba3132f064c43`.
- Full collector/native Windows suite `31475110284` / `93726901278`: 9/9 GREEN.

## R12 service keys — VERIFIED GREEN

Exact Compose service authority: `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`; current collector matches exactly.

## Final package TDD — COMPLETE GREEN

### Failure-first

Test-only `523447ffc1c04b82f06bd66207be6a24e7aca199` → Windows `31481406541` / `93746945122`: 10 pass / 2 intentional missing-wrapper failures; all existing runtime tests GREEN.

### Implementation

`8775328978e29b50232f7180982730731621d855` adds only `RUN_EXIT11_EVIDENCE.cmd`; collector/helper unchanged.

Exact runtime blobs:

- wrapper `7787475bd7a6e0640b5353c3042ae8e8471ef234`
- collector `38eee8ecfe5411a89273027404a320b94b623dba`
- helper `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

### Test-only assertion correction

`73f97d23008a9ce706fce724b2f92f694d03c75a` changes only the over-broad static test assertion; runtime files remain exactly the blobs above.

### Complete final Windows GREEN

Actions run `31481685787`, job `93747849900`, exact checkout `73f97d23008a9ce706fce724b2f92f694d03c75a`, Windows Server 2025 / Node 22.16.0:

- tests=12
- pass=12
- fail=0
- skipped=0

GREEN covers:

- collector read-only boundary;
- exact five services;
- sanitizer;
- controlled Docker native nonzero;
- legacy native stderr RED reproduction;
- stderr+exit0 acceptance;
- native nonzero preservation;
- one user-facing CMD wrapper;
- `powershell.exe -NoExit`;
- fixed single evidence path `exit11-evidence.txt`;
- explicit `FINAL_STATE=REAL_RED` + `OUTPUT_PATH=`;
- no wrapper Docker/Compose command;
- no credential/config/registration/token/cookie/message/WhatsApp/Telegram exposure.

## Current unique next action

**Do not ask the user to run anything yet.**

1. Extend only `.github/workflows/multibridge-lab-native-process.yml` so packaging occurs after the 12 tests pass.
2. Packaging must copy exactly the three runtime files above into an artifact staging directory, generate a SHA-256 manifest, verify the directory contains no extra files, then upload it with official GitHub artifact tooling.
3. The workflow modification must trigger a new Windows run; require all 12 tests GREEN before artifact creation.
4. Download the resulting artifact and independently verify filenames/hashes/source equality.
5. Perform final verification review.
6. Only then hand one ZIP to the user and request exactly `exit11-evidence.txt` after one Windows run.

## User involvement gate

No user testing until artifact build/hash verification and final review are complete. User is not a script-debugging environment.

## Runtime-ready after config repair

Config validation GREEN → sustained five bridges → stable RestartCount → Compose endpoint/alias → Synapse↔bridge DNS/TCP GREEN → provisioning/login GREEN → LAB_RUNTIME_READY → human auth.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native root repairs + Windows GREEN.
- [x] Exact R12 service keys verified.
- [x] Package failure-first RED → wrapper implementation → 12/12 Windows GREEN (`31481685787`).
- [ ] CI-build/hash artifact from exact GREEN source and independently verify ZIP.
- [ ] Capture validator lines and repair R12 generator at source.
- [ ] Validate five runtimes and reach human-auth boundary.
