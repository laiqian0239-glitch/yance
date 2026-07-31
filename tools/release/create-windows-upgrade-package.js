#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function clean(value) { return value == null ? '' : String(value).trim(); }
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { return sha256Buffer(fs.readFileSync(filePath)); }
function canonicalJson(value) { return `${JSON.stringify(value, null, 2)}\n`; }
function gitObject(value, label) {
  const normalized = clean(value).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) throw Object.assign(new Error(`${label} 必须是完整 Git 对象 ID`), { code: 'YANCE_UPGRADE_GIT_ID_INVALID' });
  return normalized;
}
function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') result.help = true;
    else if (token.startsWith('--')) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw Object.assign(new Error(`参数 ${token} 缺少值`), { code: 'YANCE_UPGRADE_ARGUMENT_INVALID' });
      result[token.slice(2)] = value;
    } else throw Object.assign(new Error(`未知参数：${token}`), { code: 'YANCE_UPGRADE_ARGUMENT_INVALID' });
  }
  return result;
}

function powershellScript() {
  return String.raw`param(
  [switch]$KeepApplicationBackup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManifestPath = Join-Path $PackageRoot 'upgrade-manifest.json'
$ManifestHashPath = Join-Path $PackageRoot 'upgrade-manifest.sha256'

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Read-DetachedHash([string]$Path, [string]$ExpectedName) {
  $line = (Get-Content -LiteralPath $Path -Raw).Trim()
  if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') { throw "校验文件格式无效：$Path" }
  if ($Matches[2].Trim() -ne $ExpectedName) { throw "校验文件绑定了错误文件：$($Matches[2])" }
  return $Matches[1].ToLowerInvariant()
}

function Assert-ManifestHash {
  if (!(Test-Path -LiteralPath $ManifestPath) -or !(Test-Path -LiteralPath $ManifestHashPath)) { throw '升级清单或其 SHA-256 文件缺失。' }
  $expected = Read-DetachedHash $ManifestHashPath 'upgrade-manifest.json'
  $actual = Get-Sha256 $ManifestPath
  if ($actual -ne $expected) { throw "升级清单 SHA-256 不匹配。expected=$expected actual=$actual" }
}

function Stop-YanceProcesses {
  foreach ($name in @('Yance')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 900
  $left = @(Get-Process -Name 'Yance' -ErrorAction SilentlyContinue)
  if ($left.Count -gt 0) { throw '言策进程未能完全停止。请重启 Windows 后再升级。' }
}

function Copy-Tree([string]$Source, [string]$Destination, [switch]$Mirror) {
  if (!(Test-Path -LiteralPath $Source)) { return }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  $copyArgs = @($Source, $Destination, $(if ($Mirror) {'/MIR'} else {'/E'}), '/COPY:DAT', '/DCOPY:DAT', '/R:2', '/W:1', '/XJ', '/NP', '/NFL', '/NDL')
  & robocopy @copyArgs | Out-Null
  $code = $LASTEXITCODE
  if ($code -gt 7) { throw "备份/恢复失败，robocopy 退出码：$code" }
}

function Read-InstalledIdentity([string]$InstallRoot) {
  $manifest = Join-Path $InstallRoot 'resources\release-manifest.json'
  $hashFile = Join-Path $InstallRoot 'resources\release-manifest.sha256'
  if (!(Test-Path -LiteralPath $manifest) -or !(Test-Path -LiteralPath $hashFile)) { throw "安装目录缺少发行身份：$InstallRoot" }
  $expected = Read-DetachedHash $hashFile 'release-manifest.json'
  $actual = Get-Sha256 $manifest
  if ($expected -ne $actual) { throw '当前安装的发行清单校验失败，拒绝升级。' }
  return (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)
}

function Find-InstallRoot {
  $candidate = $null
  try { $candidate = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Yance' -Name InstallLocation -ErrorAction Stop).InstallLocation } catch {}
  if (!$candidate) { $candidate = Join-Path $env:LOCALAPPDATA 'Yance' }
  $resolved = [IO.Path]::GetFullPath($candidate)
  $allowedDefault = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Yance'))
  if (!(Test-Path -LiteralPath $resolved)) { throw "未找到言策安装目录：$resolved" }
  if ($resolved -ne $allowedDefault -and !(Test-Path -LiteralPath (Join-Path $resolved 'resources\release-manifest.json'))) {
    throw "注册表安装目录不可信：$resolved"
  }
  return $resolved
}

function Write-Result([hashtable]$Result, [string]$BackupRoot, [string]$UserDataRoot) {
  $json = $Result | ConvertTo-Json -Depth 8
  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $BackupRoot 'upgrade-result.json') -Value $json -Encoding UTF8
  $logs = Join-Path $UserDataRoot 'logs'
  New-Item -ItemType Directory -Path $logs -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $logs 'last-upgrade-result.json') -Value $json -Encoding UTF8
}

Assert-ManifestHash
$Package = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$InstallerPath = Join-Path $PackageRoot $Package.installerFileName
if (!(Test-Path -LiteralPath $InstallerPath)) { throw "升级安装包缺失：$InstallerPath" }
if ((Get-Sha256 $InstallerPath) -ne $Package.installerSha256) { throw '升级安装包 SHA-256 不匹配。' }

$InstallRoot = Find-InstallRoot
$UserDataRoot = Join-Path $env:APPDATA 'Yance'
$Before = Read-InstalledIdentity $InstallRoot
if ($Before.sourceCommit -eq $Package.targetSourceCommit) {
  Write-Host '当前已经是目标版本，无需重复升级。' -ForegroundColor Green
  exit 0
}
if ($Before.sourceCommit -notin @($Package.allowedBaselineSourceCommits)) {
  throw "当前版本不在本升级包允许范围。current=$($Before.sourceCommit)"
}

$Stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$BackupRoot = Join-Path $env:LOCALAPPDATA "Yance-Upgrade-Backups\$Stamp"
$ApplicationBackup = Join-Path $BackupRoot 'Application'
$UserDataBackup = Join-Path $BackupRoot 'UserData'
$PassReceipt = Join-Path $UserDataRoot 'logs\post-install-launch.pass'
$JsonReceipt = Join-Path $UserDataRoot 'logs\post-install-launch.json'

$Result = @{
  schemaVersion = 1
  status = 'RUNNING'
  startedAtUtc = [DateTime]::UtcNow.ToString('o')
  baselineSourceCommit = $Before.sourceCommit
  targetSourceCommit = $Package.targetSourceCommit
  installRoot = $InstallRoot
  userDataRoot = $UserDataRoot
  backupRoot = $BackupRoot
  rolledBack = $false
}

try {
  Stop-YanceProcesses
  Copy-Tree $InstallRoot $ApplicationBackup
  Copy-Tree $UserDataRoot $UserDataBackup
  Remove-Item -LiteralPath $PassReceipt,$JsonReceipt -Force -ErrorAction SilentlyContinue

  $process = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "安装程序失败，退出码：$($process.ExitCode)" }

  $Exe = Join-Path $InstallRoot 'Yance.exe'
  if (!(Test-Path -LiteralPath $Exe)) { throw '升级后找不到 Yance.exe。' }
  Start-Process -FilePath $Exe -ArgumentList '--post-install' | Out-Null
  $deadline = [DateTime]::UtcNow.AddSeconds([int]$Package.postInstallTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline -and !(Test-Path -LiteralPath $PassReceipt)) { Start-Sleep -Milliseconds 500 }
  if (!(Test-Path -LiteralPath $PassReceipt)) { throw '升级后启动未产生 PASS 回执。' }

  $After = Read-InstalledIdentity $InstallRoot
  if ($After.sourceCommit -ne $Package.targetSourceCommit) { throw "升级后源码身份不匹配。actual=$($After.sourceCommit)" }
  if ($Package.requirePlatformAuth -and ($After.platformAuthConfigured -ne $true -or $After.platformAuthReleaseManaged -ne $true)) { throw '目标安装包未绑定受发行管理的 Telegram/Facebook 平台配置。' }

  $Result.status = 'PASS'
  $Result.completedAtUtc = [DateTime]::UtcNow.ToString('o')
  $Result.targetBuildId = $After.buildId
  $Result.platformAuthConfigured = $After.platformAuthConfigured
  Write-Result $Result $BackupRoot $UserDataRoot
  if (!$KeepApplicationBackup) { Remove-Item -LiteralPath $ApplicationBackup -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Host "言策升级完成。备份与报告：$BackupRoot" -ForegroundColor Green
  exit 0
} catch {
  $failure = $_.Exception.Message
  try { Stop-YanceProcesses } catch {}
  try {
    if (Test-Path -LiteralPath $ApplicationBackup) {
      Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
      Copy-Tree $ApplicationBackup $InstallRoot -Mirror
    }
    if (Test-Path -LiteralPath $UserDataBackup) {
      Copy-Tree $UserDataBackup $UserDataRoot -Mirror
    }
    $Result.rolledBack = $true
  } catch {
    $Result.rollbackError = $_.Exception.Message
  }
  $Result.status = 'FAIL'
  $Result.failedAtUtc = [DateTime]::UtcNow.ToString('o')
  $Result.error = $failure
  Write-Result $Result $BackupRoot $UserDataRoot
  throw "升级失败；已执行回滚。原因：$failure。报告：$BackupRoot\upgrade-result.json"
}
`;
}

function createPackage(options = {}) {
  const installerInput = clean(options.installer);
  const outputInput = clean(options.outputDir);
  if (!installerInput) throw Object.assign(new Error('必须提供现有 Windows 安装程序'), { code: 'YANCE_UPGRADE_INSTALLER_MISSING' });
  if (!outputInput) throw Object.assign(new Error('必须提供输出目录'), { code: 'YANCE_UPGRADE_OUTPUT_REQUIRED' });
  const installerPath = path.resolve(installerInput);
  const outputDir = path.resolve(outputInput);
  if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
    throw Object.assign(new Error('必须提供现有 Windows 安装程序'), { code: 'YANCE_UPGRADE_INSTALLER_MISSING' });
  }
  const baselineSourceCommit = gitObject(options.baselineCommit, 'baseline commit');
  const targetSourceCommit = gitObject(options.targetCommit, 'target commit');
  const targetSourceTree = gitObject(options.targetTree, 'target tree');
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
    throw Object.assign(new Error('升级包输出目录必须为空，拒绝删除现有文件'), { code: 'YANCE_UPGRADE_OUTPUT_NOT_EMPTY', details: { outputDir } });
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const installerFileName = path.basename(installerPath);
  const copiedInstaller = path.join(outputDir, installerFileName);
  fs.copyFileSync(installerPath, copiedInstaller);
  const manifest = {
    schemaVersion: 1,
    packageType: 'YANCE_TRANSACTIONAL_IN_PLACE_UPGRADE',
    product: 'Yance',
    publicName: '言策',
    createdAtUtc: new Date().toISOString(),
    installerFileName,
    installerSha256: sha256File(copiedInstaller),
    allowedBaselineSourceCommits: [baselineSourceCommit],
    targetSourceCommit,
    targetSourceTree,
    requirePlatformAuth: options.requirePlatformAuth !== false,
    postInstallTimeoutSeconds: Math.max(30, Math.min(300, Number(options.postInstallTimeoutSeconds || 120))),
    preservesUserDataRoot: '%APPDATA%\\Yance',
    rollbackMode: 'APPLICATION_AND_USER_DATA_SNAPSHOT'
  };
  const manifestPath = path.join(outputDir, 'upgrade-manifest.json');
  fs.writeFileSync(manifestPath, canonicalJson(manifest), 'utf8');
  const manifestSha256 = sha256File(manifestPath);
  fs.writeFileSync(path.join(outputDir, 'upgrade-manifest.sha256'), `${manifestSha256}  upgrade-manifest.json\n`, 'utf8');
  const scriptPath = path.join(outputDir, 'Yance-OneClick-Upgrade.ps1');
  fs.writeFileSync(scriptPath, powershellScript(), 'utf8');
  fs.writeFileSync(path.join(outputDir, '开始升级言策.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Yance-OneClick-Upgrade.ps1"\r\nif errorlevel 1 pause\r\n', 'utf8');
  fs.writeFileSync(path.join(outputDir, 'README_ZH.txt'), [
    '言策原地升级包',
    '',
    '双击“开始升级言策.cmd”。升级器会自动校验版本、备份应用与用户数据、安装、启动验证；失败时自动恢复。',
    '不要单独移动或删除本目录里的安装包、JSON、SHA-256 或 PowerShell 文件。',
    '普通用户不需要运行源码测试、Round 1、Round 2 或 Builder。',
    '',
    `允许的旧源码：${baselineSourceCommit}`,
    `目标源码：${targetSourceCommit}`,
    `安装包 SHA-256：${manifest.installerSha256}`
  ].join('\r\n'), 'utf8');
  return {
    status: 'PASS',
    outputDir,
    installerPath: copiedInstaller,
    installerSha256: manifest.installerSha256,
    manifestPath,
    manifestSha256,
    scriptPath,
    targetSourceCommit,
    targetSourceTree
  };
}

function usage() {
  return 'node tools/release/create-windows-upgrade-package.js --installer <Yance-Setup.exe> --output-dir <目录> --baseline-commit <40位> --target-commit <40位> --target-tree <40位>';
}

function main() {
  try {
    const args = parseArgs();
    if (args.help) { process.stdout.write(`${usage()}\n`); return; }
    const result = createPackage({
      installer: args.installer,
      outputDir: args['output-dir'],
      baselineCommit: args['baseline-commit'],
      targetCommit: args['target-commit'],
      targetTree: args['target-tree'],
      requirePlatformAuth: args['require-platform-auth'] !== 'false',
      postInstallTimeoutSeconds: args['post-install-timeout-seconds']
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: error.code || 'YANCE_UPGRADE_PACKAGE_FAILED', message: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { canonicalJson, createPackage, gitObject, parseArgs, powershellScript, sha256File };
