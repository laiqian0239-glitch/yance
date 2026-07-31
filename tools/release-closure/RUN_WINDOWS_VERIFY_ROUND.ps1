[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(1, 2)]
  [int]$Round,

  [Parameter(Mandatory = $true)]
  [string]$BundlePath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedBundleSha256,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedBranch,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedCommit,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedTree,

  [Parameter(Mandatory = $true)]
  [string]$NodeRoot,

  [ValidateSet('STRICT', 'DIAGNOSTIC')]
  [string]$VerificationMode = 'STRICT',

  [string]$ValidationRoot = 'D:\Yance-Windows-Validation'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$NodeExe = Join-Path $NodeRoot 'node.exe'
$NpmCli = Join-Path $NodeRoot 'node_modules\npm\bin\npm-cli.js'
$RoundRoot = Join-Path $ValidationRoot ("Round{0}" -f $Round)
$SourceRoot = Join-Path $RoundRoot 'source'
$CacheRoot = Join-Path $RoundRoot 'npm-cache'
$RequestedTempRoot = Join-Path $RoundRoot 'temp'
$TempRoot = $RequestedTempRoot
$EvidenceRoot = Join-Path $RoundRoot 'evidence'
$LogsRoot = Join-Path $RoundRoot 'logs'
$EnvironmentManifest = Join-Path $RoundRoot 'ENVIRONMENT_MANIFEST.json'
$StepResultsPath = Join-Path $RoundRoot 'STEP_RESULTS.json'
$TimelinePath = Join-Path $RoundRoot 'PROCESS_TIMELINE.json'
$RoundResultPath = Join-Path $RoundRoot 'ROUND_RESULT.json'
$FinalStatusPath = Join-Path $RoundRoot 'FINAL_STATUS.txt'
$TempSelectionPath = Join-Path $RoundRoot 'TEMP_SELECTION.json'
$LiveStatusPath = Join-Path $RoundRoot 'LIVE_STATUS.json'
$RunnerSha256 = ''
$BundleSha256 = ''
$nodeVersion = ''
$npmVersion = ''
$gitVersion = ''
$head = ''
$tree = ''
$branch = ''
$crCount = -1
$repositoryCleanBefore = $false
$repositoryCleanAfter = $false
$gitFsckBefore = 'NOT_EXECUTED'
$gitFsckAfter = 'NOT_EXECUTED'
$verifyExitCode = $null
$failureMessage = $null
$failureReasonCode = $null
$overallStatus = 'FAIL'
$originalPath = $env:PATH
$ResidualProcesses = @()
$ResidualCleanupStatus = 'NOT_EXECUTED'
$systemTempBase = [System.IO.Path]::GetTempPath()
$Timeline = New-Object System.Collections.ArrayList
$StepResults = New-Object System.Collections.ArrayList
$RoundStartedAt = [DateTime]::UtcNow
$CurrentPhase = 'bootstrap'
$TempSelectionEvidence = @()

function Write-AtomicText([string]$Path, [string]$Content, [string]$Encoding = 'utf8') {
  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $temporary = "$Path.$PID.$([DateTime]::UtcNow.Ticks).tmp"
  Set-Content -LiteralPath $temporary -Value $Content -NoNewline -Encoding $Encoding
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-AtomicJson([string]$Path, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 16
  if ([string]::IsNullOrWhiteSpace($json)) {
    if ($Value -is [System.Array] -or $Value -is [System.Collections.IList]) { $json = '[]' }
    elseif ($null -eq $Value) { $json = 'null' }
    else { throw "Unable to serialize JSON document: $Path" }
  }
  Write-AtomicText $Path $json 'utf8'
}

function Add-TimelineEvent([string]$Phase, [string]$Status, [hashtable]$Details = @{}) {
  $row = [ordered]@{
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    phase = $Phase
    status = $Status
  }
  foreach ($key in $Details.Keys) { $row[$key] = $Details[$key] }
  [void]$Timeline.Add([pscustomobject]$row)
  Write-AtomicJson $TimelinePath @($Timeline)
}

function Add-StepResult([string]$Name, [string]$Status, [datetime]$StartedAt, [hashtable]$Details = @{}) {
  $row = [ordered]@{
    name = $Name
    status = $Status
    startedAtUtc = $StartedAt.ToUniversalTime().ToString('o')
    endedAtUtc = [DateTime]::UtcNow.ToString('o')
    durationMs = [int64](([DateTime]::UtcNow - $StartedAt.ToUniversalTime()).TotalMilliseconds)
  }
  foreach ($key in $Details.Keys) { $row[$key] = $Details[$key] }
  [void]$StepResults.Add([pscustomobject]$row)
  Write-AtomicJson $StepResultsPath @($StepResults)
}

function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}


function Write-LiveStatus([string]$Phase, [string]$Status, [string]$Message, [hashtable]$Details = @{}) {
  $record = [ordered]@{
    schemaVersion = 1
    documentType = 'YANCE_WINDOWS_VERIFY_LIVE_STATUS'
    updatedAtUtc = [DateTime]::UtcNow.ToString('o')
    round = $Round
    verificationMode = $VerificationMode
    phase = $Phase
    status = $Status
    message = $Message
  }
  foreach ($key in $Details.Keys) { $record[$key] = $Details[$key] }
  Write-AtomicJson $LiveStatusPath $record
  $stamp = [DateTime]::Now.ToString('HH:mm:ss')
  Write-Host ("[{0}] Round {1} {2} {3}: {4}" -f $stamp, $Round, $VerificationMode, $Phase, $Message) -ForegroundColor Cyan
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $PWD.Path) {
  $previousErrorActionPreference = $ErrorActionPreference
  Push-Location $WorkingDirectory
  try {
    $ErrorActionPreference = 'Continue'
    $output = & $FilePath @Arguments 2>&1
    $code = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
  if ($code -ne 0) { throw "Native command failed with exit code ${code}: $FilePath $($Arguments -join ' ')" }
  return @($output | ForEach-Object { $_.ToString() })
}

function Invoke-LoggedNode([string[]]$Arguments, [string]$Name, [string]$WorkingDirectory = $SourceRoot) {
  $started = [DateTime]::UtcNow
  $stdout = Join-Path $LogsRoot "$Name.stdout.log"
  $stderr = Join-Path $LogsRoot "$Name.stderr.log"
  Add-TimelineEvent $Name 'STARTED' @{ node = $NodeExe; workingDirectory = $WorkingDirectory }
  Write-LiveStatus $Name 'RUNNING' "$Name started" @{ workingDirectory = $WorkingDirectory }
  $previousErrorActionPreference = $ErrorActionPreference
  Push-Location $WorkingDirectory
  try {
    # This exact Windows PowerShell 5.1 path completed npm ci and WP7 on the
    # user's real Windows host. Native stderr warnings are diagnostic only;
    # success or failure is determined exclusively by $LASTEXITCODE.
    $ErrorActionPreference = 'Continue'
    & $NodeExe @Arguments 1> $stdout 2> $stderr
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
    Pop-Location
  }
  Write-AtomicText (Join-Path $LogsRoot "$Name.exit.txt") ([string]$exitCode) 'ascii'
  Add-StepResult $Name ($(if ($exitCode -eq 0) { 'PASS' } else { 'FAIL' })) $started @{ exitCode = $exitCode; stdout = $stdout; stderr = $stderr }
  Add-TimelineEvent $Name ($(if ($exitCode -eq 0) { 'FINISHED' } else { 'FAILED' })) @{ exitCode = $exitCode }
  Write-LiveStatus $Name ($(if ($exitCode -eq 0) { 'PASS' } else { 'FAIL' })) "$Name finished with exit code $exitCode" @{ exitCode = $exitCode }
  if ($exitCode -ne 0) { throw "$Name failed with exit code $exitCode. See $stdout and $stderr" }
  return $exitCode
}

function Normalize-WindowsPathForLexicalComparison([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return '' }
  $value = $PathValue.Trim().Trim([char]34).Replace([char]47, [char]92)
  $root = [System.IO.Path]::GetPathRoot($value)
  $minimumLength = if ([string]::IsNullOrEmpty($root)) { 0 } else { $root.Length }
  while ($value.Length -gt $minimumLength -and $value.EndsWith('\')) {
    $value = $value.Substring(0, $value.Length - 1)
  }
  return $value
}

function Get-WindowsShortPathProbe([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root)) { New-Item -ItemType Directory -Path $Root -Force | Out-Null }
  $probe = Join-Path $Root ("Yance Long Path Probe {0}" -f ([Guid]::NewGuid().ToString('N')))
  New-Item -ItemType Directory -Path $probe -Force | Out-Null
  $targetVariable = 'YANCE_WINDOWS_SHORT_PATH_TARGET'
  $previousTarget = [Environment]::GetEnvironmentVariable($targetVariable, 'Process')
  $commandInterpreter = if (-not [string]::IsNullOrWhiteSpace($env:ComSpec)) { $env:ComSpec } else { Join-Path $env:SystemRoot 'System32\cmd.exe' }
  try {
    [Environment]::SetEnvironmentVariable($targetVariable, $probe, 'Process')
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $output = & $commandInterpreter /d /c 'for %I in ("%YANCE_WINDOWS_SHORT_PATH_TARGET%") do @echo %~sI' 2>&1
      $code = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $previousErrorActionPreference }
    $lines = @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
    $shortPath = if ($lines.Count -gt 0) { [string]$lines[$lines.Count - 1] } else { '' }
    if ($code -ne 0) {
      return [pscustomobject][ordered]@{
        status = 'FAIL'; reasonCode = 'WINDOWS_SHORT_PATH_COMMAND_FAILED'; root = $Root; probePath = $probe
        shortPath = $shortPath; commandInterpreter = $commandInterpreter; exitCode = $code; output = ($lines -join "`n")
      }
    }
    $shortPathLexical = Normalize-WindowsPathForLexicalComparison $shortPath
    $probePathLexical = Normalize-WindowsPathForLexicalComparison $probe
    $shortPathExists = (-not [string]::IsNullOrWhiteSpace($shortPath)) -and (Test-Path -LiteralPath $shortPath -PathType Container)
    $lexicallyDistinct = (-not [string]::IsNullOrWhiteSpace($shortPathLexical)) -and
      (-not $shortPathLexical.Equals($probePathLexical, [StringComparison]::OrdinalIgnoreCase))
    $available = $shortPathExists -and $lexicallyDistinct
    $reasonCode = if ($available) {
      'WINDOWS_SHORT_PATH_ALIAS_AVAILABLE'
    }
    elseif (-not [string]::IsNullOrWhiteSpace($shortPath) -and -not $shortPathExists) {
      'WINDOWS_SHORT_PATH_ALIAS_NOT_RESOLVABLE'
    }
    else {
      'WINDOWS_SHORT_PATH_ALIAS_UNAVAILABLE'
    }
    return [pscustomobject][ordered]@{
      status = $(if ($available) { 'PASS' } else { 'FAIL' })
      reasonCode = $reasonCode
      root = $Root; probePath = $probe; shortPath = $shortPath; commandInterpreter = $commandInterpreter; exitCode = $code
      shortPathExists = $shortPathExists; lexicallyDistinct = $lexicallyDistinct
      comparisonMethod = 'LEXICAL_CASE_INSENSITIVE_NO_CANONICALIZATION'
    }
  }
  catch {
    return [pscustomobject][ordered]@{
      status = 'FAIL'; reasonCode = 'WINDOWS_SHORT_PATH_PROBE_FAILED'; root = $Root; probePath = $probe
      shortPath = ''; commandInterpreter = $commandInterpreter; exitCode = $null; error = $_.Exception.Message
    }
  }
  finally {
    [Environment]::SetEnvironmentVariable($targetVariable, $previousTarget, 'Process')
    Remove-Item -LiteralPath $probe -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Select-CompatibleTempRoot() {
  $candidateRoots = New-Object System.Collections.Generic.List[string]
  $candidateRoots.Add($RequestedTempRoot)
  $fallback = Join-Path $systemTempBase ("Yance-Windows-Validation-{0}-Round{1}" -f $ExpectedCommit.Substring(0, 7), $Round)
  if (-not $candidateRoots.Contains($fallback)) { $candidateRoots.Add($fallback) }
  $systemDriveFallback = Join-Path $env:SystemDrive ("YanceTemp\{0}\Round{1}" -f $ExpectedCommit.Substring(0, 7), $Round)
  if (-not $candidateRoots.Contains($systemDriveFallback)) { $candidateRoots.Add($systemDriveFallback) }

  $probes = New-Object System.Collections.ArrayList
  foreach ($candidate in $candidateRoots) {
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Recurse -Force }
    New-Item -ItemType Directory -Path $candidate -Force | Out-Null
    $probe = Get-WindowsShortPathProbe $candidate
    [void]$probes.Add($probe)
    if ($probe.status -eq 'PASS') {
      return [pscustomobject][ordered]@{ status = 'PASS'; selected = $candidate; probes = @($probes) }
    }
  }
  return [pscustomobject][ordered]@{ status = 'FAIL'; selected = $null; probes = @($probes) }
}

function Get-SanitizedPath([string]$Original, [string]$PinnedNodeRoot) {
  $items = New-Object System.Collections.Generic.List[string]
  $items.Add([System.IO.Path]::GetFullPath($PinnedNodeRoot))
  foreach ($entry in ($Original -split ';')) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    $candidate = $entry.Trim()
    try { $full = [System.IO.Path]::GetFullPath($candidate) } catch { $full = $candidate }
    if ($full.Equals([System.IO.Path]::GetFullPath($PinnedNodeRoot), [StringComparison]::OrdinalIgnoreCase)) { continue }
    $containsNode = (Test-Path -LiteralPath (Join-Path $full 'node.exe') -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $full 'npm.cmd') -PathType Leaf)
    if ($containsNode) { continue }
    if (-not $items.Contains($candidate)) { $items.Add($candidate) }
  }
  return ($items -join ';')
}

function Assert-NoHiddenIndexFlags([string]$RepositoryRoot, [string]$Stage) {
  $rows = @(& git -C $RepositoryRoot ls-files -v)
  if ($LASTEXITCODE -ne 0) { throw "git ls-files -v failed during $Stage" }
  # `git ls-files -v` uses uppercase H for ordinary cached files, lowercase
  # status letters for assume-unchanged entries, and uppercase S for
  # skip-worktree. Avoid PowerShell's case-insensitive -match semantics here.
  $hidden = @($rows | Where-Object {
    if ([string]::IsNullOrWhiteSpace($_)) { return $false }
    $flag = [char]$_[0]
    return [char]::IsLower($flag) -or $flag -ceq [char]'S'
  })
  if ($hidden.Count -gt 0) { throw "Hidden Git index flags detected during ${Stage}: $($hidden -join '; ')" }
}

function Get-RoundOwnedProcesses() {
  try {
    return @(Get-CimInstance Win32_Process | Where-Object {
      $_.ProcessId -ne $PID -and
      -not [string]::IsNullOrWhiteSpace($_.CommandLine) -and
      $_.CommandLine.IndexOf($SourceRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object ProcessId, ParentProcessId, Name, CommandLine)
  }
  catch { return @() }
}

function Stop-RoundOwnedProcesses() {
  $before = @(Get-RoundOwnedProcesses)
  foreach ($process in ($before | Sort-Object ProcessId -Descending)) {
    & taskkill.exe /PID ([string]$process.ProcessId) /T /F *> $null
  }
  if ($before.Count -gt 0) { Start-Sleep -Seconds 2 }
  $after = @(Get-RoundOwnedProcesses)
  return [ordered]@{ before = $before; after = $after; status = $(if ($after.Count -eq 0) { 'PASS' } else { 'FAIL' }) }
}

$resolvedValidation = [System.IO.Path]::GetFullPath($ValidationRoot)
if ($resolvedValidation.Length -lt 8 -or $resolvedValidation -match '^[A-Za-z]:\\?$') { throw "Unsafe ValidationRoot: $resolvedValidation" }
if (Test-Path -LiteralPath $RoundRoot) { Remove-Item -LiteralPath $RoundRoot -Recurse -Force }
New-Item -ItemType Directory -Path $SourceRoot, $CacheRoot, $RequestedTempRoot, $EvidenceRoot, $LogsRoot -Force | Out-Null
Write-AtomicJson $StepResultsPath @()
Write-AtomicJson $TimelinePath @()
$parentProcessId = $null
try {
  $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -ErrorAction Stop
  $parentProcessId = $parentProcess.ParentProcessId
} catch {}
Write-AtomicJson $EnvironmentManifest ([ordered]@{
  schemaVersion = 2
  documentType = 'YANCE_WINDOWS_VERIFY_ENVIRONMENT_MANIFEST'
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  status = 'BOOTSTRAP'
  phase = 'runner-bootstrap'
  verificationMode = $VerificationMode
  round = $Round
  powershell = $PSVersionTable.PSVersion.ToString()
  processId = $PID
  parentProcessId = $parentProcessId
  validationRoot = $ValidationRoot
  requestedTempRoot = $RequestedTempRoot
  nodeRoot = $NodeRoot
  bundlePath = $BundlePath
})
Add-TimelineEvent 'ROUND' 'STARTED' @{ round = $Round; verificationMode = $VerificationMode }
Write-LiveStatus 'ROUND' 'STARTED' 'Validation round started' @{ validationRoot = $ValidationRoot }

try {
  $CurrentPhase = 'input-validation'
  $RunnerSha256 = Get-Sha256 $PSCommandPath
  Assert-File $BundlePath 'Git Bundle'
  Assert-File $NodeExe 'Node 22.16.0 executable'
  Assert-File $NpmCli 'npm CLI'
  $BundleSha256 = Get-Sha256 $BundlePath
  if ($BundleSha256 -ne $ExpectedBundleSha256.ToLowerInvariant()) { throw 'Git Bundle SHA-256 mismatch' }

  $env:GIT_CONFIG_COUNT = '4'
  $env:GIT_CONFIG_KEY_0 = 'core.autocrlf'
  $env:GIT_CONFIG_VALUE_0 = 'false'
  $env:GIT_CONFIG_KEY_1 = 'core.eol'
  $env:GIT_CONFIG_VALUE_1 = 'lf'
  $env:GIT_CONFIG_KEY_2 = 'core.safecrlf'
  $env:GIT_CONFIG_VALUE_2 = 'true'
  $env:GIT_CONFIG_KEY_3 = 'init.defaultBranch'
  $env:GIT_CONFIG_VALUE_3 = 'main'
  $env:NPM_CONFIG_CACHE = $CacheRoot
  $env:PATH = Get-SanitizedPath $originalPath $NodeRoot
  $env:YANCE_NODE_EXE = $NodeExe
  $env:YANCE_NPM_CLI_JS = $NpmCli
  $env:YANCE_EXPECTED_NODE_VERSION = 'v22.16.0'
  $env:YANCE_EXPECTED_NPM_VERSION = '10.9.2'

  $nodeVersion = (& $NodeExe --version).Trim()
  $npmVersion = (& $NodeExe $NpmCli --version).Trim()
  $gitVersion = (& git --version).Trim()
  if ($nodeVersion -ne 'v22.16.0') { throw "Node version mismatch: $nodeVersion" }
  if ($npmVersion -ne '10.9.2') { throw "npm version mismatch: $npmVersion" }

  $CurrentPhase = 'temp-selection'
  Write-LiveStatus $CurrentPhase 'RUNNING' 'Selecting a compatible temporary directory'
  $tempSelectionStarted = [DateTime]::UtcNow
  $tempSelection = Select-CompatibleTempRoot
  $TempSelectionEvidence = @($tempSelection.probes)
  Write-AtomicJson $TempSelectionPath $tempSelection
  if ($tempSelection.status -ne 'PASS') {
    Add-StepResult 'temp-selection' 'FAIL' $tempSelectionStarted @{ reasonCode = 'YANCE_WINDOWS_TEMP_SHORT_PATH_UNAVAILABLE'; probes = @($TempSelectionEvidence) }
    throw 'YANCE_WINDOWS_TEMP_SHORT_PATH_UNAVAILABLE No writable TEMP volume with a native Windows 8.3 alias is available'
  }
  $TempRoot = [string]$tempSelection.selected
  Add-StepResult 'temp-selection' 'PASS' $tempSelectionStarted @{ selected = $TempRoot; probes = @($TempSelectionEvidence) }
  $env:TEMP = $TempRoot
  $env:TMP = $TempRoot
  $env:YANCE_WP3_SHORT_PATH_TEMP_ROOT = $TempRoot
  Add-TimelineEvent 'TEMP_SELECTION' 'PASS' @{ requested = $RequestedTempRoot; selected = $TempRoot }

  $CurrentPhase = 'git-clone'
  Write-LiveStatus $CurrentPhase 'RUNNING' 'Creating a fresh source clone from the reviewed Bundle'
  $cloneStarted = [DateTime]::UtcNow
  $cloneArgs = @(
    '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'clone',
    '--config', 'core.autocrlf=false', '--config', 'core.eol=lf', '--config', 'core.safecrlf=true',
    '--branch', $ExpectedBranch, $BundlePath, $SourceRoot
  )
  Invoke-Native 'git' $cloneArgs $RoundRoot | Set-Content -LiteralPath (Join-Path $LogsRoot 'git-clone.log') -Encoding utf8
  Add-StepResult 'git-clone' 'PASS' $cloneStarted @{ sourceRoot = $SourceRoot }

  $head = (& git -C $SourceRoot rev-parse HEAD).Trim()
  $tree = (& git -C $SourceRoot rev-parse 'HEAD^{tree}').Trim()
  $branch = (& git -C $SourceRoot branch --show-current).Trim()
  $statusBefore = (& git -C $SourceRoot status --porcelain=v1 --untracked-files=all) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
  if ($head -ne $ExpectedCommit.ToLowerInvariant()) { throw "Commit mismatch: $head" }
  if ($tree -ne $ExpectedTree.ToLowerInvariant()) { throw "Tree mismatch: $tree" }
  if ($branch -ne $ExpectedBranch) { throw "Branch mismatch: $branch" }
  if ($statusBefore) { throw "Fresh clone is dirty before npm ci: $statusBefore" }
  Assert-NoHiddenIndexFlags $SourceRoot 'before verification'
  $repositoryCleanBefore = $true

  $fsckBeforeLog = Join-Path $LogsRoot 'git-fsck-before.log'
  & git -C $SourceRoot fsck --full *> $fsckBeforeLog
  if ($LASTEXITCODE -ne 0) { throw 'git fsck before verification failed' }
  $gitFsckBefore = 'PASS'

  $svg = Join-Path $SourceRoot 'assets\branding\yance\source\yance-mark-master.svg'
  $svgBytes = [System.IO.File]::ReadAllBytes($svg)
  $crCount = @($svgBytes | Where-Object { $_ -eq 13 }).Count
  if ($crCount -ne 0) { throw "Brand SVG contains $crCount CR bytes after fresh clone" }

  $CurrentPhase = 'preflight'
  Write-LiveStatus $CurrentPhase 'RUNNING' 'Checking Windows, Node, npm, Git and TEMP bindings'
  $preflightScript = Join-Path $SourceRoot 'tools\release-closure\windows-verify-preflight.js'
  Invoke-LoggedNode @($preflightScript, '--output', $EnvironmentManifest, '--source-root', $SourceRoot, '--temp-root', $TempRoot, '--temp-selection-evidence', $TempSelectionPath, '--npm-cli', $NpmCli, '--expected-node', 'v22.16.0', '--expected-npm', '10.9.2', '--expected-node-exe', $NodeExe) 'preflight' $SourceRoot | Out-Null

  $CurrentPhase = 'npm-ci'
  Write-LiveStatus $CurrentPhase 'RUNNING' 'Installing reviewed dependencies; npm warnings do not count as failure'
  Invoke-LoggedNode @($NpmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund') 'npm-ci' $SourceRoot | Out-Null

  $CurrentPhase = 'verify-wp7'
  Write-LiveStatus $CurrentPhase 'RUNNING' 'Running WP7 verification and required tests'
  $verifyArguments = @((Join-Path $SourceRoot 'tools\wp7\verify.js'), '--output-dir', $EvidenceRoot)
  if ($VerificationMode -eq 'DIAGNOSTIC') { $verifyArguments += '--diagnostic' }
  try {
    $verifyExitCode = Invoke-LoggedNode $verifyArguments 'verify-wp7' $SourceRoot
  }
  catch {
    $verifyExitCode = 1
    throw
  }

  $statusAfter = (& git -C $SourceRoot status --porcelain=v1 --untracked-files=all) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'git status after verification failed' }
  if ($statusAfter) { throw "Repository is dirty after verification: $statusAfter" }
  Assert-NoHiddenIndexFlags $SourceRoot 'after verification'
  $repositoryCleanAfter = $true
  $fsckAfterLog = Join-Path $LogsRoot 'git-fsck-after.log'
  & git -C $SourceRoot fsck --full *> $fsckAfterLog
  if ($LASTEXITCODE -ne 0) { throw 'git fsck after verification failed' }
  $gitFsckAfter = 'PASS'
  $overallStatus = 'PASS'
  Add-TimelineEvent 'ROUND' 'PASS' @{ round = $Round }
  Write-LiveStatus 'ROUND' 'PASS' 'Validation round completed successfully'
}
catch {
  $failureMessage = $_.Exception.Message
  $failureReasonCode = if ($failureMessage -match '^([A-Z0-9_]{5,})\b') { $Matches[1] } else { 'YANCE_WINDOWS_ROUND_FAILED' }
  if (-not (@($StepResults) | Where-Object { $_.status -eq 'FAIL' -and $_.name -eq $CurrentPhase })) {
    Add-StepResult $CurrentPhase 'FAIL' $RoundStartedAt @{ reasonCode = $failureReasonCode; message = $failureMessage }
  }
  Add-TimelineEvent 'ROUND' 'FAIL' @{ round = $Round; phase = $CurrentPhase; reasonCode = $failureReasonCode; message = $failureMessage }
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $LogsRoot 'runner-error.log') -Encoding utf8
}
finally {
  try {
    $cleanup = Stop-RoundOwnedProcesses
    $ResidualProcesses = @($cleanup.before)
    $ResidualCleanupStatus = $cleanup.status
    Write-AtomicJson (Join-Path $RoundRoot 'RESIDUAL_PROCESSES.json') $cleanup
    if ($cleanup.status -ne 'PASS' -and $overallStatus -eq 'PASS') {
      $overallStatus = 'FAIL'
      $failureReasonCode = 'YANCE_WINDOWS_ROUND_RESIDUAL_PROCESS'
      $failureMessage = 'Round-owned residual processes remain after verification'
    }
  } catch {
    $ResidualCleanupStatus = 'FAIL'
    if ($overallStatus -eq 'PASS') {
      $overallStatus = 'FAIL'
      $failureReasonCode = 'YANCE_WINDOWS_ROUND_CLEANUP_FAILED'
      $failureMessage = $_.Exception.Message
    }
  }
  try {
    if (Test-Path -LiteralPath $SourceRoot) {
      $currentStatus = (& git -C $SourceRoot status --porcelain=v1 --untracked-files=all 2>$null) -join "`n"
      if ($LASTEXITCODE -eq 0 -and -not $currentStatus) { $repositoryCleanAfter = $true }
    }
  } catch {}

  $result = [ordered]@{
    schemaVersion = 3
    documentType = 'YANCE_WINDOWS_VERIFY_WP7_ROUND_RESULT'
    round = $Round
    verificationMode = $VerificationMode
    formalRoundEligible = ($VerificationMode -eq 'STRICT' -and $overallStatus -eq 'PASS')
    status = $overallStatus
    reasonCode = $failureReasonCode
    message = $failureMessage
    branch = $branch
    commit = $head
    tree = $tree
    expectedBranch = $ExpectedBranch
    expectedCommit = $ExpectedCommit.ToLowerInvariant()
    expectedTree = $ExpectedTree.ToLowerInvariant()
    bundlePath = [System.IO.Path]::GetFullPath($BundlePath)
    bundleSha256 = $BundleSha256
    runnerPath = $PSCommandPath
    runnerSha256 = $RunnerSha256
    node = $nodeVersion
    nodeExecutable = $NodeExe
    npm = $npmVersion
    npmCli = $NpmCli
    git = $gitVersion
    powershell = $PSVersionTable.PSVersion.ToString()
    sourceRoot = $SourceRoot
    npmCache = $CacheRoot
    requestedTemp = $RequestedTempRoot
    temp = $TempRoot
    tempSelectionEvidence = @($TempSelectionEvidence)
    evidenceRoot = $EvidenceRoot
    repositoryCleanBefore = $repositoryCleanBefore
    repositoryCleanAfter = $repositoryCleanAfter
    gitFsckBefore = $gitFsckBefore
    gitFsckAfter = $gitFsckAfter
    brandSvgCrCount = $crCount
    verifyWp7ExitCode = $verifyExitCode
    residualCleanupStatus = $ResidualCleanupStatus
    residualProcessCountBeforeCleanup = @($ResidualProcesses).Count
    completedAtUtc = [DateTime]::UtcNow.ToString('o')
    files = @()
  }
  Write-AtomicJson $StepResultsPath @($StepResults)
  Write-AtomicJson $TimelinePath @($Timeline)
  Write-AtomicText $FinalStatusPath $overallStatus 'ascii'
  Write-AtomicJson $RoundResultPath $result
  $roundPrefix = $RoundRoot.TrimEnd('\') + '\'
  $result.files = @(Get-ChildItem -LiteralPath $RoundRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    if ($_.FullName.StartsWith($roundPrefix, [StringComparison]::OrdinalIgnoreCase)) { $_.FullName.Substring($roundPrefix.Length) } else { $_.Name }
  })
  Write-AtomicJson $RoundResultPath $result
  Write-LiveStatus 'ROUND' $overallStatus ($(if ($overallStatus -eq 'PASS') { 'Validation round completed successfully' } else { $failureMessage })) @{ reasonCode = $failureReasonCode }
  $env:PATH = $originalPath
}

if ($overallStatus -ne 'PASS') {
  Write-Error "Round $Round FAIL: $failureMessage"
  exit 1
}
Write-Host "Round $Round PASS: $ExpectedCommit / $ExpectedTree"
