[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$WorkRoot = (Join-Path ([IO.Path]::GetTempPath()) ('yance-parlant-seal-' + [Guid]::NewGuid().ToString('N')))
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ParlantVersion = 'v3.3.2'
$ParlantCommit = '61bba3b2b3fffd677d345e393e8c942dbd400297'
$ParlantUvLockBlob = 'aa2f7de8e858f19296df58efec56d72c8d3f50a5'
$UvVersion = '0.12.3'
$UvCommit = '507230998c9541d67814b57463ac00e454ff6991'
$UvAsset = 'uv-x86_64-pc-windows-msvc.zip'
$UvAssetSize = 19013455
$UvAssetSha256 = 'b23350c79e8ad0192b8124af13a0f17e8d4e4549524785e1aef389ae5a06990e'
$PythonBuildStandaloneRelease = '20260807'
$PythonBuildStandaloneCommit = '00c8a06113f11220667c3bcf5fab1672ff9e78ef'
$PythonAsset = 'cpython-3.12.13+20260807-x86_64-pc-windows-msvc-install_only_stripped.tar.gz'
$PythonAssetSize = 21962247
$PythonAssetSha256 = '18bcc65b17921806b72cdc88bcf000bf67a2c99a8fc381fe1629f2b9ba56858d'
$CpythonVersion = '3.12.13'
$TiktokenVersion = '0.12.0'
$TiktokenCommit = '97e49cbadd500b5cc9dbb51a486f0b42e6701bee'
$TiktokenEncodingName = 'o200k_base'
$TiktokenEncodingUrl = 'https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken'
$TiktokenEncodingSha256 = '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d'
$TiktokenCacheKey = 'fb374d419588a4632f3f557e76b4b70aebbca790'

function Assert-Sha256([string]$Path, [string]$Expected, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { throw "$Label SHA256 mismatch: expected=$Expected actual=$actual" }
}
function Assert-Size([string]$Path, [long]$Expected, [string]$Label) {
  $actual = (Get-Item -LiteralPath $Path).Length
  if ($actual -ne $Expected) { throw "$Label size mismatch: expected=$Expected actual=$actual" }
}
function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$Label) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit $LASTEXITCODE" }
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
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
if (Test-Path -LiteralPath $OutputRoot) {
  if ((Get-ChildItem -LiteralPath $OutputRoot -Force | Measure-Object).Count -gt 0) { throw "OutputRoot must be empty: $OutputRoot" }
} else { New-Item -ItemType Directory -Path $OutputRoot | Out-Null }
if (Test-Path -LiteralPath $WorkRoot) { throw "WorkRoot must not already exist: $WorkRoot" }
New-Item -ItemType Directory -Path $WorkRoot | Out-Null

$DownloadRoot = Join-Path $WorkRoot 'downloads'
$ToolRoot = Join-Path $WorkRoot 'tools'
$ParlantRepo = Join-Path $WorkRoot 'parlant-src'
$PythonRoot = Join-Path $OutputRoot 'python'
$VenvRoot = Join-Path $OutputRoot 'venv'
$LicenseRoot = Join-Path $OutputRoot 'licenses'
$TiktokenCacheRoot = Join-Path $OutputRoot 'tiktoken-cache'
New-Item -ItemType Directory -Path $DownloadRoot, $ToolRoot, $LicenseRoot | Out-Null

$UvZip = Join-Path $DownloadRoot $UvAsset
$UvUrl = "https://github.com/astral-sh/uv/releases/download/$UvVersion/$UvAsset"
Invoke-WebRequest -UseBasicParsing -Uri $UvUrl -OutFile $UvZip
Assert-Size $UvZip $UvAssetSize 'uv Windows x64 asset'
Assert-Sha256 $UvZip $UvAssetSha256 'uv Windows x64 asset'
Expand-Archive -LiteralPath $UvZip -DestinationPath $ToolRoot
$UvExe = (Get-ChildItem -LiteralPath $ToolRoot -Filter 'uv.exe' -Recurse | Select-Object -First 1).FullName
if (-not $UvExe) { throw 'uv.exe was not found in the verified asset' }

$PythonTar = Join-Path $DownloadRoot $PythonAsset
$PythonUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/$PythonBuildStandaloneRelease/$($PythonAsset.Replace('+','%2B'))"
Invoke-WebRequest -UseBasicParsing -Uri $PythonUrl -OutFile $PythonTar
Assert-Size $PythonTar $PythonAssetSize 'python-build-standalone CPython asset'
Assert-Sha256 $PythonTar $PythonAssetSha256 'python-build-standalone CPython asset'
New-Item -ItemType Directory -Path $PythonRoot | Out-Null
Invoke-Checked 'tar.exe' @('-xf', $PythonTar, '-C', $OutputRoot) 'extract verified CPython asset'
$PythonExe = Join-Path $PythonRoot 'python.exe'
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "standalone python.exe missing after extraction: $PythonExe" }
$PythonVersion = (& $PythonExe -I -c 'import platform; print(platform.python_version())').Trim()
if ($PythonVersion -ne $CpythonVersion) { throw "CPython version mismatch: expected=$CpythonVersion actual=$PythonVersion" }

Invoke-Checked 'git.exe' @('init', $ParlantRepo) 'initialize Parlant source checkout'
Invoke-Checked 'git.exe' @('-C', $ParlantRepo, 'remote', 'add', 'origin', 'https://github.com/emcie-co/parlant.git') 'configure Parlant upstream'
Invoke-Checked 'git.exe' @('-C', $ParlantRepo, 'fetch', '--depth=1', 'origin', 'refs/tags/v3.3.2') 'fetch exact Parlant tag'
Invoke-Checked 'git.exe' @('-C', $ParlantRepo, 'checkout', '--detach', 'FETCH_HEAD') 'checkout exact Parlant tag'
$ActualParlantCommit = (& git.exe -C $ParlantRepo rev-parse HEAD).Trim()
if ($ActualParlantCommit -ne $ParlantCommit) { throw "Parlant commit mismatch: expected=$ParlantCommit actual=$ActualParlantCommit" }
$LockPath = Join-Path $ParlantRepo 'uv.lock'
$ActualLockBlob = (& git.exe -C $ParlantRepo hash-object $LockPath).Trim()
if ($ActualLockBlob -ne $ParlantUvLockBlob) { throw "Parlant uv.lock Git blob mismatch: expected=$ParlantUvLockBlob actual=$ActualLockBlob" }

$OldUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
try {
  $env:UV_PROJECT_ENVIRONMENT = $VenvRoot
  Invoke-Checked $UvExe @('sync', '--project', $ParlantRepo, '--frozen', '--no-dev', '--no-editable', '--python', $PythonExe) 'materialize Parlant runtime from official uv.lock'
} finally {
  if ($null -eq $OldUvProjectEnvironment) { Remove-Item Env:UV_PROJECT_ENVIRONMENT -ErrorAction SilentlyContinue } else { $env:UV_PROJECT_ENVIRONMENT = $OldUvProjectEnvironment }
}

$VenvPython = Join-Path $VenvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) { throw "materialized venv python missing: $VenvPython" }
$InstalledParlantVersion = (& $VenvPython -I -c 'import importlib.metadata, sys; print(importlib.metadata.version(sys.argv[1]))' 'parlant').Trim()
if ($InstalledParlantVersion -ne '3.3.2') { throw "installed Parlant version mismatch: expected=3.3.2 actual=$InstalledParlantVersion" }

$InstalledTiktokenVersion = (& $VenvPython -I -c 'import importlib.metadata, sys; print(importlib.metadata.version(sys.argv[1]))' 'tiktoken').Trim()
if ($InstalledTiktokenVersion -ne $TiktokenVersion) { throw "installed tiktoken version mismatch: expected=$TiktokenVersion actual=$InstalledTiktokenVersion" }
New-Item -ItemType Directory -Path $TiktokenCacheRoot | Out-Null
$OldTiktokenCacheDir = $env:TIKTOKEN_CACHE_DIR
try {
  $env:TIKTOKEN_CACHE_DIR = $TiktokenCacheRoot
  Invoke-Checked $VenvPython @('-I', '-c', 'import sys, tiktoken; print(tiktoken.get_encoding(sys.argv[1]).name)', $TiktokenEncodingName) 'pre-materialize official tiktoken o200k cache'
} finally {
  if ($null -eq $OldTiktokenCacheDir) { Remove-Item Env:TIKTOKEN_CACHE_DIR -ErrorAction SilentlyContinue } else { $env:TIKTOKEN_CACHE_DIR = $OldTiktokenCacheDir }
}
$TiktokenCacheFile = Join-Path $TiktokenCacheRoot $TiktokenCacheKey
Assert-Sha256 $TiktokenCacheFile $TiktokenEncodingSha256 'tiktoken o200k_base cache'

Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\parlant\yance_parlant_server.py') -Destination (Join-Path $OutputRoot 'yance_parlant_server.py')
Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\parlant\generate_runtime_sbom.py') -Destination (Join-Path $OutputRoot 'generate_runtime_sbom.py')
foreach ($license in @(
  'third_party\licenses\parlant-Apache-2.0.txt',
  'third_party\licenses\uv-Apache-2.0.txt',
  'third_party\licenses\uv-MIT.txt',
  'third_party\licenses\python-build-standalone-MPL-2.0.txt',
  'third_party\licenses\cpython-PSF-2.0.txt'
)) { Copy-Item -LiteralPath (Join-Path $SourceRoot $license) -Destination $LicenseRoot }
$AssetLicense = Join-Path $PythonRoot 'LICENSE.txt'
if (Test-Path -LiteralPath $AssetLicense -PathType Leaf) { Copy-Item -LiteralPath $AssetLicense -Destination (Join-Path $LicenseRoot 'cpython-asset-LICENSE.txt') }

$TiktokenLicense = Get-ChildItem -LiteralPath (Join-Path $VenvRoot 'Lib\site-packages') -Filter 'LICENSE' -File -Recurse | Where-Object { $_.FullName -match 'tiktoken-0\.12\.0\.dist-info[\\/]licenses[\\/]LICENSE$' } | Select-Object -First 1
if (-not $TiktokenLicense) { throw 'installed tiktoken MIT license file is missing from sealed environment' }
Copy-Item -LiteralPath $TiktokenLicense.FullName -Destination (Join-Path $LicenseRoot 'tiktoken-MIT.txt')

$env:PARLANT_DATA_COLLECTION = 'false'
Invoke-Checked $VenvPython @('-I', (Join-Path $OutputRoot 'yance_parlant_server.py'), '--self-test') 'Parlant bridge isolated self-test'
Invoke-Checked $VenvPython @('-I', (Join-Path $OutputRoot 'generate_runtime_sbom.py'), '--output', (Join-Path $OutputRoot 'runtime-sbom.cdx.json')) 'Parlant runtime CycloneDX SBOM generation'

# Build tools, caches and source-control metadata are never part of OutputRoot.
Remove-Item -LiteralPath (Join-Path $OutputRoot 'generate_runtime_sbom.py') -Force
Get-ChildItem -LiteralPath $OutputRoot -Directory -Recurse -Force | Where-Object { $_.Name -in @('__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache') } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force

$SealInput = Join-Path $WorkRoot 'runtime-tree.sha256-input.txt'
$CanonicalRecordsInput = Join-Path $WorkRoot 'runtime-tree.records.json'
$CanonicalRecordsOutput = Join-Path $WorkRoot 'runtime-tree.canonical-records.json'
$Wp1Lib = Join-Path $SourceRoot 'tools\wp1\lib.js'
if (-not (Test-Path -LiteralPath $Wp1Lib -PathType Leaf)) { throw "WP1 canonicalization authority missing: $Wp1Lib" }
$NodeExe = (Get-Command 'node.exe' -ErrorAction Stop).Source
$records = @()
Get-ChildItem -LiteralPath $OutputRoot -File -Recurse -Force | Where-Object { $_.Name -ne 'runtime-seal.json' } | ForEach-Object {
  $rel = Relative-Path $OutputRoot $_.FullName
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $records += [ordered]@{ path = $rel; sizeBytes = [int64]$_.Length; sha256 = $hash }
}
[IO.File]::WriteAllText($CanonicalRecordsInput, (($records | ConvertTo-Json -Depth 4 -Compress) + "`n"), (New-Object Text.UTF8Encoding($false)))
$CanonicalizeScript = @'
const fs = require('node:fs');
const { canonicalizePayloadRecords } = require(process.argv[1]);
const records = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.writeFileSync(process.argv[3], `${JSON.stringify(canonicalizePayloadRecords(records))}\n`, 'utf8');
'@
Invoke-Checked $NodeExe @('-e', $CanonicalizeScript, $Wp1Lib, $CanonicalRecordsInput, $CanonicalRecordsOutput) 'canonicalize Parlant runtime records through WP1 authority'
$records = @(Get-Content -LiteralPath $CanonicalRecordsOutput -Raw | ConvertFrom-Json)
$canonicalLines = @($records | ForEach-Object { '{0}|{1}|{2}' -f $_.path, $_.sizeBytes, $_.sha256 })
[IO.File]::WriteAllText($SealInput, (($canonicalLines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
$TreeSha = (Get-FileHash -LiteralPath $SealInput -Algorithm SHA256).Hash.ToLowerInvariant()
$SbomSha = (Get-FileHash -LiteralPath (Join-Path $OutputRoot 'runtime-sbom.cdx.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$seal = [ordered]@{
  schemaVersion = 1
  documentType = 'YANCE_PARLANT_WINDOWS_RUNTIME_SEAL'
  parlant = [ordered]@{ version = $ParlantVersion; commit = $ParlantCommit; uvLockGitBlob = $ParlantUvLockBlob }
  uvBuildTool = [ordered]@{ version = $UvVersion; commit = $UvCommit; asset = $UvAsset; assetSha256 = $UvAssetSha256 }
  pythonBuildStandalone = [ordered]@{ release = $PythonBuildStandaloneRelease; commit = $PythonBuildStandaloneCommit; asset = $PythonAsset; assetSha256 = $PythonAssetSha256; cpythonVersion = $CpythonVersion }
  tiktoken = [ordered]@{ version = $TiktokenVersion; commit = $TiktokenCommit; encoding = $TiktokenEncodingName; encodingUrl = $TiktokenEncodingUrl; encodingSha256 = $TiktokenEncodingSha256; cacheKeySha1 = $TiktokenCacheKey; cacheProtocol = 'TIKTOKEN_CACHE_DIR' }
  runtime = [ordered]@{ fileCount = $records.Count; treeSha256 = $TreeSha; sbomSha256 = $SbomSha; dependencyResolution = 'build-time-only'; networkResolutionAtRuntime = $false }
}
[IO.File]::WriteAllText((Join-Path $OutputRoot 'runtime-seal.json'), (($seal | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))

# Cleanup explicitly proves that uv.exe, Git checkout and download caches are outside the shipped runtime.
Remove-Item -LiteralPath $ToolRoot -Recurse -Force
Remove-Item -LiteralPath $ParlantRepo -Recurse -Force
Remove-Item -LiteralPath $DownloadRoot -Recurse -Force

Write-Host ("PARLANT_RUNTIME_SEALED root={0} files={1} treeSha256={2}" -f $OutputRoot, $records.Count, $TreeSha)