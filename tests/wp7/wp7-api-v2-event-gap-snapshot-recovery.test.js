'use strict';
const test=require('node:test');const {load,assertWindows,assertBoolean}=require('./final-phase-helpers');
test('wp7-api-v2-event-gap-snapshot-recovery.test',()=>{const d=load('evidence/wp7/runtime-ownership.json');assertWindows(d);assertBoolean(d,'eventGapForcedSnapshotRefetch');});
