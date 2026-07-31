[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$DataRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-JsonFile {
  param([string]$Path, [hashtable]$Value)
  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  $Value | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Download-File {
  param([string]$Uri, [string]$Destination)
  $partial = "$Destination.part"
  Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $partial -Headers @{ 'User-Agent' = 'Yance-Local-Speech-Installer' }
  if (-not (Test-Path -LiteralPath $partial) -or (Get-Item -LiteralPath $partial).Length -lt 1024) {
    throw "Downloaded file is missing or too small: $Uri"
  }
  Move-Item -LiteralPath $partial -Destination $Destination -Force
}

$root = [IO.Path]::GetFullPath($DataRoot)
$target = Join-Path $root 'models\whisper'
$statusPath = Join-Path $target 'install-status.json'
$temp = Join-Path ([IO.Path]::GetTempPath()) ("yance-whisper-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $target -Force | Out-Null
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$startedAt = [DateTime]::UtcNow.ToString('o')
Write-JsonFile -Path $statusPath -Value @{ status = 'running'; startedAt = $startedAt; step = 'prepare' }

try {
  $release = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest' -Headers @{ 'User-Agent' = 'Yance-Local-Speech-Installer' }
  $asset = @($release.assets) | Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1
  if (-not $asset) { throw 'whisper.cpp x64 release asset was not found.' }

  $whisperZip = Join-Path $temp 'whisper-bin-x64.zip'
  Write-JsonFile -Path $statusPath -Value @{ status = 'running'; startedAt = $startedAt; step = 'download-whisper'; release = $release.tag_name }
  Download-File -Uri $asset.browser_download_url -Destination $whisperZip
  $extract = Join-Path $temp 'whisper'
  Expand-Archive -LiteralPath $whisperZip -DestinationPath $extract -Force
  $engine = Get-ChildItem -LiteralPath $extract -Recurse -File | Where-Object { $_.Name -in @('whisper-cli.exe','main.exe') } | Select-Object -First 1
  if (-not $engine) { throw 'whisper.cpp executable was not found in the release archive.' }
  Copy-Item -LiteralPath $engine.FullName -Destination (Join-Path $target $engine.Name) -Force
  Get-ChildItem -LiteralPath $engine.DirectoryName -File -Filter '*.dll' -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $target $_.Name) -Force
  }

  $model = Join-Path $target 'ggml-base.bin'
  if (-not (Test-Path -LiteralPath $model) -or (Get-Item -LiteralPath $model).Length -lt 1000000) {
    Write-JsonFile -Path $statusPath -Value @{ status = 'running'; startedAt = $startedAt; step = 'download-model'; release = $release.tag_name }
    Download-File -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin' -Destination $model
  }

  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
  if (-not $ffmpeg -and (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    Write-JsonFile -Path $statusPath -Value @{ status = 'running'; startedAt = $startedAt; step = 'install-ffmpeg'; release = $release.tag_name }
    & winget.exe install --id Gyan.FFmpeg.Essentials --exact --silent --accept-package-agreements --accept-source-agreements | Out-Null
    $ffmpeg = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Recurse -File -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1
  }
  if ($ffmpeg) { Copy-Item -LiteralPath $ffmpeg -Destination (Join-Path $target 'ffmpeg.exe') -Force }

  $enginePath = @('whisper-cli.exe','main.exe') | ForEach-Object { Join-Path $target $_ } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  $ffmpegPath = Join-Path $target 'ffmpeg.exe'
  if (-not $enginePath -or -not (Test-Path -LiteralPath $model)) { throw 'Whisper engine or model validation failed.' }
  Write-JsonFile -Path $statusPath -Value @{
    status = 'ready'; startedAt = $startedAt; completedAt = [DateTime]::UtcNow.ToString('o');
    engine = $enginePath; model = $model; ffmpeg = $(if (Test-Path -LiteralPath $ffmpegPath) { $ffmpegPath } else { '' }); release = $release.tag_name
  }
  exit 0
} catch {
  Write-JsonFile -Path $statusPath -Value @{ status = 'failed'; startedAt = $startedAt; failedAt = [DateTime]::UtcNow.ToString('o'); message = $_.Exception.Message }
  Write-Error $_
  exit 1
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
