param(
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedCommit = '',

  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedTree = '',

  [string]$ExpectedProductVersion = '29.2.7',
  [string]$ExpectedElectron = '43.4.1',

  [string]$ExpectedExecutablePath = '',

  [ValidateRange(0, 2147483647)]
  [int]$ExpectedProcessId = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$logPath = Join-Path $env:APPDATA 'Yance\logs\desktop.jsonl'

$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(Yance|Yance29|electron)\.exe$' -or ($_.ExecutablePath -and $_.ExecutablePath -match 'Yance(?:29)?')
} | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine

Write-Host '=== 当前 Windows 运行实例 ==='
if (-not $processes) { throw '未发现言策/Electron运行进程。' }
$processes | Format-Table -AutoSize

$expectedExecutableFullPath = ''
$mainCandidates = @($processes | Where-Object { $_.ExecutablePath })
if ($ExpectedExecutablePath) {
  $expectedExecutableFullPath = [IO.Path]::GetFullPath($ExpectedExecutablePath)
  if (-not (Test-Path -LiteralPath $expectedExecutableFullPath -PathType Leaf)) {
    throw "期望的运行实例可执行文件不存在: $expectedExecutableFullPath"
  }
  $mainCandidates = @($mainCandidates | Where-Object {
    [IO.Path]::GetFullPath($_.ExecutablePath).Equals($expectedExecutableFullPath, [StringComparison]::OrdinalIgnoreCase)
  })
}
if ($ExpectedProcessId -gt 0) {
  $mainCandidates = @($mainCandidates | Where-Object { $_.ProcessId -eq $ExpectedProcessId })
}
$main = $mainCandidates | Select-Object -First 1
if (-not $main) {
  throw "当前运行进程不匹配期望身份。ExecutablePath=$expectedExecutableFullPath ProcessId=$ExpectedProcessId"
}
if ($main.ExecutablePath -and (Test-Path $main.ExecutablePath)) {
  $version = (Get-Item $main.ExecutablePath).VersionInfo
  [pscustomobject]@{
    ExecutablePath = $main.ExecutablePath
    ProductName = $version.ProductName
    ProductVersion = $version.ProductVersion
    FileVersion = $version.FileVersion
  } | Format-List
}

if (-not (Test-Path $logPath)) { Write-Warning "运行日志不存在: $logPath"; exit 3 }
$records = Get-Content $logPath -Tail 4000 | ForEach-Object {
  try { $_ | ConvertFrom-Json } catch { $null }
} | Where-Object { $_ -and $_.event -in @('runtime-identity-verified','renderer-runtime-environment') }
$identity = $records | Where-Object event -eq 'runtime-identity-verified' | Select-Object -Last 1
$renderer = $records | Where-Object event -eq 'renderer-runtime-environment' | Select-Object -Last 1

Write-Host '=== 期望源码与可执行文件身份 ==='
[pscustomobject]@{ ExpectedCommit = $ExpectedCommit; ExpectedTree = $ExpectedTree; ExpectedExecutablePath = $expectedExecutableFullPath; ExpectedProcessId = $ExpectedProcessId } | Format-List
Write-Host '=== 已验证发布身份 ==='
$identity | Format-List at,productName,productVersion,stageVersion,buildId,sourceCommit,sourceTree,manifestSha256,electron,chrome,node,packaged
Write-Host '=== Electron 渲染与缩放环境 ==='
$renderer | Format-List at,devicePixelRatio,visualViewportScale,viewportWidth,viewportHeight,screenWidth,screenHeight,readingMode,density

if (-not $identity) { throw '缺少 runtime-identity-verified 日志，当前运行实例不是包含本修复的受验证版本，或尚未重新启动。' }
if ($ExpectedProductVersion -and $identity.productVersion -ne $ExpectedProductVersion) {
  throw "产品版本不匹配。期望=$ExpectedProductVersion；实际=$($identity.productVersion)"
}
if ($ExpectedElectron -and $identity.electron -ne $ExpectedElectron) {
  throw "Electron Runtime不匹配。期望=$ExpectedElectron；实际=$($identity.electron)"
}
if ($ExpectedCommit -and $identity.sourceCommit -ne $ExpectedCommit.ToLowerInvariant()) {
  throw "运行实例Commit不匹配。期望=$ExpectedCommit；实际=$($identity.sourceCommit)"
}
if ($ExpectedTree -and $identity.sourceTree -ne $ExpectedTree.ToLowerInvariant()) {
  throw "运行实例Tree不匹配。期望=$ExpectedTree；实际=$($identity.sourceTree)"
}
if (-not $renderer) { throw '缺少 renderer-runtime-environment 日志，无法确认当前DPR/Viewport/阅读密度。' }
if ($renderer.devicePixelRatio -le 0 -or $renderer.visualViewportScale -le 0) {
  throw '缩放环境数据无效。'
}

Write-Host 'PASS: 当前运行实例的可执行路径、产品版本、Commit/Tree、Electron Runtime 与缩放环境均已读取；传入的期望值已完成严格比对。' -ForegroundColor Green
