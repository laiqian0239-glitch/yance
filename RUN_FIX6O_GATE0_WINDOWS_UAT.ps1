[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

$LogRoot = Join-Path $Root '.tmp\gate0-windows-launcher'
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$LauncherLog = Join-Path $LogRoot ("launcher-{0}.log" -f $Stamp)
$RuntimeLog = Join-Path $LogRoot ("runtime-{0}.log" -f $Stamp)
$RuntimeStdoutLog = Join-Path $LogRoot ("runtime-{0}.stdout.log" -f $Stamp)
$RuntimeStderrLog = Join-Path $LogRoot ("runtime-{0}.stderr.log" -f $Stamp)
$ExpectedElectronSha256 = 'd75c0057fd58c08023ff82ed9dd38443f90b4a962c9a9359aa74d9070f4add34'

function Write-YanceLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $Line = '[{0}] {1}' -f ([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss.fff')), $Message
  Write-Host $Line
  Add-Content -LiteralPath $LauncherLog -Value $Line -Encoding UTF8
}

$ExitCode = 1
try {
  Write-YanceLog 'Starting FIX6O Gate 0 Windows UAT preflight.'
  Write-YanceLog ("Source root: {0}" -f $Root)

  $NodeCommand = Get-Command node.exe -ErrorAction Stop
  $NpmCommand = Get-Command npm.cmd -ErrorAction Stop
  $NodePath = $NodeCommand.Source
  $NpmPath = $NpmCommand.Source
  Write-YanceLog ("Node: {0}" -f $NodePath)
  Write-YanceLog ("npm: {0}" -f $NpmPath)

  $NodeTarget = (& $NodePath -p "process.platform + ':' + process.arch").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Node.js platform target.' }
  if ($NodeTarget -ne 'win32:x64') { throw "This package requires 64-bit Windows. Detected: $NodeTarget" }

  $NodeVersion = (& $NodePath -p "process.versions.node").Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Node.js version.' }
  $Version = [Version]$NodeVersion
  if ($Version -lt [Version]'22.5.0') { throw "Node.js 22.5.0 or newer is required. Detected: $NodeVersion" }
  Write-YanceLog ("Node target: {0}; version: {1}" -f $NodeTarget, $NodeVersion)

  $EntryPath = Join-Path $Root 'tools\runtime-delivery\start-source-uat.js'
  if (-not (Test-Path -LiteralPath $EntryPath -PathType Leaf)) { throw "Missing runtime entry: $EntryPath" }

  $ElectronZip = Join-Path $Root 'vendor\electron\electron-v39.8.5-win32-x64.zip'
  if (-not (Test-Path -LiteralPath $ElectronZip -PathType Leaf)) { throw "Missing trusted Electron ZIP: $ElectronZip" }
  $ActualElectronSha256 = (Get-FileHash -LiteralPath $ElectronZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualElectronSha256 -ne $ExpectedElectronSha256) {
    throw "Electron ZIP SHA256 mismatch. Expected $ExpectedElectronSha256; actual $ActualElectronSha256"
  }
  Write-YanceLog ("Electron ZIP verified: {0}" -f $ActualElectronSha256)
  Write-YanceLog 'Verifying 307 trusted npm archives, installing dependencies, and starting isolated Windows UAT.'
  Write-YanceLog ("Runtime stdout: {0}" -f $RuntimeStdoutLog)
  Write-YanceLog ("Runtime stderr: {0}" -f $RuntimeStderrLog)

  $Arguments = @(('"{0}"' -f $EntryPath), '--install', ('"--electron-zip={0}"' -f $ElectronZip))
  $RuntimeProcess = Start-Process -FilePath $NodePath -ArgumentList $Arguments -WorkingDirectory $Root -RedirectStandardOutput $RuntimeStdoutLog -RedirectStandardError $RuntimeStderrLog -NoNewWindow -PassThru -Wait
  $ExitCode = $RuntimeProcess.ExitCode

  Set-Content -LiteralPath $RuntimeLog -Value '===== Runtime stdout =====' -Encoding UTF8
  if (Test-Path -LiteralPath $RuntimeStdoutLog) {
    Get-Content -LiteralPath $RuntimeStdoutLog | Tee-Object -FilePath $RuntimeLog -Append
  }
  Add-Content -LiteralPath $RuntimeLog -Value "`r`n===== Runtime stderr =====" -Encoding UTF8
  if (Test-Path -LiteralPath $RuntimeStderrLog) {
    $StderrLines = @(Get-Content -LiteralPath $RuntimeStderrLog)
    if ($StderrLines.Count -gt 0) {
      $StderrLines | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
      $StderrLines | Add-Content -LiteralPath $RuntimeLog -Encoding UTF8
    }
  }

  Add-Content -LiteralPath $LauncherLog -Value "`r`n===== Runtime output =====" -Encoding UTF8
  Get-Content -LiteralPath $RuntimeLog | Add-Content -LiteralPath $LauncherLog -Encoding UTF8

  if ($ExitCode -ne 0) {
    Write-YanceLog ("Runtime failed with exit code {0}." -f $ExitCode)
  } else {
    Write-YanceLog 'Runtime reached trusted readiness and detached successfully.'
  }
}
catch {
  $ExitCode = 1
  $Message = $_.Exception.Message
  Write-YanceLog ("Preflight failed: {0}" -f $Message)
  Add-Content -LiteralPath $LauncherLog -Value ($_ | Format-List * -Force | Out-String) -Encoding UTF8
}
finally {
  Write-YanceLog ("Final exit code: {0}" -f $ExitCode)
  Write-Host ''
  Write-Host ("Launcher log: {0}" -f $LauncherLog)
  if (Test-Path -LiteralPath $RuntimeLog) { Write-Host ("Runtime log: {0}" -f $RuntimeLog) }
}

exit $ExitCode
