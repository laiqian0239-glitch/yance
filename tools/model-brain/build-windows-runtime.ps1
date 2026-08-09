param(
  [Parameter(Mandatory=$true)][string]$LiteLLMSource,
  [Parameter(Mandatory=$true)][string]$PythonArchive,
  [Parameter(Mandatory=$true)][string]$UvExe,
  [string]$Output = "dist/model-brain-runtime"
)
$ErrorActionPreference = "Stop"
$ExpectedCommit = "72a4a55f43ea7266de589f005d0d33624fe5d555"
$ExpectedTree = "98627d729e47b181cebb6ae8afe60201bbd56993"
$ExpectedCoreTree = "cb54d17e6ce0a0ad98c992f9642957faa998bbca"
$ExpectedLicenseBlob = "3bfef5bae9b48c334acf426d5b7f21bc1913aab9"
$ExpectedUvLockBlob = "08d10667fb1fde67211a74ad1d4c747c0fb84cf3"
$ExpectedPython = "3.12.13"
$ExpectedUv = "0.12.3"
$BuildPhase = "source-integrity"

try {
$source = (Resolve-Path $LiteLLMSource).Path
if ((git -C $source rev-parse HEAD).Trim() -ne $ExpectedCommit) { throw "LiteLLM commit mismatch" }
if ((git -C $source rev-parse 'HEAD^{tree}').Trim() -ne $ExpectedTree) { throw "LiteLLM tree mismatch" }
if ((git -C $source rev-parse 'HEAD:litellm').Trim() -ne $ExpectedCoreTree) { throw "LiteLLM core tree mismatch" }
if ((git -C $source hash-object LICENSE).Trim() -ne $ExpectedLicenseBlob) { throw "LiteLLM license blob mismatch" }
if ((git -C $source hash-object uv.lock).Trim() -ne $ExpectedUvLockBlob) { throw "uv.lock blob mismatch" }

$BuildPhase = "python-bootstrap"
Remove-Item $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Output | Out-Null
$OutputRoot = (Resolve-Path $Output).Path
$pythonRoot = Join-Path $OutputRoot "python"
Expand-Archive -Path $PythonArchive -DestinationPath $pythonRoot
$pythonExe = Get-ChildItem $pythonRoot -Recurse -Filter python.exe | Select-Object -First 1 -ExpandProperty FullName
if (-not $pythonExe) { throw "sealed CPython executable missing" }
$pythonVersion = (& $pythonExe -I -c 'import platform; print(platform.python_version())').Trim()
if ($pythonVersion -ne $ExpectedPython) { throw "CPython version mismatch: $pythonVersion" }
if ((& $UvExe --version) -notmatch [regex]::Escape($ExpectedUv)) { throw "uv version mismatch" }

$BuildPhase = "locked-export"
$req = Join-Path $OutputRoot "requirements.locked.txt"
# Build-time only. Export the exact base-SDK dependency closure from the reviewed
# upstream lock while omitting the LiteLLM project, workspace projects and dev group.
& $UvExe export --directory $source --locked --no-dev --no-emit-workspace --no-emit-project --format requirements-txt --output-file $req
if ($LASTEXITCODE -ne 0) { throw "uv locked export failed" }
if (Select-String -Path $req -Pattern 'litellm\[proxy\]|litellm-enterprise|litellm-proxy-extras|maturin|setuptools-rust' -Quiet) { throw "forbidden proxy/enterprise/Rust build dependency" }

$BuildPhase = "dependency-install"
# Install every locked base dependency into the sealed interpreter. The LiteLLM
# project itself is never installed, so no console/service entrypoint is generated.
& $UvExe pip install --python $pythonExe --require-hashes --no-deps -r $req
if ($LASTEXITCODE -ne 0) { throw "sealed dependency install failed" }
$sitePackages = (& $pythonExe -I -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
if (-not $sitePackages -or -not (Test-Path $sitePackages)) { throw "sealed site-packages path missing" }

$BuildPhase = "sdk-materialization"
# Materialize the reviewed MIT litellm/ tree directly from the immutable Git tree
# object. Windows checkout bytes may apply worktree EOL conversion, so sealed source
# identity must come from Git objects rather than from the platform checkout view.
$litellmTarget = Join-Path $sitePackages "litellm"
Remove-Item $litellmTarget -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $litellmTarget | Out-Null
$sourceArchive = Join-Path $OutputRoot "litellm-source.tar"
Remove-Item $sourceArchive -Force -ErrorAction SilentlyContinue
& git -C $source archive --format=tar --output=$sourceArchive $ExpectedCoreTree
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $sourceArchive -PathType Leaf)) {
  Remove-Item $sourceArchive -Force -ErrorAction SilentlyContinue
  throw "LiteLLM pinned core tree object export failed"
}
& tar -xf $sourceArchive -C $litellmTarget
$archiveExitCode = $LASTEXITCODE
Remove-Item $sourceArchive -Force -ErrorAction SilentlyContinue
if ($archiveExitCode -ne 0) { throw "LiteLLM pinned core tree object extraction failed" }

# Verify source tree integrity against the pinned Git tree itself. Bind every
# materialized file to the reviewed tree's exact blob SHA and reject extra paths.
$treeEntries = @(& git -C $source ls-tree -r $ExpectedCoreTree)
if ($LASTEXITCODE -ne 0 -or $treeEntries.Count -eq 0) { throw "LiteLLM pinned core tree enumeration failed" }
$expectedPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
foreach ($entry in $treeEntries) {
  if ($entry -notmatch '^(?<mode>[0-9]{6}) blob (?<blob>[0-9a-f]{40})\t(?<path>.+)$') {
    throw "LiteLLM pinned core tree entry parse failed: $entry"
  }
  $expectedBlob = $Matches['blob']
  $relative = $Matches['path']
  [void]$expectedPaths.Add($relative)
  $targetFile = Join-Path $litellmTarget $relative
  if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
    throw "LiteLLM source path mismatch after materialization: missing=$relative"
  }
  $actualBlob = (& git -C $source hash-object --no-filters -- $targetFile).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualBlob -ne $expectedBlob) {
    throw "LiteLLM source blob mismatch after materialization: path=$relative expected=$expectedBlob actual=$actualBlob"
  }
}
$actualSourceFiles = @(Get-ChildItem -LiteralPath $litellmTarget -Recurse -File | ForEach-Object {
  [IO.Path]::GetRelativePath($litellmTarget, $_.FullName).Replace('\','/')
})
$unexpectedSourceFiles = @($actualSourceFiles | Where-Object { -not $expectedPaths.Contains($_) })
if ($unexpectedSourceFiles.Count -gt 0) {
  throw "LiteLLM unexpected source path after materialization: $($unexpectedSourceFiles -join ',')"
}
if ($actualSourceFiles.Count -ne $expectedPaths.Count) {
  throw "LiteLLM source path set mismatch after materialization: expected=$($expectedPaths.Count) actual=$($actualSourceFiles.Count)"
}
$sourceTreePreserved = $true

# The reviewed source tree contains no compiled Rust bridge. Do not mutate the tree;
# reject a native bridge if one ever appears in the pinned source/materialized runtime.
if (Get-ChildItem $litellmTarget -Recurse -File | Where-Object { $_.Name -match '^_native\.(pyd|dll|so)$' -and $_.FullName -match 'rust_bridge' }) { throw "forbidden Rust native bridge payload" }

Copy-Item "runtime/model-brain/yance_litellm_worker.py" (Join-Path $OutputRoot "yance_litellm_worker.py")
Copy-Item "runtime/model-brain/generate_runtime_sbom.py" (Join-Path $OutputRoot "generate_runtime_sbom.py")
Copy-Item (Join-Path $source "LICENSE") (Join-Path $OutputRoot "THIRD_PARTY_LITELLM_LICENSE.txt")

$BuildPhase = "sbom"
& $pythonExe -I (Join-Path $OutputRoot "generate_runtime_sbom.py") --output (Join-Path $OutputRoot "sbom.cdx.json") --runtime-root $OutputRoot --litellm-version "1.95.0"
if ($LASTEXITCODE -ne 0) { throw "CycloneDX SBOM generation failed" }

$BuildPhase = "isolated-import"
$importOutput = & $pythonExe -I -c "from litellm import Router; from litellm.router_strategy.complexity_router.complexity_router import ComplexityRouter; r=Router(model_list=[], enable_tag_filtering=True, tag_filtering_match_any=False); assert r.enable_tag_filtering is True; assert r.tag_filtering_match_any is False; print('Router ComplexityRouter tag_filtering isolated import OK')" 2>&1
$importExitCode = $LASTEXITCODE
if ($importOutput) { $importOutput | Write-Output }
if ($importExitCode -ne 0) { throw "isolated Router/ComplexityRouter/tag_filtering import gate failed: $($importOutput -join ' | ')" }

$BuildPhase = "manifest"
@{
  schemaVersion = 3
  upstreamCommit = $ExpectedCommit
  upstreamTree = $ExpectedTree
  upstreamCoreTree = $ExpectedCoreTree
  upstreamLicenseBlob = $ExpectedLicenseBlob
  uvLockBlob = $ExpectedUvLockBlob
  python = $ExpectedPython
  uvBuildTool = $ExpectedUv
  sealed = $true
  pythonIsolatedMode = $true
  runtimeDependencyResolution = $false
  projectBuildBackendInvoked = $false
  upstreamSourceTreePreserved = $sourceTreePreserved
  proxySourceNamespacePresent = $true
  proxyExtraDependencies = $false
  enterpriseDependencies = $false
  proxyServiceEntrypoints = $false
  proxyServiceActivated = $false
  rustNativePayload = $false
  excluded = @('proxy optional dependencies','litellm-enterprise','litellm-proxy-extras','generated Proxy console/service entrypoints','Rust native bridge','network resolution at runtime')
} | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $OutputRoot "runtime-manifest.json")
} catch {
  $message = $_.Exception.Message -replace '[\r\n]+', ' '
  Write-Output ('::error title=Model Brain runtime build ({0})::{1}' -f $BuildPhase, $message)
  throw
}