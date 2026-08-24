'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const {
  seedTrustedDependencyCache,
  verifyTrustedDependencySeeds
} = require('../../tools/runtime-delivery/dependency-install-authority');


function tarHeader(name, size) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, 'utf8');
  header.write('0000777\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

function npmTarball(packageName = 'example', version = '1.2.3', rootDirectory = 'package') {
  const body = Buffer.from(JSON.stringify({ name: packageName, version }), 'utf8');
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return zlib.gzipSync(Buffer.concat([
    tarHeader(`${rootDirectory}/package.json`, body.length),
    body,
    padding,
    Buffer.alloc(1024, 0)
  ]));
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yance-clean-install-authority-'));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function npmIntegrity(buffer) {
  return `sha512-${crypto.createHash('sha512').update(buffer).digest('base64')}`;
}

function fixture() {
  const root = tempRoot();
  const archive = npmTarball();
  const archiveRelative = 'vendor/npm/example-1.2.3.tgz';
  fs.mkdirSync(path.join(root, 'vendor/npm'), { recursive: true });
  fs.mkdirSync(path.join(root, 'governance'), { recursive: true });
  fs.writeFileSync(path.join(root, archiveRelative), archive);
  const integrity = npmIntegrity(archive);
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/example': {
        version: '1.2.3',
        resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz',
        integrity
      }
    }
  }, null, 2));
  fs.writeFileSync(path.join(root, 'governance/dependency-install-policy.json'), JSON.stringify({
    schemaVersion: 1,
    trustedCacheSeeds: [{
      packageName: 'example',
      version: '1.2.3',
      lockPath: 'node_modules/example',
      resolved: 'https://registry.npmjs.org/example/-/example-1.2.3.tgz',
      integrity,
      archivePath: archiveRelative,
      archiveSha256: sha256(archive),
      license: 'MIT'
    }]
  }, null, 2));
  return { root, archive, archiveRelative };
}

test('trusted dependency seeds are rejected when the vendored archive digest differs from policy', () => {
  const { root, archiveRelative } = fixture();
  fs.appendFileSync(path.join(root, archiveRelative), 'tampered');
  assert.throws(
    () => verifyTrustedDependencySeeds(root),
    error => error.reasonCode === 'SOURCE_UAT_DEPENDENCY_SEED_SHA256_MISMATCH'
  );
});

test('trusted dependency seeds must match package-lock version, resolved URL and npm integrity', () => {
  const { root } = fixture();
  const policyPath = path.join(root, 'governance/dependency-install-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  policy.trustedCacheSeeds[0].version = '9.9.9';
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  assert.throws(
    () => verifyTrustedDependencySeeds(root),
    error => error.reasonCode === 'SOURCE_UAT_DEPENDENCY_SEED_LOCK_MISMATCH'
  );
});

test('trusted dependency cache seeding uses a private cache and returns an auditable receipt', () => {
  const { root } = fixture();
  const calls = [];
  const cacheRoot = path.join(root, '.tmp/npm-cache');
  const npmCliPath = path.join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(npmCliPath), { recursive: true });
  fs.writeFileSync(npmCliPath, '');
  const receipt = seedTrustedDependencyCache(root, {
    platform: 'win32',
    cacheRoot,
    npmCliPath,
    nodeExecutable: process.execPath,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, error: null, signal: null };
    }
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.seedCount, 1);
  assert.equal(receipt.cacheRoot, path.resolve(cacheRoot));
  assert.equal(calls[0].command, process.execPath);
  assert.equal(calls[0].args[0], npmCliPath);
  assert.deepEqual(calls[0].args.slice(1, 3), ['cache', 'add']);
  assert.match(calls[0].args[3], /example-1\.2\.3\.tgz$/u);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
});



test('trusted dependency seeds accept npm tarballs with a safe single-root package directory', () => {
  const { root, archiveRelative } = fixture();
  const buffer = npmTarball('example', '1.2.3', 'example');
  fs.writeFileSync(path.join(root, archiveRelative), buffer);
  const policyPath = path.join(root, 'governance/dependency-install-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  policy.trustedCacheSeeds[0].archiveSha256 = sha256(buffer);
  policy.trustedCacheSeeds[0].integrity = npmIntegrity(buffer);
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/example'].integrity = npmIntegrity(buffer);
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  const verification = verifyTrustedDependencySeeds(root);
  assert.equal(verification.seedCount, 1);
  assert.equal(verification.seeds[0].packageMetadata.name, 'example');
});

test('trusted dependency seeds reject a tarball whose package metadata does not match policy', () => {
  const { root, archiveRelative } = fixture();
  fs.writeFileSync(path.join(root, archiveRelative), npmTarball('different-package', '1.2.3'));
  const policyPath = path.join(root, 'governance/dependency-install-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const buffer = fs.readFileSync(path.join(root, archiveRelative));
  policy.trustedCacheSeeds[0].archiveSha256 = sha256(buffer);
  policy.trustedCacheSeeds[0].integrity = npmIntegrity(buffer);
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/example'].integrity = npmIntegrity(buffer);
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  assert.throws(
    () => verifyTrustedDependencySeeds(root),
    error => error.reasonCode === 'SOURCE_UAT_DEPENDENCY_SEED_PACKAGE_METADATA_MISMATCH'
  );
});

test('production dependency policy verifies the complete lockfile-bound trusted tarball set', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  const verification = verifyTrustedDependencySeeds(repoRoot);
  const packageVersions = new Set(verification.seeds.map(seed => `${seed.packageName}@${seed.version}`));
  assert.equal(verification.seedCount, 262);
  assert.equal(packageVersions.size, 262);
  assert.equal(packageVersions.has('@borewit/text-codec@0.2.2'), true);
  assert.equal(packageVersions.has('@electron/get@5.0.0'), true);
  assert.equal(packageVersions.has('write-file-atomic@1.3.4'), true);
  assert.equal(packageVersions.has('yauzl@2.10.0'), true);
});


test('trusted dependency cache seeding batches verified archives instead of spawning once per package', () => {
  const { root } = fixture();
  const secondArchive = npmTarball('second-example', '4.5.6');
  const secondRelative = 'vendor/npm/second-example-4.5.6.tgz';
  fs.writeFileSync(path.join(root, secondRelative), secondArchive);
  const secondIntegrity = npmIntegrity(secondArchive);
  const policyPath = path.join(root, 'governance/dependency-install-policy.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  policy.trustedCacheSeeds.push({
    packageName: 'second-example',
    version: '4.5.6',
    lockPath: 'node_modules/second-example',
    resolved: 'https://registry.npmjs.org/second-example/-/second-example-4.5.6.tgz',
    integrity: secondIntegrity,
    archivePath: secondRelative,
    archiveSha256: sha256(secondArchive),
    license: 'MIT'
  });
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  const lockPath = path.join(root, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.packages['node_modules/second-example'] = {
    version: '4.5.6',
    resolved: 'https://registry.npmjs.org/second-example/-/second-example-4.5.6.tgz',
    integrity: secondIntegrity
  };
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));

  const calls = [];
  const receipt = seedTrustedDependencyCache(root, {
    platform: 'linux',
    maxBatchSeeds: 32,
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, error: null, signal: null };
    }
  });

  assert.equal(receipt.seedCount, 2);
  assert.equal(receipt.batchCount, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ['cache', 'add']);
  assert.equal(calls[0].args.includes(path.join(root, 'vendor/npm/example-1.2.3.tgz')), true);
  assert.equal(calls[0].args.includes(path.join(root, secondRelative)), true);
});
