'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = require('../run_all_tests');

test('launcher creates one existing absolute fallback temp root for every child variable', t => {
  const nonexistent = path.join(__dirname, '.missing-system-temp', String(Date.now()));
  const root = runner.createTestTempRoot({
    TMPDIR: nonexistent,
    TEMP: nonexistent,
    TMP: nonexistent
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(path.isAbsolute(root), true);
  assert.equal(fs.statSync(root).isDirectory(), true);
  assert.equal(root.startsWith(path.join(__dirname, '..', '.test-tmp')), true);

  const env = runner.childEnvironment({ ORIGINAL_MARKER: 'preserved' }, root);
  assert.equal(env.TMPDIR, root);
  assert.equal(env.TEMP, root);
  assert.equal(env.TMP, root);
  assert.equal(env.ORIGINAL_MARKER, 'preserved');
});


test('launcher prioritizes an explicit compact test temp parent over inherited system temp paths', t => {
  const parent = fs.mkdtempSync(path.join(process.cwd(), 'yb40-parent-'));
  const inherited = fs.mkdtempSync(path.join(process.cwd(), 'yb40-inherited-'));
  t.after(() => {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(inherited, { recursive: true, force: true });
  });

  const root = runner.createTestTempRoot({
    YANCE_TEST_TEMP_ROOT: parent,
    TMPDIR: inherited,
    TEMP: inherited,
    TMP: inherited
  });

  assert.equal(path.dirname(root), path.resolve(parent));
  assert.match(path.basename(root), /^yb-/u);
  const env = runner.childEnvironment({}, root);
  assert.equal(env.YANCE_TEST_TEMP_ROOT, root);
});
