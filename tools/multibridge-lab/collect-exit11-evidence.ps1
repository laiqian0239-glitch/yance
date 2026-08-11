Set-StrictMode -Version Latest

$nativeHelper = Join-Path $PSScriptRoot 'native-process.ps1'
. $nativeHelper

$script:LabRecoveryServices = @(
  'facebook-personal',
  'instagram-dm',
  'google-messages',
  'signal',
  'line'
)

function Protect-LabEvidenceLine {
  [CmdletBinding()]
  param([AllowEmptyString()][string]$Line)

  if ($null -eq $Line) { return '' }
  $value = [string]$Line

  $value = [regex]::Replace($value, '(?i)\b(as_token|hs_token|access_token|refresh_token|password)\b\s*[:=]\s*[^\s,;]+', '$1: [REDACTED]')
  $value = [regex]::Replace($value, '(?i)\bAuthorization\s*:\s*(?:Bearer\s+)?[^\s,;]+', 'Authorization: [REDACTED]')
  $value = [regex]::Replace($value, '(?i)\bCookie\s*:\s*.*$', 'Cookie: [REDACTED]')
  $value = [regex]::Replace($value, '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[REDACTED]')
  $value = [regex]::Replace($value, '(?<!\w)\+?[0-9][0-9() .-]{7,}[0-9](?!\w)', '[REDACTED]')
  $value = [regex]::Replace($value, '(?i)\b(message|body|text|content)\b\s*[:=]\s*.*$', '$1: [REDACTED]')
  $value = [regex]::Replace($value, '(?i)\b(sessionid|cookie|token)\b\s*[:=]\s*[^\s,;]+', '$1: [REDACTED]')

  return $value
}

function Test-LabValidationLine {
  [CmdletBinding()]
  param([AllowEmptyString()][string]$Line)

  if ([string]::IsNullOrWhiteSpace($Line)) { return $false }
  return $Line -match '(?i)\b(config(?:uration)?|validation|validator|invalid|missing|required|unknown|unsupported|yaml|fatal|error)\b'
}

function Resolve-LabDockerExecutable {
  [CmdletBinding()]
  param()

  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($null -eq $command) { $command = Get-Command docker -ErrorAction SilentlyContinue }
  if ($null -eq $command) { throw 'Docker CLI was not found.' }
  return [IO.Path]::GetFullPath($command.Source)
}

function Invoke-LabDockerReadOnly {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$DockerPath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $allowed = @('ps', 'inspect', 'logs')
  if ($Arguments.Count -eq 0 -or $allowed -notcontains $Arguments[0]) {
    throw "Non-read-only Docker action rejected: $($Arguments -join ' ')"
  }
  return Invoke-LabNativeProcess -FilePath $DockerPath -Arguments $Arguments
}

function Assert-LabDockerReadSuccess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Operation,
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)]$Result
  )

  if ($null -eq $Result) {
    throw "Docker $Operation returned no result for service $Service."
  }

  $exitCode = [int]$Result.ExitCode
  if ($exitCode -eq 0) { return }

  $safeStderr = Protect-LabEvidenceLine ([string]$Result.StdErr)
  $safeStderr = $safeStderr.Trim()
  if ([string]::IsNullOrWhiteSpace($safeStderr)) { $safeStderr = '[NO_STDERR]' }
  throw "Docker $Operation failed for service $Service with exit code $exitCode. stderr=$safeStderr"
}

function Get-LabBridgeContainerId {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$DockerPath,
    [Parameter(Mandatory = $true)][string]$Service
  )

  $lookup = Invoke-LabDockerReadOnly -DockerPath $DockerPath -Arguments @(
    'ps', '-a', '--filter', "label=com.docker.compose.service=$Service", '--format', '{{.ID}}'
  )
  Assert-LabDockerReadSuccess -Operation 'ps' -Service $Service -Result $lookup

  $ids = @($lookup.StdOut -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($ids.Count -ne 1) {
    throw "Expected exactly one container for service $Service, found $($ids.Count)."
  }
  return $ids[0].Trim()
}

function Get-LabExit11ServiceEvidence {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$DockerPath,
    [Parameter(Mandatory = $true)][string]$Service
  )

  $containerId = Get-LabBridgeContainerId -DockerPath $DockerPath -Service $Service
  $state = Invoke-LabDockerReadOnly -DockerPath $DockerPath -Arguments @(
    'inspect', '--format', '{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}', $containerId
  )
  Assert-LabDockerReadSuccess -Operation 'inspect' -Service $Service -Result $state

  $logs = Invoke-LabDockerReadOnly -DockerPath $DockerPath -Arguments @('logs', '--tail', '80', $containerId)
  Assert-LabDockerReadSuccess -Operation 'logs' -Service $Service -Result $logs

  $combined = @($logs.StdOut -split '\r?\n') + @($logs.StdErr -split '\r?\n')
  $validation = @(
    $combined |
      Where-Object { Test-LabValidationLine $_ } |
      Select-Object -Last 12 |
      ForEach-Object { Protect-LabEvidenceLine $_ }
  )

  return [pscustomobject]@{
    Service = $Service
    State = (Protect-LabEvidenceLine $state.StdOut.Trim())
    DockerLogsExitCode = [int]$logs.ExitCode
    ValidationLines = $validation
  }
}

function Invoke-LabExit11Collector {
  [CmdletBinding()]
  param([string]$OutputPath = (Join-Path (Get-Location) 'exit11-evidence.txt'))

  $docker = Resolve-LabDockerExecutable
  $lines = New-Object System.Collections.Generic.List[string]
  [void]$lines.Add('YANCE-MULTIBRIDGE-LAB EXIT-11 SANITIZED EVIDENCE')
  [void]$lines.Add('READ_ONLY=true')
  [void]$lines.Add('LOG_TAIL=80')
  [void]$lines.Add('')

  $hadCollectorError = $false
  foreach ($service in $script:LabRecoveryServices) {
    [void]$lines.Add("SERVICE=$service")
    try {
      $evidence = Get-LabExit11ServiceEvidence -DockerPath $docker -Service $service
      [void]$lines.Add("STATE=$($evidence.State)")
      [void]$lines.Add("LOGS_EXIT_CODE=$($evidence.DockerLogsExitCode)")
      if ($evidence.ValidationLines.Count -eq 0) {
        [void]$lines.Add('VALIDATION_LINE=[NONE_MATCHED]')
      } else {
        foreach ($line in $evidence.ValidationLines) {
          [void]$lines.Add("VALIDATION_LINE=$line")
        }
      }
    } catch {
      $hadCollectorError = $true
      [void]$lines.Add("COLLECTOR_ERROR=$(Protect-LabEvidenceLine $_.Exception.Message)")
    }
    [void]$lines.Add('')
  }

  $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
  [IO.File]::WriteAllLines($resolvedOutput, $lines, [Text.UTF8Encoding]::new($false))
  Write-Host "Evidence: $resolvedOutput"
  if ($hadCollectorError) {
    Write-Host 'FINAL STATUS: REAL_RED'
    return 1
  }
  Write-Host 'FINAL STATUS: REAL_RED'
  return 0
}
