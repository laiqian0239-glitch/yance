'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const file = 'package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.equal(pkg.devDependencies?.electron, '39.8.5', 'factory must start from frozen predecessor Electron identity');
assert.ok(!pkg.overrides || typeof pkg.overrides === 'object', 'package overrides must be an object when present');
const electronOverride = pkg.overrides?.electron;
assert.ok(!electronOverride || typeof electronOverride === 'object', 'existing Electron override must be an object when present');
pkg.overrides = {
  ...(pkg.overrides || {}),
  electron: {
    ...(electronOverride || {}),
    '@electron-internal/extract-zip': '1.0.3',
    '@electron/get': {
      '.': '5.0.0',
      'env-paths': '3.0.0',
      'undici': '7.25.0'
    },
    '@types/node': {
      '.': '24.10.13',
      'undici-types': '7.16.0'
    }
  }
};
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
