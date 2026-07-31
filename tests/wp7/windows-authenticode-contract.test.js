'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signAuthenticode } = require('../../tools/wp7/windows-authenticode');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-authenticode-'));
  for (const name of ['Yance-Setup-1.0.0-x64.exe', 'release.pfx', 'signtool.exe']) fs.writeFileSync(path.join(root, name), name);
  return root;
}

test('signer keeps the certificate password out of process arguments and verifies the receipt', () => {
  const root = fixture();
  try {
    let invocation;
    const result = signAuthenticode({
      hostPlatform: 'win32',
      filePath: path.join(root, 'Yance-Setup-1.0.0-x64.exe'),
      certificatePath: path.join(root, 'release.pfx'),
      signToolPath: path.join(root, 'signtool.exe'),
      password: 'top-secret-value',
      spawn(command, args, options) {
        invocation = { command, args, options };
        return { status: 0, stdout: JSON.stringify({ status: 'PASS', signatureStatus: 'Valid', signerSubject: 'CN=Yance', signerThumbprint: 'ABC', timestampSubject: 'CN=Timestamp' }), stderr: '' };
      }
    });
    assert.equal(result.status, 'PASS');
    assert.equal(result.signatureStatus, 'Valid');
    assert.equal(invocation.args.includes('top-secret-value'), false);
    assert.equal(invocation.options.env.YANCE_WINDOWS_CERTIFICATE_PASSWORD, 'top-secret-value');
    assert.match(invocation.args.join(' '), /sign-authenticode\.ps1/);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('signer rejects missing password before starting PowerShell', () => {
  const root = fixture();
  try {
    assert.throws(() => signAuthenticode({
      hostPlatform: 'win32',
      filePath: path.join(root, 'Yance-Setup-1.0.0-x64.exe'),
      certificatePath: path.join(root, 'release.pfx'),
      signToolPath: path.join(root, 'signtool.exe'),
      env: {},
      password: ''
    }), /YANCE_WINDOWS_CERTIFICATE_PASSWORD/);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
