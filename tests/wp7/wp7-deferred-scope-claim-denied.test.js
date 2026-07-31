'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {validateDeferredScope}=require('../../tools/wp7/lib');const {expectReason}=require('./helpers');
test('wp7-deferred-scope-claim-denied.test',()=>expectReason(assert,()=>validateDeferredScope({distributionMode:'LOCAL_PRIVATE_UNSIGNED',automaticUpdateAccepted:true}),'WP7_DEFERRED_SCOPE_CLAIMED'));
