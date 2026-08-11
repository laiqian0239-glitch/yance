Set-StrictMode -Version Latest

function Invoke-FacebookProvisioningNativeChecked {
  param(
    [Parameter(Mandatory = $true)][string]$DockerExe,
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $result = Invoke-LabNativeProcess -FilePath $DockerExe -Arguments $Arguments -WorkingDirectory $LabRoot
  if ($result.ExitCode -ne 0) { throw "REAL_RED: $FailureMessage" }
  return [string]$result.StdOut
}

function Invoke-FacebookComposeJson {
  param(
    [Parameter(Mandatory = $true)][string]$DockerExe,
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [Parameter(Mandatory = $true)][string]$ComposePath
  )
  $stdout = Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
    'compose', '-f', $ComposePath, 'config', '--format', 'json'
  ) -FailureMessage 'Docker Compose could not render the provisioning authority as JSON.'
  try { return ($stdout | ConvertFrom-Json) }
  catch { throw 'REAL_RED: Docker Compose provisioning authority JSON is invalid.' }
}

function Get-FacebookComposeProjectionWithoutProvisioningPort {
  param([Parameter(Mandatory = $true)]$Document)
  $copy = (($Document | ConvertTo-Json -Depth 64 -Compress) | ConvertFrom-Json)
  if ($null -eq $copy.services -or $null -eq $copy.services.'facebook-personal') {
    throw 'REAL_RED: Compose authority is missing facebook-personal.'
  }
  $facebook = $copy.services.'facebook-personal'
  if ($facebook.PSObject.Properties.Name -contains 'ports') {
    $facebook.PSObject.Properties.Remove('ports')
  }
  return ($copy | ConvertTo-Json -Depth 64 -Compress)
}

function Get-FacebookTargetPortMappings {
  param(
    [Parameter(Mandatory = $true)]$Document,
    [Parameter(Mandatory = $true)][int]$InternalPort
  )
  if ($null -eq $Document.services -or $null -eq $Document.services.'facebook-personal') {
    throw 'REAL_RED: Compose authority is missing facebook-personal.'
  }
  $service = $Document.services.'facebook-personal'
  if (-not ($service.PSObject.Properties.Name -contains 'ports') -or $null -eq $service.ports) { return ,@() }
  $matches = @()
  foreach ($mapping in @($service.ports)) {
    if ($null -eq $mapping -or -not ($mapping.PSObject.Properties.Name -contains 'target')) { continue }
    try { $target = [int]$mapping.target } catch { continue }
    if ($target -eq $InternalPort) { $matches += $mapping }
  }
  return ,@($matches)
}

function Test-FacebookLoopbackPortMapping {
  param(
    [Parameter(Mandatory = $true)]$Mapping,
    [Parameter(Mandatory = $true)][int]$InternalPort
  )
  try { $target = [int]$Mapping.target } catch { return $false }
  try { $published = [int]$Mapping.published } catch { return $false }
  $hostIp = if ($Mapping.PSObject.Properties.Name -contains 'host_ip') { [string]$Mapping.host_ip } else { '' }
  $protocol = if ($Mapping.PSObject.Properties.Name -contains 'protocol') { [string]$Mapping.protocol } else { '' }
  return ($target -eq $InternalPort -and $published -eq $InternalPort -and $hostIp -eq '127.0.0.1' -and ($protocol -eq '' -or $protocol -eq 'tcp'))
}

function Get-FacebookConfigScalar {
  param(
    [Parameter(Mandatory = $true)][string]$DockerExe,
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [Parameter(Mandatory = $true)][string]$ImageTag,
    [Parameter(Mandatory = $true)][string]$YqPath,
    [Parameter(Mandatory = $true)][string]$Expression
  )
  $dataDir = Join-Path $LabRoot '.runtime/facebook-personal'
  $configPath = Join-Path $dataDir 'config.yaml'
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'REAL_RED: Facebook Personal config.yaml is missing.'
  }
  $mount = "${dataDir}:/data:ro"
  $stdout = Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
    'run', '--rm', '--pull=never', '--volume', $mount,
    '--entrypoint', $YqPath, $ImageTag, '-r', $Expression, '/data/config.yaml'
  ) -FailureMessage "exact upstream yq could not project $Expression."
  return $stdout.Trim()
}

function Get-FacebookProvisioningRuntimeSample {
  param(
    [Parameter(Mandatory = $true)][string]$DockerExe,
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [Parameter(Mandatory = $true)][string]$ComposePath
  )
  $containerOutput = Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
    'compose', '-f', $ComposePath, 'ps', '-q', 'facebook-personal'
  ) -FailureMessage 'Compose could not resolve the Facebook Personal container after provisioning publication.'
  $ids = @($containerOutput -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($ids.Count -ne 1) { throw 'REAL_RED: expected exactly one Facebook Personal Compose container.' }
  $state = Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
    'inspect', '--format', '{{.State.Running}}|{{.State.ExitCode}}|{{.RestartCount}}|{{.Image}}', [string]$ids[0]
  ) -FailureMessage 'Docker could not inspect Facebook Personal after provisioning publication.'
  $parts = $state.Trim().Split('|')
  if ($parts.Count -ne 4) { throw 'REAL_RED: Facebook Personal runtime state shape is invalid.' }
  return [pscustomobject]@{
    Running = [string]$parts[0]
    ExitCode = [int]$parts[1]
    RestartCount = [int]$parts[2]
    ImageId = [string]$parts[3]
  }
}

function Assert-FacebookPublishedPort {
  param(
    [Parameter(Mandatory = $true)][string]$DockerExe,
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [Parameter(Mandatory = $true)][string]$ComposePath,
    [Parameter(Mandatory = $true)][int]$InternalPort
  )
  $stdout = Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
    'compose', '-f', $ComposePath, 'port', 'facebook-personal', [string]$InternalPort
  ) -FailureMessage 'Compose could not resolve the published Facebook Personal provisioning port after authority repair.'
  $lines = @($stdout -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  if ($lines.Count -ne 1 -or $lines[0] -notmatch '^127\.0\.0\.1:(\d+)$') {
    throw 'REAL_RED: Facebook Personal provisioning publication is not loopback-only.'
  }
  if ([int]$matches[1] -ne $InternalPort) {
    throw 'REAL_RED: Facebook Personal provisioning publication changed the frozen host port.'
  }
  return [int]$matches[1]
}

function Ensure-FacebookPersonalProvisioningAuthority {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$LabRoot,
    [Parameter(Mandatory = $true)][string]$DockerExe,
    [Parameter(Mandatory = $true)][string]$ComposePath,
    [Parameter(Mandatory = $true)][string]$ImageTag,
    [Parameter(Mandatory = $true)][string]$ImageId,
    [Parameter(Mandatory = $true)][string]$YqPath
  )

  if (-not (Get-Command Invoke-LabNativeProcess -ErrorAction SilentlyContinue)) {
    throw 'REAL_RED: native-process authority is unavailable to provisioning repair.'
  }
  if (-not (Test-Path -LiteralPath $ComposePath -PathType Leaf)) {
    throw 'REAL_RED: runtime/docker-compose.lab.yml is missing.'
  }

  $address = Get-FacebookConfigScalar -DockerExe $DockerExe -LabRoot $LabRoot -ImageTag $ImageTag -YqPath $YqPath -Expression '.appservice.address'
  $hostname = Get-FacebookConfigScalar -DockerExe $DockerExe -LabRoot $LabRoot -ImageTag $ImageTag -YqPath $YqPath -Expression '.appservice.hostname'
  $portText = Get-FacebookConfigScalar -DockerExe $DockerExe -LabRoot $LabRoot -ImageTag $ImageTag -YqPath $YqPath -Expression '.appservice.port'
  $allowMatrixAuth = Get-FacebookConfigScalar -DockerExe $DockerExe -LabRoot $LabRoot -ImageTag $ImageTag -YqPath $YqPath -Expression '.provisioning.allow_matrix_auth'

  if ($allowMatrixAuth -ne 'true') { throw 'REAL_RED: Facebook Personal provisioning does not allow Matrix authentication.' }
  if ($hostname -ne '0.0.0.0') { throw 'REAL_RED: Facebook Personal appservice listener is not Docker-reachable.' }
  try { $internalPort = [int]$portText } catch { throw 'REAL_RED: Facebook Personal appservice.port is invalid.' }
  if ($internalPort -le 0 -or $internalPort -gt 65535) { throw 'REAL_RED: Facebook Personal appservice.port is out of range.' }
  try { $uri = [Uri]$address } catch { throw 'REAL_RED: Facebook Personal appservice.address is invalid.' }
  if (-not $uri.IsAbsoluteUri -or $uri.Host -ne 'facebook-personal' -or $uri.Port -ne $internalPort) {
    throw 'REAL_RED: Facebook Personal appservice.address does not match its listener authority.'
  }

  $before = Invoke-FacebookComposeJson -DockerExe $DockerExe -LabRoot $LabRoot -ComposePath $ComposePath
  $existing = Get-FacebookTargetPortMappings -Document $before -InternalPort $internalPort
  $needsRepair = $true
  if ($existing.Count -eq 1 -and (Test-FacebookLoopbackPortMapping -Mapping $existing[0] -InternalPort $internalPort)) {
    $needsRepair = $false
  }
  elseif ($existing.Count -gt 0) {
    throw 'REAL_RED: an existing Facebook Personal target-port publication conflicts with loopback-only authority.'
  }

  $composeDir = Split-Path -Parent $ComposePath
  $transactionId = [Guid]::NewGuid().ToString('N')
  $candidateName = ".yance-facebook-provisioning-candidate-$transactionId.yml"
  $backupName = ".yance-facebook-provisioning-backup-$transactionId.yml"
  $candidatePath = Join-Path $composeDir $candidateName
  $backupPath = Join-Path $composeDir $backupName
  $replaced = $false

  try {
    if ($needsRepair) {
      Copy-Item -LiteralPath $ComposePath -Destination $candidatePath -Force
      $composeMount = "${composeDir}:/compose"
      $bind = "127.0.0.1:${internalPort}:${internalPort}/tcp"
      [void](Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
        'run', '--rm', '--pull=never', '--volume', $composeMount,
        '--env', "YANCE_FACEBOOK_PROVISIONING_BIND=$bind",
        '--entrypoint', $YqPath, $ImageTag,
        '-i', '.services."facebook-personal".ports = ((.services."facebook-personal".ports // []) + [strenv(YANCE_FACEBOOK_PROVISIONING_BIND)])',
        "/compose/$candidateName"
      ) -FailureMessage 'exact upstream yq could not add the loopback-only Facebook provisioning publication.')

      $candidate = Invoke-FacebookComposeJson -DockerExe $DockerExe -LabRoot $LabRoot -ComposePath $candidatePath
      $beforeProjection = Get-FacebookComposeProjectionWithoutProvisioningPort -Document $before
      $candidateProjection = Get-FacebookComposeProjectionWithoutProvisioningPort -Document $candidate
      if ($beforeProjection -cne $candidateProjection) {
        throw 'REAL_RED: Compose candidate changed semantics outside the Facebook Personal ports surface.'
      }
      $candidateMappings = Get-FacebookTargetPortMappings -Document $candidate -InternalPort $internalPort
      if ($candidateMappings.Count -ne 1 -or -not (Test-FacebookLoopbackPortMapping -Mapping $candidateMappings[0] -InternalPort $internalPort)) {
        throw 'REAL_RED: Compose candidate did not produce exactly one loopback-only Facebook provisioning publication.'
      }

      [IO.File]::Replace($candidatePath, $ComposePath, $backupPath, $true)
      $replaced = $true
      $committed = Invoke-FacebookComposeJson -DockerExe $DockerExe -LabRoot $LabRoot -ComposePath $ComposePath
      $committedProjection = Get-FacebookComposeProjectionWithoutProvisioningPort -Document $committed
      if ($committedProjection -cne $beforeProjection) {
        throw 'REAL_RED: committed Compose authority changed semantics outside the Facebook Personal ports surface.'
      }
      $committedMappings = Get-FacebookTargetPortMappings -Document $committed -InternalPort $internalPort
      if ($committedMappings.Count -ne 1 -or -not (Test-FacebookLoopbackPortMapping -Mapping $committedMappings[0] -InternalPort $internalPort)) {
        throw 'REAL_RED: committed Compose authority failed loopback-only provisioning validation.'
      }

      [void](Invoke-FacebookProvisioningNativeChecked -DockerExe $DockerExe -LabRoot $LabRoot -Arguments @(
        'compose', '-f', $ComposePath, 'up', '-d', '--force-recreate', 'facebook-personal'
      ) -FailureMessage 'Compose could not recreate only facebook-personal after provisioning publication repair.')
    }

    Start-Sleep -Seconds 5
    $first = Get-FacebookProvisioningRuntimeSample -DockerExe $DockerExe -LabRoot $LabRoot -ComposePath $ComposePath
    if ($first.Running -ne 'true' -or $first.ExitCode -ne 0 -or $first.RestartCount -ne 0 -or $first.ImageId -ne $ImageId) {
      throw 'REAL_RED: Facebook Personal runtime identity is not GREEN after provisioning publication.'
    }
    Start-Sleep -Seconds 5
    $second = Get-FacebookProvisioningRuntimeSample -DockerExe $DockerExe -LabRoot $LabRoot -ComposePath $ComposePath
    if ($second.Running -ne 'true' -or $second.ExitCode -ne 0 -or $second.RestartCount -ne $first.RestartCount -or $second.ImageId -ne $ImageId) {
      throw 'REAL_RED: Facebook Personal runtime did not remain stable after provisioning publication.'
    }

    $hostPort = Assert-FacebookPublishedPort -DockerExe $DockerExe -LabRoot $LabRoot -ComposePath $ComposePath -InternalPort $internalPort
    if ($replaced -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      Remove-Item -LiteralPath $backupPath -Force
      $replaced = $false
    }
    Write-Host "FACEBOOK_PROVISIONING_COMPOSE_AUTHORITY_GREEN host=127.0.0.1 host_port=$hostPort internal_port=$internalPort"
    return [pscustomobject]@{
      InternalPort = $internalPort
      HostPort = $hostPort
      BridgeUrl = "http://127.0.0.1:$hostPort"
      Changed = [bool]$needsRepair
    }
  }
  catch {
    $originalError = [string]$_.Exception.Message
    if ($replaced -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      try {
        [IO.File]::Replace($backupPath, $ComposePath, $null, $true)
        $replaced = $false
        $restore = Invoke-LabNativeProcess -FilePath $DockerExe -Arguments @(
          'compose', '-f', $ComposePath, 'up', '-d', '--force-recreate', 'facebook-personal'
        ) -WorkingDirectory $LabRoot
        if ($restore.ExitCode -ne 0) { throw 'runtime restore failed' }
      }
      catch { throw "REAL_RED: provisioning repair failed and Compose rollback could not restore facebook-personal. original=$originalError" }
    }
    throw $originalError
  }
  finally {
    Remove-Item -LiteralPath $candidatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  }
}
