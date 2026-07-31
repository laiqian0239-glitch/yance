'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('clean-install-start-stop-restart.test',()=>{const clean=load('evidence/wp7/clean-install.json'),cycle=load('evidence/wp7/restart-cycle.json');assertWindows(clean);assertWindows(cycle);assertBoolean(clean,'firstStartFreshInitialization');assertBoolean(cycle,'firstStartReady');assertBoolean(cycle,'controlledStopConfirmed');assertBoolean(cycle,'restartReady');assert.equal(clean.installerSha256,cycle.installerSha256);});
