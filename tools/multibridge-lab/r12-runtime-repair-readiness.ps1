param(
  [string]$LabRoot = 'C:\Users\1\Downloads\yance-multibridge-lab'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolRoot = $PSScriptRoot
$databaseWiringPath = Join-Path $toolRoot 'r12-database-wiring.ps1'
$nativeProcessPath = Join-Path $toolRoot 'native-process.ps1'
$loginAuthorityPath = Join-Path $toolRoot 'runtime-login-flow-authorities.json'

if (-not (Test-Path -LiteralPath $databaseWiringPath -PathType Leaf)) {
  throw 'REAL_RED: bundled R12 database wiring authority is missing.'
}
if (-not (Test-Path -LiteralPath $nativeProcessPath -PathType Leaf)) {
  throw 'REAL_RED: bundled native-process helper is missing.'
}

. $databaseWiringPath
. $nativeProcessPath

$TerminalStatuses = @('GREEN', 'REAL_RED', 'HUMAN_AUTH_REQUIRED')
$targets = @('facebook-personal', 'instagram-dm', 'google-messages', 'signal', 'line')
$expectedComposeServices = @('synapse') + $targets
$composeRelative = 'runtime/docker-compose.lab.yml'
$profilesRelative = 'runtime/upstream-builds.json'
$evidenceRelative = 'evidence/live'
$dataRelative = '.runtime'

function Write-TerminalStatus {
  param([Parameter(Mandatory = $true)][ValidateSet('GREEN', 'REAL_RED', 'HUMAN_AUTH_REQUIRED')][string]$Status)
  if ($TerminalStatuses -notcontains $Status) { throw 'REAL_RED: invalid terminal status.' }
  Write-Host "FINAL STATUS: $Status"
}

function Get-Sha256Text {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
  }
  finally {
    $sha.Dispose()
  }
}

function Get-SingleLineArray {
  param([AllowEmptyString()][string]$Text)
  return ,@($Text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
}

$resolvedLabRoot = $null
$composePath = $null
$profilesPath = $null
$profilesDocument = $null
$dockerExe = $null
$runtimeAuthority = @{}

function Invoke-DockerChecked {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $result = Invoke-LabNativeProcess -FilePath $dockerExe -Arguments $Arguments -WorkingDirectory $resolvedLabRoot
  if ($result.ExitCode -ne 0) {
    throw "REAL_RED: $FailureMessage"
  }
  return [string]$result.StdOut
}

function Invoke-ComposeChecked {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $composeArgs = @('compose', '-f', $composePath) + $Arguments
  return Invoke-DockerChecked -Arguments $composeArgs -FailureMessage $FailureMessage
}

function Get-Profile {
  param([Parameter(Mandatory = $true)][string]$Service)
  $profile = $profilesDocument.profiles | Where-Object { [string]$_.platformId -eq $Service } | Select-Object -First 1
  if ($null -eq $profile) { throw "REAL_RED: exact runtime profile is missing for $Service." }
  return $profile
}

function Get-ServiceDataDirectory {
  param([Parameter(Mandatory = $true)][string]$Service)
  return Join-Path (Join-Path $resolvedLabRoot $dataRelative) $Service
}

function Get-ServiceConfigPath {
  param([Parameter(Mandatory = $true)][string]$Service)
  return Join-Path (Get-ServiceDataDirectory -Service $Service) 'config.yaml'
}

function Get-YqPathForImage {
  param([Parameter(Mandatory = $true)][string]$Image)
  $stdout = Invoke-DockerChecked -Arguments @('run', '--rm', '--entrypoint', '/bin/sh', $Image, '-c', 'command -v yq') -FailureMessage "could not resolve upstream yq for $Image."
  $lines = Get-SingleLineArray -Text $stdout
  if ($lines.Count -ne 1 -or -not $lines[0].StartsWith('/')) {
    throw "REAL_RED: upstream yq path is invalid for $Image."
  }
  return [string]$lines[0]
}

function Invoke-ServiceYq {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string[]]$YqArguments,
    [hashtable]$Environment = @{}
  )
  $authority = $runtimeAuthority[$Service]
  if ($null -eq $authority) { throw "REAL_RED: runtime authority was not preflighted for $Service." }
  $dataDir = Get-ServiceDataDirectory -Service $Service
  $mount = "${dataDir}:/data"
  $arguments = @('run', '--rm', '--volume', $mount)
  foreach ($key in ($Environment.Keys | Sort-Object)) {
    $arguments += @('--env', "${key}=$($Environment[$key])")
  }
  $arguments += @('--entrypoint', [string]$authority.YqPath, [string]$authority.ImageTag)
  $arguments += $YqArguments
  return Invoke-DockerChecked -Arguments $arguments -FailureMessage "upstream yq operation failed for $Service."
}

function Get-YqScalar {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string]$Expression
  )
  $stdout = Invoke-ServiceYq -Service $Service -FileName $FileName -YqArguments @('-r', $Expression, "/data/$FileName")
  return $stdout.Trim()
}

function Get-NonDatabaseSemanticHash {
  param(
    [Parameter(Mandatory = $true)][string]$Service,
    [Parameter(Mandatory = $true)][string]$FileName
  )
  $semanticJson = Invoke-ServiceYq -Service $Service -FileName $FileName -YqArguments @('-o=json', 'del(.database.type, .database.uri)', "/data/$FileName")
  return Get-Sha256Text -Text $semanticJson
}

function Repair-ServiceDatabaseConfig {
  param([Parameter(Mandatory = $true)][string]$Service)

  $wiring = Get-LabR12DatabaseWiring -Service $Service
  if ($null -eq $wiring) { throw "REAL_RED: recovered DB wiring is missing for $Service." }
  if ([string]$wiring.Type -ne 'sqlite3-fk-wal') { throw "REAL_RED: unexpected DB type for $Service." }
  $expectedUri = "file:/data/$Service.db?_txlock=immediate"
  if ([string]$wiring.Uri -ne $expectedUri) { throw "REAL_RED: unexpected DB URI for $Service." }

  $dataDir = Get-ServiceDataDirectory -Service $Service
  $configPath = Get-ServiceConfigPath -Service $Service
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw "REAL_RED: existing R12 config is missing for $Service."
  }

  $transactionId = [Guid]::NewGuid().ToString('N')
  $candidateName = ".yance-r12-db-candidate-$transactionId.yaml"
  $backupName = ".yance-r12-db-backup-$transactionId.yaml"
  $candidatePath = Join-Path $dataDir $candidateName
  $backupPath = Join-Path $dataDir $backupName
  $replaced = $false

  try {
    Copy-Item -LiteralPath $configPath -Destination $candidatePath -Force

    $beforeHash = Get-NonDatabaseSemanticHash -Service $Service -FileName 'config.yaml'
    $repairEnv = @{
      YANCE_DATABASE_TYPE = [string]$wiring.Type
      YANCE_DATABASE_URI = [string]$wiring.Uri
    }
    [void](Invoke-ServiceYq -Service $Service -FileName $candidateName -YqArguments @('-i', '.database.type=strenv(YANCE_DATABASE_TYPE)|.database.uri=strenv(YANCE_DATABASE_URI)', "/data/$candidateName") -Environment $repairEnv)

    $afterHash = Get-NonDatabaseSemanticHash -Service $Service -FileName $candidateName
    if ($beforeHash -ne $afterHash) {
      throw "REAL_RED: non-database config semantics changed for $Service."
    }

    $actualType = Get-YqScalar -Service $Service -FileName $candidateName -Expression '.database.type'
    $actualUri = Get-YqScalar -Service $Service -FileName $candidateName -Expression '.database.uri'
    if ($actualType -ne [string]$wiring.Type -or $actualUri -ne [string]$wiring.Uri) {
      throw "REAL_RED database repair validation failed for $Service."
    }

    [IO.File]::Replace($candidatePath, $configPath, $backupPath, $true)
    $replaced = $true

    $committedHash = Get-NonDatabaseSemanticHash -Service $Service -FileName 'config.yaml'
    $committedType = Get-YqScalar -Service $Service -FileName 'config.yaml' -Expression '.database.type'
    $committedUri = Get-YqScalar -Service $Service -FileName 'config.yaml' -Expression '.database.uri'
    if ($committedHash -ne $beforeHash -or $committedType -ne [string]$wiring.Type -or $committedUri -ne [string]$wiring.Uri) {
      throw "REAL_RED: committed database repair verification failed for $Service."
    }

    Write-Host "NON_DATABASE_CONFIG_HASH_GREEN service=$Service"
  }
  catch {
    if ($replaced -and (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      [IO.File]::Replace($backupPath, $configPath, $null, $true)
      $replaced = $false
    }
    throw
  }
  finally {
    Remove-Item -LiteralPath $candidatePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-ComposeContainerId {
  param([Parameter(Mandatory = $true)][string]$Service)
  $stdout = Invoke-ComposeChecked -Arguments @('ps', '-q', $Service) -FailureMessage "could not resolve Compose container for $Service."
  $ids = Get-SingleLineArray -Text $stdout
  if ($ids.Count -ne 1) { throw "REAL_RED: expected exactly one Compose container for $Service." }
  return [string]$ids[0]
}

function Get-BridgeRuntimeSample {
  param([Parameter(Mandatory = $true)][string]$service)
  $containerId = Get-ComposeContainerId -Service $service
  $stdout = Invoke-DockerChecked -Arguments @('inspect', '--format', '{{.State.Running}}|{{.State.ExitCode}}|{{.RestartCount}}|{{.Image}}', $containerId) -FailureMessage "could not inspect runtime state for $Service."
  $parts = $stdout.Trim().Split('|')
  if ($parts.Count -ne 4) { throw "REAL_RED: runtime state shape is invalid for $Service." }
  return [pscustomobject]@{
    Running = [string]$parts[0]
    ExitCode = [int]$parts[1]
    RestartCount = [int]$parts[2]
    ImageId = [string]$parts[3]
  }
}

function Assert-SynapseHealthy {
  [void](Invoke-ComposeChecked -Arguments @('up', '-d', 'synapse') -FailureMessage 'could not ensure existing Synapse runtime is started.')
  $containerId = Get-ComposeContainerId -Service 'synapse'
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    $stdout = Invoke-DockerChecked -Arguments @('inspect', '--format', '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}}{else}none{{end}}', $containerId) -FailureMessage 'could not inspect Synapse health.'
    $parts = $stdout.Trim().Split('|')
    if ($parts.Count -eq 2 -and $parts[0] -eq 'true' -and $parts[1] -eq 'healthy') {
      Write-Host 'SYNAPSE_HEALTH_GREEN'
      return
    }
    if ($parts.Count -eq 2 -and $parts[1] -eq 'unhealthy') { throw 'REAL_RED: Synapse is unhealthy.' }
    Start-Sleep -Seconds 2
  }
  throw 'REAL_RED: timed out waiting for existing Synapse health.'
}

function Assert-InitialBridgeRuntime {
  $restartBaseline = @{}
  Start-Sleep -Seconds 5
  foreach ($service in $targets) {
    $sample = Get-BridgeRuntimeSample -Service $service
    if ($sample.Running -ne 'true' -or $sample.ExitCode -ne 0) {
      throw "REAL_RED: upstream config/startup validation failed for $service."
    }
    if ($sample.RestartCount -ne 0) {
      throw "REAL_RED: RestartCount is nonzero immediately after forced recreation for $service."
    }
    if ($sample.ImageId -ne [string]$runtimeAuthority[$service].ImageId) {
      throw "REAL_RED: Compose runtime image no longer matches exact stage evidence for $service."
    }
    $restartBaseline[$service] = [int]$sample.RestartCount
  }
  Write-Host 'UPSTREAM_CONFIG_VALIDATION_GREEN'
  return $restartBaseline
}

function Assert-SustainedBridgeRuntime {
  param([Parameter(Mandatory = $true)][hashtable]$RestartBaseline)
  Start-Sleep -Seconds 15
  foreach ($service in $targets) {
    $sample = Get-BridgeRuntimeSample -Service $service
    if ($sample.Running -ne 'true' -or $sample.ExitCode -ne 0) {
      throw "REAL_RED: bridge runtime did not remain running for $service."
    }
    if ($sample.RestartCount -ne [int]$RestartBaseline[$service) {
      throw "REAL_RED: RestartCount changed during readiness window for $service."
    }
    if ($sample.ImageId -ne [string]$runtimeAuthority[$service].ImageId) {
      throw "REAL_RED: exact runtime image identity changed for $service."
    }
  }
  Write-Host 'SUSTAINED_RUNTIME_GREEN'
}

function Get-AppserviceEndpoint {
  param([Parameter(Mandatory = $true)][string]$service)
  $address = Get-YqScalar -Service $Service -FileName 'config.yaml' -Expression '.appservice.address'
  try { $uri = [Uri]$address } catch { throw "REAL_RED: appservice endpoint is invalid for $Service." }
  if (-not $uri.IsAbsoluteUri -or $uri.Host -ne $Service -or $uri.Port -le 0) {
    throw "REAL_RED: appservice endpoint is not Compose-authoritative for $Service."
  }
  return $uri
}

function Get-HomeserverEndpoint {
  param([Parameter(Mandatory = $true)][string]$Service)
  $address = Get-YqScalar -Service $Service -FileName 'config.yaml' -Expression '.homeserver.address'
  try { $uri = [Uri]$address } catch { throw "REAL_RED: homeserver endpoint is invalid for $Service." }
  if (-not $uri.IsAbsoluteUri -or $uri.Host -ne 'synapse' -or $uri.Port -le 0) {
    throw "REAL_RED: homeserver endpoint is not Compose-authoritative for $Service."
  }
  return $uri
}

function Assert-SynapseToBridgesConnectivity {
  foreach ($service in $targets) {
    $endpoint = Get-AppserviceEndpoint -Service $service
    $python = "import socket; s=socket.create_connection(('$($endpoint.Host)',$($endpoint.Port)),5); s.close()"
    [void](Invoke-ComposeChecked -Arguments @('exec', '-T', 'synapse', 'python', '-c', $python) -FailureMessage "Synapse could not connect to Compose bridge $service.")
  }
  Write-Host 'SYNAPSE_TO_BRIDGES_GREEN'
}

function Assert-BridgesToSynapseConnectivity {
  foreach ($service in $targets) {
    $endpoint = Get-HomeserverEndpoint -Service $service
    $versionsUrl = "$($endpoint.Scheme)://$($endpoint.Host):$($endpoint.Port)/_matrix/client/versions"
    [void](Invoke-ComposeChecked -Arguments @('exec', '-T', $service, 'curl', '--fail', '--silent', '--show-error', '--max-time', '5', '-o', '/dev/null', $versionsUrl) -FailureMessage "$service could not connect to Compose Synapse endpoint.")
  }
  Write-Host 'BRIDGES_TO_SYNAPSE_GREEN'
}

function Assert-LoginFlowAuthority {
  if (-not (Test-Path -LiteralPath $loginAuthorityPath -PathType Leaf)) {
    $repoFallback = Join-Path (Split-Path -Parent (Split-Path -Parent $toolRoot)) 'tests/multibridge-lab/fixtures/runtime-login-flow-authorities.json'
    if (Test-Path -LiteralPath $repoFallback -PathType Leaf) { $script:loginAuthorityPath = $repoFallback }
  }
  if (-not (Test-Path -LiteralPath $loginAuthorityPath -PathType Leaf)) {
    throw 'REAL_RED: frozen login-flow authority is missing.'
  }
  $document = Get-Content -Raw -LiteralPath $loginAuthorityPath | ConvertFrom-Json
  if ([int]$document.schemaVersion -ne 1) { throw 'REAL_RED: login-flow authority schema is invalid.' }
  $actualServices = @($document.authorities | ForEach-Object { [string]$_.service })
  if (($actualServices -join '|') -ne ($targets -join '|')) { throw 'REAL_RED: login-flow authority service set is invalid.' }
  foreach ($authority in $document.authorities) {
    if ([string]$authority.flowEvidence -ne 'GetLoginFlows') { throw 'REAL_RED: login-flow evidence type is invalid.' }
    if ([string]$authority.commit -notmatch '^[0-9a-f]{40}$' -or [string]$authority.blob -notmatch '^[0-9a-f]{40}$') {
      throw 'REAL_RED: login-flow source identity is invalid.'
    }
  }
  Write-Host 'hLOGIN_FLOW_AUTHORITY_GREEN'
}

try {
  if (-not (Test-Path -LiteralPath $LabRoot -PathType Container)) { throw 'REAL_RED: existing Windows Lab root is missing.' }
  $resolvedLabRoot = (Resolve-Path -LiteralPath $LabRoot).Path
  $composePath = Join-Path $resolvedLabRoot $composeRelative
  $profilesPath = Join-Path $resolvedLabRoot $profilesRelative
  if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) { throw 'REAL_RED: runtime/docker-compose.lab.yml is missing.' }
  if (-not (Test-Path -LiteralPath $profilesPath -PathType Leaf)) { throw 'REAL_RED: runtime/upstream-builds.json is missing.' }

  $dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $dockerCommand) { $dockerCommand = Get-Command docker -ErrorAction Stop | Select-Object -First 1 }
  $dockerExe = [string]$dockerCommand.Source
  if (-not $dockerExe) { $dockerExe = [string]$dockerCommand.Path }
  if (-not $dockerExe) { throw 'REAL_RED: Docker CLI is unavailable.' }

  $profilesDocument = Get-Content -Raw -LiteralPath $profilesPath | ConvertFrom-Json

  $serviceOutput = Invoke-ComposeChecked -Arguments @('config', '--services') -FailureMessage 'Docker Compose authority could not enumerate services.'
  $composeServices = Get-SingleLineArray -Text $serviceOutput
  foreach ($required in $expectedComposeServices) {
    if ($composeServices -notcontains $required) { throw "REAL_RED: Compose service authority is missing $required." }
  }
  Write-Host 'COMPOSE_AUTHORITY_GREEN'

  foreach ($service in $targets) {
    $profile = Get-Profile -Service $service
    $stageEvidencePath = Join-Path (Join-Path $resolvedLabRoot $evidenceRelative) "runtime-stage-$service.json"
    $configPath = Get-ServiceConfigPath -Service $service
    if (-not (Test-Path -LiteralPath $stageEvidencePath -PathType Leaf)) { throw "REAL_RED: exact stage evidence is missing for $service." }
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "REAL_RED: existing R12 config is missing for $service." }
    $stageEvidence = Get-Content -Raw -LiteralPath $stageEvidencePath | ConvertFrom-Json
    if ([string]$stageEvidence.sourceHead -ne [string]$profile.commit) { throw "REAL_RED: source identity mismatch for $service." }
    if ([string]$stageEvidence.imageTag -ne [string]$profile.imageTag) { throw "REAL_RED: image tag mismatch for $service." }
    if ([string]$stageEvidence.runtimePackagingSmoke -ne 'green' -or [string]$stageEvidence.runtimeExecutableLoadSmoke -ne 'green') {
      throw "REAL_RED: stage smoke authority is not GREEN for $service."
    }
    $localImageId = (Invoke-DockerChecked -Arguments @('image', 'inspect', '--format', '{{.Id}}', [string]$profile.imageTag) -FailureMessage "exact staged image is unavailable for $service.").Trim()
    if (-not $localImageId -or $localImageId -ne [string]$stageEvidence.imageId) { throw "REAL_RED: local staged image identity mismatch for $service." }
    $yqPath = Get-YqPathForImage -Image ([string]$profile.imageTag)
    $runtimeAuthority[$service] = [pscustomobject]@{
      ImageTag = [string]$profile.imageTag
      ImageId = [string]$stageEvidence.imageId
      YqPath = [string]$yqPath
    }
  }
  Write-Host 'EXACT_STAGE_AUTHORITY_GREEN'

  [void](Invoke-ComposeChecked -Arguments (@('stop') + $targets) -FailureMessage 'could not stop the exact five bridge services before DB&Wó"‚rê¢f˜&V6ÇÇG6W'fñ6Rñ‚GF&vWG2í≤&Wó"’6W'fñ6TFF&6T6ˆÊfñr’6W'fñ6RG6W'fñ6R–¢w&óFR‘Ü˜7Bu#%ÙDD$4Uı$Uï%Ùu$TT‚p†¢76W'B’7ñÊ6TÜV«Fáê¢∑fˆñE“ÑñÁfˆ∂R‘6ˆ◊˜6T6ÜV6∂VB‘&wV÷VÁG2ÑÇwWr¬r÷Br¬r“÷f˜&6R◊&V7&VFRrí≤GF&vWG2í‘fñ«W&T÷W76vRv6˜V∆BÊ˜B7F'BFÜRWÜ7BfófR&Wó&VB'&ñFvR6W'fñ6W2‚rê†¢G&W7F'D&6V∆ñÊR“76W'B‘ñÊóFñƒ'&ñFvU'VÁFñ÷P¢76W'B’7W7FñÊVD'&ñFvU'VÁFñ÷R’&W7F'D&6V∆ñÊRG&W7F'D&6V∆ñÊP¢76W'B’7ñÊ6UFÙ'&ñFvW46ˆÊÊV7FófóGê¢76W'B‘'&ñFvW5Fı7ñÊ6T6ˆÊÊV7FófóGê¢76W'B‘∆ˆvñ‰f∆˜tWFÜ˜&óGê†¢w&óFR‘Ü˜7Btƒ%ı%TÂDî‘Uı$TEíp¢w&óFR‘Ü˜7Bt∆¬Êˆ‚÷áV÷‚'VÁFñ÷RvFW2&Ru$TT‚‚&V¬66˜VÁB6ˆˆ∂ñW2¬"66Á2¬ÜˆÊRó&ñÊr¬7&VFVÁFñ«2¬$dÊBFWfñ6R∆ñÊ∂ñÊr&RñÁFVÁFñˆÊ∆«íÊ˜B7F'FVB'íFÜó26∂vR‚p¢w&óFR’FW&÷ñÊ≈7FGW2’7FGW2tÖT‘ÂÙUDÖı$UTï$TBp¢WÜóB ß–¶6F6Ç∞¢F÷W76vR“∑7G&ñÊu“EÚ‰WÜ6WFñˆ‚‰÷W76vP¢ñbÇ÷Ê˜BF÷W76vRÂ7F'G5vóFÇÇu$T≈ı$TC¢ríí≤F÷W76vR“u$T≈ı$TC¢'VÁFñ÷R&VFñÊW72vFRfñ∆VB‚r–¢w&óFR‘Ü˜7BF÷W76vP¢w&óFR’FW&÷ñÊ≈7FGW2’7FGW2u$T≈ı$TBp¢WÜóBß–†