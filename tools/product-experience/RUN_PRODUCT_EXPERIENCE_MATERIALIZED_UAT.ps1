[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DesktopBundleRoot,

  [Parameter(Mandatory = $true)]
  [string]$MatrixBundleRoot,

  [string]$ExistingDataRoot,
  [string]$UatDataRoot,
  [string]$EvidenceRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$ManifestFileName = 'PRODUCT_EXPERIENCE_MATERIALIZED_UAT_MANIFEST.json'
$DesktopClass = 'PRODUCT_EXPERIENCE_MATERIALIZED_DESKTOP_UAT_ONLY'
$MatrixClass = 'PRODUCT_EXPERIENCE_MATERIALIZED_MATRIX_UAT_ONLY'

function Resolve-RealDirectory {
  param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label does not exist: $Path" }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "$Label must not be a symlink/reparse point: $Path" }
  return $item.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
}

function Assert-SafeRelativePath {
  param([Parameter(Mandatory = $true)][string]$RelativePath)
  if ([string]::IsNullOrWhiteSpace($RelativePath)) { throw 'manifest path must be non-empty' }
  if ($RelativePath.Contains('\') -or $RelativePath.StartsWith('/') -or [IO.Path]::IsPathRooted($RelativePath)) { throw "manifest path must be normalized repository-style relative path: $RelativePath" }
  $parts = $RelativePath.Split('/')
  if ($parts | Where-Object { [string]::IsNullOrWhiteSpace($_) -or $_ -eq '.' -or $_ -eq '..' }) { throw "manifest path escape is forbidden: $RelativePath" }
  if ($RelativePath -eq $ManifestFileName) { throw 'manifest may not list itself' }
}

function Get-CanonicalActualFiles {
  param([Parameter(Mandatory = $true)][string]$Root)
  $rows = @()
  $rootPrefix = $Root + [IO.Path]::DirectorySeparatorChar
  foreach ($item in Get-ChildItem -LiteralPath $Root -Force -Recurse) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "symlink/reparse point is forbidden in materialized UAT bundle: $($item.FullName)" }
    if ($item.PSIsContainer) { continue }
    $full = [IO.Path]::GetFullPath($item.FullName)
    if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "file escapes materialized UAT bundle root: $full" }
    $relative = $full.Substring($rootPrefix.Length).Replace('\', '/')
    if ($relative -eq $ManifestFileName) { continue }
    Assert-SafeRelativePath $relative
    $rows += [pscustomobject]@{
      path = $relative
      sizeBytes = [int64]$item.Length
      sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  return @($rows | Sort-Object -Property path)
}

function Verify-Bundle {
  param(
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$ExpectedClass
  )
  $canonicalRoot = Resolve-RealDirectory $Root 'bundle root'
  $manifestPath = Join-Path $canonicalRoot $ManifestFileName
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "missing $ManifestFileName in $canonicalRoot" }
  $manifestItem = Get-Item -LiteralPath $manifestPath -Force
  if (($manifestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'materialized UAT manifest must not be a symlink/reparse point' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.schemaVersion -ne 1 -or $manifest.documentType -ne 'V21_PRODUCT_EXPERIENCE_MATERIALIZED_UAT_CANDIDATE') { throw 'materialized UAT manifest schema/document type mismatch' }
  if ($manifest.formalRelease -ne $false) { throw 'materialized UAT candidate must remain non-release' }
  if ([string]$manifest.bundleClass -ne $ExpectedClass) { throw "bundle class mismatch: expected=$ExpectedClass actual=$($manifest.bundleClass)" }
  if ([string]::IsNullOrWhiteSpace([string]$manifest.candidateBranch)) { throw 'candidateBranch is missing' }
  if ([string]$manifest.candidateCommit -notmatch '^[0-9a-f]{40}$') { throw 'candidateCommit is malformed' }
  if ([string]$manifest.candidateTree -notmatch '^[0-9a-f]{40}$') { throw 'candidateTree is malformed' }

  $expectedRows = @($manifest.files)
  $seen = @{}
  $previous = $null
  foreach ($row in $expectedRows) {
    $relative = [string]$row.path
    Assert-SafeRelativePath $relative
    if ($seen.ContainsKey($relative)) { throw "duplicate manifest file identity: $relative" }
    if ($null -ne $previous -and [StringComparer]::Ordinal.Compare($previous, $relative) -ge 0) { throw 'manifest file records are not strictly sorted' }
    if ([int64]$row.sizeBytes -lt 0) { throw "invalid file Length in manifest: $relative" }
    if ([string]$row.sha256 -notmatch '^[0-9a-f]{64}$') { throw "invalid SHA256 in manifest: $relative" }
    $seen[$relative] = $true
    $previous = $relative
  }

  $actualRows = @(Get-CanonicalActualFiles $canonicalRoot)
  if ($actualRows.Count -ne $expectedRows.Count) { throw "materialized UAT file set mismatch: expected=$($expectedRows.Count) actual=$($actualRows.Count)" }
  for ($index = 0; $index -lt $expectedRows.Count; $index++) {
    $expected = $expectedRows[$index]
    $actual = $actualRows[$index]
    if ([string]$actual.path -ne [string]$expected.path) { throw "materialized UAT file identity mismatch: expected=$($expected.path) actual=$($actual.path)" }
    if ([int64]$actual.sizeBytes -ne [int64]$expected.sizeBytes) { throw "materialized UAT Length mismatch: $($expected.path)" }
    if ([string]$actual.sha256 -ne [string]$expected.sha256) { throw "materialized UAT SHA256 mismatch: $($expected.path)" }
  }

  return [pscustomobject]@{ root = $canonicalRoot; manifest = $manifest }
}

$desktop = Verify-Bundle -Root $DesktopBundleRoot -ExpectedClass $DesktopClass
$matrix = Verify-Bundle -Root $MatrixBundleRoot -ExpectedClass $MatrixClass

foreach ($field in @('candidateBranch', 'candidateCommit', 'candidateTree')) {
  $desktopValue = [string]$desktop.manifest.$field
  $matrixValue = [string]$matrix.manifest.$field
  if ($desktopValue -ne $matrixValue) { throw "desktop/matrix $field mismatch: desktop=$desktopValue matrix=$matrixValue" }
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Engine/Desktop CLI is required' }
  Set-Alias -Name docker.exe -Value docker -Scope Script
}
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
  if (-not (Get-Command tar -ErrorAction SilentlyContinue)) { throw 'Windows tar extraction tooling is required' }
  Set-Alias -Name tar.exe -Value tar -Scope Script
}

$matrixArchive = Get-ChildItem -LiteralPath $matrix.root -Filter 'matrix-images.tar' -File -Recurse | Select-Object -First 1
if (-not $matrixArchive) { throw 'sealed Matrix image archive matrix-images.tar is missing' }
$composePath = Join-Path $matrix.root 'materialized-matrix-compose.yml'
if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) { throw 'image-only Matrix compose file is missing' }

$env:YANCE_UAT_CANDIDATE_SHA = [string]$desktop.manifest.candidateCommit
& docker.exe load --input $matrixArchive.FullName
if ($LASTEXITCODE -ne 0) { throw "docker load failed with exit code $LASTEXITCODE" }
& docker.exe compose --project-directory $matrix.root -f $composePath up -d --no-build
if ($LASTEXITCODE -ne 0) { throw "docker compose up --no-build failed with exit code $LASTEXITCODE" }

if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) {
  $EvidenceRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "Yance\MaterializedUAT\$($desktop.manifest.candidateCommit)"
}
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
$EvidenceRoot = Resolve-RealDirectory $EvidenceRoot 'evidence root'

$desktopArchive = Get-ChildItem -LiteralPath $desktop.root -Filter 'Yance_Stage6_4_5_9_WP7_PreReview_Trusted_Product_*.tar.gz' -File -Recurse | Select-Object -First 1
if (-not $desktopArchive) { throw 'WP7 pre-review trusted desktop archive is missing' }
$applicationRoot = Join-Path $EvidenceRoot 'desktop'
Remove-Item -LiteralPath $applicationRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $applicationRoot | Out-Null
& tar.exe -xf $desktopArchive.FullName -C $applicationRoot
if ($LASTEXITCODE -ne 0) { throw "tar extraction failed with exit code $LASTEXITCODE" }

$yanceExe = Get-ChildItem -LiteralPath $applicationRoot -Filter 'Yance.exe' -File -Recurse | Select-Object -First 1
if (-not $yanceExe) { throw 'already-built Yance.exe is missing from the WP7 desktop payload' }

if ([string]::IsNullOrWhiteSpace($UatDataRoot)) { $UatDataRoot = Join-Path $EvidenceRoot 'data' }
if (-not [string]::IsNullOrWhiteSpace($ExistingDataRoot)) {
  if (Get-Process -Name 'Yance' -ErrorAction SilentlyContinue) { throw 'Yance must be stopped before copying existing data into the isolated UAT data root' }
  $sourceData = Resolve-RealDirectory $ExistingDataRoot 'existing Yance data root'
  Remove-Item -LiteralPath $UatDataRoot -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $UatDataRoot | Out-Null
  foreach ($entry in Get-ChildItem -LiteralPath $sourceData -Force) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "existing data contains forbidden symlink/reparse point: $($entry.FullName)" }
    Copy-Item -LiteralPath $entry.FullName -Destination $UatDataRoot -Recurse -Force -ErrorAction Stop
  }
} else {
  New-Item -ItemType Directory -Force -Path $UatDataRoot | Out-Null
}
$env:YANCE_DATA_DIR = (Resolve-RealDirectory $UatDataRoot 'isolated Yance UAT data root')

$startedAtUtc = [DateTime]::UtcNow.ToString('o')
$process = Start-Process -FilePath $yanceExe.FullName -WorkingDirectory $yanceExe.DirectoryName -PassThru
$evidence = [ordered]@{
  schemaVersion = 1
  documentType = 'V21_PRODUCT_EXPERIENCE_MATERIALIZED_UAT_WINDOWS_EVIDENCE'
  formalRelease = $false
  candidateBranch = [string]$desktop.manifest.candidateBranch
  candidateCommit = [string]$desktop.manifest.candidateCommit
  candidateTree = [string]$desktop.manifest.candidateTree
  desktopBundleClass = $DesktopClass
  matrixBundleClass = $MatrixClass
  matrixArchive = $matrixArchive.FullName
  composeFile = $composePath
  desktopArchive = $desktopArchive.FullName
  yanceExecutable = $yanceExe.FullName
  yanceDataDir = $env:YANCE_DATA_DIR
  startedAtUtc = $startedAtUtc
  processId = $process.Id
}
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'materialized-uat-evidence.json') -Encoding UTF8

Write-Host "GREEN: verified same-identity materialized UAT candidate $($desktop.manifest.candidateCommit)"
Write-Host "GREEN: Matrix images loaded and started with docker compose up --no-build"
Write-Host "GREEN: already-built Yance.exe started with isolated data root $env:YANCE_DATA_DIR"
Write-Host "Evidence: $(Join-Path $EvidenceRoot 'materialized-uat-evidence.json')"
