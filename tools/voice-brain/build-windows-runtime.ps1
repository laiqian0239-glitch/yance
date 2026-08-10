[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][string]$SupplyRoot,
  [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$WorkRoot = (Join-Path ([IO.Path]::GetTempPath()) ('yance-voice-seal-' + [Guid]::NewGuid().ToString('N')))
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$CosyVoiceCommit = '074ca6dc9e80a2f424f1f74b48bdd7d3fea531cc'
$CosyVoiceModelRevision = '29e01c4e8d000f4bcd70751be16fa94bf3d85a18'
$UvVersion = '0.12.3'
$UvCommit = '507230998c9541d67814b57463ac00e454ff6991'
$UvAsset = 'uv-x86_64-pc-windows-msvc.zip'
$UvAssetSize = 19013455
$UvAssetSha256 = 'b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e'
$PythonBuildStandaloneRelease = '20260807'
$PythonBuildStandaloneCommit = '00c8a06113f11220667c3bcf5fab1672ff9e78ef'
$PythonAsset = 'cpython-3.10.20+20260807-x86_64-pc-windows-msvc-install_only_stripped.tar.gz'
$PythonAssetSize = 22272036
$PythonAssetSha256 = '53391d9e6401c8f91b97aab6daf49200bce0b6eb41dcc1615031e65e9db8bd63'
$CpythonVersion = '3.10.20'
$SenseVoiceRelease = 'runtime-llamacpp-v0.1.9'
$SenseVoiceCommit = '73ccdd3577db37e92dbf22a4a9fc323b038cf13b'
$SenseVoiceAsset = 'funasr-llamacpp-windows-x64-avx2.zip'
$SenseVoiceAssetSize = 4917274
$SenseVoiceAssetSha256 = 'f2a1389658e6fb5f5f93c7bad98b5ce100eb4811e0e3c39603e39466773b1b4c'
$SenseVoiceModelRevision = '90c1c61912018b70ada0fcc024ea24aca62f2e63'
$SenseVoiceModelAsset = 'sense-voice-small-q8_0.gguf'
$SenseVoiceModelSize = 254208320
$SenseVoiceModelSha256 = '4ae45c94422de949b387e2e0fb10d7e14e4c42c69db30c3444ecc7d4b844b7c5'

function Assert-Sha256([string]$Path, [string]$Expected, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { throw "$Label SHA256 mismatch: expected=$Expected actual=$actual" }
}
function Assert-Size([string]$Path, [long]$Expected, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
  $actual = (Get-Item -LiteralPath $Path).Length
  if ($actual -ne $Expected) { throw "$Label size mismatch: expected=$Expected actual=$actual" }
}
function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit $LASTEXITCODE" }
}
function Assert-GitRevision([string]$Repository, [string]$Expected, [string]$Label) {
  if (-not (Test-Path -LiteralPath (Join-Path $Repository '.git'))) { throw "$Label must be a Git checkout with provenance: $Repository" }
  $actual = (& git.exe -C $Repository rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $actual -ne $Expected) { throw "$Label revision mismatch: expected=$Expected actual=$actual" }
  Invoke-Checked 'git.exe' @('-C', $Repository, 'diff', '--exit-code') "$Label worktree verification"
  Invoke-Checked 'git.exe' @('-C', $Repository, 'diff', '--cached', '--exit-code') "$Label index verification"
}
function Relative-Path([string]$Root, [string]$Path) {
  $rootFull = [IO.Path]::GetFullPath($Root)
  $separator = [IO.Path]::DirectorySeparatorChar.ToString()
  if (-not $rootFull.EndsWith($separator)) { $rootFull += $separator }
  $rootUri = New-Object System.Uri($rootFull)
  $pathUri = New-Object System.Uri([IO.Path]::GetFullPath($Path))
  return [Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace('\', '/')
}

$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$SupplyRoot = [IO.Path]::GetFullPath($SupplyRoot)
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
if (-not (Test-Path -LiteralPath $SupplyRoot -PathType Container)) { throw "SupplyRoot is missing: $SupplyRoot" }
if (Test-Path -LiteralPath $OutputRoot) {
  if ((Get-ChildItem -LiteralPath $OutputRoot -Force | Measure-Object).Count -gt 0) { throw "OutputRoot must be empty: $OutputRoot" }
} else { New-Item -ItemType Directory -Path $OutputRoot | Out-Null }
if (Test-Path -LiteralPath $WorkRoot) { throw "WorkRoot must not already exist: $WorkRoot" }
New-Item -ItemType Directory -Path $WorkRoot | Out-Null

$UvZip = Join-Path $SupplyRoot $UvAsset
$PythonTar = Join-Path $SupplyRoot $PythonAsset
$SenseVoiceZip = Join-Path $SupplyRoot $SenseVoiceAsset
$SenseVoiceModel = Join-Path $SupplyRoot $SenseVoiceModelAsset
$CosyVoiceSource = Join-Path $SupplyRoot 'cosyvoice-source'
$CosyVoiceModel = Join-Path $SupplyRoot 'cosyvoice-model'
$UvCache = Join-Path $SupplyRoot 'uv-cache'

Assert-Size $UvZip $UvAssetSize 'uv Windows x64 asset'
Assert-Sha256 $UvZip $UvAssetSha256 'uv Windows x64 asset'
Assert-Size $PythonTar $PythonAssetSize 'python-build-standalone CPython asset'
Assert-Sha256 $PythonTar $PythonAssetSha256 'python-build-standalone CPython asset'
Assert-Size $SenseVoiceZip $SenseVoiceAssetSize 'SenseVoice Windows x64 AVX2 asset'
Assert-Sha256 $SenseVoiceZip $SenseVoiceAssetSha256 'SenseVoice Windows x64 AVX2 asset'
Assert-Size $SenseVoiceModel $SenseVoiceModelSize 'SenseVoice q8 model'
Assert-Sha256 $SenseVoiceModel $SenseVoiceModelSha256 'SenseVoice q8 model'
Assert-GitRevision $CosyVoiceSource $CosyVoiceCommit 'CosyVoice source'
Assert-GitRevision $CosyVoiceModel $CosyVoiceModelRevision 'CosyVoice3 model'
if (-not (Test-Path -LiteralPath $UvCache -PathType Container)) { throw "sealed uv cache is missing: $UvCache" }

$submoduleStatus = @(& git.exe -C $CosyVoiceSource submodule status --recursive)
if ($LASTEXITCODE -ne 0 -or @($submoduleStatus | Where-Object { $_ -match '^[\-+U]' }).Count -gt 0) { throw 'CosyVoice submodules are missing or do not match the pinned source commit' }
Invoke-Checked 'git.exe' @('-C', $CosyVoiceModel, 'lfs', 'fsck') 'CosyVoice3 Git LFS integrity verification'

$CosyRoot = Join-Path $OutputRoot 'cosyvoice'
$SenseRoot = Join-Path $OutputRoot 'sensevoice'
$ToolRoot = Join-Path $WorkRoot 'tools'
$SenseExtract = Join-Path $WorkRoot 'sensevoice-extract'
$PythonRoot = Join-Path $CosyRoot 'python'
$ProjectRoot = Join-Path $WorkRoot 'cosyvoice-project'
New-Item -ItemType Directory -Path $CosyRoot, $SenseRoot, $ToolRoot, $SenseExtract, $ProjectRoot | Out-Null

Expand-Archive -LiteralPath $UvZip -DestinationPath $ToolRoot
$UvExe = (Get-ChildItem -LiteralPath $ToolRoot -Filter 'uv.exe' -File -Recurse | Select-Object -First 1).FullName
if (-not $UvExe) { throw 'uv.exe was not found in the verified asset' }

Invoke-Checked 'tar.exe' @('-xf', $PythonTar, '-C', $CosyRoot) 'extract verified CPython asset'
$PythonExe = Join-Path $PythonRoot 'python.exe'
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "standalone python.exe missing after extraction: $PythonExe" }
$PythonVersion = (& $PythonExe -I -c 'import platform; print(platform.python_version())').Trim()
if ($PythonVersion -ne $CpythonVersion) { throw "CPython version mismatch: expected=$CpythonVersion actual=$PythonVersion" }

Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\voice-brain\cosyvoice\pyproject.toml') -Destination $ProjectRoot
Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\voice-brain\cosyvoice\uv.lock') -Destination $ProjectRoot
$LockPath = Join-Path $ProjectRoot 'uv.lock'
$LockSha256 = (Get-FileHash -LiteralPath $LockPath -Algorithm SHA256).Hash.ToLowerInvariant()

$RequirementsPath = Join-Path $WorkRoot 'cosyvoice-locked-requirements.txt'
$OldUvCacheDir = $env:UV_CACHE_DIR
try {
  $env:UV_CACHE_DIR = $UvCache
  Invoke-Checked $UvExe @('export', '--project', $ProjectRoot, '--frozen', '--offline', '--no-dev', '--format', 'requirements-txt', '--output-file', $RequirementsPath) 'export exact CosyVoice uv.lock closure'
  Push-Location $ProjectRoot
  try {
    Invoke-Checked $UvExe @('pip', 'sync', '--python', $PythonExe, '--offline', '--require-hashes', $RequirementsPath) 'materialize exact CosyVoice closure into sealed CPython'
  } finally {
    Pop-Location
  }
} finally {
  if ($null -eq $OldUvCacheDir) { Remove-Item Env:UV_CACHE_DIR -ErrorAction SilentlyContinue } else { $env:UV_CACHE_DIR = $OldUvCacheDir }
}
$WhisperVersion = (& $PythonExe -I -c 'import importlib.metadata; print(importlib.metadata.version("openai-whisper"))').Trim()
if ($WhisperVersion -ne '20231117') { throw "openai-whisper closure mismatch: expected=20231117 actual=$WhisperVersion" }

$SourceDestination = Join-Path $CosyRoot 'source'
$ModelDestination = Join-Path $CosyRoot 'models\Fun-CosyVoice3-0.5B-2512'
Copy-Item -LiteralPath $CosyVoiceSource -Destination $SourceDestination -Recurse
Copy-Item -LiteralPath $CosyVoiceModel -Destination $ModelDestination -Recurse
Remove-Item -LiteralPath (Join-Path $SourceDestination '.git') -Recurse -Force
Remove-Item -LiteralPath (Join-Path $ModelDestination '.git') -Recurse -Force

Expand-Archive -LiteralPath $SenseVoiceZip -DestinationPath $SenseExtract
$SenseVoiceExe = (Get-ChildItem -LiteralPath $SenseExtract -Filter 'llama-funasr-sensevoice.exe' -File -Recurse | Select-Object -First 1).FullName
if (-not $SenseVoiceExe) { throw 'verified SenseVoice archive does not contain llama-funasr-sensevoice.exe' }
$SenseBin = Join-Path $SenseRoot 'bin'
$SenseModels = Join-Path $SenseRoot 'models'
New-Item -ItemType Directory -Path $SenseBin, $SenseModels | Out-Null
Copy-Item -LiteralPath $SenseVoiceExe -Destination (Join-Path $SenseBin 'llama-funasr-sensevoice.exe')
Copy-Item -LiteralPath $SenseVoiceModel -Destination (Join-Path $SenseModels $SenseVoiceModelAsset)

Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\voice-brain\cosyvoice\yance_cosyvoice_entrypoint.py') -Destination $CosyRoot
Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\voice-brain\cosyvoice\generate_runtime_sbom.py') -Destination $CosyRoot
$LicenseRoot = Join-Path $OutputRoot 'licenses'
New-Item -ItemType Directory -Path $LicenseRoot | Out-Null
foreach ($license in @(
  'third_party\licenses\cosyvoice-Apache-2.0.txt',
  'third_party\licenses\cosyvoice3-model-Apache-2.0.txt',
  'third_party\licenses\funasr-model-license.txt',
  'third_party\licenses\onnxruntime-MIT.txt',
  'third_party\licenses\pytorch-BSD-3-Clause.txt',
  'third_party\licenses\sensevoice-MIT.txt',
  'third_party\licenses\uv-Apache-2.0.txt',
  'third_party\licenses\uv-MIT.txt',
  'third_party\licenses\python-build-standalone-MPL-2.0.txt',
  'third_party\licenses\cpython-PSF-2.0.txt'
)) { Copy-Item -LiteralPath (Join-Path $SourceRoot $license) -Destination $LicenseRoot }

$CosyVoiceImportProbe = 'import sys; source=sys.argv[1]; sys.path[:0]=[source, source + r"\third_party\Matcha-TTS"]; from cosyvoice.cli.cosyvoice import AutoModel; print("CosyVoice import ok")'
Invoke-Checked $PythonExe @('-I', '-c', $CosyVoiceImportProbe, $SourceDestination) 'CosyVoice sealed import self-test'
Invoke-Checked $PythonExe @('-I', (Join-Path $CosyRoot 'generate_runtime_sbom.py'), '--output', (Join-Path $CosyRoot 'runtime-sbom.cdx.json'), '--lock-sha256', $LockSha256) 'Voice runtime SBOM generation'
Remove-Item -LiteralPath (Join-Path $CosyRoot 'generate_runtime_sbom.py') -Force

Get-ChildItem -LiteralPath $OutputRoot -Directory -Recurse -Force | Where-Object { $_.Name -in @('__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache') } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force
$records = @()
Get-ChildItem -LiteralPath $OutputRoot -File -Recurse -Force | Where-Object { $_.Name -ne 'runtime-seal.json' } | ForEach-Object {
  $records += [ordered]@{ path = (Relative-Path $OutputRoot $_.FullName); sizeBytes = [int64]$_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$records = @($records | Sort-Object path)
$SealInput = Join-Path $WorkRoot 'runtime-tree.sha256-input.txt'
$canonicalLines = @($records | ForEach-Object { '{0}|{1}|{2}' -f $_.path, $_.sizeBytes, $_.sha256 })
[IO.File]::WriteAllText($SealInput, (($canonicalLines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
$TreeSha = (Get-FileHash -LiteralPath $SealInput -Algorithm SHA256).Hash.ToLowerInvariant()
$seal = [ordered]@{
  schemaVersion = 1
  documentType = 'YANCE_VOICE_BRAIN_WINDOWS_RUNTIME_SEAL'
  senseVoice = [ordered]@{ release = $SenseVoiceRelease; commit = $SenseVoiceCommit; asset = $SenseVoiceAsset; assetSha256 = $SenseVoiceAssetSha256; modelRevision = $SenseVoiceModelRevision; modelAsset = $SenseVoiceModelAsset; modelSha256 = $SenseVoiceModelSha256 }
  cosyVoice = [ordered]@{ commit = $CosyVoiceCommit; modelRevision = $CosyVoiceModelRevision; uvLockSha256 = $LockSha256; openAiWhisperUse = 'upstream prompt-audio mel feature extraction only' }
  uvBuildTool = [ordered]@{ version = $UvVersion; commit = $UvCommit; asset = $UvAsset; assetSha256 = $UvAssetSha256; mode = '--frozen --offline' }
  pythonBuildStandalone = [ordered]@{ release = $PythonBuildStandaloneRelease; commit = $PythonBuildStandaloneCommit; asset = $PythonAsset; assetSha256 = $PythonAssetSha256; cpythonVersion = $CpythonVersion }
  runtime = [ordered]@{ fileCount = $records.Count; treeSha256 = $TreeSha; dependencyResolution = 'build-time-only'; networkResolutionAtRuntime = $false }
}
[IO.File]::WriteAllText((Join-Path $OutputRoot 'runtime-seal.json'), (($seal | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host "Voice Brain sealed Windows runtime ready: $OutputRoot"
Write-Host "Runtime tree SHA-256: $TreeSha"
