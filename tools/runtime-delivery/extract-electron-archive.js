'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const { sha256File, secureZipEntryPath } = require('./source-uat-delivery');

function fail(reasonCode, message, details = {}) {
  const error = Object.assign(new Error(message), { reasonCode, details });
  throw error;
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => error ? reject(error) : resolve(zip));
  });
}

function openReadStream(zip, entry) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
}

async function extract(zipPath, destinationRoot) {
  const zip = await openZip(zipPath);
  await new Promise((resolve, reject) => {
    let settled = false;
    const done = error => {
      if (settled) return;
      settled = true;
      try { zip.close(); } catch (_) {}
      error ? reject(error) : resolve();
    };
    zip.once('error', done);
    zip.once('end', () => done());
    zip.on('entry', async entry => {
      try {
        const destination = secureZipEntryPath(destinationRoot, entry.fileName);
        if (/\/$/u.test(entry.fileName)) {
          fs.mkdirSync(destination, { recursive: true });
          zip.readEntry();
          return;
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const input = await openReadStream(zip, entry);
        const output = fs.createWriteStream(destination, { flags: 'wx', mode: (entry.externalFileAttributes >>> 16) & 0o777 || 0o644 });
        input.once('error', done);
        output.once('error', done);
        output.once('close', () => zip.readEntry());
        input.pipe(output);
      } catch (error) {
        done(error);
      }
    });
    zip.readEntry();
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const zipPath = path.resolve(process.argv[2] || '');
  if (!fs.existsSync(zipPath)) fail('SOURCE_UAT_ELECTRON_ARCHIVE_MISSING', 'Electron ZIP 不存在', { zipPath });
  const expectedSha256 = String(process.env.YANCE_EXPECTED_ELECTRON_SHA256 || '').trim().toLowerCase();
  const actualSha256 = sha256File(zipPath);
  if (!/^[0-9a-f]{64}$/u.test(expectedSha256) || actualSha256 !== expectedSha256) {
    fail('SOURCE_UAT_ELECTRON_ARCHIVE_HASH_MISMATCH', 'Electron ZIP SHA-256 不匹配', { zipPath, expectedSha256, actualSha256 });
  }
  const destinationRoot = path.join(repoRoot, 'node_modules', 'electron', 'dist');
  fs.rmSync(destinationRoot, { recursive: true, force: true });
  fs.mkdirSync(destinationRoot, { recursive: true });
  await extract(zipPath, destinationRoot);
  process.stdout.write(`${JSON.stringify({ status: 'PASS', zipPath, actualSha256, destinationRoot }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', reasonCode: error.reasonCode || error.code || 'SOURCE_UAT_ELECTRON_ARCHIVE_EXTRACT_FAILED', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exitCode = 1;
});
