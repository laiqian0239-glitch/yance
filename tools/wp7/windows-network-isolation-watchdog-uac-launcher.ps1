[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $WatchdogPath,
    [Parameter(Mandatory = $true)][string] $RequestPath,
    [Parameter(Mandatory = $true)][string] $ExpectedRequestSha256,
    [Parameter(Mandatory = $true)][string] $ExpectedWatchdogSha256,
    [Parameter(Mandatory = $true)][string] $ExpectedLauncherSha256,
    [Parameter(Mandatory = $true)][string] $ExpectedPowerShellSha256,
    [Parameter(Mandatory = $true)][string] $ProtectedRoot,
    [Parameter(Mandatory = $true)][string] $ExecutionNonce
)

$ErrorActionPreference = 'Stop'
$startedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')

function Get-Sha256([string] $LiteralPath) {
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Quote-PowerShellLiteral([string] $Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

try {
    foreach ($path in @($WatchdogPath, $RequestPath, $PSCommandPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing input: $path" }
    }
    $requestSha256 = Get-Sha256 $RequestPath
    $watchdogSha256 = Get-Sha256 $WatchdogPath
    $launcherSha256 = Get-Sha256 $PSCommandPath
    $powerShellPath = Join-Path $PSHOME 'powershell.exe'
    if (-not (Test-Path -LiteralPath $powerShellPath -PathType Leaf)) { throw 'Trusted Windows PowerShell executable is missing.' }
    $powerShellSha256 = Get-Sha256 $powerShellPath
    if ($requestSha256 -ne $ExpectedRequestSha256.ToLowerInvariant()) { throw 'Request SHA256 changed before elevation.' }
    if ($watchdogSha256 -ne $ExpectedWatchdogSha256.ToLowerInvariant()) { throw 'Watchdog SHA256 mismatch.' }
    if ($launcherSha256 -ne $ExpectedLauncherSha256.ToLowerInvariant()) { throw 'Launcher SHA256 mismatch.' }
    if ($powerShellSha256 -ne $ExpectedPowerShellSha256.ToLowerInvariant()) { throw 'Windows PowerShell executable SHA256 mismatch.' }

    $command = @(
        '& ' + (Quote-PowerShellLiteral $WatchdogPath),
        '-RequestPath ' + (Quote-PowerShellLiteral $RequestPath),
        '-ExpectedRequestSha256 ' + (Quote-PowerShellLiteral $requestSha256),
        '-ExpectedWatchdogSha256 ' + (Quote-PowerShellLiteral $watchdogSha256),
        '-LauncherSha256 ' + (Quote-PowerShellLiteral $launcherSha256),
        '-PowerShellSha256 ' + (Quote-PowerShellLiteral $powerShellSha256),
        '-ProtectedRoot ' + (Quote-PowerShellLiteral $ProtectedRoot)
    ) -join ' '
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process = Start-Process $powerShellPath `
        -Verb RunAs `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand) `
        -WindowStyle Hidden `
        -PassThru

    [ordered]@{
        schemaVersion = 2
        documentType = 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_LAUNCH'
        executionNonce = $ExecutionNonce
        requestSha256 = $requestSha256
        watchdogScriptSha256 = $watchdogSha256
        launcherScriptSha256 = $launcherSha256
        powerShellExecutablePath = $powerShellPath
        powerShellExecutableSha256 = $powerShellSha256
        elevatedProcessId = [int] $process.Id
        startedAtUtc = $startedAtUtc
        endedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
