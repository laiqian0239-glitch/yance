'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createLearningDataPolicy}=require('../services/learningDataPolicy');
test('per-conversation do-not-learn is fail-closed',async()=>{const policy=createLearningDataPolicy();const result=await policy.minimize({text:'private',doNotLearn:true});assert.deepEqual(result,{allowed:false,reasonCode:'DO_NOT_LEARN',text:''});});
test('raw private text cannot leave the device when Presidio is unavailable',async()=>{const policy=createLearningDataPolicy();const result=await policy.minimize({text:'private'});assert.equal(result.allowed,false);assert.equal(result.reasonCode,'PRESIDIO_UNAVAILABLE');});
test('remote learning telemetry is off by default',()=>{const policy=createLearningDataPolicy();assert.equal(policy.outboundPolicy({endpoint:'https://example.com'}).allowed,false);assert.equal(policy.outboundPolicy({endpoint:'http://127.0.0.1:3000'}).allowed,true);});
