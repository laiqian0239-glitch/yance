'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  canonicalTarPath,
  createDeterministicTarGzip
} = require('../../tools/wp7/deterministic-tar-gzip');

const FIXED_TIMESTAMP = '2026-08-13T00:00:00.000Z';

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function withTempDirectory(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-wp7-node-tar-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root, sourceMtime) {
  const bundle = path.join(root, 'bundle');
  const deep = path.join(bundle, 'deep');
  const bin = path.join(bundle, 'bin');
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });

  const longName = `get${'x'.repeat(108)}.d.ts`;
  const longPath = path.join(deep, longName);
  fs.writeFileSync(longPath, 'export type LongPath = true;\n');
  fs.writeFileSync(path.join(bundle, 'plain.txt'), 'plain\n');
  fs.writeFileSync(path.join(bin, 'run.cmd'), '@echo off\r\necho run\r\n');

  const timestamp = new Date(sourceMtime);
  for (const target of [longPath, path.join(bundle, 'plain.txt'), path.join(bin, 'run.cmd'), deep, bin, bundle]) {
    fs.utimesSync(target, timestamp, timestamp);
  }

  return {
    bundle,
    longEntry: `bundle/deep/${longName}`,
    expectedEntries: [
      'bundle/',
      'bundle/bin/',
      'bundle/bin/run.cmd',
      'bundle/deep/',
      `bundle/deep/${longName}`,
      'bundle/plain.txt'
    ]
  };
}

function loadArchiveTool(nodeModules) {
  assert.ok(nodeModules, 'WP7_ARCHIVE_TOOL_NODE_MODULES must point to the isolated archive OSS node_modules');
  const absolute = path.resolve(nodeModules);
  const packageJsonPath = path.join(absolute, 'tar', 'package.json');
  assert.equal(fs.existsSync(packageJsonPath), true, `missing isolated tar package metadata: ${packageJsonPath}`);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  assert.equal(packageJson.version, '7.5.22');
  return require(path.join(absolute, 'tar'));
}

test('node-tar PAX archive preserves long paths and WP7 deterministic metadata policy', () => {
  const archiveToolNodeModules = process.env.WP7_ARCHIVE_TOOL_NODE_MODULES;
  const tar = loadArchiveTool(archiveToolNodeModules);

  withTempDirectory(root => {
    const firstRoot = path.join(root, 'first');
    const secondRoot = path.join(root, 'second');
    fs.mkdirSync(firstRoot);
    fs.mkdirSync(secondRoot);
    const first = writeFixture(firstRoot, '2025-01-01T00:00:00.000Z');
    const second = writeFixture(secondRoot, '2026-06-01T12:34:56.000Z');
    const firstArchive = path.join(root, 'first.tar.gz');
    const secondArchive = path.join(root, 'second.tar.gz');

    const firstResult = createDeterministicTarGzip({
      sourceRoot: firstRoot,
      entryRoot: 'bundle',
      outputPath: firstArchive,
      timestamp: FIXED_TIMESTAMP,
      targetPlatform: 'win32',
      archiveToolNodeModules
    });
    const secondResult = createDeterministicTarGzip({
      sourceRoot: secondRoot,
      entryRoot: 'bundle',
      outputPath: secondArchive,
      timestamp: FIXED_TIMESTAMP,
      targetPlatform: 'win32',
      archiveToolNodeModules
    });

    assert.equal(firstResult.implementation, 'NODE_TAR_PAX_GZIP_V1');
    assert.equal(secondResult.implementation, 'NODE_TAR_PAX_GZIP_V1');
    assert.equal(firstResult.entryCount, first.expectedEntries.length);
    assert.equal(secondResult.entryCount, second.expectedEntries.length);
    assert.equal(sha256(firstArchive), sha256(secondArchive), 'source mtimes must not affect deterministic archive bytes');
    assert.deepEqual(fs.readFileSync(firstArchive), fs.readFileSync(secondArchive));

    const entries = [];
    tar.t({
      file: firstArchive,
      sync: true,
      onentry(entry) {
        entries.push({
          path: entry.path,
          mode: entry.mode & 0o777,
          mtime: entry.mtime ? entry.mtime.toISOString() : null
        });
      }
    });

    assert.deepEqual(entries.map(entry => entry.path), first.expectedEntries);
    assert.ok(entries.some(entry => entry.path === first.longEntry), 'PAX archive must preserve the exact >100-byte filename');
    assert.equal(entries.find(entry => entry.path === 'bundle/bin/run.cmd').mode, 0o755);
    assert.equal(entries.find(entry => entry.path === 'bundle/plain.txt').mode, 0o644);
    assert.equal(entries.find(entry => entry.path === 'bundle/').mode, 0o755);
    for (const entry of entries.filter(row => !row.path.endsWith('/'))) {
      assert.equal(entry.mtime, FIXED_TIMESTAMP, `file mtime must be fixed: ${entry.path}`);
    }
  });
});

test('WP7 archive policy rejects unsafe paths and real symlinks before node-tar encoding', () => {
  const archiveToolNodeModules = process.env.WP7_ARCHIVE_TOOL_NODE_MODULES;
  loadArchiveTool(archiveToolNodeModules);
  assert.throws(() => canonicalTarPath('../escape'), /unsafe segments/u);

  withTempDirectory(root => {
    const fixture = writeFixture(root, '2025-01-01T00:00:00.000Z');
    const outside = path.join(root, 'outside-target');
    fs.mkdirSync(outside);
    const link = path.join(fixture.bundle, 'symlink-dir');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');

    assert.throws(
      () => createDeterministicTarGzip({
        sourceRoot: root,
        entryRoot: 'bundle',
        outputPath: path.join(root, 'symlink.tar.gz'),
        timestamp: FIXED_TIMESTAMP,
        targetPlatform: 'win32',
        archiveToolNodeModules
      }),
      error => error && error.reasonCode === 'WP7_PRE_REVIEW_TRUSTED_PRODUCT_ARCHIVE_FAILED' && /symlinks are forbidden/u.test(error.message)
    );
  });
});
