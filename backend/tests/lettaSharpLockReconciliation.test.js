'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  planLettaSharpLockReconciliation,
  reconcileLettaSharpLockFile
} = require('../../scripts/dependencies/reconcile-letta-sharp-lock');

const NESTED = 'node_modules/@letta-ai/letta-code/node_modules/';
const NESTED_SHARP = `${NESTED}sharp`;
const NESTED_SHARP_LINUX = `${NESTED}@img/sharp-linux-x64`;
const NESTED_LIBVIPS_LINUX = `${NESTED}@img/sharp-libvips-linux-x64`;
const NESTED_COLOUR = `${NESTED}@img/colour`;
const NESTED_SEMVER = `${NESTED}semver`;

function staleLock() {
  return {
    name: 'yance-lock-reconciliation-fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'yance-lock-reconciliation-fixture',
        version: '0.0.0'
      },
      'node_modules/@letta-ai/letta-code': {
        version: '0.30.5',
        resolved: 'https://registry.npmjs.org/@letta-ai/letta-code/-/letta-code-0.30.5.tgz',
        integrity: 'sha512-reviewed-letta-fixture',
        dependencies: {
          sharp: '^0.34.5',
          semver: '^7.7.3'
        }
      },
      'node_modules/sharp': {
        version: '0.35.3',
        resolved: 'https://registry.npmjs.org/sharp/-/sharp-0.35.3.tgz',
        integrity: 'sha512-reviewed-root-sharp-fixture'
      },
      [NESTED_SHARP]: {
        version: '0.34.5',
        resolved: 'https://registry.npmjs.org/sharp/-/sharp-0.34.5.tgz',
        integrity: 'sha512-stale-nested-sharp-fixture',
        optionalDependencies: {
          '@img/sharp-linux-x64': '0.34.5',
          '@img/sharp-libvips-linux-x64': '1.2.4'
        }
      },
      [NESTED_SHARP_LINUX]: {
        version: '0.34.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-linux-x64/-/sharp-linux-x64-0.34.5.tgz',
        integrity: 'sha512-stale-sharp-platform-fixture'
      },
      [NESTED_LIBVIPS_LINUX]: {
        version: '1.2.4',
        resolved: 'https://registry.npmjs.org/@img/sharp-libvips-linux-x64/-/sharp-libvips-linux-x64-1.2.4.tgz',
        integrity: 'sha512-stale-libvips-platform-fixture'
      },
      [NESTED_COLOUR]: {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/@img/colour/-/colour-1.0.0.tgz',
        integrity: 'sha512-unrelated-colour-fixture'
      },
      [NESTED_SEMVER]: {
        version: '7.8.5',
        resolved: 'https://registry.npmjs.org/semver/-/semver-7.8.5.tgz',
        integrity: 'sha512-unrelated-semver-fixture'
      },
      'node_modules/unrelated-runtime': {
        version: '1.0.0'
      }
    }
  };
}

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function withTempLock(lock, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yance-letta-sharp-lock-'));
  const lockPath = path.join(root, 'package-lock.json');
  fs.writeFileSync(lockPath, canonical(lock));
  try {
    return callback(lockPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('planner identifies only the exact reviewed stale Letta sharp subtree without mutating input', () => {
  const lock = staleLock();
  const before = structuredClone(lock);
  const result = planLettaSharpLockReconciliation(lock);

  assert.deepEqual(result.deletePaths, [
    NESTED_LIBVIPS_LINUX,
    NESTED_SHARP_LINUX,
    NESTED_SHARP
  ].sort());
  assert.deepEqual(lock, before, 'planning must be pure and leave caller-owned lock bytes semantically unchanged');
});

test('file reconciliation deletes only planned stale nodes and preserves unrelated Letta-local authority', () => {
  const lock = staleLock();
  withTempLock(lock, (lockPath) => {
    const result = reconcileLettaSharpLockFile(lockPath);
    const outputText = fs.readFileSync(lockPath, 'utf8');
    const output = JSON.parse(outputText);

    assert.deepEqual(result.deletePaths, [
      NESTED_LIBVIPS_LINUX,
      NESTED_SHARP_LINUX,
      NESTED_SHARP
    ].sort());
    assert.equal(output.packages[NESTED_SHARP], undefined);
    assert.equal(output.packages[NESTED_SHARP_LINUX], undefined);
    assert.equal(output.packages[NESTED_LIBVIPS_LINUX], undefined);
    assert.deepEqual(output.packages[NESTED_COLOUR], lock.packages[NESTED_COLOUR]);
    assert.deepEqual(output.packages[NESTED_SEMVER], lock.packages[NESTED_SEMVER]);
    assert.deepEqual(output.packages['node_modules/unrelated-runtime'], lock.packages['node_modules/unrelated-runtime']);
    assert.deepEqual(output.packages['node_modules/sharp'], lock.packages['node_modules/sharp']);
    assert.equal(outputText, canonical(output), 'output must be canonical two-space JSON with exactly one trailing LF');
  });
});

test('planner refuses root sharp, Letta parent, or declared-range drift before producing a deletion plan', () => {
  const cases = [
    ['root sharp drift', lock => { lock.packages['node_modules/sharp'].version = '0.35.2'; }, /root sharp.*0\.35\.3/iu],
    ['Letta Code drift', lock => { lock.packages['node_modules/@letta-ai/letta-code'].version = '0.30.6'; }, /Letta Code.*0\.30\.5/iu],
    ['Letta sharp range drift', lock => { lock.packages['node_modules/@letta-ai/letta-code'].dependencies.sharp = '^0.35.0'; }, /sharp.*\^0\.34\.5/iu]
  ];

  for (const [label, mutate, pattern] of cases) {
    const lock = staleLock();
    mutate(lock);
    const before = structuredClone(lock);
    assert.throws(() => planLettaSharpLockReconciliation(lock), pattern, label);
    assert.deepEqual(lock, before, `${label}: failed planning must not mutate input`);
  }
});

test('planner refuses already-safe or already-absent nested sharp instead of fabricating work', () => {
  const safe = staleLock();
  safe.packages[NESTED_SHARP].version = '0.35.3';
  assert.throws(
    () => planLettaSharpLockReconciliation(safe),
    /nested sharp.*0\.34\.5|already.*safe/iu
  );

  const absent = staleLock();
  delete absent.packages[NESTED_SHARP];
  assert.throws(
    () => planLettaSharpLockReconciliation(absent),
    /nested sharp.*0\.34\.5|absent|already/iu
  );
});

test('planner refuses unexpected target platform versions and performs no partial filesystem mutation', () => {
  const lock = staleLock();
  lock.packages[NESTED_SHARP_LINUX].version = '0.34.6';
  const original = canonical(lock);

  withTempLock(lock, (lockPath) => {
    assert.throws(
      () => reconcileLettaSharpLockFile(lockPath),
      /@img\/sharp.*0\.34\.5|unexpected.*version/iu
    );
    assert.equal(fs.readFileSync(lockPath, 'utf8'), original, 'validation failure must leave file bytes untouched');
  });
});

test('helper rejects unsupported lockfile versions before mutation', () => {
  const lock = staleLock();
  lock.lockfileVersion = 2;
  const before = structuredClone(lock);
  assert.throws(() => planLettaSharpLockReconciliation(lock), /lockfileVersion.*3/iu);
  assert.deepEqual(lock, before);
});

test('reconciliation is deterministic for identical reviewed stale input', () => {
  const first = staleLock();
  const second = staleLock();
  let firstOutput = null;
  let secondOutput = null;

  withTempLock(first, (lockPath) => {
    reconcileLettaSharpLockFile(lockPath);
    firstOutput = fs.readFileSync(lockPath, 'utf8');
  });
  withTempLock(second, (lockPath) => {
    reconcileLettaSharpLockFile(lockPath);
    secondOutput = fs.readFileSync(lockPath, 'utf8');
  });

  assert.equal(firstOutput, secondOutput);
});
