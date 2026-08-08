[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$WorkRoot = (Join-Path ([IO.Path]::GetTempPath()) ('yance-graphiti-seal-' + [Guid]::NewGuid().ToString('N')))
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$GraphitiVersion = 'v0.29.3'
$GraphitiCommit = '021d3a57d511f21b10adaf7fa923bd5c1fce5e9d'
$GraphitiUvLockBlob = '38b26ce7d01f11287d71df7f5359867b85b3d6c4'
$GraphitiPyprojectBlob = 'd0dc10e0efe7acedc27fac8665dd8e00b02dce32'
$Neo4jVersion = '2026.07.1'
$Neo4jAsset = 'neo4j-community-2026.07.1-windows.zip'
$Neo4jAssetSize = 262189122
$Neo4jAssetSha256 = 'd70f2019c7a53b6ed5ac61a027a9884a5dbcf714d52e941249036d02d7886162'
$Neo4jAssetUrl = 'https://dist.neo4j.org/neo4j-community-2026.07.1-windows.zip'
$Neo4jChecksumUrl = 'https://dist.neo4j.org/neo4j-community-2026.07.1-windows.zip.sha256'
$TemurinVersion = 'jdk-21.0.11+10'
$TemurinAsset = 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.11_10.zip'
$TemurinAssetSize = 205073954
$TemurinAssetSha256 = 'd3625e7cadf23787ea540229544b6e2ab494b3b54da1801879e583e1dfee0a64'
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

function Assert-Sha256([string]$Path, [string]$Expected, [string]$Label, [string]$ReasonCode = 'GRAPHITI_ARTIFACT_CHECKSUM_MISMATCH') {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$ReasonCode $Label is missing: $Path" }
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { throw "$ReasonCode $Label SHA256 mismatch: expected=$Expected actual=$actual" }
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
function Move-SingleExtractedDirectory([string]$ExtractRoot, [string]$Destination, [string]$Label) {
  $children = @(Get-ChildItem -LiteralPath $ExtractRoot -Directory)
  if ($children.Count -ne 1) { throw "$Label verified archive must contain one root directory" }
  if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Recurse -Force }
  Move-Item -LiteralPath $children[0].FullName -Destination $Destination
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
$UvCacheRoot = Join-Path $WorkRoot 'uv-cache'
$GraphitiRepo = Join-Path $WorkRoot 'graphiti-src'
$PythonRoot = Join-Path $OutputRoot 'python'
$VenvRoot = Join-Path $OutputRoot 'venv'
$Neo4jRoot = Join-Path $OutputRoot 'neo4j'
$JavaRoot = Join-Path $OutputRoot 'java'
$LicenseRoot = Join-Path $OutputRoot 'licenses'
New-Item -ItemType Directory -Path $DownloadRoot, $ToolRoot, $UvCacheRoot, $LicenseRoot | Out-Null

$UvZip = Join-Path $DownloadRoot $UvAsset
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/astral-sh/uv/releases/download/$UvVersion/$UvAsset" -OutFile $UvZip
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
Invoke-Checked 'tar.exe' @('-xf', $PythonTar, '-C', $OutputRoot) 'extract verified CPython asset'
$PythonExe = Join-Path $PythonRoot 'python.exe'
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "standalone python.exe missing after extraction: $PythonExe" }
$PythonVersion = (& $PythonExe -I -c 'import platform; print(platform.python_version())').Trim()
if ($PythonVersion -ne $CpythonVersion) { throw "CPython version mismatch: expected=$CpythonVersion actual=$PythonVersion" }

$TemurinZip = Join-Path $DownloadRoot $TemurinAsset
$TemurinTag = $TemurinVersion.Replace('+','%2B')
Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/adoptium/temurin21-binaries/releases/download/$TemurinTag/$TemurinAsset" -OutFile $TemurinZip
Assert-Size $TemurinZip $TemurinAssetSize 'Temurin Windows x64 JDK asset'
Assert-Sha256 $TemurinZip $TemurinAssetSha256 'Temurin Windows x64 JDK asset'
$TemurinExtract = Join-Path $WorkRoot 'temurin-extract'
Expand-Archive -LiteralPath $TemurinZip -DestinationPath $TemurinExtract
Move-SingleExtractedDirectory $TemurinExtract $JavaRoot 'Temurin'
if (-not (Test-Path -LiteralPath (Join-Path $JavaRoot 'bin\java.exe') -PathType Leaf)) { throw 'verified Temurin asset did not contain java.exe' }

$Neo4jChecksum = Join-Path $DownloadRoot ($Neo4jAsset + '.sha256')
Invoke-WebRequest -UseBasicParsing -Uri $Neo4jChecksumUrl -OutFile $Neo4jChecksum
$FirstPartyChecksum = ((Get-Content -LiteralPath $Neo4jChecksum -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($FirstPartyChecksum -ne $Neo4jAssetSha256) { throw "GRAPHITI_FIRST_PARTY_CHECKSUM_MISMATCH expected=$Neo4jAssetSha256 firstParty=$FirstPartyChecksum" }
$Neo4jZip = Join-Path $DownloadRoot $Neo4jAsset
Invoke-WebRequest -UseBasicParsing -Uri $Neo4jAssetUrl -OutFile $Neo4jZip
Assert-Size $Neo4jZip $Neo4jAssetSize 'Neo4j Community Windows ZIP'
Assert-Sha256 $Neo4jZip $Neo4jAssetSha256 'Neo4j Community Windows ZIP' 'GRAPHITI_NEO4J_CHECKSUM_MISMATCH'
$Neo4jExtract = Join-Path $WorkRoot 'neo4j-extract'
Expand-Archive -LiteralPath $Neo4jZip -DestinationPath $Neo4jExtract
Move-SingleExtractedDirectory $Neo4jExtract $Neo4jRoot 'Neo4j Community'
if (-not (Test-Path -LiteralPath (Join-Path $Neo4jRoot 'bin\neo4j.bat') -PathType Leaf)) { throw 'verified Neo4j archive did not contain neo4j.bat' }

Invoke-Checked 'git.exe' @('init', $GraphitiRepo) 'initialize Graphiti source checkout'
Invoke-Checked 'git.exe' @('-C', $GraphitiRepo, 'remote', 'add', 'origin', 'https://github.com/getzep/graphiti.git') 'configure Graphiti upstream'
Invoke-Checked 'git.exe' @('-C', $GraphitiRepo, 'fetch', '--depth=1', 'origin', 'refs/tags/v0.29.3') 'fetch exact Graphiti tag'
Invoke-Checked 'git.exe' @('-C', $GraphitiRepo, 'checkout', '--detach', 'FETCH_HEAD') 'checkout exact Graphiti tag'
$ActualGraphitiCommit = (& git.exe -C $GraphitiRepo rev-parse HEAD).Trim()
if ($ActualGraphitiCommit -ne $GraphitiCommit) { throw "Graphiti commit mismatch: expected=$GraphitiCommit actual=$ActualGraphitiCommit" }
$ActualLockBlob = (& git.exe -C $GraphitiRepo hash-object (Join-Path $GraphitiRepo 'uv.lock')).Trim()
if ($ActualLockBlob -ne $GraphitiUvLockBlob) { throw "Graphiti uv.lock Git blob mismatch: expected=$GraphitiUvLockBlob actual=$ActualLockBlob" }
$ActualPyprojectBlob = (& git.exe -C $GraphitiRepo hash-object (Join-Path $GraphitiRepo 'pyproject.toml')).Trim()
if ($ActualPyprojectBlob -ne $GraphitiPyprojectBlob) { throw "Graphiti pyproject.toml Git blob mismatch: expected=$GraphitiPyprojectBlob actual=$ActualPyprojectBlob" }

$OldUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
$OldUvCacheDir = $env:UV_CACHE_DIR
try {
  $env:UV_PROJECT_ENVIRONMENT = $VenvRoot
  $env:UV_CACHE_DIR = $UvCacheRoot
  Invoke-Checked $UvExe @('sync', '--project', $GraphitiRepo, '--frozen', '--no-dev', '--no-editable', '--python', $PythonExe) 'uv sync materialize Graphiti runtime from exact official uv.lock'
  Invoke-Checked $UvExe @('sync', '--project', $GraphitiRepo, '--frozen', '--offline', '--no-dev', '--no-editable', '--python', $PythonExe) 'uv sync --frozen --offline closure for exact Graphiti lock'
} finally {
  if ($null -eq $OldUvProjectEnvironment) { Remove-Item Env:UV_PROJECT_ENVIRONMENT -ErrorAction SilentlyContinue } else { $env:UV_PROJECT_ENVIRONMENT = $OldUvProjectEnvironment }
  if ($null -eq $OldUvCacheDir) { Remove-Item Env:UV_CACHE_DIR -ErrorAction SilentlyContinue } else { $env:UV_CACHE_DIR = $OldUvCacheDir }
}
$VenvPython = Join-Path $VenvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) { throw "materialized venv python missing: $VenvPython" }
$InstalledGraphitiVersion = (& $VenvPython -I -c 'import importlib.metadata; print(importlib.metadata.version("graphiti-core"))').Trim()
if ($InstalledGraphitiVersion -ne '0.29.3') { throw "installed graphiti-core version mismatch: expected=0.29.3 actual=$InstalledGraphitiVersion" }

Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\graphiti\yance_graphiti_server.py') -Destination (Join-Path $OutputRoot 'yance_graphiti_server.py')
Copy-Item -LiteralPath (Join-Path $SourceRoot 'runtime\graphiti\generate_runtime_sbom.py') -Destination (Join-Path $OutputRoot 'generate_runtime_sbom.py')
foreach ($license in @(
  'third_party\licenses\graphiti-Apache-2.0.txt',
  'third_party\licenses\neo4j-GPL-3.0.txt',
  'third_party\licenses\temurin-GPL-2.0-with-Classpath-Exception.txt',
  'third_party\licenses\uv-Apache-2.0.txt',
  'third_party\licenses\uv-MIT.txt',
  'third_party\licenses\python-build-standalone-MPL-2.0.txt',
  'third_party\licenses\cpython-PSF-2.0.txt'
)) { Copy-Item -LiteralPath (Join-Path $SourceRoot $license) -Destination $LicenseRoot }
$PythonAssetLicense = Join-Path $PythonRoot 'LICENSE.txt'
if (Test-Path -LiteralPath $PythonAssetLicense -PathType Leaf) { Copy-Item -LiteralPath $PythonAssetLicense -Destination (Join-Path $LicenseRoot 'cpython-asset-LICENSE.txt') }
foreach ($name in @('LICENSE.txt','LICENSES.txt','NOTICE.txt','NOTICE')) {
  $candidate = Join-Path $Neo4jRoot $name
  if (Test-Path -LiteralPath $candidate -PathType Leaf) { Copy-Item -LiteralPath $candidate -Destination (Join-Path $LicenseRoot ('neo4j-' + $name)) }
}

$env:GRAPHITI_TELEMETRY_ENABLED = 'false'
Invoke-Checked $VenvPython @('-I', (Join-Path $OutputRoot 'yance_graphiti_server.py'), '--self-test') 'Graphiti bridge isolated self-test'
Invoke-Checked $VenvPython @('-I', (Join-Path $OutputRoot 'generate_runtime_sbom.py'), '--output', (Join-Path $OutputRoot 'runtime-sbom.cdx.json')) 'Graphiti runtime CycloneDX SBOM generation'
Remove-Item -LiteralPath (Join-Path $OutputRoot 'generate_runtime_sbom.py') -Force
Get-ChildItem -LiteralPath $OutputRoot -Directory -Recurse -Force | Where-Object { $_.Name -in @('__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache') } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force

$SealInput = Join-Path $WorkRoot 'runtime-tree.sha256-input.txt'
$records = @()
Get-ChildItem -LiteralPath $OutputRoot -File -Recurse -Force | Where-Object { $_.Name -ne 'runtime-seal.json' } | ForEach-Object {
  $rel = Relative-Path $OutputRoot $_.FullName
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $records += [ordered]@{ path = $rel; sizeBytes = [int64]$_.Length; sha256 = $hash }
}
$records = @($records | Sort-Object path)
$canonicalLines = @($records | ForEach-Object { '{0}|{1}|{2}' -f $_.path, $_.sizeBytes, $_.sha256 })
[IO.File]::WriteAllText($SealInput, (($canonicalLines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
$TreeSha = (Get-FileHash -LiteralPath $SealInput -Algorithm SHA256).Hash.ToLowerInvariant()
$SbomSha = (Get-FileHash -LiteralPath (Join-Path $OutputRoot 'runtime-sbom.cdx.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$seal = [ordered]@{
  schemaVersion = 1
  documentType = 'YANCE_GRAPHITI_WINDOWS_RUNTIME_SEAL'
  graphiti = [ordered]@{ version = $GraphitiVersion; commit = $GraphitiCommit; uvLockGitBlob = $GraphitiUvLockBlob; pyprojectGitBlob = $GraphitiPyprojectBlob }
  neo4jCommunity = [ordered]@{ version = $Neo4jVersion; asset = $Neo4jAsset; artifactUrl = $Neo4jAssetUrl; firstPartySha256Url = $Neo4jChecksumUrl; assetSha256 = $Neo4jAssetSha256 }
  temurin = [ordered]@{ version = $TemurinVersion; asset = $TemurinAsset; assetSha256 = $TemurinAssetSha256 }
  uvBuildTool = [ordered]@{ version = $UvVersion; commit = $UvCommit; asset = $UvAsset; assetSha256 = $UvAssetSha256 }
  pythonBuildStandalone = [ordered]@{ release = $PythonBuildStandaloneRelease; commit = $PythonBuildStandaloneCommit; asset = $PythonAsset; assetSha256 = $PythonAssetSha256; cpythonVersion = $CpythonVersion }
  runtime = [ordered]@{ fileCount = $records.Count; treeSha256 = $TreeSha; sbomSha256 = $SbomSha; dependencyResolution = 'build-time-only'; networkResolutionAtRuntime = $false; neo4jHttpEnabled = $false; graphitiLoopbackOnly = $true }
}
[IO.File]::WriteAllText((Join-Path $OutputRoot 'runtime-seal.json'), (($seal | ConvertTo-Json -Depth 8) + "`n"), (New-Object Text.UTF8Encoding($false)))

Remove-Item -LiteralPath $ToolRoot -Recurse -Force
Remove-Item -LiteralPath $GraphitiRepo -Recurse -Force
Remove-Item -LiteralPath $DownloadRoot -Recurse -Force
Remove-Item -LiteralPath $UvCacheRoot -Recurse -Force
Write-Host ("GRAPHITI_RUNTIME_SEALED root={0} files={1} treeSha256={2}" -f $OutputRoot, $records.Count, $TreeSha)
