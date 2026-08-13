param(
  [Parameter(Mandatory = $true)][string]$PythonExe,
  [Parameter(Mandatory = $true)][string]$UvExe,
  [Parameter(Mandatory = $true)][string]$NodeExe,
  [Parameter(Mandatory = $true)][string]$NpmCli,
  [Parameter(Mandatory = $true)][string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PythonRoot = Join-Path $RepoRoot 'runtime\learning-growth\python'
$PromptfooRoot = Join-Path $RepoRoot 'runtime\learning-growth\promptfoo'

foreach ($required in @(
  (Join-Path $PythonRoot 'pyproject.toml'),
  (Join-Path $PythonRoot 'uv.lock'),
  (Join-Path $PromptfooRoot 'package.json'),
  (Join-Path $PromptfooRoot 'package-lock.json')
)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing sealed Learning lock input: $required" }
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
$PythonOut = Join-Path $OutputRoot 'python'
$PromptfooOut = Join-Path $OutputRoot 'promptfoo'
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $PythonOut, $PromptfooOut
New-Item -ItemType Directory -Force -Path $PythonOut, $PromptfooOut | Out-Null

& $UvExe sync --project $PythonRoot --python $PythonExe --frozen --no-dev
if ($LASTEXITCODE -ne 0) { throw 'uv frozen Learning runtime build failed' }
Copy-Item -Recurse -Force (Join-Path $PythonRoot '.venv') (Join-Path $PythonOut '.venv')
Copy-Item -Force (Join-Path $PythonRoot 'learning_entrypoint.py') $PythonOut
Copy-Item -Force (Join-Path $PythonRoot 'uv.lock') $PythonOut
& $PythonExe (Join-Path $PythonRoot 'generate_runtime_sbom.py') (Join-Path $PythonOut 'sbom.json')
if ($LASTEXITCODE -ne 0) { throw 'Learning Python SBOM generation failed' }

Copy-Item -Recurse -Force $PromptfooRoot\* $PromptfooOut
Push-Location $PromptfooOut
try {
  & $NodeExe $NpmCli ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Promptfoo npm ci failed' }
  & $NodeExe (Join-Path $PromptfooOut 'generate_runtime_sbom.js') (Join-Path $PromptfooOut 'sbom.json')
  if ($LASTEXITCODE -ne 0) { throw 'Promptfoo SBOM generation failed' }
} finally { Pop-Location }

Write-Output "Learning sealed Windows runtime prepared at $OutputRoot"
