[CmdletBinding()]
param(
  [string]$BundlePath = '',
  [string]$WorkRoot = 'C:\Yance-UAT-__SHORT_COMMIT__',
  [string]$OutputRoot = 'C:\Yance-UAT-Product-__SHORT_COMMIT__',
  [string]$EvidenceRoot = 'C:\Yance-UAT-Evidence-__SHORT_COMMIT__',
  [string]$ProductionDepsRoot = 'C:\Yance-UAT-ProdDeps-__SHORT_COMMIT__',
  [string]$ElectronArchive = '',
  [string]$RceditPath = '',
  [switch]$SkipNpmCi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedCommit = '__EXPECTED_COMMIT__'
$expectedTree = '__EXPECTED_TREE__'
$branch = '__BRANCH__'
$electronVersion = '39.8.5'
$electronArchiveExpectedSha256 = 'd75c0057fd58c08023ff82ed9dd38443f90b4a962c9a9359aa74d9070f4add34'
$nodeVersion = 'v22.16.0'
$npmVersion = '10.9.2'
$rceditExpectedSha256 = '3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a'
$bundleExpectedSha256 = '__BUNDLE_SHA256__'
$expectedTagObject = '530ba7f48a5da3c73ea578173aa0078fd02bb8e9'
$expectedTagPeeledCommit = 'c150182219edea2faf49c714275e9921a21df742'

if (-not $BundlePath) {
  $BundlePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\01_GIT_BUNDLE\Yance_GIT_FULL___SHORT_COMMIT__.bundle'))
}
$BundlePath = [IO.Path]::GetFullPath($BundlePath)
$WorkRoot = [IO.Path]::GetFullPath($WorkRoot)
$OutputRoot = [IO.Path]::GetFullPath($OutputRoot)
$EvidenceRoot = [IO.Path]::GetFullPath($EvidenceRoot)
$ProductionDepsRoot = [IO.Path]::GetFullPath($ProductionDepsRoot)
New-Item -ItemType Directory -Path $EvidenceRoot -Force | Out-Null
$resultPath = Join-Path $EvidenceRoot 'WINDOWS_PREVIEW_RUNNER_RESULT.json'
$script:NativeCommandLog = Join-Path $EvidenceRoot 'native-commands.log'

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "缺少命令: $Name" }
  return $command.Source
}


function ConvertTo-NativeArgument([string]$Value) {
  if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $slashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq '\') {
      $slashes += 1
      continue
    }
    if ($character -eq '"') {
      [void]$builder.Append(('\' * (($slashes * 2) + 1)))
      [void]$builder.Append('"')
      $slashes = 0
      continue
    }
    if ($slashes -gt 0) {
      [void]$builder.Append(('\' * $slashes))
      $slashes = 0
    }
    [void]$builder.Append($character)
  }
  if ($slashes -gt 0) { [void]$builder.Append(('\' * ($slashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Write-NativeCommandLog([string]$Stage, [string]$FilePath, [string[]]$Arguments, [int]$ExitCode, [string]$StdOut, [string]$StdErr) {
  $record = @(
    "===== $([DateTime]::UtcNow.ToString('o')) stage=$Stage exitCode=$ExitCode =====",
    "file=$FilePath",
    "arguments=$($Arguments | ConvertTo-Json -Compress)",
    '--- stdout ---',
    $StdOut,
    '--- stderr ---',
    $StdErr,
    '===== end =====',
    ''
  ) -join [Environment]::NewLine
  Add-Content -LiteralPath $script:NativeCommandLog -Value $record -Encoding UTF8
}

function Invoke-NativeTextCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Stage,
    [Parameter(Mandatory=$true)][string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory = '',
    [switch]$EchoOutput
  )
  $resolvedFile = [IO.Path]::GetFullPath($FilePath)
  $isCmd = [IO.Path]::GetExtension($resolvedFile).Equals('.cmd', [StringComparison]::OrdinalIgnoreCase)
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  if ($isCmd) {
    foreach ($argument in $Arguments) {
      if ([string]$argument -match '[&|<>^\r\n]') { throw "不安全的CMD参数。Stage=$Stage" }
    }
    $processInfo.FileName = $env:ComSpec
    $inner = '"' + $resolvedFile + '"'
    if ($Arguments.Count -gt 0) { $inner += ' ' + (($Arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ') }
    $processInfo.Arguments = '/d /s /c "' + $inner + '"'
  } else {
    $processInfo.FileName = $resolvedFile
    $processInfo.Arguments = (($Arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join ' ')
  }
  if ($WorkingDirectory) { $processInfo.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory) }
  $processInfo.UseShellExecute = $false
  $processInfo.CreateNoWindow = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $processInfo
  try {
    if (-not $process.Start()) { throw "原生命令无法启动: $resolvedFile" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result
    $exitCode = $process.ExitCode
  } finally {
    $process.Dispose()
  }

  Write-NativeCommandLog -Stage $Stage -FilePath $resolvedFile -Arguments $Arguments -ExitCode $exitCode -StdOut $stdout -StdErr $stderr
  if ($EchoOutput) {
    if ($stdout) { Write-Host -NoNewline $stdout }
    if ($stderr) { Write-Host -NoNewline $stderr }
  }
  if ($exitCode -ne 0) {
    throw "原生命令失败。Stage=$Stage ExitCode=$exitCode Command=$resolvedFile。完整输出=$script:NativeCommandLog"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    StdOut = $stdout
    StdErr = $stderr
    FilePath = $resolvedFile
    Stage = $Stage
  }
}

function Get-LowerSha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Write-RunnerResult([string]$Status, [string]$ReasonCode, [string]$Message, [hashtable]$Details) {
  $document = [ordered]@{
    schemaVersion = 1
    status = $Status
    reasonCode = $ReasonCode
    message = $Message
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    expectedCommit = $expectedCommit
    expectedTree = $expectedTree
    details = $Details
    formalInstallerAuthorized = $false
    releaseApproved = $false
  }
  $document | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
}


function Save-StartupDiagnostics([string]$UatExe, [object]$UatProcess, [string]$BundledNode, [string]$Reason) {
  $startupRoot = Join-Path $EvidenceRoot 'startup-diagnostics'
  New-Item -ItemType Directory -Path $startupRoot -Force | Out-Null
  $logRoot = Join-Path $env:APPDATA 'Yance\logs'
  foreach ($name in @('desktop-bootstrap.jsonl','desktop.jsonl','server.jsonl')) {
    $source = Join-Path $logRoot $name
    if (Test-Path -LiteralPath $source -PathType Leaf) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $startupRoot $name) -Force
    }
  }
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(Yance|Yance29|electron|node|powershell)\.exe$' -or
      ($_.ExecutablePath -and $_.ExecutablePath -match 'Yance(?:29)?')
  } | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $startupRoot 'process-tree.json') -Encoding UTF8

  $processState = [ordered]@{
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    reason = $Reason
    executablePath = $UatExe
    executableExists = [bool](Test-Path -LiteralPath $UatExe -PathType Leaf)
    bundledNodePath = $BundledNode
    bundledNodeExists = [bool](Test-Path -LiteralPath $BundledNode -PathType Leaf)
    appDataRoot = (Join-Path $env:APPDATA 'Yance')
    bootstrapLogExists = [bool](Test-Path -LiteralPath (Join-Path $logRoot 'desktop-bootstrap.jsonl'))
    desktopLogExists = [bool](Test-Path -LiteralPath (Join-Path $logRoot 'desktop.jsonl'))
    serverLogExists = [bool](Test-Path -LiteralPath (Join-Path $logRoot 'server.jsonl'))
    processId = $(if ($UatProcess) { $UatProcess.Id } else { $null })
    processHasExited = $(if ($UatProcess) { try { $UatProcess.Refresh(); $UatProcess.HasExited } catch { $null } } else { $null })
    processExitCode = $(if ($UatProcess) { try { if ($UatProcess.HasExited) { $UatProcess.ExitCode } else { $null } } catch { $null } } else { $null })
  }
  $processState | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $startupRoot 'startup-state.json') -Encoding UTF8

  if (Test-Path -LiteralPath $BundledNode -PathType Leaf) {
    try {
      $nodeDiagnostic = Invoke-NativeTextCommand -Stage 'startup-diagnostics-bundled-node-version' -FilePath $BundledNode -Arguments @('--version')
      @($nodeDiagnostic.StdOut, $nodeDiagnostic.StdErr, "exitCode=$($nodeDiagnostic.ExitCode)") | Set-Content -LiteralPath (Join-Path $startupRoot 'bundled-node-version.txt') -Encoding UTF8
    } catch {
      $_ | Out-String | Set-Content -LiteralPath (Join-Path $startupRoot 'bundled-node-version-FAIL.txt') -Encoding UTF8
    }
  }
}

try {
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw '需要 Windows PowerShell 5.1 或更高版本。' }
  if (-not [Environment]::Is64BitOperatingSystem) { throw '需要 64 位 Windows。' }
  if (-not (Test-Path -LiteralPath $BundlePath -PathType Leaf)) { throw "完整Git Bundle不存在: $BundlePath" }
  $bundleActualSha256 = Get-LowerSha256 $BundlePath
  if ($bundleActualSha256 -ne $bundleExpectedSha256) { throw "Git Bundle SHA256不匹配。期望=$bundleExpectedSha256 实际=$bundleActualSha256" }
  if (Test-Path -LiteralPath $WorkRoot) { throw "WorkRoot必须为全新目录: $WorkRoot" }
  if (Test-Path -LiteralPath $OutputRoot) { throw "OutputRoot必须为全新目录: $OutputRoot" }
  if (Test-Path -LiteralPath $ProductionDepsRoot) { throw "ProductionDepsRoot必须为全新目录: $ProductionDepsRoot" }

  $git = Require-Command 'git.exe'
  $node = Require-Command 'node.exe'
  $npm = Require-Command 'npm.cmd'
  $nodeVersionResult = Invoke-NativeTextCommand -Stage 'node-version' -FilePath $node -Arguments @('--version')
  $npmVersionResult = Invoke-NativeTextCommand -Stage 'npm-version' -FilePath $npm -Arguments @('--version')
  $gitVersionResult = Invoke-NativeTextCommand -Stage 'git-version' -FilePath $git -Arguments @('--version')
  $actualNodeVersion = $nodeVersionResult.StdOut.Trim()
  $actualNpmVersion = $npmVersionResult.StdOut.Trim()
  Write-Host "Git: $($gitVersionResult.StdOut.Trim())"
  Write-Host "Node: $actualNodeVersion"
  Write-Host "npm: $actualNpmVersion"
  if ($actualNodeVersion -ne $nodeVersion) { throw "Node版本不匹配。期望=$nodeVersion 实际=$actualNodeVersion" }
  if ($actualNpmVersion -ne $npmVersion) { throw "npm版本不匹配。期望=$npmVersion 实际=$actualNpmVersion" }

  # 关闭旧实例，防止旧安装版冒充本次UAT。
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(Yance|Yance29|electron)\.exe$' -or ($_.ExecutablePath -and $_.ExecutablePath -match 'Yance(?:29)?')
  } | ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { }
  }
  Start-Sleep -Seconds 2

  # 保留旧用户数据，不直接删除。
  $userData = Join-Path $env:APPDATA 'Yance'
  if (Test-Path -LiteralPath $userData) {
    $backup = "$userData.before-__SHORT_COMMIT__.$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
    Move-Item -LiteralPath $userData -Destination $backup
    Write-Host "旧用户数据已备份到: $backup"
  }

  Write-Host '从完整Git Bundle全新克隆，并在首次checkout前锁定LF策略...'
  Invoke-NativeTextCommand -Stage 'git-clone' -FilePath $git -Arguments @('-c','core.autocrlf=false','-c','core.eol=lf','clone','--config','core.autocrlf=false','--config','core.eol=lf','-b',$branch,$BundlePath,$WorkRoot) -EchoOutput | Out-Null
  Invoke-NativeTextCommand -Stage 'git-config-autocrlf' -FilePath $git -Arguments @('-C',$WorkRoot,'config','core.autocrlf','false') | Out-Null
  Invoke-NativeTextCommand -Stage 'git-config-eol' -FilePath $git -Arguments @('-C',$WorkRoot,'config','core.eol','lf') | Out-Null
  $head = (Invoke-NativeTextCommand -Stage 'git-rev-parse-head' -FilePath $git -Arguments @('-C',$WorkRoot,'rev-parse','HEAD')).StdOut.Trim()
  $tree = (Invoke-NativeTextCommand -Stage 'git-rev-parse-tree' -FilePath $git -Arguments @('-C',$WorkRoot,'rev-parse','HEAD^{tree}')).StdOut.Trim()
  $dirtyText = (Invoke-NativeTextCommand -Stage 'git-status-clean' -FilePath $git -Arguments @('-C',$WorkRoot,'status','--porcelain')).StdOut
  $dirty = @($dirtyText -split '\r?\n' | Where-Object { $_ })
  if ($head -ne $expectedCommit -or $tree -ne $expectedTree -or $dirty.Count -ne 0) {
    throw "源码身份不匹配或工作区不干净。Commit=$head Tree=$tree Dirty=$($dirty.Count)"
  }
  $tagObject = (Invoke-NativeTextCommand -Stage 'git-tag-object' -FilePath $git -Arguments @('-C',$WorkRoot,'rev-parse','refs/tags/stage-6.4.5.8-rejected-architecture')).StdOut.Trim()
  $tagPeeled = (Invoke-NativeTextCommand -Stage 'git-tag-peeled' -FilePath $git -Arguments @('-C',$WorkRoot,'rev-parse','refs/tags/stage-6.4.5.8-rejected-architecture^{}')).StdOut.Trim()
  $tagType = (Invoke-NativeTextCommand -Stage 'git-tag-type' -FilePath $git -Arguments @('-C',$WorkRoot,'cat-file','-t',$tagObject)).StdOut.Trim()
  if ($tagObject -ne $expectedTagObject -or $tagPeeled -ne $expectedTagPeeledCommit -or $tagType -ne 'tag') {
    throw "权威 immutable tag 身份不匹配。Object=$tagObject Peeled=$tagPeeled Type=$tagType"
  }
  $fsckResult = Invoke-NativeTextCommand -Stage 'git-fsck-full-strict' -FilePath $git -Arguments @('-C',$WorkRoot,'fsck','--full','--strict')
  @($fsckResult.StdOut, $fsckResult.StdErr) | Out-File -FilePath (Join-Path $EvidenceRoot 'git-fsck-full-strict.log') -Encoding utf8
  Write-Host "源码身份与权威Tag PASS: $head / $tree / $tagObject" -ForegroundColor Green

  Push-Location $WorkRoot
  try {
    if (-not $SkipNpmCi) {
      Invoke-NativeTextCommand -Stage 'npm-ci-full' -FilePath $npm -Arguments @('ci','--no-audit','--no-fund') -WorkingDirectory $WorkRoot -EchoOutput | Out-Null
    }

    $lockedElectron = (Invoke-NativeTextCommand -Stage 'read-locked-electron-version' -FilePath $node -Arguments @('-e',"const p=require('./package-lock.json');process.stdout.write(p.packages['node_modules/electron'].version)") -WorkingDirectory $WorkRoot).StdOut.Trim()
    if ($lockedElectron -ne $electronVersion) { throw "Electron锁定版本不匹配: $lockedElectron" }
    $electronDist = Join-Path $WorkRoot 'node_modules\electron\dist'
    $electronExe = Join-Path $electronDist 'electron.exe'
    if (-not (Test-Path -LiteralPath $electronExe -PathType Leaf)) { throw "官方Electron Windows分发不存在: $electronExe" }

    Write-Host '创建独立 production-only 依赖树...'
    New-Item -ItemType Directory -Path $ProductionDepsRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $WorkRoot 'package.json') -Destination $ProductionDepsRoot
    Copy-Item -LiteralPath (Join-Path $WorkRoot 'package-lock.json') -Destination $ProductionDepsRoot
    $npmrc = Join-Path $WorkRoot '.npmrc'
    if (Test-Path -LiteralPath $npmrc -PathType Leaf) { Copy-Item -LiteralPath $npmrc -Destination $ProductionDepsRoot }
    Push-Location $ProductionDepsRoot
    try {
      Invoke-NativeTextCommand -Stage 'npm-ci-production' -FilePath $npm -Arguments @('ci','--omit=dev','--no-audit','--no-fund') -WorkingDirectory $ProductionDepsRoot -EchoOutput | Out-Null
    } finally { Pop-Location }
    $productionNodeModules = Join-Path $ProductionDepsRoot 'node_modules'
    if (-not (Test-Path -LiteralPath $productionNodeModules -PathType Container)) { throw 'production-only node_modules不存在。' }
    if (Test-Path -LiteralPath (Join-Path $productionNodeModules 'electron')) { throw 'production-only依赖树错误包含Electron开发依赖。' }
    if ([IO.Path]::GetFullPath($productionNodeModules).StartsWith([IO.Path]::GetFullPath($WorkRoot), [StringComparison]::OrdinalIgnoreCase)) {
      throw 'production-only依赖树必须独立于完整Electron依赖树。'
    }

    Write-Host '鐗╁寲闅旂 WP7 archive OSS toolchain...'
    $archiveOssRoot = Join-Path $EvidenceRoot 'wp7-archive-oss-toolchain'
    if (Test-Path -LiteralPath $archiveOssRoot) { throw "archive OSS toolchain鐩綍蹇呴』涓哄叏鏂扮洰褰? $archiveOssRoot" }
    New-Item -ItemType Directory -Path $archiveOssRoot -Force | Out-Null
    $archiveManifestPath = Join-Path $WorkRoot 'tools\wp7\archive-oss\package.json'
    $archiveLockPath = Join-Path $WorkRoot 'tools\wp7\archive-oss\package-lock.json'
    if (-not (Test-Path -LiteralPath $archiveManifestPath -PathType Leaf) -or -not (Test-Path -LiteralPath $archiveLockPath -PathType Leaf)) {
      throw 'tracked WP7 archive OSS manifest/lock涓嶅瓨鍦ㄣ€?
    }
    Copy-Item -LiteralPath $archiveManifestPath -Destination $archiveOssRoot
    Copy-Item -LiteralPath $archiveLockPath -Destination $archiveOssRoot
    Invoke-NativeTextCommand -Stage 'npm-ci-wp7-archive-oss' -FilePath $npm -Arguments @('ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--no-bin-links') -WorkingDirectory $archiveOssRoot -EchoOutput | Out-Null
    $archiveToolNodeModules = Join-Path $archiveOssRoot 'node_modules'
    $archiveTarPackagePath = Join-Path $archiveToolNodeModules 'tar\package.json'
    if (-not (Test-Path -LiteralPath $archiveTarPackagePath -PathType Leaf)) { throw 'isolated tar package metadata涓嶅瓨鍦ㄣ€? }
    $archiveTarPackage = Get-Content -LiteralPath $archiveTarPackagePath -Raw | ConvertFrom-Json
    if ([string]$archiveTarPackage.name -ne 'tar' -or [string]$archiveTarPackage.version -ne '7.5.22') {
      throw "archive OSS韬唤涓嶅尮閰? $($archiveTarPackage.name)@$($archiveTarPackage.version)"
    }

    if (-not $ElectronArchive) {
      $deps = Join-Path $EvidenceRoot 'trusted-inputs'
      New-Item -ItemType Directory -Path $deps -Force | Out-Null
      $ElectronArchive = Join-Path $deps "electron-v$electronVersion-win32-x64.zip"
      $shasums = Join-Path $deps 'Electron-SHASUMS256.txt'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $baseUrl = "https://github.com/electron/electron/releases/download/v$electronVersion"
      Write-Host '下载官方Electron Windows x64归档与SHASUMS...'
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/electron-v$electronVersion-win32-x64.zip" -OutFile $ElectronArchive
      Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt" -OutFile $shasums
      $archiveName = Split-Path -Leaf $ElectronArchive
      $line = Get-Content -LiteralPath $shasums | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))$" } | Select-Object -First 1
      if (-not $line) { throw "官方SHASUMS中没有找到: $archiveName" }
      $officialHash = ($line -split '\s+')[0].ToLowerInvariant()
      if ($officialHash -ne $electronArchiveExpectedSha256) { throw "官方SHASUMS与封存Electron SHA256不一致。官方=$officialHash 封存=$electronArchiveExpectedSha256" }
    } elseif (-not (Test-Path -LiteralPath $ElectronArchive -PathType Leaf)) {
      throw "指定的Electron归档不存在: $ElectronArchive"
    }
    $ElectronArchive = [IO.Path]::GetFullPath($ElectronArchive)
    $electronArchiveActualSha256 = Get-LowerSha256 $ElectronArchive
    if ($electronArchiveActualSha256 -ne $electronArchiveExpectedSha256) {
      throw "Electron归档SHA256不匹配。期望=$electronArchiveExpectedSha256 实际=$electronArchiveActualSha256"
    }
    Write-Host "Electron归档固定SHA256 PASS: $electronArchiveActualSha256" -ForegroundColor Green

    if (-not $RceditPath) {
      $RceditPath = Join-Path $EvidenceRoot 'trusted-inputs\rcedit-v2.0.0-x64.exe'
      $acquireScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\03_TRUSTED_TOOLS\ACQUIRE_TRUSTED_RCEDIT.ps1'))
      & $acquireScript -DestinationPath $RceditPath | Out-Host
    }
    $RceditPath = [IO.Path]::GetFullPath($RceditPath)
    if (-not (Test-Path -LiteralPath $RceditPath -PathType Leaf)) { throw "rcedit不存在: $RceditPath" }
    $rceditActualSha256 = Get-LowerSha256 $RceditPath
    if ($rceditActualSha256 -ne $rceditExpectedSha256) {
      throw "rcedit SHA256不匹配。期望=$rceditExpectedSha256 实际=$rceditActualSha256"
    }
    Write-Host "rcedit custody PASS: $rceditActualSha256" -ForegroundColor Green

    $timestamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $sessionId = [Guid]::NewGuid().ToString('N')
    $builderLog = Join-Path $EvidenceRoot 'Yance-UAT-pre-review-builder-__SHORT_COMMIT__.log'
    $arguments = @(
      'tools/wp7/create-pre-review-trusted-product.js',
      '--repo-root', $WorkRoot,
      '--electron-archive', $ElectronArchive,
      '--electron-dist', $electronDist,
      '--production-node-modules', $productionNodeModules,
      '--trusted-node-executable', $node,
      '--rcedit-path', $RceditPath,
      '--archive-tool-node-modules', $archiveToolNodeModules,
      '--output-dir', $OutputRoot,
      '--build-timestamp-utc', $timestamp,
      '--build-session-id', $sessionId,
      '--target-platform', 'win32',
      '--target-arch', 'x64'
    )
    Write-Host '构建WP7 PRE_REVIEW_ONLY可信产品（不是正式安装包）...'
    $builderResult = Invoke-NativeTextCommand -Stage 'build-pre-review-product' -FilePath $node -Arguments $arguments -WorkingDirectory $WorkRoot -EchoOutput
    @($builderResult.StdOut, $builderResult.StdErr) | Out-File -FilePath $builderLog -Encoding utf8

    $buildRecordPath = Join-Path $OutputRoot 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_BUILD.json'
    if (-not (Test-Path -LiteralPath $buildRecordPath -PathType Leaf)) { throw "Builder记录不存在: $buildRecordPath" }
    $buildRecord = Get-Content -Raw -LiteralPath $buildRecordPath | ConvertFrom-Json
    if ($buildRecord.sourceCommit -ne $expectedCommit -or $buildRecord.sourceTree -ne $expectedTree) { throw 'Builder记录源码身份不匹配。' }
    if ($buildRecord.rceditSha256 -ne $rceditExpectedSha256) { throw 'Builder记录未绑定受信任rcedit SHA256。' }
    if ($buildRecord.electronReleaseArchiveSha256 -ne $electronArchiveExpectedSha256) { throw 'Builder记录未绑定固定Electron归档SHA256。' }
    if ($buildRecord.artifactClass -ne 'WP7_PRE_REVIEW_ONLY' -or $buildRecord.finalReleaseEvidence -ne $false) { throw 'Builder产物分类不是PRE_REVIEW_ONLY。' }

    $uatExe = Join-Path $OutputRoot 'staging\application-payload\Yance.exe'
    if (-not (Test-Path -LiteralPath $uatExe -PathType Leaf)) { throw "UAT可执行文件不存在: $uatExe" }
    $headAfter = (Invoke-NativeTextCommand -Stage 'git-post-build-head' -FilePath $git -Arguments @('-C',$WorkRoot,'rev-parse','HEAD')).StdOut.Trim()
    $treeAfter = (Invoke-NativeTextCommand -Stage 'git-post-build-tree' -FilePath $git -Arguments @('-C',$WorkRoot,'rev-parse','HEAD^{tree}')).StdOut.Trim()
    $dirtyAfterText = (Invoke-NativeTextCommand -Stage 'git-post-build-status' -FilePath $git -Arguments @('-C',$WorkRoot,'status','--porcelain')).StdOut
    $dirtyAfter = @($dirtyAfterText -split '\r?\n' | Where-Object { $_ })
    if ($headAfter -ne $expectedCommit -or $treeAfter -ne $expectedTree -or $dirtyAfter.Count -ne 0) {
      throw '构建后源码身份变化或工作区变脏。'
    }

    $payloadRoot = Split-Path -Parent $uatExe
    $bundledNode = Join-Path $payloadRoot 'runtime\node22\node.exe'
    if (-not (Test-Path -LiteralPath $bundledNode -PathType Leaf)) {
      throw "Bundled Node运行时不存在: $bundledNode"
    }
    $nodePreflightResult = Invoke-NativeTextCommand -Stage 'bundled-node-preflight' -FilePath $bundledNode -Arguments @('--version')
    @($nodePreflightResult.StdOut, $nodePreflightResult.StdErr, "exitCode=$($nodePreflightResult.ExitCode)") | Set-Content -LiteralPath (Join-Path $EvidenceRoot 'bundled-node-preflight.txt') -Encoding UTF8
    $nodePreflightVersion = $nodePreflightResult.StdOut.Trim()
    if ($nodePreflightVersion -ne $nodeVersion) {
      Save-StartupDiagnostics -UatExe $uatExe -UatProcess $null -BundledNode $bundledNode -Reason 'BUNDLED_NODE_PREFLIGHT_FAILED'
      throw "Bundled Node预检失败。ExitCode=$($nodePreflightResult.ExitCode) Output=$($nodePreflightResult.StdOut) $($nodePreflightResult.StdErr)"
    }

    Write-Host "启动UAT实例并等待可审计readiness: $uatExe"
    $electronLog = Join-Path $EvidenceRoot 'electron-main.log'
    $previousEnableLogging = $env:ELECTRON_ENABLE_LOGGING
    $previousElectronLogFile = $env:ELECTRON_LOG_FILE
    try {
      $env:ELECTRON_ENABLE_LOGGING = '1'
      $env:ELECTRON_LOG_FILE = $electronLog
      $uatProcess = Start-Process -FilePath $uatExe -WorkingDirectory $payloadRoot -PassThru
    } finally {
      $env:ELECTRON_ENABLE_LOGGING = $previousEnableLogging
      $env:ELECTRON_LOG_FILE = $previousElectronLogFile
    }

    $bootstrapLog = Join-Path $env:APPDATA 'Yance\logs\desktop-bootstrap.jsonl'
    $desktopLog = Join-Path $env:APPDATA 'Yance\logs\desktop.jsonl'
    $verifyScript = Join-Path $PSScriptRoot 'VERIFY_RUNTIME_IDENTITY.ps1'
    $verifyOutputPath = Join-Path $EvidenceRoot 'runtime-identity-verification.txt'
    $verifyFailurePath = Join-Path $EvidenceRoot 'runtime-identity-last-failure.txt'
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    $runtimeVerified = $false
    $lastVerificationError = 'readiness尚未达到'

    while ([DateTime]::UtcNow -lt $deadline) {
      $uatProcess.Refresh()
      if ($uatProcess.HasExited) {
        Save-StartupDiagnostics -UatExe $uatExe -UatProcess $uatProcess -BundledNode $bundledNode -Reason 'MAIN_PROCESS_EXITED_BEFORE_READINESS'
        throw "Yance主进程在readiness前退出。PID=$($uatProcess.Id) ExitCode=$($uatProcess.ExitCode)"
      }

      if ((Test-Path -LiteralPath $bootstrapLog -PathType Leaf) -and (Test-Path -LiteralPath $desktopLog -PathType Leaf)) {
        try {
          $verifyOutput = @(& $verifyScript -ExpectedCommit $expectedCommit -ExpectedTree $expectedTree -ExpectedElectron $electronVersion -ExpectedExecutablePath $uatExe -ExpectedProcessId $uatProcess.Id 2>&1)
          $verifyOutput | Set-Content -LiteralPath $verifyOutputPath -Encoding UTF8
          $runtimeVerified = $true
          break
        } catch {
          $lastVerificationError = $_.Exception.Message
          $_ | Out-String | Set-Content -LiteralPath $verifyFailurePath -Encoding UTF8
        }
      }
      Start-Sleep -Seconds 2
    }

    if (-not $runtimeVerified) {
      Save-StartupDiagnostics -UatExe $uatExe -UatProcess $uatProcess -BundledNode $bundledNode -Reason 'RUNTIME_READINESS_TIMEOUT'
      throw "90秒内未完成Backend/preload/renderer/runtime identity readiness。最后错误=$lastVerificationError"
    }
    Save-StartupDiagnostics -UatExe $uatExe -UatProcess $uatProcess -BundledNode $bundledNode -Reason 'RUNTIME_READINESS_VERIFIED'

    Write-RunnerResult 'PASS' 'PREVIEW_RUNTIME_IDENTITY_VERIFIED' 'PRE_REVIEW_ONLY产品已构建、启动并通过运行身份门禁。' @{
      executablePath = $uatExe
      builderLog = $builderLog
      buildRecord = $buildRecordPath
      rceditPath = $RceditPath
      rceditSha256 = $rceditActualSha256
      electronArchive = $ElectronArchive
      electronArchiveSha256 = $electronArchiveActualSha256
      productionNodeModules = $productionNodeModules
      bundleSha256 = $bundleActualSha256
      authoritativeTagObject = $tagObject
      bundledNodeVersion = $nodePreflightVersion
      startupDiagnostics = (Join-Path $EvidenceRoot 'startup-diagnostics')
      nativeCommandLog = $script:NativeCommandLog
    }

    Write-Host ''
    Write-Host 'UAT实例已启动并通过运行身份核验。现在按 WINDOWS_UAT_CHECKLIST.md 测试 Session、Persona、WhatsApp、Telegram、Facebook、托盘与安装完成启动。' -ForegroundColor Green
    Write-Host "UAT EXE: $uatExe"
    Write-Host "Builder日志: $builderLog"
    Write-Host "Runner结果: $resultPath"
  } finally {
    Pop-Location
  }
} catch {
  Write-RunnerResult 'FAIL' 'WINDOWS_PREVIEW_RUNNER_FAILED' $_.Exception.Message @{
    bundlePath = $BundlePath
    workRoot = $WorkRoot
    outputRoot = $OutputRoot
    evidenceRoot = $EvidenceRoot
    stack = $_.ScriptStackTrace
    nativeCommandLog = $script:NativeCommandLog
  }
  Write-Error $_
  exit 1
}
