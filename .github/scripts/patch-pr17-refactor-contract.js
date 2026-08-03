#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const testPath = path.resolve(__dirname, '..', '..', 'backend', 'tests', 'architectureClosureV2', 'wpB', 'sqliteStoreSingleAuthority.test.js');
let source = fs.readFileSync(testPath, 'utf8');
const before = "  assert.match(source, /return engine\\.R32SqliteStore\\.call\\(this, options\\)/u);\n";
const after = "  assert.match(source, /const store = engine\\.R32SqliteStore\\.call\\(this, options\\)/u);\n  assert.match(source, /return store/u);\n";
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`expected one stale facade delegation assertion, found ${count}`);
source = source.replace(before, after);
fs.writeFileSync(testPath, source, 'utf8');
process.stdout.write('PR17_REFACTOR_CONTRACT_PATCHED\n');
