'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function requiredFile(filePath, label) {
  const absolute = path.resolve(String(filePath || ''));
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`${label} is missing: ${absolute}`);
  return absolute;
}

function parseJsonLine(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try { return JSON.parse(lines[index]); } catch (_) {}
  }
  return null;
}

function signAuthenticode(options = {}) {
  const hostPlatform = options.hostPlatform || process.platform;
  if (hostPlatform !== 'win32' && options.allowNonWindows !== true) throw new Error('Authenticode signing must run on Windows');
  const filePath = requiredFile(options.filePath, 'file to sign');
  const certificatePath = requiredFile(options.certificatePath, 'PFX certificate');
  const signToolPath = requiredFile(options.signToolPath, 'signtool.exe');
  if (path.extname(signToolPath).toLowerCase() !== '.exe') throw new Error('signtool path must point to a native .exe');
  const password = String(options.password || options.env?.YANCE_WINDOWS_CERTIFICATE_PASSWORD || process.env.YANCE_WINDOWS_CERTIFICATE_PASSWORD || '');
  if (!password) throw new Error('YANCE_WINDOWS_CERTIFICATE_PASSWORD is required');
  const scriptPath = requiredFile(options.scriptPath || path.join(__dirname, 'sign-authenticode.ps1'), 'Authenticode signing script');
  const powershell = options.powershellPath || 'powershell.exe';
  const timestampUrl = String(options.timestampUrl || DEFAULT_TIMESTAMP_URL);
  const spawn = options.spawn || spawnSync;
  const result = spawn(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-FilePath', filePath,
    '-CertificatePath', certificatePath,
    '-SignToolPath', signToolPath,
    '-TimestampUrl', timestampUrl
  ], {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...(options.env || {}), YANCE_WINDOWS_CERTIFICATE_PASSWORD: password }
  });
  if (result.status !== 0) {
    const error = new Error(`Authenticode signing failed with exit code ${result.status}`);
    error.details = { stdout: String(result.stdout || '').slice(-8000), stderr: String(result.stderr || '').slice(-8000) };
    throw error;
  }
  const receipt = parseJsonLine(result.stdout);
  if (!receipt || receipt.status !== 'PASS' || receipt.signatureStatus !== 'Valid') throw new Error('Authenticode signer did not return a valid verification receipt');
  return Object.freeze({
    status: 'PASS',
    filePath,
    sha256: sha256File(filePath),
    signatureStatus: receipt.signatureStatus,
    signerSubject: String(receipt.signerSubject || ''),
    signerThumbprint: String(receipt.signerThumbprint || ''),
    timestampSubject: String(receipt.timestampSubject || ''),
    timestampUrl
  });
}

module.exports = { DEFAULT_TIMESTAMP_URL, parseJsonLine, signAuthenticode };
