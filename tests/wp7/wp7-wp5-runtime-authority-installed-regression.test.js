'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('wp7-wp5-runtime-authority-installed-regression.test',()=>{const d=load('evidence/wp7/safe-mode-removal.json');assertWindows(d);assertBoolean(d,'yanceSqliteSoleAuthority');assert.equal(d.legacyFallbackInfluenceCount,0);});
