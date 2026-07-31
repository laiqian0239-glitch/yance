'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function fail(reasonCode, message, details = {}) {
  const error = new Error(message);
  error.reasonCode = reasonCode;
  error.details = details;
  throw error;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function validateReceipt(receipt, expected) {
  if (receipt?.schemaVersion !== 1
    || receipt?.documentType !== 'WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT'
    || receipt?.status !== 'PASS'
    || receipt?.action !== expected.action
    || receipt?.executionNonce !== expected.executionNonce
    || receipt?.isAdministrator !== true) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT_INVALID', 'elevated helper receipt is not bound to the request', { receipt, expected });
  }
  if (!Array.isArray(receipt.before) || !Array.isArray(receipt.after)) {
    fail('WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT_INVALID', 'elevated helper receipt has no adapter snapshots');
  }
  return receipt;
}

class WindowsElevatedNetworkAdapter {
  constructor(options = {}) {
    this.root = path.resolve(options.root || '.');
    this.launch = options.launch;
    if (typeof this.launch !== 'function') fail('WP7_WINDOWS_NETWORK_ISOLATION_PROVIDER_INVALID', 'elevated adapter requires a helper launcher');
  }

  async invoke(action, rows = []) {
    const executionNonce = crypto.randomUUID();
    const operationRoot = path.join(this.root, `${Date.now()}-${executionNonce}`);
    const requestPath = path.join(operationRoot, 'request.json');
    const receiptPath = path.join(operationRoot, 'receipt.json');
    const request = {
      schemaVersion: 1,
      action,
      executionNonce,
      interfaceIndexes: rows.map((row) => Number(row.interfaceIndex))
    };
    writeJson(requestPath, request);
    const result = await this.launch({ requestPath, receiptPath, request });
    if (result?.exitCode !== 0 || !fs.existsSync(receiptPath)) {
      fail('WP7_WINDOWS_NETWORK_ISOLATION_HELPER_FAILED', 'elevated helper did not produce a successful receipt', { action, result, receiptPath });
    }
    let receipt;
    try { receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')); }
    catch (error) { fail('WP7_WINDOWS_NETWORK_ISOLATION_HELPER_RECEIPT_INVALID', 'elevated helper receipt is invalid JSON', { message: error.message }); }
    return validateReceipt(receipt, request);
  }

  async snapshot() {
    const receipt = await this.invoke('SNAPSHOT');
    return receipt.after.map((row) => ({
      interfaceIndex: Number(row.interfaceIndex),
      name: String(row.interfaceDescription || `interface-${row.interfaceIndex}`),
      status: String(row.status),
      macAddress: String(row.macAddress || '')
    }));
  }

  async disable(rows) { return this.invoke('DISABLE', rows); }
  async restore(rows) { return this.invoke('RESTORE', rows); }
}

function createWindowsUacLauncher(options = {}) {
  const helperPath = path.resolve(options.helperPath || path.join(__dirname, 'windows-network-isolation-helper.ps1'));
  const launcherPath = path.resolve(options.launcherPath || path.join(__dirname, 'windows-network-isolation-uac-launcher.ps1'));
  return ({ requestPath, receiptPath }) => new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath,
      '-HelperPath', helperPath, '-RequestPath', requestPath, '-ReceiptPath', receiptPath
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr, launcherPath, helperPath }));
  });
}

module.exports = { WindowsElevatedNetworkAdapter, createWindowsUacLauncher, validateReceipt };
