'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('offline-installed-runtime-ready.test',()=>{const d=load('evidence/wp7/offline-startup.json');assertWindows(d);assertBoolean(d,'networkUnavailable');assertBoolean(d,'localReadyReached');assertBoolean(d,'capabilityStateExplicit');assert.equal(d.falseOnlineCapabilityCount,0);});
