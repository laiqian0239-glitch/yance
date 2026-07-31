'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('wp7-installer-sha256-preinstall.test',()=>{const d=load('evidence/wp7/preinstall-installer-sha256.json');assertWindows(d);assertBoolean(d,'installerSha256VerifiedImmediatelyBeforeInstall');assert.equal(d.observedInstallerSha256,d.installerSha256);});
