'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WRANGLER_VERSION = '4.121.0';
const WRANGLER_UPSTREAM_COMMIT = '15fc56824836570ca291aa148be72d2d62f59566';
const WORKER_URL = 'https://yance-facebook-gateway.wangyi198675.workers.dev';

function git(repoRoot, args, options = {}) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: options.encoding || 'utf8' });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function trackedFiles(repoRoot, prefix) {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z', '--', prefix]);
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

function isSecretDevVarsFile(relative) {
  const basename = path.posix.basename(relative.replace(/\\/gu, '/'));
  if (basename === '.dev.vars') return true;
  return basename.startsWith('.dev.vars.') && basename !== '.dev.vars.example';
}

function isRepositoryOnlyWorkerTest(relative) {
  return relative.replace(/\\/gu, '/').startsWith('services/facebook-worker/tests/');
}

function copyTrackedFile(repoRoot, packageRoot, relative) {
  const normalized = relative.replace(/\\/gu, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`unsafe tracked path: ${relative}`);
  }
  if (isSecretDevVarsFile(normalized)) throw new Error(`secret-bearing file must not be packaged: ${normalized}`);
  const source = path.join(repoRoot, ...normalized.split('/'));
  const destination = path.join(packageRoot, ...normalized.split('/'));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`tracked package source missing: ${normalized}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function renderRunPs1(sourceCommit) {
  return `param()\r\n` +
`$ErrorActionPreference = 'Stop'\r\n` +
`Set-StrictMode -Version Latest\r\n` +
`$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path\r\n` +
`Set-Location $PackageRoot\r\n` +
`$Wrangler = 'wrangler@${WRANGLER_VERSION}'\r\n` +
`$ExpectedSourceCommit = '${sourceCommit}'\r\n` +
`$ArtifactDir = Join-Path $PackageRoot 'artifacts'\r\n` +
`New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null\r\n` +
`\r\n` +
`function Assert-LastExit([string]$Stage) {\r\n` +
`  if ($LASTEXITCODE -ne 0) { throw "$Stage failed with exit code $LASTEXITCODE" }\r\n` +
`}\r\n` +
`\r\n` +
`Write-Host "Yance Facebook Public production deploy package"\r\n` +
`Write-Host "Source commit: $ExpectedSourceCommit"\r\n` +
`Write-Host "Pinned Wrangler: $Wrangler"\r\n` +
`\r\n` +
`Get-Content (Join-Path $PackageRoot 'SHA256SUMS.txt') | ForEach-Object {\r\n` +
`  if ($_ -match '^([0-9a-f]{64})  (.+)$') {\r\n` +
`    $expected = $Matches[1]\r\n` +
`    $relative = $Matches[2].Replace('/', [IO.Path]::DirectorySeparatorChar)\r\n` +
`    $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $PackageRoot $relative)).Hash.ToLowerInvariant()\r\n` +
`    if ($actual -ne $expected) { throw "Package integrity mismatch: $relative" }\r\n` +
`  }\r\n` +
`}\r\n` +
`\r\n` +
`$NodeVersion = (& node -p "process.versions.node")\r\n` +
`Assert-LastExit 'Node version check'\r\n` +
`$NodeParts = $NodeVersion.Split('.')\r\n` +
`if ([int]$NodeParts[0] -lt 22 -or ([int]$NodeParts[0] -eq 22 -and [int]$NodeParts[1] -lt 19)) { throw "Node >=22.19.0 required; found $NodeVersion" }\r\n` +
`\r\n` +
`& node tools/facebook/prepare-production-config.js --config services/facebook-worker/wrangler.jsonc --output-dir artifacts/facebook-production-preflight\r\n` +
`Assert-LastExit 'Production public preflight'\r\n` +
`\r\n` +
`& npx.cmd --yes wrangler@${WRANGLER_VERSION} deploy --dry-run --config services/facebook-worker/wrangler.jsonc --outdir artifacts/wrangler-dry-run\r\n` +
`Assert-LastExit 'Wrangler canonical dry-run'\r\n` +
`\r\n` +
`& npx.cmd --yes wrangler@${WRANGLER_VERSION} whoami\r\n` +
`if ($LASTEXITCODE -ne 0) {\r\n` +
`  Write-Host 'Cloudflare browser authorization is required. Wrangler will open the official Cloudflare login flow.'\r\n` +
`  & npx.cmd --yes wrangler@${WRANGLER_VERSION} login\r\n` +
`  Assert-LastExit 'Cloudflare Wrangler login'\r\n` +
`  & npx.cmd --yes wrangler@${WRANGLER_VERSION} whoami\r\n` +
`  Assert-LastExit 'Cloudflare Wrangler identity verification'\r\n` +
`}\r\n` +
`\r\n` +
`$RequiredSecrets = @((Get-Content 'services/facebook-worker/required-secrets.json' -Raw | ConvertFrom-Json).required)\r\n` +
`$SecretListOutput = @(& npx.cmd --yes wrangler@${WRANGLER_VERSION} secret list --config services/facebook-worker/wrangler.jsonc)\r\n` +
`Assert-LastExit 'Cloudflare Worker secret inventory'\r\n` +
`$RemoteSecrets = (($SecretListOutput -join "\`n") | ConvertFrom-Json)\r\n` +
`$RemoteSecretNames = @($RemoteSecrets | ForEach-Object { $_.name })\r\n` +
`$MissingSecrets = @($RequiredSecrets | Where-Object { $RemoteSecretNames -notcontains $_ })\r\n` +
`if ($MissingSecrets.Count -gt 0) { throw "Required Cloudflare Worker secrets are missing: $($MissingSecrets -join ', ')" }\r\n` +
`Write-Host 'GREEN: all required Worker secret names exist remotely; secret values were not read.'\r\n` +
`\r\n` +
`& npx.cmd --yes wrangler@${WRANGLER_VERSION} deploy --config services/facebook-worker/wrangler.jsonc\r\n` +
`Assert-LastExit 'Facebook Public canonical production deploy'\r\n` +
`\r\n` +
`& node tools/facebook/verify-formal-worker.js\r\n` +
`Assert-LastExit 'Facebook Public live runtime verification'\r\n` +
`\r\n` +
`$Evidence = [ordered]@{\r\n` +
`  status = 'GREEN'\r\n` +
`  sourceCommit = $ExpectedSourceCommit\r\n` +
`  wranglerVersion = '${WRANGLER_VERSION}'\r\n` +
`  workerUrl = '${WORKER_URL}'\r\n` +
`  requiredSecretNamesVerified = $RequiredSecrets\r\n` +
`  completedAtUtc = [DateTime]::UtcNow.ToString('o')\r\n` +
`}\r\n` +
`$Evidence | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $ArtifactDir 'facebook-public-deploy-evidence.json')\r\n` +
`Write-Host 'GREEN: Facebook Public canonical Worker deployed and strict live runtime verification passed.'\r\n`;
}

function renderReadme(sourceCommit) {
  return [
    'Yance Facebook Public / Facebook Page - Windows Production Deploy',
    '',
    `Source commit: ${sourceCommit}`,
    `Wrangler: ${WRANGLER_VERSION} (Cloudflare workers-sdk ${WRANGLER_UPSTREAM_COMMIT})`,
    `Production Worker: ${WORKER_URL}`,
    '',
    'Run from Windows PowerShell:',
    '  Set-ExecutionPolicy -Scope Process Bypass',
    '  .\\RUN.ps1',
    '',
    'Repository-level Facebook Public tests are completed by the source CI before this sealed package is produced.',
    'The sealed deploy script verifies package hashes and public production configuration, performs a pinned',
    'Wrangler dry-run from the packaged Worker source, checks Cloudflare identity, opens official Wrangler',
    'browser login only when needed, checks required secret names with official `wrangler secret list`,',
    'deploys the single canonical wrangler.jsonc, then runs the strict formal Worker verifier.',
    '',
    'The secret inventory check reads secret NAMES only. No Meta App secret, Page token, Cloudflare API token,',
    'real .dev.vars file, repository-only test suite, hotfix deploy script, or legacy wrangler.deploy.local.jsonc is included.',
    ''
  ].join('\r\n');
}

function writeManifest(packageRoot) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  walk(packageRoot);
  const manifestPath = path.join(packageRoot, 'SHA256SUMS.txt');
  const rows = files
    .filter(file => file !== manifestPath)
    .map(file => `${sha256(file)}  ${path.relative(packageRoot, file).split(path.sep).join('/')}`)
    .sort();
  fs.writeFileSync(manifestPath, `${rows.join('\n')}\n`, 'utf8');
}

function createPackage(repoRoot, outputRoot) {
  const root = path.resolve(repoRoot);
  const output = path.resolve(outputRoot);
  const sourceCommit = String(git(root, ['rev-parse', 'HEAD'])).trim();
  const sourceTree = String(git(root, ['rev-parse', 'HEAD^{tree}'])).trim();
  const branch = String(git(root, ['branch', '--show-current'])).trim();
  const dirty = String(git(root, ['status', '--porcelain', '--untracked-files=no'])).trim();
  if (dirty) throw new Error('working tree tracked files must be clean before creating the Facebook Public production package');

  const packageName = `YANCE_FACEBOOK_PUBLIC_WINDOWS_DEPLOY_${sourceCommit.slice(0, 12)}`;
  const packageRoot = path.join(output, packageName);
  fs.rmSync(packageRoot, { recursive: true, force: true });
  fs.mkdirSync(packageRoot, { recursive: true });

  const workerFiles = trackedFiles(root, 'services/facebook-worker');
  if (!workerFiles.includes('services/facebook-worker/wrangler.jsonc')) throw new Error('canonical Wrangler config is not tracked');
  if (!workerFiles.includes('services/facebook-worker/required-secrets.json')) throw new Error('required secret-name manifest is not tracked');
  if (workerFiles.some(file => file.endsWith('wrangler.deploy.local.jsonc'))) throw new Error('legacy divergent Wrangler config is still tracked');
  for (const file of workerFiles) {
    if (isSecretDevVarsFile(file) || isRepositoryOnlyWorkerTest(file)) continue;
    copyTrackedFile(root, packageRoot, file);
  }
  for (const file of ['tools/facebook/prepare-production-config.js', 'tools/facebook/verify-formal-worker.js']) copyTrackedFile(root, packageRoot, file);

  fs.writeFileSync(path.join(packageRoot, 'RUN.ps1'), renderRunPs1(sourceCommit), 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'README.txt'), renderReadme(sourceCommit), 'utf8');
  fs.writeFileSync(path.join(packageRoot, 'PROVENANCE.json'), `${JSON.stringify({
    schemaVersion: 1,
    documentType: 'YANCE_FACEBOOK_PUBLIC_WINDOWS_PRODUCTION_DEPLOY_PACKAGE',
    sourceBranch: branch,
    sourceCommit,
    sourceTree,
    wranglerVersion: WRANGLER_VERSION,
    wranglerUpstreamCommit: WRANGLER_UPSTREAM_COMMIT,
    workerUrl: WORKER_URL,
    deployAuthority: 'services/facebook-worker/wrangler.jsonc',
    requiredSecretNamesAuthority: 'services/facebook-worker/required-secrets.json',
    remoteSecretCheckAuthority: `wrangler@${WRANGLER_VERSION} secret list`,
    repositoryTestsIncluded: false,
    repositoryTestsAuthority: 'source CI before package creation',
    sealedValidation: ['sha256', 'production-public-preflight', `wrangler@${WRANGLER_VERSION} deploy --dry-run`, 'wrangler secret list', 'formal-worker-runtime-verifier'],
    excludedAuthorities: ['services/facebook-worker/wrangler.deploy.local.jsonc', 'tools/facebook/deploy-avatar-proxy-routes.js', 'tools/facebook/deploy-page-discovery-hotfix.js'],
    secretsIncluded: false
  }, null, 2)}\n`, 'utf8');
  writeManifest(packageRoot);

  return { packageRoot, packageName, sourceCommit, sourceTree, branch, wranglerVersion: WRANGLER_VERSION };
}

function main(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(__dirname, '../..');
  const outputRoot = path.resolve(argv[0] || path.join(repoRoot, 'artifacts/facebook-public-windows-deploy'));
  const result = createPackage(repoRoot, outputRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();
module.exports = { WRANGLER_VERSION, WRANGLER_UPSTREAM_COMMIT, WORKER_URL, createPackage, renderRunPs1, main };
