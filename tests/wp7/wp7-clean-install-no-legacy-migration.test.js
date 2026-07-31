'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows}=require('./final-phase-helpers');
test('wp7-clean-install-no-legacy-migration.test',()=>{const d=load('evidence/wp7/clean-install.json');assertWindows(d);assert.equal(d.legacyTestDataMigrationAttempted,false);assert.equal(d.legacyTestDataMigrationRequired,false);});
