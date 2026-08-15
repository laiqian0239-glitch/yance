[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [string]$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$WorkRoot = (Join-Path ([IO.Path]::GetTempPath()) ('yance-learning-policy-seal-' + [Guid]::NewGuid().ToString('N')))
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

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
$VowpalWabbitVersion = '9.11.2'
$VowpalWabbitCommit = '122bae254a5b8bc2b774d13b33d53e6dbc2cfba7'
$LearningLockBlob = 'cf2aa6e320d6d5c16c92672136325f29ef4365ae'
$Utf8NoBom = New-Object Text.UTF8Encoding($false)

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
function Invoke-JsonEntrypoint([string]$PythonExe, [string]$Entrypoint, [hashtable]$Request, [string]$Label) {
  $requestJson = $Request | ConvertTo-Json -Depth 20 -Compress
  $stdoutLines = @($requestJson | & $PythonExe -I $Entrypoint)
  $exitCode = $LASTEXITCODE
  $stdout = $stdoutLines -join "`n"
  if ($exitCode -ne 0) { throw "$Label failed with exit $($exitCode): $stdout" }
  try { return ($stdout | ConvertFrom-Json) }
  catch { throw "$Label returned invalid JSON: $stdout" }
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
$ProjectRoot = Join-Path $SourceRoot 'runtime\learning-growth\python'
$PythonRoot = Join-Path $OutputRoot 'python'
$VenvRoot = Join-Path $OutputRoot 'venv'
$LicenseRoot = Join-Path $OutputRoot 'licenses'
New-Item -ItemType Directory -Path $DownloadRoot, $ToolRoot, $LicenseRoot | Out-Null
foreach ($required in @('pyproject.toml','uv.lock','learning_entrypoint.py')) {
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required) -PathType Leaf)) { throw "Learning runtime source input missing: $required" }
}
$ActualLockBlob = (& git.exe -C $SourceRoot hash-object (Join-Path $ProjectRoot 'uv.lock')).Trim()
if ($ActualLockBlob -ne $LearningLockBlob) { throw "Learning uv.lock Git blob mismatch: expected=$LearningLockBlob actual=$ActualLockBlob" }

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

$OldUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
try {
  $env:UV_PROJECT_ENVIRONMENT = $VenvRoot
  Invoke-Checked $UvExe @('sync', '--project', $ProjectRoot, '--frozen', '--no-dev', '--no-editable', '--python', $PythonExe) 'materialize Learning runtime from tracked uv.lock'
} finally {
  if ($null -eq $OldUvProjectEnvironment) { Remove-Item Env:UV_PROJECT_ENVIRONMENT -ErrorAction SilentlyContinue } else { $env:UV_PROJECT_ENVIRONMENT = $OldUvProjectEnvironment }
}

$VenvPython = Join-Path $VenvRoot 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $VenvPython -PathType Leaf)) { throw "materialized venv python missing: $VenvPython" }
$InstalledVwVersion = (& $VenvPython -I -c 'import importlib.metadata, sys; print(importlib.metadata.version(sys.argv[1]))' 'vowpalwabbit').Trim()
if ($InstalledVwVersion -ne $VowpalWabbitVersion) { throw "installed Vowpal Wabbit version mismatch: expected=$VowpalWabbitVersion actual=$InstalledVwVersion" }
$Entrypoint = Join-Path $OutputRoot 'learning_entrypoint.py'
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'learning_entrypoint.py') -Destination $Entrypoint

foreach ($license in @(
  'third_party\licenses\vowpal-wabbit-BSD-3-Clause.txt',
  'third_party\licenses\uv-Apache-2.0.txt',
  'third_party\licenses\uv-MIT.txt',
  'third_party\licenses\python-build-standalone-MPL-2.0.txt',
  'third_party\licenses\cpython-PSF-2.0.txt'
)) {
  $source = Join-Path $SourceRoot $license
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "runtime license input missing: $license" }
  Copy-Item -LiteralPath $source -Destination $LicenseRoot
}
$AssetLicense = Join-Path $PythonRoot 'LICENSE.txt'
if (Test-Path -LiteralPath $AssetLicense -PathType Leaf) { Copy-Item -LiteralPath $AssetLicense -Destination (Join-Path $LicenseRoot 'cpython-asset-LICENSE.txt') }

$contract = Invoke-JsonEntrypoint $VenvPython $Entrypoint @{ operation = 'policy_runtime_contract' } 'sealed Learned Policy runtime contract'
if ([string]$contract.status -ne 'READY' -or [string]$contract.authority -ne 'Vowpal Wabbit' -or [string]$contract.vowpalwabbit -ne $VowpalWabbitVersion -or [bool]$contract.exploration -ne $false -or [bool]$contract.textGeneration -ne $false) {
  throw "sealed Learned Policy runtime contract mismatch: $($contract | ConvertTo-Json -Compress)"
}

$SbomScript = Join-Path $WorkRoot 'generate_runtime_sbom.py'
$SbomScriptText = @'
import importlib.metadata as md
import json
import pathlib
import sys
components = []
for dist in sorted(md.distributions(), key=lambda d: (d.metadata.get("Name") or "").lower()):
    name = dist.metadata.get("Name") or "unknown"
    version = dist.version
    components.append({"type":"library","name":name,"version":version,"purl":f"pkg:pypi/{name.lower().replace('_','-')}@{version}"})
doc = {"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"metadata":{"component":{"type":"application","name":"yance-learning-policy-windows-runtime","version":"1"}},"components":components}
pathlib.Path(sys.argv[1]).write_text(json.dumps(doc, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
'@
[IO.File]::WriteAllText($SbomScript, $SbomScriptText, $Utf8NoBom)
Invoke-Checked $VenvPython @('-I', $SbomScript, (Join-Path $OutputRoot 'runtime-sbom.cdx.json')) 'Learning runtime CycloneDX SBOM generation'

# Build tools, resolver state, caches and VCS metadata are never part of OutputRoot.
Get-ChildItem -LiteralPath $OutputRoot -Directory -Recurse -Force | Where-Object { $_.Name -in @('__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache') } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force
foreach ($forbiddenName in @('uv.exe', 'uv.lock', '.git')) {
  $found = @(Get-ChildItem -LiteralPath $OutputRoot -Recurse -Force | Where-Object { $_.Name -eq $forbiddenName })
  if ($found.Count -ne 0) { throw "forbidden build-time artifact shipped: $forbiddenName" }
}

$SealInput = Join-Path $WorkRoot 'runtime-tree.sha256-input.txt'
$CanonicalRecordsInput = Join-Path $WorkRoot 'runtime-tree.records.json'
$CanonicalRecordCountOutput = Join-Path $WorkRoot 'runtime-tree.record-count.txt'
$Wp1Lib = Join-Path $SourceRoot 'tools\wp1\lib.js'
if (-not (Test-Path -LiteralPath $Wp1Lib -PathType Leaf)) { throw "WP1 canonicalization authority missing: $Wp1Lib" }
$NodeExe = (Get-Command 'node.exe' -ErrorAction Stop).Source
$records = @()
Get-ChildItem -LiteralPath $OutputRoot -File -Recurse -Force | Where-Object { $_.Name -ne 'runtime-seal.json' } | ForEach-Object {
  $rel = Relative-Path $OutputRoot $_.FullName
  $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $records += [ordered]@{ path = $rel; sizeBytes = [int64]$_.Length; sha256 = $hash }
}
$recordsJson = ConvertTo-Json -InputObject @($records) -Depth 4 -Compress
[IO.File]::WriteAllText($CanonicalRecordsInput, ($recordsJson + "`n"), $Utf8NoBom)
$CanonicalizeScript = @'
const fs = require('node:fs');
const { canonicalizePayloadRecords } = require(process.argv[1]);
const records = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const canonical = canonicalizePayloadRecords(records);
const lines = canonical.map((row) => `${row.path}|${row.sizeBytes}|${row.sha256}`);
fs.writeFileSync(process.argv[3], `${lines.join('\n')}\n`, 'utf8');
fs.writeFileSync(process.argv[4], `${canonical.length}\n`, 'utf8');
'@
Invoke-Checked $NodeExe @('-e', $CanonicalizeScript, $Wp1Lib, $CanonicalRecordsInput, $SealInput, $CanonicalRecordCountOutput) 'canonicalize Learning runtime records through WP1 authority'
[int]$CanonicalRecordCount = (Get-Content -LiteralPath $CanonicalRecordCountOutput -Raw).Trim()
if ($CanonicalRecordCount -ne $records.Count) { throw "WP1 canonicalization record count mismatch: input=$($records.Count) canonical=$CanonicalRecordCount" }
$TreeSha = (Get-FileHash -LiteralPath $SealInput -Algorithm SHA256).Hash.ToLowerInvariant()
$SbomSha = (Get-FileHash -LiteralPath (Join-Path $OutputRoot 'runtime-sbom.cdx.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$seal = [ordered]@{
  schemaVersion = 1
  documentType = 'YANCE_LEARNING_WINDOWS_RUNTIME_SEAL'
  learningPolicy = [ordered]@{ learner = 'Vowpal Wabbit'; version = $VowpalWabbitVersion; commit = $VowpalWabbitCommit; mode = 'contextual-bandit-adf-offline-candidate-policy'; exploration = $false; textGeneration = $false }
  python = [ordered]@{ version = $CpythonVersion; buildStandaloneRelease = $PythonBuildStandaloneRelease; buildStandaloneCommit = $PythonBuildStandaloneCommit; asset = $PythonAsset; assetSizeBytes = $PythonAssetSize; assetSha256 = $PythonAssetSha256 }
  uv = [ordered]@{ version = $UvVersion; commit = $UvCommit; asset = $UvAsset; assetSizeBytes = $UvAssetSize; assetSha256 = $UvAssetSha256; sourceLockGitBlob = $LearningLockBlob }
  runtime = [ordered]@{ fileCount = $CanonicalRecordCount; treeSha256 = $TreeSha; sbomSha256 = $SbomSha; dependencyResolution = 'build-time-only'; networkResolutionAtRuntime = $false; buildToolsShipped = $false }
}
$sealJson = ConvertTo-Json -InputObject $seal -Depth 8
[IO.File]::WriteAllText((Join-Path $OutputRoot 'runtime-seal.json'), ($sealJson + "`n"), $Utf8NoBom)

Write-Host "SEALED_LEARNING_RUNTIME=$OutputRoot"
Write-Host "TREE_SHA256=$TreeSha"
Write-Host "SBOM_SHA256=$SbomSha"
Write-Host "FILE_COUNT=$CanonicalRecordCount"
