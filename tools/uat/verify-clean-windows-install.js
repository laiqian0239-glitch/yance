'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { installDependencies } = require('../runtime-delivery/source-uat-delivery');

function error(reasonCode, message, details = {}) {
  throw Object.assign(new Error(message), { reasonCode, code: reasonCode, details });
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function baseReceipt(repoRoot, platform, arch) {
  const lockPath = path.join(repoRoot, 'package-lock.json');
  return {
    schemaVersion: 1,
    documentType: 'YANCE_CLEAN_INSTALL_RECEIPT',
    generatedAtUtc: new Date().toISOString(),
    platform,
    arch,
    windowsUat: false,
    readyForPromotion: false,
    formalRelease: false,
    lockfile: {
      path: 'package-lock.json',
      sha256: fs.existsSync(lockPath) ? sha256File(lockPath) : ''
    }
  };
}

function readLaunchReceipt(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (cause) { error('CLEAN_INSTALL_LAUNCH_RECEIPT_INVALID', '无法读取启动收据', { filePath, cause: cause.code || cause.message }); }
}

function verifyLaunchReceipt(document, options) {
  const expectedCommit = String(options.expectedCommit || '');
  const expectedTree = String(options.expectedTree || '');
  const valid = document?.schemaVersion === 1
    && document?.documentType === 'YANCE_SOURCE_UAT_LAUNCH'
    && document?.platform === 'win32'
    && document?.status === 'RUNTIME_READY'
    && /^[0-9a-f]{64}$/u.test(String(document?.electronExecutableSha256 || ''))
    && (!expectedCommit || document.sourceCommit === expectedCommit)
    && (!expectedTree || document.sourceTree === expectedTree);
  if (!valid) error('CLEAN_INSTALL_LAUNCH_RECEIPT_MISMATCH', '启动收据未通过平台、状态或源码身份绑定校验', {
    expectedCommit,
    expectedTree,
    actual: document || null
  });
  return {
    status: 'RUNTIME_READY',
    receiptPath: path.resolve(options.launchReceiptPath),
    sourceCommit: document.sourceCommit,
    sourceTree: document.sourceTree,
    electronExecutableSha256: document.electronExecutableSha256
  };
}

function verifyCleanWindowsInstall(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const base = baseReceipt(root, platform, arch);
  if (platform !== 'win32') {
    return Object.freeze({
      ...base,
      status: 'STRUCTURAL_ONLY_NON_WINDOWS',
      install: null,
      electronLaunch: { status: 'NOT_EXECUTED', reason: 'NON_WINDOWS_ENVIRONMENT' }
    });
  }
  const install = (options.installDependencies || installDependencies)(root, { ...options, platform, arch });
  const installReceipt = install?.cleanInstallReceipt;
  if (!installReceipt || installReceipt.status !== 'SOURCE_INSTALL_VERIFIED' || installReceipt.dependencyIntegrity?.ok !== true) {
    error('CLEAN_INSTALL_DEPENDENCY_RECEIPT_INVALID', '依赖安装收据未证明完整安装', { installReceipt: installReceipt || null });
  }
  if (!options.launchReceiptPath) {
    return Object.freeze({
      ...base,
      status: 'WINDOWS_INSTALL_VERIFIED_PENDING_LAUNCH',
      install: installReceipt,
      electronLaunch: { status: 'NOT_EXECUTED', reason: 'LAUNCH_RECEIPT_REQUIRED' }
    });
  }
  const electronLaunch = verifyLaunchReceipt(readLaunchReceipt(options.launchReceiptPath), options);
  return Object.freeze({
    ...base,
    status: 'WINDOWS_CLEAN_INSTALL_AND_LAUNCH_VERIFIED',
    windowsUat: true,
    install: installReceipt,
    electronLaunch
  });
}

function value(argv, name) {
  const prefix = `--${name}=`;
  return argv.find(item => item.startsWith(prefix))?.slice(prefix.length) || '';
}

function main() {
  const argv = process.argv.slice(2);
  const repoRoot = path.resolve(value(argv, 'root') || process.cwd());
  const outputPath = path.resolve(value(argv, 'output') || path.join(repoRoot, 'CLEAN_INSTALL_RECEIPT.json'));
  const receipt = verifyCleanWindowsInstall(repoRoot, {
    launchReceiptPath: value(argv, 'launch-receipt'),
    expectedCommit: value(argv, 'expected-commit'),
    expectedTree: value(argv, 'expected-tree')
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ status: receipt.status, outputPath, windowsUat: receipt.windowsUat }, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (cause) {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: cause.reasonCode || cause.code || 'CLEAN_INSTALL_VERIFY_FAILED', message: cause.message, details: cause.details || {} }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { verifyCleanWindowsInstall, verifyLaunchReceipt };
