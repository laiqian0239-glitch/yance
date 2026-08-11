# YANCE-MULTIBRIDGE-LAB — Single Source of Truth

Last updated: 2026-08-11 17:52 +07:00
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

## Collector/package failure-first closure

All Lab-owned wrapper/collector/native-process defects found during recovery were converted into causal tests before root repair:

- native stderr semantics RED → ProcessStartInfo root repair;
- collector Docker native-nonzero RED → shared sanitized Docker-read classifier;
- missing wrapper package RED → minimal one-wrapper implementation;
- wrapper CRLF repository/worktree byte mismatch RED → permanent byte-identity gate + canonical LF source.

Exact R12 Compose service keys are verified as `facebook-personal`, `instagram-dm`, `google-messages`, `signal`, `line`.

## Final artifact-producing Windows GREEN — VERIFIED

Canonical artifact workflow pin commit:

`5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`

Actions run `31482336770`, job `93749917415`, exact checkout `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa`:

- tests=13
- pass=13
- fail=0
- skipped=0
- byte-identity gate GREEN for all three runtime files;
- `PACKAGE_FILE_SET=GREEN`;
- runtime artifact upload success, exactly 3 files;
- verification artifact upload success, exactly 2 files.

Canonical runtime Git blobs:

- wrapper `c9afd263cc5b89486ff937a195e9313bdce9c32a`
- collector `38eee8ecfe5411a89273027404a320b94b623dba`
- helper `47d56b8e6561676eec75b814c1ed1ebaa8ba30d5`

Runtime file SHA-256:

- `RUN_EXIT11_EVIDENCE.cmd` → `9f549eaf02fc641f2d070779376e5ba7f748327da5cce4acd0b3bbe43c5af65c`
- `collect-exit11-evidence.ps1` → `75fccc095aba5199e263b6c328ac0c78b8d969899f78f897f4bdb193ed7b0200`
- `native-process.ps1` → `fd715e68aae8a6efdd93ea64272208c38134d2cd67b9ac01275eda02c354599d`

GitHub artifacts:

- runtime artifact ID `9097730797`, ZIP digest `sha256:59e780e5e6f0df3bab7f30402c56ab15eb385ca8a495abdb3842caba3d472383`;
- verification artifact ID `9097731102`, ZIP digest `sha256:427776162f74c0374a31b1e2cbadfdf87c4f17f5f694454c84b722d312aebc24`.

## Independent post-download verification — GREEN

The downloaded artifacts were independently inspected outside the workflow:

1. Both downloaded ZIP SHA-256 values exactly match GitHub artifact digests above.
2. Runtime ZIP contains exactly and only:
   - `RUN_EXIT11_EVIDENCE.cmd`
   - `collect-exit11-evidence.ps1`
   - `native-process.ps1`
3. No config/registration/password/account/credential/token/cookie/message/WhatsApp/Telegram filename is present.
4. All three extracted runtime SHA-256 values exactly match the workflow manifest.
5. Recomputed Git blob identities from the extracted bytes exactly match the canonical blobs above.
6. Verification ZIP contains exactly `SHA256SUMS.txt` and `SOURCE.txt`.
7. `SOURCE.txt` records tested commit `5b8f77aa10e7bab2538d1c4f0ce3a643045536fa` and all three canonical Git blobs correctly.
8. Independent package content scan confirms:
   - wrapper uses `powershell.exe -NoExit`;
   - wrapper prints `FINAL_STATE=REAL_RED` and `OUTPUT_PATH=`;
   - wrapper does not call Docker/Compose directly;
   - collector targets exactly the five R12 services;
   - collector uses bounded logs (`--tail 80`, max 12 matched validation lines);
   - collector has no Docker lifecycle/network mutation path;
   - helper uses `System.Diagnostics.ProcessStartInfo` with independently redirected stdout/stderr.

## User involvement gate — NOW OPEN FOR ONE READ-ONLY EVIDENCE COLLECTION

This is the first point in the recovery where user Windows execution is authorized again.

The user may perform exactly one action sequence:

1. Download and extract the verified runtime ZIP.
2. Double-click `RUN_EXIT11_EVIDENCE.cmd` once.
3. Allow it to finish; the PowerShell window remains open by design.
4. Upload exactly the generated `exit11-evidence.txt` file back to ChatGPT.

Do not upload any config, registration, password, account, token, cookie, Matrix credential, message content, or other runtime files.

The package is read-only. It does not build, restart, stop, reconfigure, connect networks, exec into containers, restage Synapse, or touch WhatsApp/Telegram.

## Unique next action after evidence returns

1. Read the five sanitized service sections from `exit11-evidence.txt`.
2. Identify the exact configuration-validation line(s) for each bridge independently.
3. Map every failing field to its exact pinned upstream schema/example/validator source.
4. Only then write failure-first tests for the real R12 generated invalid fields and repair the existing R12 config generator at source.
5. No compatibility shims or networking workaround are authorized.

## Runtime-ready after config repair

Upstream config validation GREEN → five bridge processes sustained running → RestartCount stable → intended Compose endpoint/alias present → Synapse→bridge DNS/TCP GREEN → bridge→Synapse GREEN → upstream provisioning/login GREEN → `LAB_RUNTIME_READY` → only then human login/2FA/device confirmation.

## Real-account order

Facebook Personal → Instagram DM → Google Messages → Signal → LINE → Facebook Page last.

## Progress

- [x] Collector/native-process root fixes failure-first.
- [x] Exact R12 service keys verified.
- [x] Package failure-first and byte-identity hardening.
- [x] Final Windows 13/13 GREEN and artifact uploads GREEN.
- [x] Independent artifact digest/file-set/SHA/Git-blob/content verification GREEN.
- [x] Authorize one read-only Windows exit-11 evidence collection.
- [ ] Receive `exit11-evidence.txt` and identify exact five upstream validator failures.
- [ ] Repair R12 config generator at source using upstream authorities.
- [ ] Validate five runtimes and sustained readiness.
- [ ] Reach human-auth boundary in frozen order.
