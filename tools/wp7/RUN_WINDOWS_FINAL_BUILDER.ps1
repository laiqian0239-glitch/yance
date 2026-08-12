[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceBundle,
  [Parameter(Mandatory = $true)][string]$WorkRoot,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot,
  [Parameter(Mandatory = $true)][string]$PreacceptanceRecord,
  [Parameter(Mandatory = $true)][string]$PreacceptanceSha256,
  [Parameter(Mandatory = $true)][string]$WindowsRound1Result,
  [Parameter(Mandatory = $true)][string]$WindowsRound1Sha256,
  [Parameter(Mandatory = $true)][string]$WindowsRound2Result,
  [Parameter(Mandatory = $true)][string]$WindowsRound2Sha256,
  [Parameter(Mandatory = $true)][string]$ElectronArchive,
  [Parameter(Mandatory = $true)][string]$MakensisPath,
  [Parameter(Mandatory = $true)][string]$ExpectedCommit,
  [Parameter(Mandatory = $true)][string]$ExpectedTree,
  [Parameter(Mandatory = $true)][string]$ExpectedBranch,
  [Parameter(Mandatory = $true)][string]$ExpectedBundleSha256,
  [Parameter(Mandatory = $true)][string]$NodeRoot,
  [Parameter(Mandatory = $true)][string]$TrustedNodeExecutable,
  [Parameter(Mandatory = $true)][string]$BuildTimestampUtc,
  [string]$PlatformAuthConfig,
  [string]$PlatformAuthSha256,
  [switch]$RequirePlatformAuth,
  [switch]$RequireSignedInstaller,
  [string]$SigningCertificate,
  [string]$SignToolPath,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$NodeExe = Join-Path $NodeRoot 'node.exe'
$NpmCli = Join-Path $NodeRoot 'node_modules\npm\bin\npm-cli.js'
$TrustedNodeExecutable = [IO.Path]::GetFullPath($TrustedNodeExecutable)
$OriginalPath = $env:PATH
$OriginalNpmCache = $env:NPM_CONFIG_CACHE
$OriginalElectronSkipBinaryDownload = $env:ELECTRON_SKIP_BINARY_DOWNLOAD

function Get-SanitizedPath([string]$Original, [string]$PinnedNodeRoot) {
  $items = New-Object System.Collections.Generic.List[string]
  $pinned = [System.IO.Path]::GetFullPath($PinnedNodeRoot)
  $items.Add($pinned)
  foreach ($entry in ($Original -split ';')) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    $candidate = $entry.Trim()
    try { $full = [System.IO.Path]::GetFullPath($candidate) } catch { $full = $candidate }
    if ($full.Equals($pinned, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $containsNode = (Test-Path -LiteralPath (Join-Path $full 'node.exe') -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $full 'npm.cmd') -PathType Leaf)
    if ($containsNode) { continue }
    if (-not $items.Contains($candidate)) { $items.Add($candidate) }
  }
  return ($items -join ';')
}

function Expand-ValidatedElectronArchive([string]$ArchivePath, [string]$Destination, [string]$PackageRoot, [string]$EvidencePath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $destinationFull = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  $fileCount = 0
  try {
    foreach ($entry in $archive.Entries) {
      $relative = ([string]$entry.FullName).Replace('/', '\')
      if ([string]::IsNullOrWhiteSpace($relative)) { continue }
      if ($relative.StartsWith('\') -or $relative.Contains(':')) { throw "Electron archive contains an absolute or alternate-stream path: $relative" }
      $segments = @($relative -split '\\')
      if ($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }) { throw "Electron archive contains a dot path segment: $relative" }
      $unixType = (($entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($unixType -eq 0xA000) { throw "Electron archive contains a symbolic link: $relative" }
      $target = [System.IO.Path]::GetFullPath((Join-Path $Destination $relative))
      if (-not $target.StartsWith($destinationFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Electron archive path escapes destination: $relative" }
      if (-not $seen.Add($target)) { throw "Electron archive contains a duplicate path: $relative" }
      if ([string]::IsNullOrEmpty($entry.Name)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        continue
      }
      $parent = Split-Path -Parent $target
      if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
      $input = $entry.Open()
      $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
      $fileCount += 1
    }
  }
  finally { $archive.Dispose() }

  $electronExe = Join-Path $Destination 'electron.exe'
  $versionFile = Join-Path $Destination 'version'
  $packageFile = Join-Path $PackageRoot 'package.json'
  if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw 'official Electron archive does not contain electron.exe' }
  if (-not (Test-Path -LiteralPath $versionFile -PathType Leaf)) { throw 'official Electron archive does not contain version' }
  if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { throw 'installed Electron package.json is missing' }
  $packageVersion = [string]((Get-Content -LiteralPath $packageFile -Raw | ConvertFrom-Json).version)
  $archiveVersion = ([string](Get-Content -LiteralPath $versionFile -Raw)).Trim() -replace '^v', ''
  if ($packageVersion -ne $archiveVersion) { throw "Electron archive version $archiveVersion does not match npm package version $packageVersion" }
  $typeDefinition = Join-Path $Destination 'electron.d.ts'
  if (Test-Path -LiteralPath $typeDefinition -PathType Leaf) { Move-Item -LiteralPath $typeDefinition -Destination (Join-Path $PackageRoot 'electron.d.ts') -Force }
  [System.IO.File]::WriteAllText((Join-Path $PackageRoot 'path.txt'), 'electron.exe', (New-Object System.Text.UTF8Encoding($false)))
  [ordered]@{
    status = 'PASS'
    archivePath = [System.IO.Path]::GetFullPath($ArchivePath)
    archiveSha256 = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    packageVersion = $packageVersion
    archiveVersion = $archiveVersion
    extractedFileCount = $fileCount
    electronExecutableSha256 = (Get-FileHash -LiteralPath $electronExe -Algorithm SHA256).Hash.ToLowerInvariant()
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
}

function ConvertTo-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') { $backslashes += 1; continue }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) { [void]$builder.Append(('\' * $backslashes)); $backslashes = 0 }
    [void]$builder.Append($character)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

$mutex = [System.Threading.Mutex]::new($false, 'Global\YanceWindowsFinalBuilder')
$hasLock = $false
try {
  $hasLock = $mutex.WaitOne(0)
  if (-not $hasLock) { throw 'another Yance Windows Final Builder is already running' }
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'PowerShell 5.1 or newer is required' }
  if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows is required' }
  if (-not (Test-Path -LiteralPath $SourceBundle -PathType Leaf)) { throw "source bundle missing: $SourceBundle" }
  if (-not (Test-Path -LiteralPath $PreacceptanceRecord -PathType Leaf)) { throw "preacceptance record missing: $PreacceptanceRecord" }
  if (-not (Test-Path -LiteralPath $WindowsRound1Result -PathType Leaf)) { throw "Round 1 result missing: $WindowsRound1Result" }
  if (-not (Test-Path -LiteralPath $WindowsRound2Result -PathType Leaf)) { throw "Round 2 result missing: $WindowsRound2Result" }
  if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "reviewed node.exe missing: $NodeExe" }
  if (-not (Test-Path -LiteralPath $NpmCli -PathType Leaf)) { throw "reviewed npm CLI missing: $NpmCli" }
  if (-not (Test-Path -LiteralPath $TrustedNodeExecutable -PathType Leaf)) { throw "trusted packaged Node runtime missing: $TrustedNodeExecutable" }
  if ((Get-FileHash -LiteralPath $SourceBundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedBundleSha256.ToLowerInvariant()) { throw 'source bundle SHA256 mismatch' }
  if ((Get-FileHash -LiteralPath $WindowsRound1Result -Algorithm SHA256).Hash.ToLowerInvariant() -ne $WindowsRound1Sha256.ToLowerInvariant()) { throw 'Round 1 result SHA256 mismatch' }
  if ((Get-FileHash -LiteralPath $WindowsRound2Result -Algorithm SHA256).Hash.ToLowerInvariant() -ne $WindowsRound2Sha256.ToLowerInvariant()) { throw 'Round 2 result SHA256 mismatch' }
  $round1Record = Get-Content -LiteralPath $WindowsRound1Result -Raw | ConvertFrom-Json
  $round2Record = Get-Content -LiteralPath $WindowsRound2Result -Raw | ConvertFrom-Json
  if ($round1Record.bundleSha256 -ne $ExpectedBundleSha256.ToLowerInvariant() -or $round2Record.bundleSha256 -ne $ExpectedBundleSha256.ToLowerInvariant()) { throw 'Windows round result bundle binding does not match SourceBundle' }
  if ((& $NodeExe --version).Trim() -ne 'v22.16.0') { throw 'reviewed Builder host Node version mismatch' }
  if ((& $NodeExe $NpmCli --version).Trim() -ne '10.9.2') { throw 'reviewed npm version mismatch' }
  if ((& $TrustedNodeExecutable --version).Trim() -ne 'v22.23.1') { throw 'trusted packaged Node runtime version mismatch' }
  if (-not (Test-Path -LiteralPath $ElectronArchive -PathType Leaf)) { throw "Electron archive missing: $ElectronArchive" }
  if (-not (Test-Path -LiteralPath $MakensisPath -PathType Leaf)) { throw "makensis.exe missing: $MakensisPath" }
  if ([IO.Path]::GetExtension($MakensisPath).ToLowerInvariant() -ne '.exe') { throw 'MakensisPath must point to a native .exe' }
  if ($RequirePlatformAuth) {
    if (-not (Test-Path -LiteralPath $PlatformAuthConfig -PathType Leaf)) { throw "sealed platform auth configuration missing: $PlatformAuthConfig" }
    if (-not (Test-Path -LiteralPath $PlatformAuthSha256 -PathType Leaf)) { throw "platform auth SHA-256 missing: $PlatformAuthSha256" }
  }
  elseif ([string]::IsNullOrWhiteSpace($PlatformAuthConfig) -ne [string]::IsNullOrWhiteSpace($PlatformAuthSha256)) {
    throw 'PlatformAuthConfig and PlatformAuthSha256 must be supplied together'
  }
  if ($RequireSignedInstaller) {
    if (-not (Test-Path -LiteralPath $SigningCertificate -PathType Leaf)) { throw "signing certificate missing: $SigningCertificate" }
    if (-not (Test-Path -LiteralPath $SignToolPath -PathType Leaf)) { throw "signtool.exe missing: $SignToolPath" }
    if ([IO.Path]::GetExtension($SignToolPath).ToLowerInvariant() -ne '.exe') { throw 'SignToolPath must point to a native .exe' }
    if ([string]::IsNullOrWhiteSpace($env:YANCE_WINDOWS_CERTIFICATE_PASSWORD)) { throw 'YANCE_WINDOWS_CERTIFICATE_PASSWORD is required' }
  }
  if (Test-Path -LiteralPath $WorkRoot) { throw "WorkRoot must not already exist: $WorkRoot" }
  if (Test-Path -LiteralPath $EvidenceRoot) { throw "EvidenceRoot must not already exist: $EvidenceRoot" }

  New-Item -ItemType Directory -Path $EvidenceRoot | Out-Null
  $heartbeat = Join-Path $EvidenceRoot 'heartbeat.jsonl'
  $exitFile = Join-Path $EvidenceRoot 'overall-exit-code.txt'
  $stdout = Join-Path $EvidenceRoot 'builder-stdout.log'
  $stderr = Join-Path $EvidenceRoot 'builder-stderr.log'
  $identityBefore = Join-Path $EvidenceRoot 'identity-before.json'
  $identityAfter = Join-Path $EvidenceRoot 'identity-after.json'

  git init --bare (Join-Path $EvidenceRoot 'bundle-verify.git') | Out-Null
  git -C (Join-Path $EvidenceRoot 'bundle-verify.git') bundle verify $SourceBundle | Set-Content (Join-Path $EvidenceRoot 'bundle-verify.log')
  git -c core.autocrlf=false -c core.eol=lf clone --config core.autocrlf=false --config core.eol=lf $SourceBundle $WorkRoot --branch $ExpectedBranch
  if ($LASTEXITCODE -ne 0) { throw "git clone failed with exit $LASTEXITCODE" }
  git -C $WorkRoot config core.autocrlf false
  git -C $WorkRoot config core.eol lf

  $head = (git -C $WorkRoot rev-parse HEAD).Trim()
  $tree = (git -C $WorkRoot rev-parse 'HEAD^{tree}').Trim()
  $branch = (git -C $WorkRoot branch --show-current).Trim()
  $dirty = @(git -C $WorkRoot status --porcelain)
  if ($head -ne $ExpectedCommit -or $tree -ne $ExpectedTree -or $branch -ne $ExpectedBranch -or $dirty.Count -ne 0) { throw 'fresh clone identity mismatch, branch mismatch or dirty worktree' }
  @{ commit = $head; tree = $tree; branch = $branch; clean = $true } | ConvertTo-Json | Set-Content -Encoding UTF8 $identityBefore

  Push-Location $WorkRoot
  try {
    $env:YANCE_NODE_EXE = $NodeExe
    $env:YANCE_NPM_CLI_JS = $NpmCli
    $env:PATH = Get-SanitizedPath $OriginalPath $NodeRoot
    $env:NPM_CONFIG_CACHE = Join-Path $EvidenceRoot 'npm-cache'
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      # Windows PowerShell 5.1 converts ordinary npm stderr warnings into
      # NativeCommandError. Builder success is determined only by npm's exit code.
      $ErrorActionPreference = 'Continue'
      & $NodeExe $NpmCli ci --no-audit --no-fund
      $npmCiExitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    if ($npmCiExitCode -ne 0) { throw "root npm ci failed with exit $npmCiExitCode" }
    $electronPackageRoot = Join-Path $WorkRoot 'node_modules\electron'
    $electronDist = Join-Path $electronPackageRoot 'dist'
    Expand-ValidatedElectronArchive $ElectronArchive $electronDist $electronPackageRoot (Join-Path $EvidenceRoot 'electron-offline-bootstrap.json')
    if ($null -eq $OriginalElectronSkipBinaryDownload) { Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue } else { $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $OriginalElectronSkipBinaryDownload }
    if (-not (Test-Path -LiteralPath (Join-Path $electronDist 'electron.exe') -PathType Leaf)) { throw 'Electron distribution was not installed from the reviewed offline archive' }

    $arguments = @(
      'tools/wp7/run-windows-final-builder.js',
      '--output-root', (Join-Path $EvidenceRoot 'builder-output'),
      '--preacceptance-record', $PreacceptanceRecord,
      '--preacceptance-sha256', $PreacceptanceSha256,
      '--windows-round1-result', $WindowsRound1Result,
      '--windows-round1-sha256', $WindowsRound1Sha256,
      '--windows-round2-result', $WindowsRound2Result,
      '--windows-round2-sha256', $WindowsRound2Sha256,
      '--electron-dist', $electronDist,
      '--electron-archive', $ElectronArchive,
      '--compiler-path', $MakensisPath,
      '--trusted-node-executable', $TrustedNodeExecutable,
      '--expected-branch', $ExpectedBranch,
      '--expected-commit', $ExpectedCommit,
      '--expected-tree', $ExpectedTree,
      '--build-timestamp-utc', $BuildTimestampUtc
    )
    if (-not [string]::IsNullOrWhiteSpace($PlatformAuthConfig)) {
      $arguments += @(
        '--platform-auth-config', $PlatformAuthConfig,
        '--platform-auth-sha256', $PlatformAuthSha256,
        '--require-platform-auth', $(if ($RequirePlatformAuth) { 'true' } else { 'false' })
      )
    }
    if ($RequireSignedInstaller) {
      $arguments += @(
        '--require-signed-installer', 'true',
        '--signing-certificate', $SigningCertificate,
        '--signtool-path', $SignToolPath,
        '--timestamp-url', $TimestampUrl
      )
    }
    $argumentLine = ($arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' '
    $process = Start-Process -FilePath $NodeExe -ArgumentList $argumentLine -WorkingDirectory $WorkRoot -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -WindowStyle Hidden
    while (-not $process.HasExited) {
      @{ timestampUtc = [DateTime]::UtcNow.ToString('o'); pid = $process.Id; phase = 'WINDOWS_FINAL_BUILDER'; commit = $ExpectedCommit; tree = $ExpectedTree } | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 $heartbeat
      Write-Host ("[{0}] Final Builder is still running; do not close this window. PID={1}" -f [DateTime]::Now.ToString('HH:mm:ss'), $process.Id) -ForegroundColor Cyan
      Start-Sleep -Seconds 30
      $process.Refresh()
      $currentHead = (git rev-parse HEAD).Trim()
      $currentTree = (git rev-parse 'HEAD^{tree}').Trim()
      $currentDirty = @(git status --porcelain)
      if ($currentHead -ne $ExpectedCommit -or $currentTree -ne $ExpectedTree -or $currentDirty.Count -ne 0) {
        Stop-Process -Id $process.Id -Force
        throw 'source identity or worktree changed during Builder execution'
      }
    }
    $process.ExitCode | Set-Content -Encoding ASCII $exitFile
    if ($process.ExitCode -ne 0) { throw "Builder failed with exit $($process.ExitCode)" }
  }
  finally { Pop-Location }

  $headAfter = (git -C $WorkRoot rev-parse HEAD).Trim()
  $treeAfter = (git -C $WorkRoot rev-parse 'HEAD^{tree}').Trim()
  $dirtyAfter = @(git -C $WorkRoot status --porcelain)
  if ($headAfter -ne $ExpectedCommit -or $treeAfter -ne $ExpectedTree -or $dirtyAfter.Count -ne 0) { throw 'source identity mismatch after Builder execution' }
  @{ commit = $headAfter; tree = $treeAfter; clean = $true } | ConvertTo-Json | Set-Content -Encoding UTF8 $identityAfter

  $residual = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*$WorkRoot*" -and $_.ProcessId -ne $PID })
  $residual | Select-Object ProcessId, ParentProcessId, Name, CommandLine | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $EvidenceRoot 'residual-processes.json')
  if ($residual.Count -ne 0) { throw 'residual Builder processes remain after completion' }

  @{ timestampUtc = [DateTime]::UtcNow.ToString('o'); phase = 'COMPLETE'; status = 'PASS'; commit = $ExpectedCommit; tree = $ExpectedTree } | ConvertTo-Json -Compress | Add-Content -Encoding UTF8 $heartbeat
}
catch {
  if (-not (Test-Path -LiteralPath $EvidenceRoot)) { New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null }
  $_ | Out-String | Add-Content -Encoding UTF8 (Join-Path $EvidenceRoot 'runner-error.log')
  if (-not (Test-Path -LiteralPath (Join-Path $EvidenceRoot 'overall-exit-code.txt'))) { '1' | Set-Content -Encoding ASCII (Join-Path $EvidenceRoot 'overall-exit-code.txt') }
  throw
}
finally {
  $env:PATH = $OriginalPath
  if ($null -eq $OriginalNpmCache) { Remove-Item Env:NPM_CONFIG_CACHE -ErrorAction SilentlyContinue } else { $env:NPM_CONFIG_CACHE = $OriginalNpmCache }
  if ($null -eq $OriginalElectronSkipBinaryDownload) { Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD -ErrorAction SilentlyContinue } else { $env:ELECTRON_SKIP_BINARY_DOWNLOAD = $OriginalElectronSkipBinaryDownload }
  if ($hasLock) { $mutex.ReleaseMutex() | Out-Null }
  $mutex.Dispose()
}
