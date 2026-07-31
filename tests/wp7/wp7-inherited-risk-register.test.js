'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const path=require('node:path');const {readJson,validateRiskRegister,REPO_ROOT,RISK_IDS}=require('../../tools/wp7/lib');
test('wp7-inherited-risk-register.test',()=>{const r=validateRiskRegister(readJson(path.join(REPO_ROOT,'governance','risk-acceptance-register.json')));assert.deepEqual(r.ids,RISK_IDS);});
