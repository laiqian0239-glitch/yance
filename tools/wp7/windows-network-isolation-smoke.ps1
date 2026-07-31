[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $NodePath,
    [string] $OutputRoot = (Join-Path $env:TEMP ("Yance-Windows-Isolation-Smoke-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))),
    [Parameter(Mandatory = $true)][switch] $CheckpointConfirmed,
    [Parameter(Mandatory = $true)][switch] $IUnderstandThisDisablesAllVisibleAdapters,
    [switch] $AllowPhysicalMachine
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256([string] $LiteralPath) {
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Json([string] $LiteralPath, $Document) {
    $parent = Split-Path -Parent $LiteralPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Document | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $LiteralPath -Encoding UTF8
}

function Get-AdapterSnapshot {
    return @(Get-NetAdapter | Sort-Object InterfaceIndex | ForEach-Object {
        [ordered]@{
            interfaceIndex = [int] $_.InterfaceIndex
            name = [string] $_.Name
            adminStatus = [string] $_.AdminStatus
            status = [string] $_.Status
            interfaceGuid = [string] $_.InterfaceGuid
            macAddress = [string] $_.MacAddress
        }
    })
}

function Get-DefaultRouteSnapshot {
    $rows = @()
    foreach ($query in @(
        @{ family = 'IPv4'; prefix = '0.0.0.0/0' },
        @{ family = 'IPv6'; prefix = '::/0' }
    )) {
        $rows += @(Get-NetRoute -AddressFamily $query.family -DestinationPrefix $query.prefix -ErrorAction SilentlyContinue |
            Sort-Object InterfaceIndex, RouteMetric | ForEach-Object {
                [ordered]@{
                    addressFamily = [string] $_.AddressFamily
                    destinationPrefix = [string] $_.DestinationPrefix
                    interfaceIndex = [int] $_.InterfaceIndex
                    nextHop = [string] $_.NextHop
                    routeMetric = [int] $_.RouteMetric
                    protocol = [string] $_.Protocol
                }
            })
    }
    return @($rows)
}

function Get-RouteIdentity($Route) {
    return '{0}|{1}|{2}|{3}' -f @(
        [string] $Route.addressFamily,
        [string] $Route.destinationPrefix,
        [int] $Route.interfaceIndex,
        [string] $Route.nextHop,
        [int] $Route.routeMetric,
        [string] $Route.protocol
    )
}

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'The Windows network isolation smoke test requires an elevated administrator PowerShell session.'
}
if (-not $CheckpointConfirmed) { throw 'A Hyper-V checkpoint must be confirmed before this test.' }
if (-not $IUnderstandThisDisablesAllVisibleAdapters) { throw 'Explicit network-disable acknowledgement is required.' }

$computer = Get-CimInstance Win32_ComputerSystem
$isVirtualMachine = [string] $computer.Manufacturer -eq 'Microsoft Corporation' -and [string] $computer.Model -eq 'Virtual Machine'
if (-not $isVirtualMachine -and -not $AllowPhysicalMachine) {
    throw "This destructive network smoke test is restricted to a Hyper-V VM by default. Manufacturer=$($computer.Manufacturer); Model=$($computer.Model)"
}

$node = [IO.Path]::GetFullPath($NodePath)
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Node executable not found: $node" }
$nodeIdentity = & $node -e "process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,execPath:process.execPath}))"
if ($LASTEXITCODE -ne 0) { throw 'Unable to read Node runtime identity.' }
$nodeDocument = $nodeIdentity | ConvertFrom-Json
if ($nodeDocument.version -ne 'v22.16.0' -or $nodeDocument.platform -ne 'win32' -or $nodeDocument.arch -ne 'x64') {
    throw "Trusted runtime mismatch: $nodeIdentity"
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$cliPath = Join-Path $PSScriptRoot 'windows-network-isolation-control-cli.js'
if (-not (Test-Path -LiteralPath $cliPath -PathType Leaf)) { throw "Control CLI missing: $cliPath" }

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$sessionPath = Join-Path $OutputRoot 'session.json'
$attestationPath = Join-Path $OutputRoot 'attestation.json'
$controlRoot = Join-Path $OutputRoot 'control'
$disableStdout = Join-Path $OutputRoot 'disable.stdout.txt'
$disableStderr = Join-Path $OutputRoot 'disable.stderr.txt'
$restoreStdout = Join-Path $OutputRoot 'restore.stdout.txt'
$restoreStderr = Join-Path $OutputRoot 'restore.stderr.txt'
$resultPath = Join-Path $OutputRoot 'smoke-result.json'
$beforeAdapters = Get-AdapterSnapshot
$beforeRoutes = Get-DefaultRouteSnapshot
Write-Json (Join-Path $OutputRoot 'adapters-before.json') $beforeAdapters
Write-Json (Join-Path $OutputRoot 'routes-before.json') $beforeRoutes
if (@($beforeAdapters | Where-Object { $_.adminStatus -eq 'Up' }).Count -lt 1) { throw 'No enabled visible adapter exists for the smoke test.' }

$identityHash = Get-Sha256 $cliPath
$probeNonce = [Guid]::NewGuid().ToString()
$buildSessionId = ([Guid]::NewGuid().ToString('N')).ToLowerInvariant()
$disableExitCode = $null
$restoreExitCode = $null
$sessionSha256 = $null
$attestationSha256 = $null
$testError = $null
$restoreError = $null
$isolationVerified = $false
$restoreVerified = $false

try {
    & $node $cliPath disable `
        --session $sessionPath `
        --attestation $attestationPath `
        --control-root $controlRoot `
        --owner-pid $PID `
        --producer-pid $PID `
        --probe-nonce $probeNonce `
        --build-session-id $buildSessionId `
        --build-id 'windows-isolation-smoke-only' `
        --installer-sha256 $identityHash `
        --product-executable-sha256 $identityHash `
        --main-entry-sha256 $identityHash `
        --watchdog-ms '180000' `
        1> $disableStdout 2> $disableStderr
    $disableExitCode = $LASTEXITCODE
    if ($disableExitCode -ne 0) { throw "Isolation disable failed with exit code $disableExitCode" }
    if (-not (Test-Path -LiteralPath $sessionPath -PathType Leaf) -or -not (Test-Path -LiteralPath $attestationPath -PathType Leaf)) {
        throw 'Isolation disable did not produce session and attestation files.'
    }
    $sessionSha256 = Get-Sha256 $sessionPath
    $attestationSha256 = Get-Sha256 $attestationPath
    $afterDisableAdapters = Get-AdapterSnapshot
    $afterDisableRoutes = Get-DefaultRouteSnapshot
    Write-Json (Join-Path $OutputRoot 'adapters-after-disable.json') $afterDisableAdapters
    Write-Json (Join-Path $OutputRoot 'routes-after-disable.json') $afterDisableRoutes
    $afterByIndex = @{}
    foreach ($adapter in $afterDisableAdapters) { $afterByIndex[[int] $adapter.interfaceIndex] = $adapter }
    $notDisabled = @($beforeAdapters | Where-Object {
        $_.adminStatus -eq 'Up' -and (
            -not $afterByIndex.ContainsKey([int] $_.interfaceIndex) -or
            [string] $afterByIndex[[int] $_.interfaceIndex].adminStatus -ne 'Down'
        )
    })
    $isolationVerified = (@($notDisabled).Count -eq 0 -and @($afterDisableRoutes).Count -eq 0)
    if (-not $isolationVerified) {
        throw "Isolation postcondition failed. NotDisabled=$(@($notDisabled).Count); DefaultRoutes=$(@($afterDisableRoutes).Count)"
    }
} catch {
    $testError = $_.Exception.Message
} finally {
    if ($null -ne $sessionSha256 -and (Test-Path -LiteralPath $sessionPath -PathType Leaf)) {
        try {
            & $node $cliPath restore `
                --session $sessionPath `
                --session-sha256 $sessionSha256 `
                --attestation $attestationPath `
                --attestation-sha256 $attestationSha256 `
                --control-root $controlRoot `
                1> $restoreStdout 2> $restoreStderr
            $restoreExitCode = $LASTEXITCODE
            if ($restoreExitCode -ne 0) { throw "Isolation restore failed with exit code $restoreExitCode" }
            $afterRestoreAdapters = Get-AdapterSnapshot
            $afterRestoreRoutes = Get-DefaultRouteSnapshot
            Write-Json (Join-Path $OutputRoot 'adapters-after-restore.json') $afterRestoreAdapters
            Write-Json (Join-Path $OutputRoot 'routes-after-restore.json') $afterRestoreRoutes
            $afterRestoreByIndex = @{}
            foreach ($adapter in $afterRestoreAdapters) { $afterRestoreByIndex[[int] $adapter.interfaceIndex] = $adapter }
            $adapterMismatch = @($beforeAdapters | Where-Object {
                -not $afterRestoreByIndex.ContainsKey([int] $_.interfaceIndex) -or
                [string] $afterRestoreByIndex[[int] $_.interfaceIndex].adminStatus -ne [string] $_.adminStatus
            })
            $beforeRouteIds = @($beforeRoutes | ForEach-Object { Get-RouteIdentity $_ } | Sort-Object -Unique)
            $afterRouteIds = @($afterRestoreRoutes | ForEach-Object { Get-RouteIdentity $_ } | Sort-Object -Unique)
            $routeMismatch = @($beforeRouteIds | Where-Object { $_ -notin $afterRouteIds }) + @($afterRouteIds | Where-Object { $_ -notin $beforeRouteIds })
            $restoreVerified = (@($adapterMismatch).Count -eq 0 -and @($routeMismatch).Count -eq 0)
            if (-not $restoreVerified) { throw 'Original adapter/default-route state was not exactly restored.' }
        } catch {
            $restoreError = $_.Exception.Message
        }
    } elseif ($null -eq $testError) {
        $restoreError = 'No hash-bound isolation session was available for explicit restore; watchdog recovery must be inspected.'
    }
}

$result = [ordered]@{
    schemaVersion = 1
    documentType = 'WP7_WINDOWS_NETWORK_ISOLATION_SMOKE_RESULT'
    status = $(if ($null -eq $testError -and $null -eq $restoreError -and $isolationVerified -and $restoreVerified) { 'PASS' } else { 'FAIL' })
    smokeOnly = $true
    formalReleaseEvidence = $false
    generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    machine = [ordered]@{ manufacturer = [string] $computer.Manufacturer; model = [string] $computer.Model; virtualMachine = $isVirtualMachine }
    node = $nodeDocument
    nodeSha256 = Get-Sha256 $node
    controlProgramSha256 = $identityHash
    outputRoot = [IO.Path]::GetFullPath($OutputRoot)
    disableExitCode = $disableExitCode
    restoreExitCode = $restoreExitCode
    sessionSha256 = $sessionSha256
    attestationSha256 = $attestationSha256
    isolationVerified = $isolationVerified
    restoreVerified = $restoreVerified
    testError = $testError
    restoreError = $restoreError
}
Write-Json $resultPath $result
Get-Content -LiteralPath $resultPath -Raw
if ($result.status -ne 'PASS') { exit 1 }
