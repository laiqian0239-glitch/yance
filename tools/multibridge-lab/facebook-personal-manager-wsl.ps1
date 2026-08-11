param(
  [string]$LabRoot = 'C:\Users\1\Downloads\yance-multibridge-lab',
  [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$DistroName = 'Ubuntu-24.04'
$HomeserverUrl = 'http://127.0.0.1:8008'
$ManagerDebName = 'mautrix-manager_0.2.1_amd64.deb'
$ManagerDebSha256 = '94cca9ffe2087521a042f8afc656c1403dcc79af980acd229420829b367ea1fd'
$ManagerDebUrl = 'https://github.com/mautrix/manager/releases/download/v0.2.1/mautrix-manager_0.2.1_amd64.deb'

$nativeProcessPath = Join-Path $PSScriptRoot 'native-process.ps1'
$provisioningAuthorityPath = Join-Path $PSScriptRoot 'facebook-personal-provisioning-authority.ps1'
if (-not (Test-Path -LiteralPath $nativeProcessPath -PathType Leaf)) {
  throw 'REAL_RED: bundled native-process helper is missing.'
}
if (-not (Test-Path -LiteralPath $provisioningAuthorityPath -PathType Leaf)) {
  throw 'REAL_RED: bundled Facebook provisioning Compose authority is missing.'
}
. $nativeProcessPath
. $provisioningAuthorityPath

function Invoke-LabNativeInteractiveProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = ''
  )

  $resolvedFile = [IO.Path]::GetFullPath($FilePath)
  if (-not (Test-Path -LiteralPath $resolvedFile -PathType Leaf)) {
    throw "Native executable does not exist: $resolvedFile"
  }

  $isCmd = [IO.Path]::GetExtension($resolvedFile).Equals('.cmd', [StringComparison]::OrdinalIgnoreCase)
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  if ($isCmd) {
    foreach ($argument in $Arguments) {
      if ([string]$argument -match '[&|<>^\r\n]') { throw 'Unsafe CMD argument rejected.' }
    }
    $processInfo.FileName = $env:ComSpec
    $inner = '"' + $resolvedFile + '"'
    if ($Arguments.Count -gt 0) {
      $inner += ' ' + (($Arguments | ForEach-Object { ConvertTo-LabNativeArgument ([string]$_) }) -join ' ')
    }
    $processInfo.Arguments = '/d /s /c "' + $inner + '"'
  }
  else {
    $processInfo.FileName = $resolvedFile
    $processInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-LabNativeArgument ([string]$_) }) -join ' ')
  }
  if ($WorkingDirectory) { $processInfo.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory) }
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $false
  $processInfo.RedirectStandardInput = $false
  $processInfo.RedirectStandardOutput = $false
  $processInfo.RedirectStandardError = $false

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  try {
    if (-not $process.Start()) { throw "Native executable failed to start: $resolvedFile" }
    $process.WaitForExit()
    $exitCode = [int]$process.ExitCode
  }
  finally {
    $process.Dispose()
  }

  return [pscustomobject]@{ ExitCode = $exitCode; FilePath = $resolvedFile }
}

function Get-Sha256File {
  param([Parameter(Mandatory = $true)][string]$Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose() }
  }
  finally { $sha.Dispose() }
}

function Get-FirstCommandPath {
  param([Parameter(Mandatory = $true)][string[]]$Names)
  foreach ($name in $Names) {
    $command = Get-Command $name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $command) {
      $path = [string]$command.Source
      if (-not $path) { $path = [string]$command.Path }
      if ($path) { return $path }
    }
  }
  return $null
}

function ConvertFrom-FacebookPersonalWslGuiFacts {
  param([AllowEmptyString()][string]$Text)
  $facts = @{}
  foreach ($line in ([string]$Text -split "`r?`n")) {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') {
      $facts[[string]$matches[1]] = [string]$matches[2]
    }
  }
  return $facts
}

function Resolve-FacebookPersonalWslGuiUser {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$WslExe,
    [Parameter(Mandatory = $true)][string]$DistroName
  )

  $currentProbeScript = @'
printf 'UID=%s\n' "$(id -u)"
printf 'USER=%s\n' "$(id -un)"
'@
  $current = Invoke-LabNativeProcess -FilePath $WslExe -Arguments @('--distribution', $DistroName, '--exec', 'bash', '-lc', $currentProbeScript)
  if ($current.ExitCode -ne 0) {
    throw 'REAL_RED: could not resolve the current Ubuntu-24.04 WSL user.'
  }
  $currentFacts = ConvertFrom-FacebookPersonalWslGuiFacts -Text $current.StdOut

  $candidateNames = New-Object 'System.Collections.Generic.List[string]'
  $currentUid = 0
  if ($currentFacts.ContainsKey('UID') -and [int]::TryParse([string]$currentFacts['UID'], [ref]$currentUid) -and $currentUid -ne 0 -and $currentFacts.ContainsKey('USER')) {
    $currentName = [string]$currentFacts['USER']
    if ($currentName -and $currentName -ne 'root') { [void]$candidateNames.Add($currentName) }
  }

  $passwd = Invoke-LabNativeProcess -FilePath $WslExe -Arguments @('--distribution', $DistroName, '--exec', 'getent', 'passwd')
  if ($passwd.ExitCode -ne 0) {
    throw 'REAL_RED: Ubuntu-24.04 user database could not be read.'
  }
  $passwdCandidates = @()
  foreach ($line in ([string]$passwd.StdOut -split "`r?`n")) {
    if (-not $line) { continue }
    $fields = @($line -split ':', 7)
    if ($fields.Count -lt 7) { continue }
    $uid = 0
    if (-not [int]::TryParse([string]$fields[2], [ref]$uid)) { continue }
    if ($uid -lt 1000 -or $uid -ge 60000) { continue }
    $name = [string]$fields[0]
    $shell = [string]$fields[6]
    if (-not $name -or $name -eq 'root' -or $shell -match '(?:nologin|false)$') { continue }
    $passwdCandidates += [pscustomobject]@{ Name = $name; Uid = $uid }
  }
  foreach ($candidate in @($passwdCandidates | Sort-Object Uid, Name)) {
    if (-not $candidateNames.Contains([string]$candidate.Name)) {
      [void]$candidateNames.Add([string]$candidate.Name)
    }
  }
  if ($candidateNames.Count -eq 0) {
    throw 'REAL_RED: no non-root interactive Ubuntu-24.04 user is available for the upstream manager GUI.'
  }

  $guiProbeScript = @'
uid="$(id -u)"
user="$(id -un)"
printf 'UID=%s\n' "$uid"
printf 'USER=%s\n' "$user"
[ "$uid" -ne 0 ] || exit 10
[ -d /mnt/wslg ] || exit 11
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then exit 12; fi
[ -n "${HOME:-}" ] && [ "$HOME" != '/root' ] || exit 13
printf 'HOME=%s\n' "$HOME"
printf 'WSLG=1\n'
printf 'DISPLAY_OK=1\n'
'@

  foreach ($candidateName in $candidateNames) {
    $probe = Invoke-LabNativeProcess -FilePath $WslExe -Arguments @('--distribution', $DistroName, '--user', [string]$candidateName, '--exec', 'bash', '-lc', $guiProbeScript)
    if ($probe.ExitCode -ne 0) { continue }
    $facts = ConvertFrom-FacebookPersonalWslGuiFacts -Text $probe.StdOut
    $uid = 0
    if (-not $facts.ContainsKey('UID') -or -not [int]::TryParse([string]$facts['UID'], [ref]$uid) -or $uid -eq 0) { continue }
    if (-not $facts.ContainsKey('USER') -or [string]$facts['USER'] -ne [string]$candidateName) { continue }
    if (-not $facts.ContainsKey('WSLG') -or [string]$facts['WSLG'] -ne '1') { continue }
    if (-not $facts.ContainsKey('DISPLAY_OK') -or [string]$facts['DISPLAY_OK'] -ne '1') { continue }
    if (-not $facts.ContainsKey('HOME') -or -not [string]$facts['HOME'] -or [string]$facts['HOME'] -eq '/root') { continue }
    return [pscustomobject]@{ Name = [string]$candidateName; Uid = $uid; Home = [string]$facts['HOME'] }
  }

  throw 'REAL_RED: no non-root Ubuntu-24.04 account has a usable WSLg GUI session.'
}

if ($LibraryOnly) { return }

function Write-RealRed {
  param([Parameter(Mandatory = $true)][string]$Reason)
  Write-Host "REAL_RED: $Reason"
  Write-Host 'FINAL STATUS: REAL_RED'
}

try {
  $readinessPath = Join-Path $PSScriptRoot 'facebook-personal-wsl-readiness.ps1'
  $installerPath = Join-Path $PSScriptRoot 'facebook-personal-manager-install.sh'
  if (-not (Test-Path -LiteralPath $readinessPath -PathType Leaf)) { throw 'REAL_RED: bundled WSL readiness checker is missing.' }
  if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) { throw 'REAL_RED: bundled Linux manager installer is missing.' }

  $powershellExe = Get-FirstCommandPath -Names @('powershell.exe')
  if (-not $powershellExe) { throw 'REAL_RED: Windows PowerShell is unavailable.' }
  $readiness = Invoke-LabNativeProcess -FilePath $powershellExe -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', $readinessPath)
  if ($readiness.StdOut) { Write-Host $readiness.StdOut.TrimEnd() }
  if ($readiness.StdErr) { Write-Host $readiness.StdErr.TrimEnd() }
  if ($readiness.ExitCode -ne 0) { exit $readiness.ExitCode }
  if ($readiness.StdOut -notmatch 'WSL_GUI_READY distro=Ubuntu-24\.04') {
    throw 'REAL_RED: WSL readiness did not select the frozen Ubuntu-24.04 distro.'
  }

  if (-not (Test-Path -LiteralPath $LabRoot -PathType Container)) { throw 'REAL_RED: existing Windows Lab root is missing.' }
  $resolvedLabRoot = (Resolve-Path -LiteralPath $LabRoot).Path
  $composePath = Join-Path $resolvedLabRoot 'runtime/docker-compose.lab.yml'
  $profilesPath = Join-Path $resolvedLabRoot 'runtime/upstream-builds.json'
  $dataDir = Join-Path $resolvedLabRoot '.runtime/facebook-personal'
  $configPath = Join-Path $dataDir 'config.yaml'
  $stageEvidencePath = Join-Path $resolvedLabRoot 'evidence/live/runtime-stage-facebook-personal.json'
  foreach ($requiredPath in @($composePath, $profilesPath, $configPath, $stageEvidencePath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "REAL_RED: required Lab authority is missing: $requiredPath" }
  }

  $dockerExe = Get-FirstCommandPath -Names @('docker.exe', 'docker')
  if (-not $dockerExe) { throw 'REAL_RED: Docker CLI is unavailable.' }
  $wslExe = Get-FirstCommandPath -Names @('wsl.exe')
  if (-not $wslExe) { throw 'REAL_RED: wsl.exe is unavailable.' }
  $guiUser = Resolve-FacebookPersonalWslGuiUser -WslExe $wslExe -DistroName $DistroName
  Write-Host "WSL_GUI_USER_GREEN user=$($guiUser.Name) uid=$($guiUser.Uid)"

  $profiles = Get-Content -Raw -LiteralPath $profilesPath | ConvertFrom-Json
  $profile = $profiles.profiles | Where-Object { [string]$_.platformId -eq 'facebook-personal' } | Select-Object -First 1
  if ($null -eq $profile -or -not [string]$profile.imageTag -or -not [string]$profile.commit) {
    throw 'REAL_RED: frozen Facebook Personal runtime profile is invalid.'
  }
  $stage = Get-Content -Raw -LiteralPath $stageEvidencePath | ConvertFrom-Json
  if ([string]$stage.sourceHead -ne [string]$profile.commit -or [string]$stage.imageTag -ne [string]$profile.imageTag) {
    throw 'REAL_RED: Facebook Personal stage identity no longer matches runtime profile.'
  }
  if ([string]$stage.runtimePackagingSmoke -ne 'green' -or [string]$stage.runtimeExecutableLoadSmoke -ne 'green') {
    throw 'REAL_RED: Facebook Personal stage smoke authority is not GREEN.'
  }

  $imageTag = [string]$profile.imageTag
  $localImage = Invoke-LabNativeProcess -FilePath $dockerExe -Arguments @('image', 'inspect', '--format', '{{.Id}}', $imageTag) -WorkingDirectory $resolvedLabRoot
  if ($localImage.ExitCode -ne 0 -or $localImage.StdOut.Trim() -ne [string]$stage.imageId) {
    throw 'REAL_RED: exact Facebook Personal staged image is unavailable.'
  }

  $yqProbe = Invoke-LabNativeProcess -FilePath $dockerExe -Arguments @('run', '--rm', '--pull=never', '--entrypoint', '/bin/sh', $imageTag, '-c', 'command -v yq') -WorkingDirectory $resolvedLabRoot
  if ($yqProbe.ExitCode -ne 0) { throw 'REAL_RED: upstream yq is unavailable in the exact Facebook Personal image.' }
  $yqLines = @($yqProbe.StdOut -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.StartsWith('/') })
  if ($yqLines.Count -ne 1) { throw 'REAL_RED: upstream yq path is ambiguous.' }
  $yqPath = [string]$yqLines[0]

  $provisioningAuthority = Ensure-FacebookPersonalProvisioningAuthority `
    -LabRoot $resolvedLabRoot `
    -DockerExe $dockerExe `
    -ComposePath $composePath `
    -ImageTag $imageTag `
    -ImageId ([string]$stage.imageId) `
    -YqPath $yqPath
  $internalPort = [int]$provisioningAuthority.InternalPort
  $hostPort = [int]$provisioningAuthority.HostPort
  $bridgeUrl = [string]$provisioningAuthority.BridgeUrl

  $tcpProbe = "timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/$hostPort'"
  $wslTcp = Invoke-LabNativeProcess -FilePath $wslExe -Arguments @('--distribution', $DistroName, '--exec', 'bash', '-lc', $tcpProbe)
  if ($wslTcp.ExitCode -ne 0) { throw 'REAL_RED: Ubuntu-24.04 cannot reach the published Facebook Personal provisioning port.' }
  Write-Host "FACEBOOK_PROVISIONING_ENDPOINT_GREEN bridge_url=$bridgeUrl internal_port=$internalPort"

  $workRoot = Join-Path $env:TEMP 'yance-facebook-personal-manager-v0.2.1'
  New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
  $debPath = Join-Path $workRoot $ManagerDebName
  Invoke-WebRequest -Uri $ManagerDebUrl -OutFile $debPath -UseBasicParsing
  if ((Get-Sha256File -Path $debPath) -ne $ManagerDebSha256) { throw 'REAL_RED: official mautrix-manager deb SHA256 mismatch.' }
  Write-Host "MAUTRIX_MANAGER_DEB_SHA256_GREEN=$ManagerDebSha256"

  $debWsl = Invoke-LabNativeProcess -FilePath $wslExe -Arguments @('--distribution', $DistroName, '--exec', 'wslpath', '-a', $debPath)
  $installerWsl = Invoke-LabNativeProcess -FilePath $wslExe -Arguments @('--distribution', $DistroName, '--exec', 'wslpath', '-a', $installerPath)
  if ($debWsl.ExitCode -ne 0 -or $installerWsl.ExitCode -ne 0 -or -not $debWsl.StdOut.Trim() -or -not $installerWsl.StdOut.Trim()) {
    throw 'REAL_RED: Windows-to-WSL package path translation failed.'
  }

  Write-Host 'SYSTEM_AUTHORIZATION_REQUIRED: Ubuntu may request sudo authorization to install the exact official package.'
  $interactive = Invoke-LabNativeInteractiveProcess -FilePath $wslExe -Arguments @(
    '--distribution', $DistroName, '--user', $guiUser.Name, '--exec', 'bash', $installerWsl.StdOut.Trim(),
    '--install-and-launch', $debWsl.StdOut.Trim(), $bridgeUrl, $HomeserverUrl
  )
  if ($interactive.ExitCode -ne 0) { throw "REAL_RED: official manager install/launch failed with exit code $($interactive.ExitCode)." }
  exit 0
}
catch {
  $message = [string]$_.Exception.Message
  if ($message.StartsWith('REAL_RED:')) { Write-Host $message }
  else { Write-RealRed -Reason 'Facebook Personal WSL manager operator gate failed unexpectedly.' }
  if ($message.StartsWith('REAL_RED:')) { Write-Host 'FINAL STATUS: REAL_RED' }
  exit 1
}