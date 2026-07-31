[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [string]$BaseCommit = '4a21ec3b127af8a9362bdc06bf47ef9023138b39',

  [string]$Repository = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command is unavailable: $Name"
  }
}

Assert-Command 'git'
Assert-Command 'node'

$repoRoot = (& git -C $Repository rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoRoot)) {
  throw 'Repository is not a valid Git worktree.'
}

$scriptPath = Join-Path $repoRoot 'tools\release-closure\create-source-seal.js'
& node $scriptPath --repo $repoRoot --base-commit $BaseCommit --output-dir $OutputDir
if ($LASTEXITCODE -ne 0) {
  throw "Source seal generation failed with exit code $LASTEXITCODE"
}

$verifyPath = Join-Path $repoRoot 'tools\release-closure\verify-source-seal.js'
& node $verifyPath --seal-dir $OutputDir
if ($LASTEXITCODE -ne 0) {
  throw "Independent source seal verification failed with exit code $LASTEXITCODE"
}
