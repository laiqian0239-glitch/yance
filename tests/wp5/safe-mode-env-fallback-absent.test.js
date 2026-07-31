'use strict';
const assert=require('node:assert/strict'); const test=require('node:test'); const { createAuthorityHarness }=require('./helpers');
test('YANCE_SAFE_MODE cannot change fresh authority initialization',async()=>{const old=process.env.YANCE_SAFE_MODE; process.env.YANCE_SAFE_MODE='1'; const h=await createAuthorityHarness(); try{assert.equal(h.store.snapshot().runtime.operatingMode,'normal');}finally{await h.close(); if(old===undefined)delete process.env.YANCE_SAFE_MODE;else process.env.YANCE_SAFE_MODE=old;}});
