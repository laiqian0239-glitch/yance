'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows}=require('./final-phase-helpers');
test('installed-tree-old-runtime-scan-zero.test',()=>{const d=load('evidence/wp7/install-tree-inventory.json');assertWindows(d);assert.equal(d.forbiddenLegacyEntryCount,0);assert.equal(d.duplicateRuntimeEntrypointCount,0);});
