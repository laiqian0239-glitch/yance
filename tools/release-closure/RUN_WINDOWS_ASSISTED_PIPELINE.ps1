[CmdletBinding()]
param(
  [string]$DeliveryRoot = '',
  [string]$ConfigPath = '',
  [string]$NodeRoot = 'D:\node-v22.16.0-win-x64',
  [string]$RunRoot = '',
  [string]$ElectronArchive = 'D:\Yance-Build-Tools\electron-v39.8.5-win32-x64.zip',
  [string]$MakensisPath = 'D:\Yance-Build-Tools\NSIS\makensis.exe',
  [switch]$DiagnosticOnly,
  [switch]$SkipBuilder
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 does not reliably expose $PSScriptRoot while parameter
# default expressions are being evaluated. Resolve script-relative defaults only
# after parameter binding has completed.
if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) { $DeliveryRoot = $PSScriptRoot }
if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) { throw 'YANCE_ASSISTED_DELIVERY_ROOT_UNRESOLVED' }
$DeliveryRoot = [IO.Path]::GetFullPath($DeliveryRoot)

function Write-AtomicText([string]$Path, [string]$Content, [string]$Encoding = 'utf8') {
  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $temporary = "$Path.$PID.$([DateTime]::UtcNow.Ticks).tmp"
  Set-Content -LiteralPath $temporary -Value $Content -NoNewline -Encoding $Encoding
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-AtomicJson([string]$Path, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 20
  if ([string]::IsNullOrWhiteSpace($json)) {
    if ($Value -is [System.Array] -or $Value -is [System.Collections.IList]) { $json = '[]' }
    elseif ($null -eq $Value) { $json = 'null' }
    else { throw "Unable to serialize JSON document: $Path" }
  }
  Write-AtomicText $Path $json 'utf8'
}

function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "YANCE_ASSISTED_REQUIRED_FILE_MISSING $Label is missing: $Path" }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}


function Write-PipelineStatus([string]$Stage, [string]$Status, [string]$Message, [hashtable]$Details = @{}) {
  $stamp = [DateTime]::Now.ToString('HH:mm:ss')
  Write-Host ("[{0}] {1} {2}: {3}" -f $stamp, $Stage, $Status, $Message) -ForegroundColor Cyan
  if (-not [string]::IsNullOrWhiteSpace($script:LiveStatusPath)) {
    $record = [ordered]@{
      schemaVersion = 1
      documentType = 'YANCE_WINDOWS_ASSISTED_LIVE_STATUS'
      updatedAtUtc = [DateTime]::UtcNow.ToString('o')
      stage = $Stage
      status = $Status
      message = $Message
    }
    foreach ($key in $Details.Keys) { $record[$key] = $Details[$key] }
    Write-AtomicJson $script:LiveStatusPath $record
  }
}

function Get-LogTail([string]$Path, [int]$LineCount = 20) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  return ((Get-Content -LiteralPath $Path -Tail $LineCount -ErrorAction SilentlyContinue) -join "`n")
}

function Start-ConsoleHeartbeat([string]$Stage) {
  if ([string]::IsNullOrWhiteSpace($script:LogsRoot) -or [string]::IsNullOrWhiteSpace($script:RunRoot)) { return $null }
  $heartbeatScript = Join-Path $script:LogsRoot ("heartbeat-{0}.ps1" -f $Stage)
  $heartbeatPath = Join-Path $script:RunRoot 'PIPELINE_HEARTBEAT.txt'
  $heartbeatSource = @'
param([string]$Stage, [string]$StatusPath, [string]$RunRoot, [int]$ParentProcessId)
$ErrorActionPreference = 'SilentlyContinue'
while (Get-Process -Id $ParentProcessId -ErrorAction SilentlyContinue) {
  $now = [DateTime]::Now.ToString('HH:mm:ss')
  $utc = [DateTime]::UtcNow.ToString('o')
  $detail = 'validation is active; do not close this window'
  $roundStatusCandidates = @(
    (Join-Path $RunRoot 'DIAGNOSTIC\Round1\LIVE_STATUS.json'),
    (Join-Path $RunRoot 'VALIDATION\Round1\LIVE_STATUS.json'),
    (Join-Path $RunRoot 'VALIDATION\Round2\LIVE_STATUS.json')
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending
  if ($roundStatusCandidates.Count -gt 0) {
    try {
      $roundStatus = Get-Content -LiteralPath $roundStatusCandidates[0] -Raw | ConvertFrom-Json
      if ($roundStatus.phase) {
        $detail = ("Round {0} {1} / {2}: {3}" -f $roundStatus.round, $roundStatus.verificationMode, $roundStatus.phase, $roundStatus.message)
      }
    }
    catch {}
  }
  Write-Host ("[{0}] {1} RUNNING: {2}" -f $now, $Stage, $detail) -ForegroundColor DarkCyan
  Set-Content -LiteralPath $StatusPath -Value ("{0} {1} RUNNING {2}" -f $utc, $Stage, $detail) -NoNewline -Encoding ascii
  Start-Sleep -Seconds 10
}
'@
  Set-Content -LiteralPath $heartbeatScript -Value $heartbeatSource -Encoding ascii
  try {
    $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$heartbeatScript`" -Stage `"$Stage`" -StatusPath `"$heartbeatPath`" -RunRoot `"$script:RunRoot`" -ParentProcessId $PID"
    return Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -NoNewWindow -PassThru
  }
  catch {
    Write-Host "Heartbeat helper could not start: $($_.Exception.Message)" -ForegroundColor Yellow
    return $null
  }
}

function Stop-ConsoleHeartbeat($HeartbeatProcess) {
  if ($null -eq $HeartbeatProcess) { return }
  try {
    if (-not $HeartbeatProcess.HasExited) { Stop-Process -Id $HeartbeatProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  catch {}
}

function Complete-LoggedProcess([int]$Code, [string]$Stdout, [string]$Stderr, [string]$LogPrefix, [string]$Stage, [string]$FilePath) {
  Write-AtomicText "$LogPrefix.exit.txt" ([string]$Code) 'ascii'
  if ($Code -ne 0) {
    $tail = Get-LogTail $Stderr 30
    if ([string]::IsNullOrWhiteSpace($tail)) { $tail = Get-LogTail $Stdout 30 }
    Write-PipelineStatus $Stage 'FAIL' "Process failed with exit code $Code" @{ exitCode = $Code }
    if (-not [string]::IsNullOrWhiteSpace($tail)) {
      Write-Host '----- failure log tail -----' -ForegroundColor Red
      Write-Host $tail -ForegroundColor Red
      Write-Host '----------------------------' -ForegroundColor Red
    }
    throw "YANCE_ASSISTED_SUBPROCESS_FAILED Stage $Stage failed with exit code ${Code}: $FilePath"
  }
  Write-PipelineStatus $Stage 'PASS' 'Process completed successfully' @{ exitCode = $Code }
}

function Copy-StableTree([string]$Source, [string]$Destination, [string[]]$ExcludedDirectoryNames = @()) {
  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $arguments = @($Source, $Destination, '/E', '/COPY:DAT', '/DCOPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  foreach ($name in $ExcludedDirectoryNames) { $arguments += @('/XD', (Join-Path $Source $name)) }
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & robocopy.exe @arguments *> $null
    $code = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previousErrorActionPreference }
  if ($code -gt 7) { throw "YANCE_ASSISTED_RESULT_COPY_FAILED robocopy failed with exit code $code for $Source" }
}

function Copy-RoundEvidence([string]$SourceRound, [string]$DestinationRound) {
  if (-not (Test-Path -LiteralPath $SourceRound -PathType Container)) { return }
  New-Item -ItemType Directory -Path $DestinationRound -Force | Out-Null
  Get-ChildItem -LiteralPath $SourceRound -File -ErrorAction SilentlyContinue | Copy-Item -Destination $DestinationRound -Force
  Copy-StableTree (Join-Path $SourceRound 'logs') (Join-Path $DestinationRound 'logs')
  Copy-StableTree (Join-Path $SourceRound 'evidence') (Join-Path $DestinationRound 'evidence') @('npm-cache', 'temp')
}

function New-ResultPackage([string]$SourceRoot, [string]$DestinationZip) {
  $staging = "$SourceRoot-RESULT-STAGING"
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $DestinationZip -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $staging -Force | Out-Null

  Get-ChildItem -LiteralPath $SourceRoot -File -ErrorAction SilentlyContinue | Copy-Item -Destination $staging -Force
  Copy-StableTree (Join-Path $SourceRoot 'pipeline-logs') (Join-Path $staging 'pipeline-logs')
  Copy-RoundEvidence (Join-Path $SourceRoot 'DIAGNOSTIC\Round1') (Join-Path $staging 'DIAGNOSTIC\Round1')
  Copy-RoundEvidence (Join-Path $SourceRoot 'VALIDATION\Round1') (Join-Path $staging 'VALIDATION\Round1')
  Copy-RoundEvidence (Join-Path $SourceRoot 'VALIDATION\Round2') (Join-Path $staging 'VALIDATION\Round2')

  $validationRoot = Join-Path $SourceRoot 'VALIDATION'
  $validationDestination = Join-Path $staging 'VALIDATION'
  if (Test-Path -LiteralPath $validationRoot -PathType Container) {
    New-Item -ItemType Directory -Path $validationDestination -Force | Out-Null
    Get-ChildItem -LiteralPath $validationRoot -File -ErrorAction SilentlyContinue | Copy-Item -Destination $validationDestination -Force
  }

  Copy-StableTree (Join-Path $SourceRoot 'FINAL_BUILDER\evidence') (Join-Path $staging 'FINAL_BUILDER\evidence') @('npm-cache', 'bundle-verify.git')

  Write-AtomicJson (Join-Path $staging 'RESULT_PACKAGE_MANIFEST.json') ([ordered]@{
    schemaVersion = 1
    documentType = 'YANCE_WINDOWS_RESULT_PACKAGE_MANIFEST'
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    sourceRunRoot = $SourceRoot
    included = @('pipeline top-level files', 'pipeline logs', 'round JSON/TXT', 'round logs', 'round evidence', 'preacceptance', 'builder evidence and outputs')
    excluded = @('fresh source clones', 'node_modules', 'npm caches', 'temporary directories', 'bare bundle verification repositories')
  })

  try {
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $DestinationZip -CompressionLevel Optimal -Force
  }
  catch {
    if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw }
    Remove-Item -LiteralPath $DestinationZip -Force -ErrorAction SilentlyContinue
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      & tar.exe -a -c -f $DestinationZip -C $staging .
      $tarExitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    if ($tarExitCode -ne 0) { throw "YANCE_ASSISTED_RESULT_ARCHIVE_FAILED tar.exe exited with $tarExitCode" }
  }
  if (-not (Test-Path -LiteralPath $DestinationZip -PathType Leaf)) { throw 'YANCE_ASSISTED_RESULT_ARCHIVE_MISSING Result ZIP was not created' }
  $zipSha = Get-Sha256 $DestinationZip
  Write-AtomicText "$DestinationZip.sha256.txt" ("{0}  {1}" -f $zipSha, (Split-Path -Leaf $DestinationZip)) 'ascii'
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  return $zipSha
}

function Assert-Sha256([string]$Path, [string]$Expected, [string]$Label) {
  $actual = Get-Sha256 $Path
  if ($actual -ne $Expected.ToLowerInvariant()) { throw "YANCE_ASSISTED_SHA256_MISMATCH $Label SHA-256 mismatch: $actual" }
}

function Invoke-LoggedPowerShell([string]$ScriptPath, [string[]]$Arguments, [string]$LogPrefix, [string]$Stage) {
  $stdout = "$LogPrefix.stdout.log"
  $stderr = "$LogPrefix.stderr.log"
  Write-PipelineStatus $Stage 'STARTED' 'PowerShell subprocess started' @{ scriptPath = $ScriptPath }
  $heartbeat = Start-ConsoleHeartbeat $Stage
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 1> $stdout 2> $stderr
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Stop-ConsoleHeartbeat $heartbeat
  }
  Complete-LoggedProcess $code $stdout $stderr $LogPrefix $Stage $ScriptPath
  return $code
}

function Invoke-LoggedNative([string]$FilePath, [string[]]$Arguments, [string]$LogPrefix, [string]$WorkingDirectory = $PWD.Path, [string]$Stage = 'native-command') {
  $stdout = "$LogPrefix.stdout.log"
  $stderr = "$LogPrefix.stderr.log"
  Write-PipelineStatus $Stage 'STARTED' 'Native subprocess started' @{ filePath = $FilePath; workingDirectory = $WorkingDirectory }
  $heartbeat = Start-ConsoleHeartbeat $Stage
  $previousErrorActionPreference = $ErrorActionPreference
  Push-Location $WorkingDirectory
  try {
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments 1> $stdout 2> $stderr
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
    Stop-ConsoleHeartbeat $heartbeat
  }
  Complete-LoggedProcess $code $stdout $stderr $LogPrefix $Stage $FilePath
  return $code
}

function Assert-RoundPass([string]$ResultPath, [string]$ExpectedMode, [int]$ExpectedRound) {
  Assert-File $ResultPath "Round $ExpectedRound result"
  $record = Get-Content -LiteralPath $ResultPath -Raw | ConvertFrom-Json
  if ($record.status -ne 'PASS' -or $record.verificationMode -ne $ExpectedMode -or [int]$record.round -ne $ExpectedRound) {
    throw "YANCE_ASSISTED_ROUND_FAILED Round $ExpectedRound is not $ExpectedMode PASS: $($record.status) / $($record.reasonCode)"
  }
  if ($ExpectedMode -eq 'STRICT' -and -not [bool]$record.formalRoundEligible) {
    throw "YANCE_ASSISTED_ROUND_INELIGIBLE Round $ExpectedRound is not formally eligible"
  }
  return $record
}

$startedAt = [DateTime]::UtcNow
$finalStatus = 'FAIL'
$reasonCode = 'YANCE_ASSISTED_PIPELINE_FAILED'
$message = $null
$resultZip = $null
$config = $null
$runSummary = [ordered]@{}
$CurrentStage = 'bootstrap'
$script:LiveStatusPath = $null

try {
  $DeliveryRoot = [System.IO.Path]::GetFullPath($DeliveryRoot)
  if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    $candidates = @(Get-ChildItem -LiteralPath $DeliveryRoot -Filter 'WINDOWS_ASSISTED_VALIDATION_CONFIG_*.json' -File)
    if ($candidates.Count -ne 1) { throw "YANCE_ASSISTED_CONFIG_NOT_UNIQUE Expected exactly one assisted validation config in $DeliveryRoot" }
    $ConfigPath = $candidates[0].FullName
  }
  Assert-File $ConfigPath 'Assisted validation config'
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json

  $shortCommit = [string]$config.expectedCommit
  $shortCommit = $shortCommit.Substring(0, 7)
  if ([string]::IsNullOrWhiteSpace($RunRoot)) { $RunRoot = "D:\Yance-Assisted-$shortCommit" }
  $RunRoot = [System.IO.Path]::GetFullPath($RunRoot)
  if ($RunRoot.Length -lt 12 -or $RunRoot -match '^[A-Za-z]:\\?$') { throw "YANCE_ASSISTED_UNSAFE_RUN_ROOT Unsafe RunRoot: $RunRoot" }
  if (Test-Path -LiteralPath $RunRoot) { Remove-Item -LiteralPath $RunRoot -Recurse -Force }
  New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
  $LogsRoot = Join-Path $RunRoot 'pipeline-logs'
  New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
  $script:LiveStatusPath = Join-Path $RunRoot 'LIVE_STATUS.json'
  Write-PipelineStatus 'bootstrap' 'STARTED' 'Yance Windows one-click validation started. Heartbeats will appear continuously; do not close this window.' @{ runRoot = $RunRoot }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  $isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdministrator) { throw 'YANCE_ASSISTED_ADMIN_REQUIRED Run WorkBuddy with administrator approval' }

  $bundle = Join-Path $DeliveryRoot ([string]$config.bundleFile)
  $runner = Join-Path $DeliveryRoot ([string]$config.runnerFile)
  $builder = Join-Path $DeliveryRoot ([string]$config.builderFile)
  $deliveryVerifier = Join-Path $DeliveryRoot ([string]$config.deliveryVerifierFile)
  $nodeExe = Join-Path $NodeRoot 'node.exe'
  $npmCli = Join-Path $NodeRoot 'node_modules\npm\bin\npm-cli.js'
  Assert-File $bundle 'Git Bundle'
  Assert-File $runner 'Windows verification runner'
  Assert-File $builder 'Windows Final Builder'
  Assert-File $deliveryVerifier 'Delivery verifier'
  Assert-File $nodeExe 'Pinned Node executable'
  Assert-File $npmCli 'Pinned npm CLI'
  Assert-Sha256 $bundle ([string]$config.bundleSha256) 'Git Bundle'
  Assert-Sha256 $runner ([string]$config.runnerSha256) 'Windows verification runner'
  Assert-Sha256 $builder ([string]$config.builderSha256) 'Windows Final Builder'
  Assert-Sha256 $deliveryVerifier ([string]$config.deliveryVerifierSha256) 'Delivery verifier'
  Assert-Sha256 $PSCommandPath ([string]$config.assistedPipelineSha256) 'Assisted pipeline'

  $CurrentStage = 'delivery-verify'
  Invoke-LoggedPowerShell $deliveryVerifier @('-DeliveryRoot', $DeliveryRoot) (Join-Path $LogsRoot 'delivery-verify') $CurrentStage | Out-Null
  $CurrentStage = 'node-binding'
  Write-PipelineStatus $CurrentStage 'RUNNING' 'Checking pinned Node and npm versions'
  $nodeVersion = (& $nodeExe --version).Trim()
  $npmVersion = (& $nodeExe $npmCli --version).Trim()
  if ($nodeVersion -ne 'v22.16.0' -or $npmVersion -ne '10.9.2') {
    throw "YANCE_ASSISTED_NODE_BINDING_MISMATCH Expected Node v22.16.0/npm 10.9.2; got $nodeVersion/$npmVersion"
  }
  Write-PipelineStatus $CurrentStage 'PASS' "Node $nodeVersion / npm $npmVersion"

  $common = @(
    '-BundlePath', $bundle,
    '-ExpectedBundleSha256', ([string]$config.bundleSha256),
    '-ExpectedBranch', ([string]$config.expectedBranch),
    '-ExpectedCommit', ([string]$config.expectedCommit),
    '-ExpectedTree', ([string]$config.expectedTree),
    '-NodeRoot', $NodeRoot
  )

  $diagnosticRoot = Join-Path $RunRoot 'DIAGNOSTIC'
  $CurrentStage = 'diagnostic-round'
  Invoke-LoggedPowerShell $runner (@('-Round', '1', '-VerificationMode', 'DIAGNOSTIC', '-ValidationRoot', $diagnosticRoot) + $common) (Join-Path $LogsRoot 'diagnostic') $CurrentStage | Out-Null
  $diagnosticResult = Join-Path $diagnosticRoot 'Round1\ROUND_RESULT.json'
  [void](Assert-RoundPass $diagnosticResult 'DIAGNOSTIC' 1)
  $runSummary.diagnosticResult = $diagnosticResult

  if ($DiagnosticOnly) {
    $finalStatus = 'PASS'
    $reasonCode = 'YANCE_ASSISTED_DIAGNOSTIC_PASS'
    $message = 'Diagnostic verification completed successfully'
  }
  else {
    $validationRoot = Join-Path $RunRoot 'VALIDATION'
    $CurrentStage = 'strict-round-1'
    Invoke-LoggedPowerShell $runner (@('-Round', '1', '-VerificationMode', 'STRICT', '-ValidationRoot', $validationRoot) + $common) (Join-Path $LogsRoot 'strict-round1') $CurrentStage | Out-Null
    $CurrentStage = 'strict-round-2'
    Invoke-LoggedPowerShell $runner (@('-Round', '2', '-VerificationMode', 'STRICT', '-ValidationRoot', $validationRoot) + $common) (Join-Path $LogsRoot 'strict-round2') $CurrentStage | Out-Null
    $round1 = Join-Path $validationRoot 'Round1\ROUND_RESULT.json'
    $round2 = Join-Path $validationRoot 'Round2\ROUND_RESULT.json'
    [void](Assert-RoundPass $round1 'STRICT' 1)
    [void](Assert-RoundPass $round2 'STRICT' 2)
    $runSummary.round1Result = $round1
    $runSummary.round2Result = $round2

    $preSource = Join-Path $RunRoot 'preacceptance-source'
    $CurrentStage = 'preacceptance-clone'
    Invoke-LoggedNative 'git' @('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone', '--branch', ([string]$config.expectedBranch), $bundle, $preSource) (Join-Path $LogsRoot 'preacceptance-clone') $RunRoot $CurrentStage | Out-Null
    $head = (& git -C $preSource rev-parse HEAD).Trim()
    $tree = (& git -C $preSource rev-parse 'HEAD^{tree}').Trim()
    $branch = (& git -C $preSource branch --show-current).Trim()
    $dirty = ((& git -C $preSource status --porcelain=v1 --untracked-files=all) -join "`n")
    if ($head -ne [string]$config.expectedCommit -or $tree -ne [string]$config.expectedTree -or $branch -ne [string]$config.expectedBranch -or $dirty) {
      throw 'YANCE_ASSISTED_PREACCEPTANCE_SOURCE_MISMATCH Fresh preacceptance clone identity mismatch'
    }

    $r1sha = Get-Sha256 $round1
    $r2sha = Get-Sha256 $round2
    $preacceptance = Join-Path $validationRoot ("WP7_PREACCEPTANCE_{0}.json" -f $shortCommit)
    $preScript = Join-Path $preSource 'tools\release-closure\create-windows-preacceptance.js'
    $CurrentStage = 'preacceptance-create'
    Invoke-LoggedNative $nodeExe @(
      $preScript,
      '--output', $preacceptance,
      '--round1-result', $round1,
      '--round1-sha256', $r1sha,
      '--round2-result', $round2,
      '--round2-sha256', $r2sha,
      '--expected-branch', ([string]$config.expectedBranch),
      '--expected-commit', ([string]$config.expectedCommit),
      '--expected-tree', ([string]$config.expectedTree)
    ) (Join-Path $LogsRoot 'preacceptance-create') $preSource $CurrentStage | Out-Null
    $preSha = Get-Sha256 $preacceptance
    $runSummary.preacceptance = $preacceptance
    $runSummary.preacceptanceSha256 = $preSha

    if ($SkipBuilder) {
      $finalStatus = 'PASS'
      $reasonCode = 'YANCE_ASSISTED_STRICT_ROUNDS_PASS'
      $message = 'Diagnostic and both strict Windows rounds completed successfully; Builder was intentionally skipped'
    }
    elseif (-not (Test-Path -LiteralPath $ElectronArchive -PathType Leaf) -or -not (Test-Path -LiteralPath $MakensisPath -PathType Leaf)) {
      $missing = @()
      if (-not (Test-Path -LiteralPath $ElectronArchive -PathType Leaf)) { $missing += $ElectronArchive }
      if (-not (Test-Path -LiteralPath $MakensisPath -PathType Leaf)) { $missing += $MakensisPath }
      Write-AtomicJson (Join-Path $RunRoot 'BUILD_TOOLS_BLOCKER.json') ([ordered]@{
        status = 'BLOCKED'; reasonCode = 'YANCE_ASSISTED_BUILD_TOOLS_MISSING'; missing = $missing
        electronArchive = $ElectronArchive; makensisPath = $MakensisPath
      })
      $finalStatus = 'BLOCKED'
      $reasonCode = 'YANCE_ASSISTED_BUILD_TOOLS_MISSING'
      $message = "Validation passed, but Final Builder tools are missing: $($missing -join '; ')"
    }
    else {
      $builderRoot = Join-Path $RunRoot 'FINAL_BUILDER'
      $workRoot = Join-Path $builderRoot 'source'
      $evidenceRoot = Join-Path $builderRoot 'evidence'
      $buildUtc = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
      $CurrentStage = 'final-builder'
      Invoke-LoggedPowerShell $builder @(
        '-SourceBundle', $bundle,
        '-WorkRoot', $workRoot,
        '-EvidenceRoot', $evidenceRoot,
        '-PreacceptanceRecord', $preacceptance,
        '-PreacceptanceSha256', $preSha,
        '-WindowsRound1Result', $round1,
        '-WindowsRound1Sha256', $r1sha,
        '-WindowsRound2Result', $round2,
        '-WindowsRound2Sha256', $r2sha,
        '-ElectronArchive', $ElectronArchive,
        '-MakensisPath', $MakensisPath,
        '-ExpectedCommit', ([string]$config.expectedCommit),
        '-ExpectedTree', ([string]$config.expectedTree),
        '-ExpectedBranch', ([string]$config.expectedBranch),
        '-ExpectedBundleSha256', ([string]$config.bundleSha256),
        '-NodeRoot', $NodeRoot,
        '-BuildTimestampUtc', $buildUtc
      ) (Join-Path $LogsRoot 'final-builder') $CurrentStage | Out-Null
      $exitFile = Join-Path $evidenceRoot 'overall-exit-code.txt'
      Assert-File $exitFile 'Builder overall exit code'
      if ((Get-Content -LiteralPath $exitFile -Raw).Trim() -ne '0') { throw 'YANCE_ASSISTED_FINAL_BUILDER_FAILED Builder exit code is not zero' }
      $runSummary.builderEvidence = $evidenceRoot
      $finalStatus = 'PASS'
      $reasonCode = 'YANCE_ASSISTED_BUILDER_PASS'
      $message = 'Diagnostic, strict rounds, preacceptance and Final Builder completed successfully; interactive Windows UAT remains required'
    }
  }
}
catch {
  $rawMessage = $_.Exception.Message
  $reasonCode = if ($rawMessage -match '^([A-Z0-9_]{5,})\b') { $Matches[1] } else { 'YANCE_ASSISTED_PIPELINE_FAILED' }
  $message = "Stage ${CurrentStage}: $rawMessage"
  $finalStatus = 'FAIL'
  if ($RunRoot -and (Test-Path -LiteralPath $RunRoot)) {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $RunRoot 'PIPELINE_ERROR.log') -Encoding utf8
  }
}
finally {
  if ($RunRoot -and (Test-Path -LiteralPath $RunRoot)) {
    $summaryPath = Join-Path $RunRoot 'ASSISTED_PIPELINE_RESULT.json'
    $summary = [ordered]@{
      schemaVersion = 2
      documentType = 'YANCE_WINDOWS_ASSISTED_PIPELINE_RESULT'
      status = $finalStatus
      reasonCode = $reasonCode
      message = $message
      failedStage = $(if ($finalStatus -eq 'FAIL') { $CurrentStage } else { $null })
      startedAtUtc = $startedAt.ToString('o')
      completedAtUtc = [DateTime]::UtcNow.ToString('o')
      deliveryRoot = $DeliveryRoot
      configPath = $ConfigPath
      runRoot = $RunRoot
      nodeRoot = $NodeRoot
      electronArchive = $ElectronArchive
      makensisPath = $MakensisPath
      releaseApproved = $false
      formalInstallerAuthorized = ($finalStatus -eq 'PASS' -and -not $DiagnosticOnly -and -not $SkipBuilder)
      windowsUatRequired = $true
      outputs = $runSummary
    }
    Write-AtomicJson $summaryPath $summary
    Write-AtomicText (Join-Path $RunRoot 'FINAL_STATUS.txt') $finalStatus 'ascii'
    Write-PipelineStatus 'result-packaging' 'RUNNING' 'Collecting stable logs and evidence; source clones and caches are excluded'
    $resultZip = "$RunRoot-RESULT.zip"
    try {
      $resultZipSha = New-ResultPackage $RunRoot $resultZip
      $runSummary.resultZipSha256 = $resultZipSha
      Write-PipelineStatus 'result-packaging' 'PASS' "Result ZIP created: $resultZip" @{ sha256 = $resultZipSha }
    }
    catch {
      $packageError = $_.Exception.Message
      $finalStatus = 'FAIL'
      $reasonCode = if ($packageError -match '^([A-Z0-9_]{5,})\b') { $Matches[1] } else { 'YANCE_ASSISTED_RESULT_PACKAGING_FAILED' }
      $message = "Stage result-packaging: $packageError"
      Write-AtomicText (Join-Path $RunRoot 'FINAL_STATUS.txt') $finalStatus 'ascii'
      $summary.status = $finalStatus
      $summary.reasonCode = $reasonCode
      $summary.message = $message
      $summary.failedStage = 'result-packaging'
      $summary.completedAtUtc = [DateTime]::UtcNow.ToString('o')
      Write-AtomicJson $summaryPath $summary
      Write-PipelineStatus 'result-packaging' 'FAIL' $packageError
      Set-Content -LiteralPath (Join-Path $RunRoot 'RESULT_PACKAGING_ERROR.log') -Value ($_ | Out-String) -Encoding utf8
    }
  }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
$finalColor = if ($finalStatus -eq 'PASS') { 'Green' } elseif ($finalStatus -eq 'BLOCKED') { 'Yellow' } else { 'Red' }
Write-Host ("FINAL STATUS: {0}" -f $finalStatus) -ForegroundColor $finalColor
Write-Host $message
if ($resultZip) { Write-Host ("RESULT ZIP: {0}" -f $resultZip) -ForegroundColor Green }
Write-Host '============================================================' -ForegroundColor DarkCyan
if ($finalStatus -eq 'FAIL') { exit 1 }
if ($finalStatus -eq 'BLOCKED') { exit 2 }
exit 0
