# Windows Assisted Local Validation

The supported local validation model is an assisted execution on the user's own Windows computer. WorkBuddy may launch and supervise the pipeline after the user approves administrator access.

## Entry point

Use `tools/release-closure/RUN_WINDOWS_ASSISTED_PIPELINE.ps1` from a sealed delivery package together with its generated `WINDOWS_ASSISTED_VALIDATION_CONFIG_<commit>.json`.

The entry point performs, in order:

1. delivery, Bundle, Runner, Builder, Node and npm binding checks;
2. a fresh DIAGNOSTIC round;
3. two independent STRICT rounds;
4. machine-bound preacceptance generation;
5. Final Builder execution when the reviewed Electron archive and NSIS compiler are present;
6. result JSON, logs and a result ZIP.

## WorkBuddy compatibility contract

- The validation path must not use `Scripting.FileSystemObject` or any other COM object to resolve Windows short paths.
- Native 8.3 probing uses `cmd.exe` and records a distinct reason code for command failure versus alias unavailability.
- If the requested validation volume does not provide a usable 8.3 alias, the Runner checks the system TEMP volume and a system-drive fallback automatically.
- Missing Electron or NSIS tools are reported as `BLOCKED`, not as a product-source failure.
- Early failures must still produce valid environment, step, timeline, TEMP-selection and round-result JSON documents.
- Result manifests may list only evidence files that actually exist.

## Human interaction

The automated pipeline does not approve public release. Interactive Windows UAT remains required for installation screens, first launch, QR login, visual correctness, upgrade/migration and other user-visible behavior.


## Windows PowerShell 5.1 first-hop compatibility

The sealed verifier and assisted pipeline resolve `$PSScriptRoot`-relative defaults only after parameter binding. The verification runner interprets `git ls-files -v` case-sensitively: uppercase `H` is an ordinary cached file, lowercase status letters denote assume-unchanged, and uppercase `S` denotes skip-worktree. Delivery qualification must exercise these first-hop semantics before publishing a Windows candidate.


## Runner-to-preflight TEMP evidence binding

The controlled Runner is the authority that selects a compatible TEMP root. The Node preflight must consume the machine-generated `TEMP_SELECTION.json` from that same round instead of launching a second, independently quoted `cmd.exe` probe. This prevents Windows child-process argument quoting from corrupting a valid `%~sI` result. The shared JavaScript fallback resolver uses verbatim Windows arguments and rejects malformed command output containing quote characters.
