[CmdletBinding()]
param(
  [string]$DataRoot = '',
  [string]$Worker = '',
  [int]$Port = 27632,
  [string]$EvidenceRoot = '',
  [switch]$PrepareOnly,
  [switch]$SkipInstall,
  [switch]$PlanOnly,
  [switch]$NoExplorer
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Workflow = Join-Path $RepoRoot 'tools\uat\runWhatsappRealWindowsUatSafe.js'

if (-not (Test-Path -LiteralPath $Workflow -PathType Leaf)) {
  Write-Error "安全验收工作流不存在：$Workflow"
  exit 1
}

$Node = Get-Command node -ErrorAction Stop
$Arguments = @($Workflow, '--port', [string]$Port)
if ($DataRoot) { $Arguments += @('--data-root', $DataRoot) }
if ($Worker) { $Arguments += @('--worker', $Worker) }
if ($EvidenceRoot) { $Arguments += @('--evidence-root', $EvidenceRoot) }
if ($PrepareOnly) { $Arguments += '--prepare-only' }
if ($SkipInstall) { $Arguments += '--skip-install' }
if ($PlanOnly) { $Arguments += '--plan-only' }
if ($NoExplorer) { $Arguments += '--no-explorer' }

Write-Host '[1/4] P0 合同预检与运行进程阻断检查'
Write-Host '[2/4] 启动前只读身份诊断'
Write-Host '[3/4] 完整备份并逐项校验 SHA-256'
Write-Host '[4/4] 受控启动、退出检查与前后对比'

Push-Location $RepoRoot
try {
  & $Node.Source @Arguments
  $ExitCode = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($null -eq $ExitCode) { $ExitCode = 1 }
exit $ExitCode
