'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows}=require('./final-phase-helpers');
test('wp7-clean-install-residual-removal.test',()=>{const d=load('evidence/wp7/clean-install.json');assertWindows(d);assert.equal(d.remainingResidueCount,0);assert.ok(d.beforeResidualInventorySha256);assert.ok(d.afterResidualInventorySha256);});
