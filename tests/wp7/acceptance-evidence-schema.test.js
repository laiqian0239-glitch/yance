'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateEvidenceCommon}=require('../../tools/wp7/lib');
const {expectReason,finalEvidenceDocument}=require('./helpers');

test('acceptance-evidence-schema.test',()=>{
  const d=finalEvidenceDocument();
  assert.equal(validateEvidenceCommon(d,{final:true}).status,'PASS');
  expectReason(assert,()=>validateEvidenceCommon({...d,apiToken:'x'},{final:true}),'WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID');
  const missingTreeHash={...d};delete missingTreeHash.completeProjectSourceTreeSha256;
  expectReason(assert,()=>validateEvidenceCommon(missingTreeHash,{final:true}),'WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID');
  const missingWp4={...d,upstreamBindings:{...d.upstreamBindings}};delete missingWp4.upstreamBindings.WP4;
  expectReason(assert,()=>validateEvidenceCommon(missingWp4,{final:true}),'WP7_ACCEPTANCE_EVIDENCE_SCHEMA_INVALID');
});
