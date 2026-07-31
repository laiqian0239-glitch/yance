'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {validateAcceptanceMapping}=require('../../tools/wp7/lib');
test('wp7-acceptance-check-mapping.test',()=>{const r=validateAcceptanceMapping();assert.equal(r.status,'PASS');assert.equal(r.count,10);});
