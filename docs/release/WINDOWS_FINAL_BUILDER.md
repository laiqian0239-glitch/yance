# 言策（Yance）Windows Final Builder Contract

The final Windows installer must be produced from a complete sealed Git Bundle in a new clone. Generated build evidence remains outside the source repository.

## Required inputs

- Complete source Bundle for the exact release Commit/Tree.
- External WP7 preacceptance record bound to that exact Commit/Tree.
- Official Electron Windows x64 release archive and its extracted `dist` directory.
- Native `makensis.exe`; command shims and fixture compilers are forbidden.
- Windows x64, Node.js 22.16.0, npm 10.x, Git 2.x, PowerShell 5.1 or newer.

## Entry points

- Node Builder: `tools/wp7/run-windows-final-builder.js`
- Isolated Windows wrapper: `tools/wp7/RUN_WINDOWS_FINAL_BUILDER.ps1`

The PowerShell wrapper verifies the Bundle in a temporary bare repository, creates a new clone, acquires a global mutex, records a 30-second heartbeat, refuses dirty or drifting source identity, writes all Evidence outside the clone, records the independent exit code, and rejects residual Builder processes.

The repository root `.gitattributes` forces deterministic LF materialization for all text files, including exact-byte brand SVG assets. The wrapper still clones with `core.autocrlf=false` and `core.eol=lf` as defense in depth. Manual Windows verification clones must use the same options before the first checkout; changing line endings after checkout is not an accepted repair.

## Release security rules

- Windows npm is invoked as `npm.cmd` through the Windows shell only for the fixed internal npm command and fixed arguments.
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
  -ElectronArchive D:\inputs\electron-v39.8.5-win32-x64.zip `
  -MakensisPath 'C:\Program Files (x86)\NSIS\makensis.exe' `
  -ExpectedCommit <40-char-commit> `
  -ExpectedTree <40-char-tree> `
  -BuildTimestampUtc 2026-07-12T16:00:00.000Z
```
