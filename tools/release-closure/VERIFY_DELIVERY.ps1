[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)][string]$DeliveryRoot = '',
  [Parameter(Mandatory = $false)][string]$LogPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Resolve script-relative defaults after parameter binding. In Windows
# PowerShell 5.1, $PSScriptRoot can be empty inside a parameter default
# expression even though it is populated in the script body.
if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) { $DeliveryRoot = $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) { throw 'YANCE_DELIVERY_ROOT_UNRESOLVED' }
$DeliveryRoot = [IO.Path]::GetFullPath($DeliveryRoot)
if ([string]::IsNullOrWhiteSpace($LogPath)) { $LogPath = Join-Path $DeliveryRoot 'DELIVERY_VERIFY.log' }

$checksumPath = Join-Path $DeliveryRoot 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) { throw 'SHA256SUMS.txt is missing' }
$failed = @()
Get-Content -LiteralPath $checksumPath -Encoding UTF8 | ForEach-Object {
  if ([string]::IsNullOrWhiteSpace($_)) { return }
  if ($_ -notmatch '^([0-9a-f]{64})  (.+)$') { $failed += "INVALID LINE $_"; return }
  $expected = $Matches[1]
  $relative = $Matches[2]
  if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') { $failed += "UNSAFE $relative"; return }
  $path = Join-Path $DeliveryRoot $relative
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failed += "MISSING $relative"; return }
  $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { $failed += "HASH $relative" }
}
$result = if ($failed.Count -eq 0) { 'DELIVERY VERIFY PASS' } else { 'DELIVERY VERIFY FAIL' + [Environment]::NewLine + ($failed -join [Environment]::NewLine) }
$logDirectory = Split-Path -Parent $LogPath
if ($logDirectory -and -not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null }
[IO.File]::WriteAllText($LogPath, $result + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
if ($failed.Count -gt 0) { throw ($failed -join [Environment]::NewLine) }
Write-Host $result
