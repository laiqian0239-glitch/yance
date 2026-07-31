'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('wp7-backend-crash-recovery-installed.test',()=>{const d=load('evidence/wp7/runtime-ownership.json');assertWindows(d);assertBoolean(d,'backendCrashRecoveryVerified');assert.equal(d.maximumConcurrentAppRuntimeOwners,1);});
