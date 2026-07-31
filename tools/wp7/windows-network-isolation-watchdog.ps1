[CmdletBinding()]
param(
    [string] $RequestPath,
    [Parameter(Mandatory = $true)][string] $ExpectedWatchdogSha256,
    [Parameter(Mandatory = $true)][string] $ProtectedRoot,
    [string] $ExpectedRequestSha256,
    [string] $LauncherSha256,
    [string] $PowerShellSha256,
    [string] $GuardianStatePath,
    [int] $GuardianPrimaryPid = 0,
    [int] $GuardianOwnerPid = 0
)

$ErrorActionPreference = 'Stop'
$script:mutex = $null
$script:mutexHeld = $false

function Get-Sha256([string] $LiteralPath) {
    return (Get-FileHash -LiteralPath $LiteralPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-BytesSha256([byte[]] $Bytes) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant()
    } finally {
        $algorithm.Dispose()
    }
}

function Quote-PowerShellLiteral([string] $Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

function Write-JsonAtomic([string] $LiteralPath, $Document) {
    $parent = Split-Path -Parent $LiteralPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $temporary = "$LiteralPath.$PID.$([Guid]::NewGuid().ToString('N')).tmp"
    $json = $Document | ConvertTo-Json -Depth 16
    [IO.File]::WriteAllText($temporary, "$json`r`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $LiteralPath -Force
}

function Resolve-OwnerSid([int] $OwnerPid, [string] $FallbackPath) {
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $OwnerPid"
        if ($null -ne $process) {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner
            if ($owner.ReturnValue -eq 0) {
                $account = [Security.Principal.NTAccount]::new("$($owner.Domain)\$($owner.User)")
                return $account.Translate([Security.Principal.SecurityIdentifier])
            }
        }
    } catch {}
    $ownerName = (Get-Acl -LiteralPath $FallbackPath).Owner
    $fallbackAccount = [Security.Principal.NTAccount]::new($ownerName)
    return $fallbackAccount.Translate([Security.Principal.SecurityIdentifier])
}

function New-AccessRule($Identity, [Security.AccessControl.FileSystemRights] $Rights, [bool] $Directory, [Security.AccessControl.AccessControlType] $Type = [Security.AccessControl.AccessControlType]::Allow) {
    $inheritance = if ($Directory) {
        [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
        [Security.AccessControl.InheritanceFlags]::None
    }
    return [Security.AccessControl.FileSystemAccessRule]::new(
        $Identity,
        $Rights,
        $inheritance,
        [Security.AccessControl.PropagationFlags]::None,
        $Type
    )
}

function Set-ProtectedDirectoryAcl([string] $LiteralPath, [Security.Principal.SecurityIdentifier] $OwnerSid, [bool] $GrantOwnerAccess = $true) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $acl.AddAccessRule((New-AccessRule 'SYSTEM' ([Security.AccessControl.FileSystemRights]::FullControl) $true))
    $acl.AddAccessRule((New-AccessRule 'BUILTIN\Administrators' ([Security.AccessControl.FileSystemRights]::FullControl) $true))
    if ($GrantOwnerAccess) {
        $acl.AddAccessRule((New-AccessRule $OwnerSid ([Security.AccessControl.FileSystemRights]::ReadAndExecute) $true))
    } else {
        # The request owner can traverse the fixed ProgramData root to its own
        # explicitly protected session, but cannot enumerate sibling sessions.
        $rootTraverseRights = [Security.AccessControl.FileSystemRights]::Traverse -bor [Security.AccessControl.FileSystemRights]::ReadAttributes
        $acl.AddAccessRule((New-AccessRule $OwnerSid $rootTraverseRights $false))
    }
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}

function Set-ProtectedFileAcl([string] $LiteralPath, [Security.Principal.SecurityIdentifier] $OwnerSid, [bool] $OwnerCanModify) {
    $acl = [Security.AccessControl.FileSecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
    $acl.AddAccessRule((New-AccessRule 'SYSTEM' ([Security.AccessControl.FileSystemRights]::FullControl) $false))
    $acl.AddAccessRule((New-AccessRule 'BUILTIN\Administrators' ([Security.AccessControl.FileSystemRights]::FullControl) $false))
    $ownerRights = if ($OwnerCanModify) { [Security.AccessControl.FileSystemRights]::Modify } else { [Security.AccessControl.FileSystemRights]::Read }
    $acl.AddAccessRule((New-AccessRule $OwnerSid $ownerRights $false))
    Set-Acl -LiteralPath $LiteralPath -AclObject $acl
}

function Get-IsolatableAdapterSnapshot {
    return @(Get-NetAdapter | Sort-Object InterfaceIndex | ForEach-Object {
        [ordered]@{
            interfaceIndex = [int] $_.InterfaceIndex
            name = [string] $_.Name
            interfaceDescription = [string] $_.InterfaceDescription
            interfaceGuid = [string] $_.InterfaceGuid
            macAddress = [string] $_.MacAddress
            adminStatus = [string] $_.AdminStatus
            status = [string] $_.Status
            linkSpeed = [string] $_.LinkSpeed
            hardwareInterface = [bool] $_.HardwareInterface
            virtual = [bool] $_.Virtual
        }
    })
}

function Get-DefaultRouteSnapshot {
    $routes = @()
    foreach ($query in @(
        @{ family = 'IPv4'; prefix = '0.0.0.0/0' },
        @{ family = 'IPv6'; prefix = '::/0' }
    )) {
        $routes += @(Get-NetRoute -AddressFamily $query.family -DestinationPrefix $query.prefix -ErrorAction SilentlyContinue | Sort-Object InterfaceIndex, RouteMetric | ForEach-Object {
            [ordered]@{
                addressFamily = [string] $_.AddressFamily
                destinationPrefix = [string] $_.DestinationPrefix
                interfaceIndex = [int] $_.InterfaceIndex
                nextHop = [string] $_.NextHop
                routeMetric = [int] $_.RouteMetric
                protocol = [string] $_.Protocol
                state = [string] $_.State
            }
        })
    }
    return @($routes)
}

function Wait-NoDefaultRoutes([int] $TimeoutSeconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $routes = @()
    do {
        $routes = Get-DefaultRouteSnapshot
        if (@($routes).Count -eq 0) { return @() }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return @($routes)
}

function Invoke-AdapterActions([string] $Action, $Adapters) {
    $startedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $operations = @()
    $failed = $false
    foreach ($adapter in @($Adapters)) {
        $operationStartedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $message = ''
        $exitCode = 0
        try {
            if ($Action -eq 'DISABLE') {
                Get-NetAdapter -InterfaceIndex ([int] $adapter.interfaceIndex) | Disable-NetAdapter -Confirm:$false -PassThru | Out-Null
            } elseif ($Action -eq 'ENABLE') {
                Get-NetAdapter -InterfaceIndex ([int] $adapter.interfaceIndex) | Enable-NetAdapter -Confirm:$false -PassThru | Out-Null
            } else {
                throw "Unsupported adapter action: $Action"
            }
        } catch {
            $exitCode = 1
            $failed = $true
            $message = $_.Exception.Message
        }
        $operations += [ordered]@{
            action = $Action
            executionKind = 'POWERSHELL_CMDLET'
            commandName = $(if ($Action -eq 'DISABLE') { 'Disable-NetAdapter' } else { 'Enable-NetAdapter' })
            resultCodeSource = 'POWERSHELL_EXCEPTION_MAPPING'
            invocationCompleted = ($exitCode -eq 0)
            interfaceIndex = [int] $adapter.interfaceIndex
            name = [string] $adapter.name
            startedAtUtc = $operationStartedAtUtc
            endedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            exitCode = $exitCode
            passed = ($exitCode -eq 0)
            error = $message
        }
    }
    return [ordered]@{
        startedAtUtc = $startedAtUtc
        endedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        executionKind = 'POWERSHELL_CMDLET_BATCH'
        resultCodeSource = 'POWERSHELL_EXCEPTION_MAPPING'
        exitCode = $(if ($failed) { 1 } else { 0 })
        expectedExitCode = 0
        passed = (-not $failed)
        operationCount = @($operations).Count
        operations = $operations
    }
}

function Wait-AdapterAdminState($Adapters, [string] $ExpectedAdminStatus, [int] $TimeoutSeconds = 45) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $snapshot = Get-IsolatableAdapterSnapshot
        $byIndex = @{}
        foreach ($adapter in $snapshot) { $byIndex[[int] $adapter.interfaceIndex] = $adapter }
        $allMatch = $true
        foreach ($adapter in @($Adapters)) {
            if (-not $byIndex.ContainsKey([int] $adapter.interfaceIndex) -or [string] $byIndex[[int] $adapter.interfaceIndex].adminStatus -ne $ExpectedAdminStatus) {
                $allMatch = $false
                break
            }
        }
        if ($allMatch) { return $snapshot }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return Get-IsolatableAdapterSnapshot
}

function Get-AdapterStatePostcondition($Before, $After) {
    $afterByIndex = @{}
    foreach ($adapter in @($After)) { $afterByIndex[[int] $adapter.interfaceIndex] = $adapter }
    $mismatches = @()
    foreach ($adapter in @($Before)) {
        $index = [int] $adapter.interfaceIndex
        if (-not $afterByIndex.ContainsKey($index)) {
            $mismatches += [ordered]@{ interfaceIndex = $index; expectedAdminStatus = [string] $adapter.adminStatus; actualAdminStatus = 'MISSING' }
            continue
        }
        $actual = [string] $afterByIndex[$index].adminStatus
        if ($actual -ne [string] $adapter.adminStatus) {
            $mismatches += [ordered]@{ interfaceIndex = $index; expectedAdminStatus = [string] $adapter.adminStatus; actualAdminStatus = $actual }
        }
    }
    return [ordered]@{ passed = (@($mismatches).Count -eq 0); mismatches = $mismatches }
}

function Wait-AdapterOriginalState($Before, [int] $TimeoutSeconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $after = @()
    $postcondition = $null
    do {
        $after = Get-IsolatableAdapterSnapshot
        $postcondition = Get-AdapterStatePostcondition $Before $after
        if ($postcondition.passed) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return [ordered]@{
        adaptersAfter = $after
        postcondition = $postcondition
    }
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

function Wait-OriginalDefaultRoutes($BeforeRoutes, [int] $TimeoutSeconds = 60) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $expected = @($BeforeRoutes | ForEach-Object { Get-RouteIdentity $_ } | Sort-Object -Unique)
    $after = @()
    $missing = @($expected)
    $unexpected = @()
    do {
        $after = Get-DefaultRouteSnapshot
        $actual = @($after | ForEach-Object { Get-RouteIdentity $_ } | Sort-Object -Unique)
        $missing = @($expected | Where-Object { $_ -notin $actual })
        $unexpected = @($actual | Where-Object { $_ -notin $expected })
        if (@($missing).Count -eq 0 -and @($unexpected).Count -eq 0) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return [ordered]@{
        passed = (@($missing).Count -eq 0 -and @($unexpected).Count -eq 0)
        expectedRouteCount = @($expected).Count
        actualRouteCount = @($after).Count
        missingRouteIdentities = $missing
        unexpectedRouteIdentities = $unexpected
        routesAfter = $after
    }
}

function Restore-FromJournal($State) {
    $enabledBefore = @($State.adaptersBefore | Where-Object { [string] $_.adminStatus -eq 'Up' })
    $disabledBefore = @($State.adaptersBefore | Where-Object { [string] $_.adminStatus -eq 'Down' })
    $enableOperation = Invoke-AdapterActions 'ENABLE' $enabledBefore
    $disableOperation = Invoke-AdapterActions 'DISABLE' $disabledBefore
    $adapterResult = Wait-AdapterOriginalState $State.adaptersBefore 60
    $routePostcondition = Wait-OriginalDefaultRoutes $State.routesBefore 60
    $operation = [ordered]@{
        startedAtUtc = $enableOperation.startedAtUtc
        endedAtUtc = $disableOperation.endedAtUtc
        exitCode = $(if ($enableOperation.passed -and $disableOperation.passed) { 0 } else { 1 })
        expectedExitCode = 0
        passed = ($enableOperation.passed -and $disableOperation.passed)
        enable = $enableOperation
        disable = $disableOperation
    }
    $postcondition = [ordered]@{
        passed = ($adapterResult.postcondition.passed -and $routePostcondition.passed)
        adapterState = $adapterResult.postcondition
        defaultRoutes = [ordered]@{
            passed = $routePostcondition.passed
            expectedRouteCount = $routePostcondition.expectedRouteCount
            actualRouteCount = $routePostcondition.actualRouteCount
            missingRouteIdentities = $routePostcondition.missingRouteIdentities
            unexpectedRouteIdentities = $routePostcondition.unexpectedRouteIdentities
        }
    }
    return [ordered]@{
        operation = $operation
        adaptersAfter = $adapterResult.adaptersAfter
        routesAfter = $routePostcondition.routesAfter
        postcondition = $postcondition
        passed = ($operation.passed -and $postcondition.passed)
    }
}

function Recover-StaleSessions([string] $Root, [string] $CurrentNonce) {
    $recovered = @()
    foreach ($directory in @(Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue)) {
        if ($directory.Name -eq $CurrentNonce) { continue }
        $candidate = Join-Path $directory.FullName 'state.json'
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        try {
            $state = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json
            if ($state.documentType -ne 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE' -or $state.schemaVersion -ne 2) { throw 'Invalid stale state schema.' }
            if ($state.state -eq 'RESTORED') { continue }
            if ($state.state -eq 'ISOLATION_FAILED' -and $state.restorePostcondition.passed -eq $true) { continue }
            $restored = Restore-FromJournal $state
            if (-not $restored.passed) { throw 'Stale network state could not be restored.' }
            $state.state = 'RESTORED'
            $state.reason = 'stale-recovery-before-new-isolation'
            $state.staleRecovery = $true
            $state.restoreOperation = $restored.operation
            $state.adaptersAfterRestore = $restored.adaptersAfter
            $state.routesAfterRestore = $restored.routesAfter
            $state.restorePostcondition = $restored.postcondition
            $state.restoredAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            Write-JsonAtomic $candidate $state
            $recovered += $directory.Name
        } catch {
            throw "Stale isolation recovery failed for $($directory.FullName): $($_.Exception.Message)"
        }
    }
    return @($recovered)
}

function Test-ProcessAlive([int] $ProcessId) {
    if ($ProcessId -le 0) { return $false }
    return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Invoke-GuardianMode {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Windows network isolation guardian requires an elevated administrator token.'
    }
    if ((Get-Sha256 $PSCommandPath) -ne $ExpectedWatchdogSha256.ToLowerInvariant()) {
        throw 'Guardian watchdog script SHA256 mismatch.'
    }
    $guardianPowerShellPath = Join-Path $PSHOME 'powershell.exe'
    if ([string]::IsNullOrWhiteSpace($PowerShellSha256) -or -not (Test-Path -LiteralPath $guardianPowerShellPath -PathType Leaf) -or (Get-Sha256 $guardianPowerShellPath) -ne $PowerShellSha256.ToLowerInvariant()) {
        throw 'Guardian Windows PowerShell executable SHA256 mismatch.'
    }
    $expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'Yance\WP7NetworkIsolation')).TrimEnd('\')
    $actualRoot = [IO.Path]::GetFullPath($ProtectedRoot).TrimEnd('\')
    if (-not $actualRoot.Equals($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Guardian protected root must be the audited ProgramData location.'
    }
    $stateFullPath = [IO.Path]::GetFullPath($GuardianStatePath)
    if (-not $stateFullPath.StartsWith("$actualRoot\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Guardian state path escaped the protected root.'
    }
    if ($GuardianPrimaryPid -le 0 -or $GuardianOwnerPid -le 0 -or $GuardianPrimaryPid -eq $PID) {
        throw 'Guardian process custody is invalid.'
    }

    $guardianMutex = $null
    $guardianMutexHeld = $false
    try {
        while ($true) {
            if (-not (Test-Path -LiteralPath $stateFullPath -PathType Leaf)) {
                Start-Sleep -Milliseconds 100
                continue
            }
            $state = Get-Content -LiteralPath $stateFullPath -Raw | ConvertFrom-Json
            if ($state.schemaVersion -ne 2 -or $state.documentType -ne 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE') {
                throw 'Guardian observed an invalid state document.'
            }
            if ([int] $state.elevatedWatchdogPid -ne $GuardianPrimaryPid -or [int] $state.ownerPid -ne $GuardianOwnerPid) {
                throw 'Guardian state custody does not match its launch arguments.'
            }
            if ($state.state -eq 'RESTORED') { exit 0 }
            if ($state.state -eq 'ISOLATION_FAILED' -and $state.restorePostcondition.passed -eq $true) { exit 0 }
            if ($state.state -eq 'RESTORE_FAILED') { exit 2 }

            $guardianBindingPresent = ($null -ne $state.guardianPid -and [int] $state.guardianPid -gt 0)
            if ($guardianBindingPresent -and (
                [int] $state.guardianPid -ne $PID -or
                [string] $state.guardianScriptSha256 -ne $ExpectedWatchdogSha256.ToLowerInvariant()
            )) {
                throw 'Guardian state does not bind the running guardian process and script.'
            }
            $deadline = [DateTime]::Parse([string] $state.restoreDeadlineUtc).ToUniversalTime()
            $ownerAlive = Test-ProcessAlive $GuardianOwnerPid
            $primaryAlive = Test-ProcessAlive $GuardianPrimaryPid
            $deadlineReached = [DateTime]::UtcNow -ge $deadline
            if ($ownerAlive -and $primaryAlive -and -not $deadlineReached) {
                $guardianPollMilliseconds = if ($guardianBindingPresent) { 250 } else { 100 }
                Start-Sleep -Milliseconds $guardianPollMilliseconds
                continue
            }

            if ($primaryAlive) {
                Stop-Process -Id $GuardianPrimaryPid -Force -ErrorAction SilentlyContinue
                $stopDeadline = [DateTime]::UtcNow.AddSeconds(10)
                while ((Test-ProcessAlive $GuardianPrimaryPid) -and [DateTime]::UtcNow -lt $stopDeadline) {
                    Start-Sleep -Milliseconds 100
                }
            }

            $guardianMutex = [Threading.Mutex]::new($false, 'Global\YanceWp7NetworkIsolation')
            try {
                $guardianMutexHeld = $guardianMutex.WaitOne([TimeSpan]::FromSeconds(30))
            } catch [Threading.AbandonedMutexException] {
                $guardianMutexHeld = $true
            }
            if (-not $guardianMutexHeld) { throw 'Guardian could not acquire the isolation recovery mutex.' }

            $state = Get-Content -LiteralPath $stateFullPath -Raw | ConvertFrom-Json
            if ($state.state -eq 'RESTORED') { exit 0 }
            if ($null -eq $state.guardianPid -or [int] $state.guardianPid -le 0) {
                $state.guardianPid = [int] $PID
                $state.guardianScriptSha256 = $ExpectedWatchdogSha256.ToLowerInvariant()
                $state.guardianBindingRecovered = $true
                Write-JsonAtomic $stateFullPath $state
            }
            $restored = Restore-FromJournal $state
            $state.restoreOperation = $restored.operation
            $state.adaptersAfterRestore = $restored.adaptersAfter
            $state.routesAfterRestore = $restored.routesAfter
            $state.restorePostcondition = $restored.postcondition
            $state.restoredAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            $state.generatedAtUtc = $state.restoredAtUtc
            $state.guardianRecovery = $true
            if (-not $restored.passed) {
                $state.state = 'RESTORE_FAILED'
                $state.reason = 'guardian-restore-postcondition-failed'
                $state.error = 'Guardian could not restore the original network state.'
                Write-JsonAtomic $stateFullPath $state
                exit 3
            }
            $state.state = 'RESTORED'
            if (-not $ownerAlive) { $state.reason = 'guardian-owner-exit' }
            elseif (-not $primaryAlive) { $state.reason = 'guardian-primary-exit' }
            else { $state.reason = 'guardian-deadline' }
            Write-JsonAtomic $stateFullPath $state
            exit 0
        }
    } finally {
        if ($guardianMutexHeld -and $null -ne $guardianMutex) { try { $guardianMutex.ReleaseMutex() } catch {} }
        if ($null -ne $guardianMutex) { $guardianMutex.Dispose() }
    }
}

if (-not [string]::IsNullOrWhiteSpace($GuardianStatePath)) {
    Invoke-GuardianMode
    exit 0
}

$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Windows network isolation watchdog requires an elevated administrator token.'
}

$expectedProtectedRoot = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'Yance\WP7NetworkIsolation')).TrimEnd('\')
$actualProtectedRoot = [IO.Path]::GetFullPath($ProtectedRoot).TrimEnd('\')
if (-not $actualProtectedRoot.Equals($expectedProtectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Protected isolation root must be the audited ProgramData location.'
}
if ([string]::IsNullOrWhiteSpace($RequestPath) -or [string]::IsNullOrWhiteSpace($ExpectedRequestSha256) -or [string]::IsNullOrWhiteSpace($LauncherSha256) -or [string]::IsNullOrWhiteSpace($PowerShellSha256)) {
    throw 'Primary watchdog inputs are incomplete.'
}
if ($ExpectedRequestSha256 -notmatch '^[0-9a-fA-F]{64}$' -or $ExpectedWatchdogSha256 -notmatch '^[0-9a-fA-F]{64}$' -or $LauncherSha256 -notmatch '^[0-9a-fA-F]{64}$' -or $PowerShellSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'Primary watchdog SHA256 inputs are invalid.'
}
if (-not (Test-Path -LiteralPath $RequestPath -PathType Leaf)) { throw 'Watchdog request is missing.' }
$requestBytes = [IO.File]::ReadAllBytes($RequestPath)
if ((Get-BytesSha256 $requestBytes) -ne $ExpectedRequestSha256.ToLowerInvariant()) { throw 'Watchdog request SHA256 mismatch.' }
if ((Get-Sha256 $PSCommandPath) -ne $ExpectedWatchdogSha256.ToLowerInvariant()) { throw 'Watchdog script SHA256 mismatch.' }
$powerShellExecutablePath = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $powerShellExecutablePath -PathType Leaf) -or (Get-Sha256 $powerShellExecutablePath) -ne $PowerShellSha256.ToLowerInvariant()) { throw 'Windows PowerShell executable SHA256 mismatch.' }
$request = [Text.Encoding]::UTF8.GetString($requestBytes) | ConvertFrom-Json
if ($request.schemaVersion -ne 2 `
    -or $request.documentType -ne 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_REQUEST' `
    -or $request.action -ne 'ISOLATE_ALL_ENABLED_VISIBLE_WITH_WATCHDOG') {
    throw 'Invalid watchdog request schema or action.'
}
$nonce = [string] $request.executionNonce
if ($nonce -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') { throw 'Invalid watchdog execution nonce.' }
$ownerPid = [int] $request.ownerPid
if ($ownerPid -le 0) { throw 'Invalid watchdog owner PID.' }
$deadline = [DateTime]::Parse([string] $request.restoreDeadlineUtc).ToUniversalTime()
if ($deadline -le [DateTime]::UtcNow -or $deadline -gt [DateTime]::UtcNow.AddMinutes(10)) { throw 'Invalid watchdog restore deadline.' }
$ownerSid = Resolve-OwnerSid $ownerPid $RequestPath

$script:mutex = [Threading.Mutex]::new($false, 'Global\YanceWp7NetworkIsolation')
try {
    $script:mutexHeld = $script:mutex.WaitOne([TimeSpan]::FromSeconds(30))
} catch [Threading.AbandonedMutexException] {
    # A terminated prior watchdog abandoned custody. Owning the abandoned mutex is
    # required so stale journal recovery can restore the previous network state.
    $script:mutexHeld = $true
}
if (-not $script:mutexHeld) { throw 'Another Windows network isolation watchdog owns the global isolation mutex.' }

$sessionRoot = Join-Path $actualProtectedRoot $nonce
$statePath = Join-Path $sessionRoot 'state.json'
$isolatedStatePath = Join-Path $sessionRoot 'isolated-state.json'
$releasePath = Join-Path $sessionRoot 'release.signal'
$acceptedRequestPath = Join-Path $sessionRoot 'request.accepted.json'
$primaryError = $null
$isolationEstablished = $false
$reason = 'deadline'
$currentState = $null
$guardianProcess = $null

try {
    New-Item -ItemType Directory -Path $actualProtectedRoot -Force | Out-Null
    Set-ProtectedDirectoryAcl $actualProtectedRoot $ownerSid $false
    $staleRecovered = Recover-StaleSessions $actualProtectedRoot $nonce

    New-Item -ItemType Directory -Path $sessionRoot -Force | Out-Null
    Set-ProtectedDirectoryAcl $sessionRoot $ownerSid
    [IO.File]::WriteAllBytes($acceptedRequestPath, $requestBytes)
    if ((Get-Sha256 $acceptedRequestPath) -ne $ExpectedRequestSha256.ToLowerInvariant()) { throw 'Accepted request SHA256 mismatch.' }
    Set-ProtectedFileAcl $acceptedRequestPath $ownerSid $false
    [IO.File]::WriteAllText($releasePath, '', [Text.UTF8Encoding]::new($false))
    Set-ProtectedFileAcl $releasePath $ownerSid $true

    $beforeAdapters = Get-IsolatableAdapterSnapshot
    $enabledBefore = @($beforeAdapters | Where-Object { [string] $_.adminStatus -eq 'Up' })
    if (@($enabledBefore).Count -eq 0) { throw 'No enabled visible Windows network adapter is available for isolation.' }
    $beforeRoutes = Get-DefaultRouteSnapshot
    $currentState = [ordered]@{
        schemaVersion = 2
        documentType = 'WP7_WINDOWS_NETWORK_ISOLATION_WATCHDOG_STATE'
        executionNonce = $nonce
        state = 'PREPARED'
        reason = 'journal-before-disable'
        generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        ownerPid = $ownerPid
        ownerSid = $ownerSid.Value
        elevatedWatchdogPid = $PID
        requestSha256 = $ExpectedRequestSha256.ToLowerInvariant()
        watchdogScriptSha256 = $ExpectedWatchdogSha256.ToLowerInvariant()
        launcherScriptSha256 = $LauncherSha256.ToLowerInvariant()
        powerShellExecutablePath = $powerShellExecutablePath
        powerShellExecutableSha256 = $PowerShellSha256.ToLowerInvariant()
        protectedSessionRoot = $sessionRoot
        acceptedRequestPath = $acceptedRequestPath
        restoreDeadlineUtc = $deadline.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        staleRecoveryCount = @($staleRecovered).Count
        staleRecoveredSessions = $staleRecovered
        adapterScope = 'ALL_ENABLED_VISIBLE_WINDOWS_ADAPTERS'
        adaptersBefore = $beforeAdapters
        routesBefore = $beforeRoutes
    }
    Write-JsonAtomic $statePath $currentState
    Set-ProtectedFileAcl $statePath $ownerSid $false

    $guardianCommand = @(
        '& ' + (Quote-PowerShellLiteral $PSCommandPath),
        '-GuardianStatePath ' + (Quote-PowerShellLiteral $statePath),
        '-ExpectedWatchdogSha256 ' + (Quote-PowerShellLiteral $ExpectedWatchdogSha256.ToLowerInvariant()),
        '-ProtectedRoot ' + (Quote-PowerShellLiteral $actualProtectedRoot),
        '-PowerShellSha256 ' + (Quote-PowerShellLiteral $PowerShellSha256.ToLowerInvariant()),
        '-GuardianPrimaryPid ' + [string] $PID,
        '-GuardianOwnerPid ' + [string] $ownerPid
    ) -join ' '
    $guardianEncodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($guardianCommand))
    $guardianProcess = Start-Process $powerShellExecutablePath `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $guardianEncodedCommand) `
        -WindowStyle Hidden `
        -PassThru
    $currentState.guardianPid = [int] $guardianProcess.Id
    $currentState.guardianScriptSha256 = $ExpectedWatchdogSha256.ToLowerInvariant()
    $currentState.generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    Write-JsonAtomic $statePath $currentState
    Set-ProtectedFileAcl $statePath $ownerSid $false

    $disableOperation = Invoke-AdapterActions 'DISABLE' $enabledBefore
    $afterDisable = Wait-AdapterAdminState $enabledBefore 'Down' 45
    $afterDisableByIndex = @{}
    foreach ($adapter in $afterDisable) { $afterDisableByIndex[[int] $adapter.interfaceIndex] = $adapter }
    $notDisabled = @($enabledBefore | Where-Object {
        -not $afterDisableByIndex.ContainsKey([int] $_.interfaceIndex) -or [string] $afterDisableByIndex[[int] $_.interfaceIndex].adminStatus -ne 'Down'
    } | ForEach-Object { [int] $_.interfaceIndex })
    $afterDisableRoutes = Wait-NoDefaultRoutes 45
    $isolationPostcondition = [ordered]@{
        allOriginallyEnabledPhysicalAdaptersDisabled = (@($notDisabled).Count -eq 0)
        allOriginallyEnabledIsolatableAdaptersDisabled = (@($notDisabled).Count -eq 0)
        notDisabledInterfaceIndexes = $notDisabled
        remainingDefaultRouteCount = @($afterDisableRoutes).Count
        noDefaultRoutesRemain = (@($afterDisableRoutes).Count -eq 0)
        passed = ($disableOperation.passed -and @($notDisabled).Count -eq 0 -and @($afterDisableRoutes).Count -eq 0)
    }
    $disableOperation.postconditionVerified = [bool] $isolationPostcondition.passed
    if (-not $isolationPostcondition.passed) {
        throw "Network isolation postcondition failed: $($isolationPostcondition | ConvertTo-Json -Compress)"
    }

    $currentState.state = 'ISOLATED'
    $currentState.reason = 'disable-complete-and-verified'
    $currentState.generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $currentState.isolatedAtUtc = $currentState.generatedAtUtc
    $currentState.disableOperation = $disableOperation
    $currentState.adaptersAfterDisable = $afterDisable
    $currentState.routesAfterDisable = $afterDisableRoutes
    $currentState.isolationPostcondition = $isolationPostcondition
    Write-JsonAtomic $statePath $currentState
    Set-ProtectedFileAcl $statePath $ownerSid $false
    Write-JsonAtomic $isolatedStatePath $currentState
    Set-ProtectedFileAcl $isolatedStatePath $ownerSid $false
    $isolationEstablished = $true

    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-ProcessAlive ([int] $currentState.guardianPid))) {
            throw 'Independent network recovery guardian exited while isolation was active.'
        }
        $releaseRaw = Get-Content -LiteralPath $releasePath -Raw -ErrorAction SilentlyContinue
        if (-not [string]::IsNullOrWhiteSpace($releaseRaw)) {
            try {
                $release = $releaseRaw | ConvertFrom-Json
                if ($release.schemaVersion -eq 2 `
                    -and $release.documentType -eq 'WP7_WINDOWS_NETWORK_ISOLATION_RELEASE_SIGNAL' `
                    -and [string] $release.executionNonce -eq $nonce `
                    -and [string] $release.requestSha256 -eq $ExpectedRequestSha256.ToLowerInvariant() `
                    -and [int] $release.ownerPid -eq $ownerPid) {
                    $reason = 'release-signal'
                    break
                }
                $currentState.invalidReleaseSignalObserved = $true
            } catch {
                $currentState.invalidReleaseSignalObserved = $true
            }
        }
        Start-Sleep -Milliseconds 250
    }
} catch {
    $primaryError = $_
} finally {
    try {
        if ($null -ne $currentState -and $null -ne $currentState.adaptersBefore) {
            $restored = Restore-FromJournal $currentState
            $currentState.restoreOperation = $restored.operation
            $currentState.adaptersAfterRestore = $restored.adaptersAfter
            $currentState.routesAfterRestore = $restored.routesAfter
            $currentState.restorePostcondition = $restored.postcondition
            $currentState.restoredAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            $currentState.generatedAtUtc = $currentState.restoredAtUtc
            if (-not $restored.passed) {
                $currentState.state = 'RESTORE_FAILED'
                $currentState.reason = 'restore-postcondition-failed'
                $currentState.error = 'Original network adapter state was not fully restored.'
                Write-JsonAtomic $statePath $currentState
                exit 2
            }
            if ($null -ne $primaryError) {
                $currentState.state = 'ISOLATION_FAILED'
                $currentState.reason = 'acquire-failed-rollback-complete'
                $currentState.error = $primaryError.Exception.Message
                Write-JsonAtomic $statePath $currentState
                exit 3
            }
            $currentState.state = 'RESTORED'
            $currentState.reason = $reason
            Write-JsonAtomic $statePath $currentState
        } elseif ($null -ne $primaryError) {
            throw $primaryError
        }
    } catch {
        if ($null -ne $currentState) {
            $currentState.state = 'RESTORE_FAILED'
            $currentState.reason = 'finally-exception'
            $currentState.error = $_.Exception.Message
            $currentState.generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
            try { Write-JsonAtomic $statePath $currentState } catch {}
        }
        exit 4
    } finally {
        if ($script:mutexHeld) { try { $script:mutex.ReleaseMutex() } catch {} }
        if ($null -ne $script:mutex) { $script:mutex.Dispose() }
    }
}
