# 言策（Yance）Windows Final Builder Contract

The final Windows installer must be produced from a complete sealed Git Bundle in a new clone. Generated build evidence remains outside the source repository.

## Required inputs

- Complete source Bundle for the exact release Commit/Tree.
- External WP7 preacceptance record bound to that exact Commit/Tree.
- Official Electron Windows x64 release archive and its extracted `dist` directory.
- Native `makensis.exe`; command shims and fixture compilers are forbidden.
- Reviewed Builder-host Node.js 22.16.0 + npm 10.9.2 toolchain for dependency/build commands.
- Separate trusted packaged Node.js 22.23.1 Windows x64 executable supplied through `-TrustedNodeExecutable`; it is verified before being embedded under `resources/runtime/node22`.
- Windows x64, Git 2.x, PowerShell 5.1 or newer.

The Builder-host Node/npm toolchain and the Node runtime shipped inside Yance are separate authorities. The host toolchain must not silently become the packaged runtime, and the official Node 22.23.1 archive's bundled npm must not replace the repository package-manager authority `npm@10.9.2`.

## Entry points

- Node Builder: `tools/wp7/run-windows-final-builder.js`
- Isolated Windows wrapper: `tools/wp7/RUN_WINDOWS_FINAL_BUILDER.ps1`

The PowerShell wrapper verifies the Bundle in a temporary bare repository, creates a new clone, acquires a global mutex, records a 30-second heartbeat, refuses dirty or drifting source identity, writes all Evidence outside the clone, records the independent exit code, and rejects residual Builder processes. It also verifies the Builder-host Node/npm versions independently from the exact Node 22.23.1 packaged runtime before invoking the Node Builder.

The repository root `.gitattributes` forces deterministic LF materialization for all text files, including exact-byte brand SVG assets. The wrapper still clones with `core.autocrlf=false` and `core.eol=lf` as defense in depth. Manual Windows verification clones must use the same options before the first checkout; changing line endings after checkout is not an accepted repair.

## Release security rules

- Windows npm is invoked through the separately reviewed Builder-host Node/npm custody and remains bound to repository package-manager authority `npm@10.9.2`.
- The product-embedded trusted Node runtime must be exactly Node 22.23.1 and must flow through the existing WP7 Node runtime identity/packaging seam; Product-specific Node runtimes, Yance downloaders, and second runtime managers are forbidden.
- The final NSIS compiler must be a native `.exe`; `.cmd` and `.bat` compiler shims are rejected.
- `makensis.exe` is spawned directly without a shell.
- Compiler output must be a valid Windows PE before it can be sealed as an installer.
- A 28-byte or text fixture installer cannot become final release evidence.
- The reviewed production dependency binding is immutable during a final build. If the real installed dependency tree does not match it, stop and create a separate source Commit updating the binding, then rerun affected gates.

## Example

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\wp7\RUN_WINDOWS_FINAL_BUILDER.ps1 `
  -SourceBundle D:\handoff\Yance_WINDOWS_RELEASE_SOURCE.bundle `
  -WorkRoot D:\Yance-Builder\source `
  -EvidenceRoot D:\Yance-Evidence\Builder-<commit> `
  -PreacceptanceRecord D:\handoff\WP7_PREACCEPTANCE_BINDING.json `
  -PreacceptanceSha256 <sha256> `
  -WindowsRound1Result D:\handoff\WINDOWS_ROUND1_RESULT.json `
  -WindowsRound1Sha256 <sha256> `
  -WindowsRound2Result D:\handoff\WINDOWS_ROUND2_RESULT.json `
  -WindowsRound2Sha256 <sha256> `
  -ElectronArchive D:\inputs\electron-v39.8.5-win32-x64.zip `
  -MakensisPath 'C:\Program Files (x86)\NSIS\makensis.exe' `
  -NodeRoot D:\toolchains\node-v22.16.0-win-x64 `
  -TrustedNodeExecutable D:\runtimes\node-v22.23.1-win-x64\node.exe `
  -ExpectedBranch <branch> `
  -ExpectedCommit <40-char-commit> `
  -ExpectedTree <40-char-tree> `
  -ExpectedBundleSha256 <sha256> `
  -BuildTimestampUtc 2026-07-12T16:00:00.000Z
```
