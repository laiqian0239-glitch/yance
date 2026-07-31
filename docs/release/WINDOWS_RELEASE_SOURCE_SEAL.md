# Windows Release Source Seal

This contract seals the current clean Windows Release Closure source identity without writing generated Evidence into the Git repository.

## Inputs

- A named release-closure branch.
- A clean worktree.
- A Stage6 base commit that is an ancestor of `HEAD`.
- An empty output directory outside the source repository.

Default Stage6 base:

```text
4a21ec3b127af8a9362bdc06bf47ef9023138b39
```

## Windows invocation

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass `
  -File .\tools\release-closure\SEAL_WINDOWS_RELEASE_SOURCE.ps1 `
  -OutputDir D:\Yance-Seals\source-<commit>
```

## Cross-platform invocation

```text
node tools/release-closure/create-source-seal.js \
  --output-dir /external/path/source-<commit>

node tools/release-closure/verify-source-seal.js \
  --seal-dir /external/path/source-<commit>
```

## Generated artifacts

- Complete Git Bundle for the current release-closure branch.
- Source ZIP generated directly from the Git Tree.
- Binary Stage6-to-HEAD patch written as raw bytes without a UTF-8 BOM.
- Machine-readable source identity.
- Independent Bundle clone, ZIP/Tree, Patch rebuild and `git fsck` results.
- Human-readable report.
- Standard two-column `SHA256SUMS.txt`.

The checksum file is intentionally compatible with:

```text
sha256sum -c SHA256SUMS.txt
```

## Fail-closed rules

The generator refuses to run when:

- `HEAD` is detached.
- The worktree is dirty.
- The Stage6 base is not an ancestor of `HEAD`.
- The output directory is inside the source repository.
- The output directory is not empty.
- Bundle clone, ZIP/Tree equality, Patch rebuild equality or `git fsck` fails.
- The generated patch begins with a UTF-8 BOM.

Generated test Evidence, historical logs, preacceptance identities and release results remain outside the repository and are not silently copied into the source seal.
