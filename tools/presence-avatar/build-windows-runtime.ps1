param(
  [Parameter(Mandatory = $false)]
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Fail([string]$Message) { throw "Presence Windows gate: $Message" }
function Read-Text([string]$RelativePath) { $path = Join-Path $RepositoryRoot $RelativePath; if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { Fail "missing required file: $RelativePath" }; return [IO.File]::ReadAllText($path) }

$manifest = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'integration\element-module\package.json') -Raw | ConvertFrom-Json
if ([string]$manifest.dependencies.'livekit-client' -ne '2.21.0') { Fail 'livekit-client must be pinned exactly to 2.21.0' }
$descriptor = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'config\upstreams\v21-presence-avatar-p0.json') -Raw | ConvertFrom-Json
if ([string]$descriptor.upstreams.liveKitClient.package -ne 'livekit-client@2.21.0') { Fail 'upstream descriptor LiveKit client identity mismatch' }
if ([string]$descriptor.upstreams.cyberVerse.commit -ne '459abae601411d191a1f4c99fe55b60d59e59305') { Fail 'CyberVerse commit identity mismatch' }
if ([string]$descriptor.runtime.cyberVerseDefaultEndpoint -ne 'http://127.0.0.1:8081') { Fail 'CyberVerse default service endpoint must remain loopback' }

$rendererSource = @(Read-Text 'integration\element-module\src\presenceLiveKit.ts'; Read-Text 'integration\element-module\src\PresenceWorkspace.tsx') -join "`n"
$runtimeSource = Read-Text 'electron\presenceAvatarRuntime.js'
$preloadSource = Read-Text 'electron\preload.js'
$mainSource = Read-Text 'electron\main.js'
$cyberVersePatchPath = Join-Path $RepositoryRoot 'upstream-patches\cyberverse\0001-yance-external-audio-ingress.patch'
$cyberVersePatch = [IO.File]::ReadAllText($cyberVersePatchPath)
if ($rendererSource -notmatch 'from\s+["'']livekit-client["'']') { Fail 'official livekit-client import is missing' }
if ($rendererSource -match 'new\s+RTCPeerConnection|createOffer\(|setLocalDescription\(|new\s+WebSocket\(') { Fail 'custom WebRTC transport is forbidden' }
if (($rendererSource + $preloadSource) -match 'livekitApiSecret|livekitApiKey|signLiveKit|mintLiveKit|SignJWT|jsonwebtoken') { Fail 'LiveKit API key/secret or signing authority reached renderer/preload source' }
if ($runtimeSource -match 'RTCPeerConnection|simple-peer|wrtc|lip.?sync|face.?mesh|avatar.?state.?machine') { Fail 'custom WebRTC/avatar runtime authority is forbidden' }
if ($mainSource -notmatch 'createPresenceAvatarRuntime|presence-avatar') { Fail 'Electron main must own the CyberVerse Presence service bridge' }
if ($preloadSource -notmatch 'createPresenceSession|closePresenceSession|getPresenceHealth|pushPresenceVoiceAudioChunk') { Fail 'sanitized Presence preload bridge is incomplete' }

# The Presence seam may add external-audio ingress to pinned CyberVerse, but it
# must not add a second avatar AV driver. The reviewed design requires the
# existing standard TTS driver to be extracted once and reused by both paths.
if ($cyberVersePatch -notmatch 'runAvatarAVDriver') { Fail 'CyberVerse patch must expose one shared runAvatarAVDriver' }
if ($cyberVersePatch -notmatch '(?m)^-.*GenerateAvatarStream') { Fail 'CyberVerse patch must remove the standard pipeline inline GenerateAvatarStream driver' }
if ($cyberVersePatch -notmatch '(?m)^-.*newVoiceAVSyncBuffer') { Fail 'CyberVerse patch must remove the standard pipeline inline AV sync driver' }
if ($cyberVersePatch -notmatch '(?m)^-.*RawAVSegment') { Fail 'CyberVerse patch must remove the standard pipeline inline AV segment publisher' }
if ($cyberVersePatch -notmatch 'return\s+o\.runAvatarAVDriver') { Fail 'external-audio must call the shared CyberVerse avatar AV driver' }
$addedAvatarGenerators = [regex]::Matches($cyberVersePatch, '(?m)^\+.*GenerateAvatarStream').Count
if ($addedAvatarGenerators -ne 1) { Fail "CyberVerse patch must add exactly one shared GenerateAvatarStream driver, got $addedAvatarGenerators" }

# Prove that the checked-in integration patch is replayable against the exact
# pinned mature-OSS source, not merely textually plausible. Fetch only the
# frozen CyberVerse commit into a disposable runner directory and run git's own
# patch validator without mutating the checked-out Yance worktree.
$cyberVerseCommit = [string]$descriptor.upstreams.cyberVerse.commit
$cyberVerseCheckout = Join-Path $env:RUNNER_TEMP 'yance-presence-cyberverse-upstream'
if (Test-Path -LiteralPath $cyberVerseCheckout) { Remove-Item -LiteralPath $cyberVerseCheckout -Recurse -Force }
New-Item -ItemType Directory -Force -Path $cyberVerseCheckout | Out-Null
$gitCommand = (Get-Command git.exe -ErrorAction Stop).Source
& $gitCommand -C $cyberVerseCheckout init --quiet
if ($LASTEXITCODE -ne 0) { Fail 'failed to initialize pinned CyberVerse replayability checkout' }
& $gitCommand -C $cyberVerseCheckout remote add origin 'https://github.com/Lynpoint/CyberVerse.git'
if ($LASTEXITCODE -ne 0) { Fail 'failed to configure pinned CyberVerse upstream remote' }
& $gitCommand -C $cyberVerseCheckout fetch --depth=1 origin $cyberVerseCommit
if ($LASTEXITCODE -ne 0) { Fail 'failed to fetch exact pinned CyberVerse commit' }
& $gitCommand -C $cyberVerseCheckout checkout --quiet --detach FETCH_HEAD
if ($LASTEXITCODE -ne 0) { Fail 'failed to checkout exact pinned CyberVerse commit' }
& $gitCommand -C $cyberVerseCheckout apply --check --whitespace=error-all $cyberVersePatchPath
if ($LASTEXITCODE -ne 0) { Fail 'CyberVerse external-audio patch is not replayable against the pinned upstream commit' }

& (Get-Command node -ErrorAction Stop).Source --check (Join-Path $RepositoryRoot 'electron\presenceAvatarRuntime.js')
if ($LASTEXITCODE -ne 0) { Fail 'Presence runtime syntax check failed' }

$harness = Join-Path $env:RUNNER_TEMP 'yance-presence-livekit-build'
if (Test-Path -LiteralPath $harness) { Remove-Item -LiteralPath $harness -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $harness 'src') | Out-Null
Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'integration\element-module\src\presenceLiveKit.ts') -Destination (Join-Path $harness 'src\presenceLiveKit.ts')
@'
{"private":true,"dependencies":{"livekit-client":"2.21.0","typescript":"5.9.2"}}
'@ | Set-Content -LiteralPath (Join-Path $harness 'package.json') -Encoding utf8
@'
{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"lib":["ES2022","DOM"],"noEmit":true,"skipLibCheck":true},"include":["src/presenceLiveKit.ts"]}
'@ | Set-Content -LiteralPath (Join-Path $harness 'tsconfig.json') -Encoding utf8

# Resolve the native Windows npm shim explicitly. Set-StrictMode is intentionally
# retained for this gate, but invoking bare `npm` from Windows PowerShell can
# select npm.ps1 and inherit this script's strict mode into that child scope.
# npm.cmd is the deterministic Node/npm CLI entrypoint for the Windows harness.
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
Push-Location $harness
try {
  & $npmCommand install --package-lock-only --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'failed to resolve exact LiveKit build harness lock' }
  & $npmCommand ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'failed to install exact LiveKit build harness' }
  .\node_modules\.bin\tsc.cmd -p tsconfig.json
  if ($LASTEXITCODE -ne 0) { Fail 'official livekit-client renderer seam did not type-check' }
} finally { Pop-Location }
Write-Host 'Presence Windows gate: pinned CyberVerse patch replayability, official LiveKit renderer build, shared avatar AV driver, service preflight, secret boundary, and custom-runtime rejection passed.'
