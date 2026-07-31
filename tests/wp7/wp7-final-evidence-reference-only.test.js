'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateEvidenceReferences}=require('../../tools/wp7/lib');
const {expectReason}=require('./helpers');

test('wp7-final-evidence-reference-only.test',()=>{
  assert.equal(validateEvidenceReferences([{path:'evidence/wp7/clean-install.json',sha256:'a'.repeat(64)}],{final:true}).status,'PASS');
  expectReason(assert,()=>validateEvidenceReferences([{path:'evidence/wp4/development.json',sha256:'a'.repeat(64)}],{final:true}),'WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION');
  expectReason(assert,()=>validateEvidenceReferences([{path:'evidence/wp7/clean-install.json'}],{final:true}),'WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION');
  expectReason(assert,()=>validateEvidenceReferences(['evidence/wp7/clean-install.json'],{final:true}),'WP7_FINAL_EVIDENCE_REFERENCE_VIOLATION');
});
