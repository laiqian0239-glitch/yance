'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('wp7-wp4-credential-authority-installed-regression.test',()=>{const d=load('evidence/wp7/credential-ready-gate.json');assertWindows(d);assertBoolean(d,'hydrationCompletedBeforeLocalReady');assertBoolean(d,'trustedOwnerVerified');assertBoolean(d,'projectionAgreementVerified');assert.equal(d.earlyReadyViolationCount,0);});
