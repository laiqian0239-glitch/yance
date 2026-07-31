'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {validateDeferredScope}=require('../../tools/wp7/lib');
test('wp7-unsigned-policy-truthfulness.test',()=>assert.equal(validateDeferredScope({distributionMode:'LOCAL_PRIVATE_UNSIGNED',authenticodeAccepted:false}).status,'PASS'));
