#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const exactCapabilities = ['PRIMARY_DB_CONSTRUCTOR', 'PRIMARY_STORE_CONSTRUCTOR'];

const singleAuthorityPath = path.join(repoRoot, 'backend', 'tests', 'architectureClosureV2', 'wpB', 'sqliteStoreSingleAuthority.test.js');
let singleAuthority = fs.readFileSync(singleAuthorityPath, 'utf8');
const staleDelegation = "  assert.match(source, /return engine\\.R32SqliteStore\\.call\\(this, options\\)/u);\n";
const governedDelegation = "  assert.match(source, /const store = engine\\.R32SqliteStore\\.call\\(this, options\\)/u);\n  assert.match(source, /return store/u);\n";
const delegationCount = singleAuthority.split(staleDelegation).length - 1;
if (delegationCount !== 1) throw new Error(`expected one stale facade delegation assertion, found ${delegationCount}`);
singleAuthority = singleAuthority.replace(staleDelegation, governedDelegation);
fs.writeFileSync(singleAuthorityPath, singleAuthority, 'utf8');

const registryPath = path.join(repoRoot, 'governance', 'architecture-closure-v2', 'wp-b-authority-registry-extension.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
if (!Array.isArray(registry.entries) || registry.entries.length !== 1) {
  throw new Error('WP-B registry extension must contain one exact entry');
}
registry.entries[0].allowedCapabilities = exactCapabilities;
fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');

const sourceClosurePath = path.join(repoRoot, 'backend', 'tests', 'architectureClosureV2', 'wpA', 'sourceClosureInventory.test.js');
let sourceClosure = fs.readFileSync(sourceClosurePath, 'utf8');
const replacements = [
  [
    "      allowedCapabilities: ['PRIMARY_DB_CONSTRUCTOR', 'BUSINESS_SQL_MUTATION'],\n",
    "      allowedCapabilities: ['PRIMARY_DB_CONSTRUCTOR', 'PRIMARY_STORE_CONSTRUCTOR'],\n"
  ],
  [
    "      && error?.undeclared?.includes('BUSINESS_SQL_MUTATION')\n",
    "      && error?.undeclared?.includes('PRIMARY_STORE_CONSTRUCTOR')\n"
  ],
  [
    "    'PRIMARY_DB_CONSTRUCTOR',\n    'BUSINESS_SQL_MUTATION',\n    'RECOVERY_OR_FALLBACK_ENTRYPOINT'\n",
    "    'PRIMARY_DB_CONSTRUCTOR',\n    'PRIMARY_STORE_CONSTRUCTOR',\n    'RECOVERY_OR_FALLBACK_ENTRYPOINT'\n"
  ]
];
for (const [before, after] of replacements) {
  const count = sourceClosure.split(before).length - 1;
  if (count !== 1) throw new Error(`expected one stale source-closure fragment, found ${count}: ${before}`);
  sourceClosure = sourceClosure.replace(before, after);
}
fs.writeFileSync(sourceClosurePath, sourceClosure, 'utf8');

process.stdout.write('PR17_REFACTOR_CONTRACTS_PATCHED\n');
