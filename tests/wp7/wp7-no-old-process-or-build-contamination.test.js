'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {load,assertWindows}=require('./final-phase-helpers');
test('wp7-no-old-process-or-build-contamination.test',()=>{const d=load('evidence/wp7/no-contamination.json');assertWindows(d);assert.equal(d.oldRuntimeProcessCount,0);assert.equal(d.oldBuildArtifactCount,0);assert.equal(d.oldStagingArtifactCount,0);});
