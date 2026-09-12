'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const wp1 = require('../../tools/wp1/lib');

const ROOT = path.resolve(__dirname, '..', '..');

test('V21 Final Builder runtime package projection preserves npm override authority required by the reviewed lockfile', () => {
  const sourcePackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const releaseSource = JSON.parse(fs.readFileSync(path.join(ROOT, 'release', 'release-source.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const schemaAuthority = wp1.deriveDatabaseSchemaVersion(ROOT);
  const projected = wp1.generatedPackageMetadata(ROOT, releaseSource, schemaAuthority.databaseSchemaVersion);

  assert.deepEqual(projected.dependencies, sourcePackage.dependencies);
  assert.deepEqual(projected.overrides, sourcePackage.overrides);
  assert.equal(projected.devDependencies, undefined, 'runtime projection must not reintroduce development dependencies');

  const reviewedSharpOverride = sourcePackage.overrides?.['@letta-ai/letta-code']?.sharp;
  assert.equal(reviewedSharpOverride, '0.35.3');
  assert.equal(projected.overrides?.['@letta-ai/letta-code']?.sharp, reviewedSharpOverride);
  assert.equal(packageLock.packages?.['node_modules/sharp']?.version, reviewedSharpOverride);
});
