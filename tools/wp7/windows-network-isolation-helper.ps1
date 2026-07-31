[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $RequestPath,
    [Parameter(Mandatory = $true)][string] $ReceiptPath
)

$ErrorActionPreference = 'Stop'
$allowedActions = @('SNAPSHOT', 'DISABLE', 'RESTORE')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal] $identity

function Write-Receipt([hashtable] $Value) {
    $parent = Split-Path -Parent $ReceiptPath
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $json = $Value | ConvertTo-Json -Depth 8
    $temporary = "$ReceiptPath.$PID.tmp"
    [IO.File]::WriteAllText($temporary, "$json`r`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $ReceiptPath -Force
}

try {
    $request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
    $action = [string] $request.action
    if ($request.schemaVersion -ne 1 -or $allowedActions -notcontains $action) {
        throw 'Invalid Windows network isolation helper request.'
    }
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Windows network isolation helper requires an elevated administrator token.'
    }

    $physical = @(Get-NetAdapter -Physical | Sort-Object InterfaceIndex)
    $byIndex = @{}
    foreach ($adapter in $physical) { $byIndex[[int] $adapter.InterfaceIndex] = $adapter }
    $requestedIndexes = @($request.interfaceIndexes | ForEach-Object { [int] $_ })
    if ($requestedIndexes.Count -ne (@($requestedIndexes | Sort-Object -Unique)).Count) {
        throw 'Duplicate interface index in helper request.'
    }
    foreach ($index in $requestedIndexes) {
        if (-not $byIndex.ContainsKey($index)) { throw "Requested interface index is not a physical adapter: $index" }
    }

    $before = @($physical | ForEach-Object {
        [ordered]@{ interfaceIndex = [int] $_.InterfaceIndex; status = [string] $_.Status; interfaceDescription = $_.InterfaceDescription; macAddress = $_.MacAddress }
    })
    if ($action -eq 'DISABLE') {
        foreach ($index in $requestedIndexes) { Get-NetAdapter -InterfaceIndex $index | Disable-NetAdapter -Confirm:$false -PassThru | Out-Null }
    } elseif ($action -eq 'RESTORE') {
        foreach ($index in $requestedIndexes) { Get-NetAdapter -InterfaceIndex $index | Enable-NetAdapter -Confirm:$false -PassThru | Out-Null }
    }
    $after = @(Get-NetAdapter -Physical | Sort-Object InterfaceIndex | ForEach-Object {
        [ordered]@{ interfaceIndex = [int] $_.InterfaceIndex; status = [string] $_.Status; interfaceDescription = $_.InterfaceDescription; macAddress = $_.MacAddress }
    })
    Write-Receipt ([ordered]@{
        schemaVersion = 1
        documentType = 'WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT'
        status = 'PASS'
        action = $action
        executionNonce = [string] $request.executionNonce
        generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        producerPid = $PID
        identity = $identity.Name
        isAdministrator = $true
        requestedInterfaceIndexes = $requestedIndexes
        before = $before
        after = $after
    })
} catch {
    Write-Receipt ([ordered]@{
        schemaVersion = 1
        documentType = 'WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT'
        status = 'FAIL'
        generatedAtUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        producerPid = $PID
        identity = $identity.Name
        message = $_.Exception.Message
    })
    exit 1
}
