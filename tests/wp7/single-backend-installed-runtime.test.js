'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows}=require('./final-phase-helpers');
test('single-backend-installed-runtime.test',()=>{const d=load('evidence/wp7/runtime-ownership.json');assertWindows(d);assert.equal(d.maximumConcurrentAppRuntimeOwners,1);assert.equal(d.overlapViolationCount,0);});
