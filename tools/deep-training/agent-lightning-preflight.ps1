[CmdletBinding()]
param(
    [string]$Python = 'python3'
)

$ErrorActionPreference = 'Stop'
$expectedVersion = '0.3.0'
$versionProbe = "import importlib.metadata as m; v=m.version('agentlightning'); assert v=='$expectedVersion', v; print(v)"

$isWindowsHost = $env:OS -eq 'Windows_NT'

if (-not $isWindowsHost) {
    $pythonCommand = Get-Command $Python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        throw 'TRAINING_RUNTIME_UNAVAILABLE: sealed Linux Agent Lightning v0.3.0 runtime is required.'
    }
    $version = & $pythonCommand.Source -c $versionProbe 2>$null | Out-String
    if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne $expectedVersion) {
        throw 'TRAINING_RUNTIME_UNAVAILABLE: sealed Linux Agent Lightning v0.3.0 runtime is required.'
    }
    Write-Output 'Agent Lightning P1 execution authority: Linux; sealed v0.3.0 verified.'
    exit 0
}

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
    throw 'TRAINING_RUNTIME_UNAVAILABLE: WSL2 is required for Agent Lightning P1 on Windows.'
}

$null = & $wsl.Source --status 2>$null | Out-String
if ($LASTEXITCODE -ne 0) {
    throw 'TRAINING_RUNTIME_UNAVAILABLE: WSL status could not be verified.'
}

$null = & $wsl.Source --exec sh -lc 'case "$(uname -r)" in *WSL2*|*microsoft-standard-WSL2*) exit 0;; *) exit 1;; esac' 2>$null | Out-String
if ($LASTEXITCODE -ne 0) {
    throw 'TRAINING_RUNTIME_UNAVAILABLE: WSL2 execution kernel is required; WSL1 and host execution are forbidden.'
}

$runtimeVersion = & $wsl.Source --exec env -i `
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' `
    'LANG=C.UTF-8' 'LC_ALL=C.UTF-8' `
    $Python -c $versionProbe 2>$null | Out-String
if ($LASTEXITCODE -ne 0 -or $runtimeVersion.Trim() -ne $expectedVersion) {
    throw 'TRAINING_RUNTIME_UNAVAILABLE: WSL2 sealed Agent Lightning v0.3.0 runtime is required.'
}

Write-Output 'Agent Lightning P1 Windows boundary: WSL2 verified; sealed Linux v0.3.0 execution authority confirmed.'