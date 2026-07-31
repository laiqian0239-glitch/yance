[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $HelperPath,
    [Parameter(Mandatory = $true)][string] $RequestPath,
    [Parameter(Mandatory = $true)][string] $ReceiptPath
)
$ErrorActionPreference = 'Stop'
foreach ($candidate in @($HelperPath, $RequestPath)) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Required input file is missing: $candidate" }
}
$arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $HelperPath, '-RequestPath', $RequestPath, '-ReceiptPath', $ReceiptPath)
$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
exit $process.ExitCode
