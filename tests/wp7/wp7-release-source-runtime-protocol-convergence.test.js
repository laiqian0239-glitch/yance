'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {verifyRuntimeProtocolConvergence}=require('../../tools/wp7/lib');
test('wp7-release-source-runtime-protocol-convergence.test',()=>{const r=verifyRuntimeProtocolConvergence();assert.equal(r.status,'PASS');assert.equal(r.credentialProtocolVersion,3);});
