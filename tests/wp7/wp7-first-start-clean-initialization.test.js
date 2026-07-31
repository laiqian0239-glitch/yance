'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('wp7-first-start-clean-initialization.test',()=>{const d=load('evidence/wp7/first-start-initialization.json');assertWindows(d);assertBoolean(d,'freshConfigurationCreated');assertBoolean(d,'freshDatabaseCreated');assert.equal(d.legacyDataRootConsumed,false);});
