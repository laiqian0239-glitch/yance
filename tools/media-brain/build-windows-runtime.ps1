param(
  [string]$ImmichEndpoint = $(if ($env:YANCE_IMMICH_ENDPOINT) { $env:YANCE_IMMICH_ENDPOINT } else { 'http://127.0.0.1:2283' }),
  [string]$ComfyUIEndpoint = $(if ($env:YANCE_COMFYUI_ENDPOINT) { $env:YANCE_COMFYUI_ENDPOINT } else { 'http://127.0.0.1:8188' }),
  [string]$ImmichApiKey = $env:YANCE_IMMICH_API_KEY,
  [switch]$AllowExternalEndpoint
)

$ErrorActionPreference = 'Stop'

function Test-YanceLoopbackEndpoint([string]$Endpoint) {
  $uri = [Uri]$Endpoint
  return $uri.Host -in @('127.0.0.1', 'localhost', '::1')
}

function Assert-YanceEndpoint([string]$Name, [string]$Endpoint) {
  if ([string]::IsNullOrWhiteSpace($Endpoint)) { throw "$Name endpoint is required" }
  $uri = [Uri]$Endpoint
  if ($uri.Scheme -notin @('http', 'https')) { throw "$Name endpoint must use HTTP(S)" }
  $isLoopback = Test-YanceLoopbackEndpoint $Endpoint
  if (-not $isLoopback -and -not $AllowExternalEndpoint) {
    throw "$Name external endpoint requires explicit -AllowExternalEndpoint configuration"
  }
  if ($Name -eq 'Immich' -and -not $isLoopback -and $uri.Scheme -ne 'https') {
    throw 'Immich external endpoint must use HTTPS because it carries an API key.'
  }
}

Write-Host 'Yance Media Brain Windows preflight'
Write-Host 'ComfyUI: official Windows portable or user-managed endpoint; Yance does not install models.'
Write-Host 'Immich: user-managed/self-hosted service; Yance does not create an Immich database or Docker stack.'

Assert-YanceEndpoint 'Immich' $ImmichEndpoint
Assert-YanceEndpoint 'ComfyUI' $ComfyUIEndpoint

$immichHeaders = @{}
if (-not [string]::IsNullOrWhiteSpace($ImmichApiKey)) { $immichHeaders['x-api-key'] = $ImmichApiKey }
try {
  $immich = Invoke-WebRequest -UseBasicParsing -Uri "$($ImmichEndpoint.TrimEnd('/'))/api/server/ping" -Headers $immichHeaders -TimeoutSec 10 -MaximumRedirection 0
  if ($immich.StatusCode -lt 200 -or $immich.StatusCode -ge 300) { throw "Immich health returned HTTP $($immich.StatusCode)" }
  Write-Host 'Immich health: ready'
} catch {
  throw "Immich preflight failed: $($_.Exception.Message)"
}

try {
  $comfy = Invoke-WebRequest -UseBasicParsing -Uri "$($ComfyUIEndpoint.TrimEnd('/'))/object_info" -TimeoutSec 15
  if ($comfy.StatusCode -lt 200 -or $comfy.StatusCode -ge 300) { throw "ComfyUI health returned HTTP $($comfy.StatusCode)" }
  $models = Invoke-RestMethod -Uri "$($ComfyUIEndpoint.TrimEnd('/'))/models/checkpoints" -TimeoutSec 15
  $modelCount = @($models).Count
  if ($modelCount -eq 0) { Write-Warning 'ComfyUI is reachable but missing model checkpoints; Media Brain will report degraded.' }
  Write-Host "ComfyUI health: ready; checkpoints=$modelCount"
} catch {
  throw "ComfyUI preflight failed: $($_.Exception.Message)"
}

Write-Host 'Media Brain preflight complete. No runtime or model was installed by Yance.'
