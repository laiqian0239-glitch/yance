'use strict';

const fs = require('node:fs');
const path = require('node:path');

const output = path.resolve(process.argv[2] || 'learning-promptfoo-sbom.json');
const lock = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package-lock.json'), 'utf8'));
const packages = Object.entries(lock.packages || {}).filter(([key]) => key).map(([key, value]) => ({ path: key, version: value.version || '' })).sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(output, `${JSON.stringify({ schema: 'YANCE_LEARNING_RUNTIME_SBOM_V1', runtime: 'promptfoo', packages }, null, 2)}\n`, 'utf8');
