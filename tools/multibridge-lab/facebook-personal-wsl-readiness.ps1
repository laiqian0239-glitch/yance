param(
  [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Normalize-WslOutput {
  param([AllowEmptyString()][string]$Text)
  if ($null -eq $Text) { return '' }
  return ([string]$Text) -replace "`0", ''
}

function ConvertFrom-WslVerboseOutput {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)

  $normalized = Normalize-WslOutput -Text $Text
  foreach ($line in ($normalized -split "`r?`n")) {
    if ($line -match '^\s*(\*)?\s*(.+?)\s+\S+\s+([12])\s*$') {
      [pscustomobject]@{
        Name = [string]$matches[2]
        Version = [int]$matches[3]
        IsDefault = [bool]($matches[1] -eq '*')
      }
    }
  }
}

function ConvertFrom-KeyValueLines {
  param([AllowEmptyString()][string]$Text)
  $result = @{}
  foreach ($line in ((Normalize-WslOutput -Text $Text) -split "`r?`n")) {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') {
      $result[[string]$matches[1]] = [string]$matches[2]
    }
  }
  return $result
}

if ($LibraryOnly) { return }

$nativeProcessPath = Join-Path $PSScriptRoot 'native-process.ps1'
if (-not (Test-Path -LiteralPath $nativeProcessPath -PathType Leaf)) {
  Write-Host 'REAL_RED: bundled native-process helper is missing.'
  Write-Host 'FINAL STATUS: REAL_RED'
  exit 1
}
. $nativeProcessPath

function Write-SetupRequired {
  param([Parameter(Mandatory = $true)][string]$Reason)
  Write-Host "WSL_SETUP_REQUIRED reason=$Reason"
  Write-Host 'FINAL STATUS: WSL_SETUP_REQUIRED'
}

function Invoke-WslReadOnly {
  param(
    [Parameter(Mandatory = $true)][string]$WslExe,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )
  return Invoke-LabNativeProcess -FilePath $WslExe -Arguments $Arguments
}

try {
  $wslCommand = Get-Command wsl.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $wslCommand) {
    Write-SetupRequired -Reason 'WSL_COMMAND_MISSING'
    exit 2
  }
  $wslExe = [string]$wslCommand.Source
  if (-not $wslExe) { $wslExe = [string]$wslCommand.Path }
  if (-not $wslExe) { throw 'REAL_RED: could not resolve wsl.exe path.' }

  $status = Invoke-WslReadOnly -WslExe $wslExe -Arguments @('--status')
  if ($status.ExitCode -ne 0) {
    Write-SetupRequired -Reason 'WSL_STATUS_UNAVAILABLE'
    exit 2
  }
  Write-Host 'WSL_STATUS_QUERY_GREEN'

  $version = Invoke-WslReadOnly -WslExe $wslExe -Arguments @('--version')
  if ($version.ExitCode -ne 0) {
    Write-SetupRequired -Reason 'WSL_VERSION_UNAVAILABLE'
    exit 2
  }
  Write-Host 'WSL_VERSION_QUERY_GREEN'

  $list = Invoke-WslReadOnly -WslExe $wslExe -Arguments @('--list', '--verbose')
  if ($list.ExitCode -ne 0) {
    Write-SetupRequired -Reason 'WSL_DISTRO_LIST_UNAVAILABLE'
    exit 2
  }
  $distros = @(ConvertFrom-WslVerboseOutput -Text $list.StdOut)
  $wsl2Distros = @($distros | Where-Object { $_.Version -eq 2 } | Sort-Object @{ Expression = 'IsDefault'; Descending = $true }, Name)
  if ($wsl2Distros.Count -eq 0) {
    Write-SetupRequired -Reason 'NO_WSL2_DISTRO'
    exit 2
  }
  Write-Host "WSL2_DISTRO_COUNT=$($wsl2Distros.Count)"

  $probeScript = @'
arch="$(uname -m)"
printf 'ARCH=%s\n' "$arch"
if command -v apt-get >/dev/null 2>&1; then echo 'APT=1'; else echo 'APT=0'; fi
if command -v dpkg >/dev/null 2>&1; then echo 'DPKG=1'; else echo 'DPKG=0'; fi
if [ -d /mnt/wslg ]; then echo 'WSLG_DIR=1'; else echo 'WSLG_DIR=0'; fi
if [ -n "${WAYLAND_DISPLAY:-}" ]; then echo 'WAYLAND_DISPLAY_SET=1'; else echo 'WAYLAND_DISPLAY_SET=0'; fi
if [ -n "${DISPLAY:-}" ]; then echo 'DISPLAY_SET=1'; else echo 'DISPLAY_SET=0'; fi
'@

  $candidate = $null
  foreach ($distro in $wsl2Distros) {
    $probe = Invoke-WslReadOnly -WslExe $wslExe -Arguments @('--distribution', [string]$distro.Name, '--exec', 'bash', '-lc', $probeScript)
    if ($probe.ExitCode -ne 0) {
      Write-Host "WSL_DISTRO_PROBE_SKIPPED name=$($distro.Name) reason=PROBE_EXIT_$($probe.ExitCode)"
      continue
    }
    $facts = ConvertFrom-KeyValueLines -Text $probe.StdOut
    $archOk = $facts.ContainsKey('ARCH') -and ($facts['ARCH'] -eq 'x86_64' -or $facts['ARCH'] -eq 'amd64')
    $aptOk = $facts.ContainsKey('APT') -and $facts['APT'] -eq '1'
    $dpkgOk = $facts.ContainsKey('DPKG') -and $facts['DPKG'] -eq '1'
    $wslgDirOk = $facts.ContainsKey('WSLG_DIR') -and $facts['WSLG_DIR'] -eq '1'
    $displayOk = ($facts.ContainsKey('WAYLAND_DISPLAY_SET') -and $facts['WAYLAND_DISPLAY_SET'] -eq '1') -or ($facts.ContainsKey('DISPLAY_SET') -and $facts['DISPLAY_SET'] -eq '1')

    if ($archOk -and $aptOk -and $dpkgOk -and $wslgDirOk -and $displayOk) {
      $candidate = $distro
      break
    }
    Write-Host "WSL_DISTRO_PROBE_SKIPPED name=$($distro.Name) reason=NOT_AMD64_DEB_WSLG_READY"
  }

  if ($null -eq $candidate) {
    Write-SetupRequired -Reason 'NO_AMD64_DEB_WSLG_DISTRO'
    exit 2
  }

  Write-Host "WSL2_DISTRO_GREEN name=$($candidate.Name)"
  Write-Host 'WSL_DISTRO_ARCH_GREEN'
  Write-Host 'WSL_DEB_PACKAGE_MANAGER_GREEN'
  Write-Host 'WSLG_ENV_GREEN'

  $networkScript = @'
probe_tcp() {
  local host="$1"
  timeout 3 bash -c "exec 3<>/dev/tcp/$host/8008" >/dev/null 2>&1
}
if probe_tcp 127.0.0.1; then
  echo 'NETWORK_MODE=localhost'
  exit 0
fi
host_ip="$(ip route show default 2>/dev/null | awk 'NR==1 {print $3}')"
if [ -n "$host_ip" ] && probe_tcp "$host_ip"; then
  echo 'NETWORK_MODE=host-ip'
  exit 0
fi
echo 'NETWORK_MODE=unreachable'
exit 3
'@

  $network = Invoke-WslReadOnly -WslExe $wslExe -Arguments @('--distribution', [string]$candidate.Name, '--exec', 'bash', '-lc', $networkScript)
  $networkFacts = ConvertFrom-KeyValueLines -Text $network.StdOut
  if ($network.ExitCode -ne 0 -or -not $networkFacts.ContainsKey('NETWORK_MODE') -or $networkFacts['NETWORK_MODE'] -eq 'unreachable') {
    Write-Host "WSL_LAB_NETWORK_REQUIRED distro=$($candidate.Name) target=windows-synapse:8008"
    Write-Host 'FINAL STATUS: WSL_LAB_NETWORK_REQUIRED'
    exit 3
  }

  Write-Host "WSL_WINDOWS_LAB_CONNECTIVITY_GREEN mode=$($networkFacts['NETWORK_MODE'])"
  Write-Host "WSL_GUI_READY distro=$($candidate.Name)"
  Write-Host 'FINAL STATUS: WSL_GUI_READY'
  exit 0
}
catch {
  $message = [string]$_.Exception.Message
  if (-not $message.StartsWith('REAL_RED:')) { $message = 'REAL_RED: WSL readiness checker failed unexpectedly.' }
  Write-Host $message
  Write-Host 'FINAL STATUS: REAL_RED'
  exit 1
}
