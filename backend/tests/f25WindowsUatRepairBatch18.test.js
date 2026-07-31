'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const routeAuthority=require('../../frontend/js/r32-conversation-route-authority.js');
const generationAuthority=require('../../frontend/js/r32-reply-generation-authority.js');

test('connected WhatsApp source_account_id alias resolves as the bound production account',()=>{
  const account={id:'wa-live',platform:'whatsapp',state:'connected',canSend:true,metadata:{source_account_id:'legacy-wa-source'}};
  const result=routeAuthority.resolve([account],{id:'conv-1',platform:'whatsapp',accountId:'legacy-wa-source'});
  assert.equal(result.account.id,'wa-live');
  assert.equal(result.identityConflict,'');
  assert.equal(result.capabilityBlock,'');
  assert.equal(result.sendable,true);
});

test('connected account without confirmed send capability is not mislabeled as a source conflict or reauthentication',()=>{
  const account={id:'fb-page',platform:'facebook',state:'connected',canSend:false};
  const result=routeAuthority.resolve([account],{id:'conv-fb',platform:'facebook',accountId:'fb-page'});
  assert.equal(result.identityConflict,'');
  assert.equal(result.capabilityBlock,'not-sendable');
  assert.equal(result.sendable,false);
  assert.match(result.reason,/真实发送能力|平台确认/);
  assert.doesNotMatch(result.reason,/来源冲突|重新授权/);
});

test('reauthorization is only shown for an explicit platform credential state',()=>{
  const account={id:'fb-page',platform:'facebook',state:'reauthorize',canSend:false};
  const result=routeAuthority.resolve([account],{id:'conv-fb',platform:'facebook',accountId:'fb-page'});
  assert.equal(result.identityConflict,'');
  assert.equal(result.capabilityBlock,'reauthorization-required');
  assert.match(result.reason,/重新授权/);
});

test('platform mismatch remains a hard identity conflict',()=>{
  const account={id:'wa-live',platform:'whatsapp',state:'connected',canSend:true};
  const result=routeAuthority.resolve([account],{id:'conv-fb',platform:'facebook',accountId:'wa-live'});
  assert.equal(result.identityConflict,'platform-mismatch');
  assert.equal(result.sendable,false);
});

test('an older candidate generation token becomes unusable after a new inbound message',async()=>{
  const authority=generationAuthority.createAuthority();
  const oldToken=authority.begin('conv-1','conv-1:msg-1');
  let release;
  const backendCall=new Promise(resolve=>{release=resolve});
  const oldCommit=(async()=>{
    await backendCall;
    authority.assertCurrent(oldToken,{contactId:'conv-1',fingerprint:'conv-1:msg-1'});
    return ['old candidate'];
  })();
  authority.invalidate('conv-1');
  const newToken=authority.begin('conv-1','conv-1:msg-2');
  release();
  await assert.rejects(oldCommit,error=>error?.code==='AI_REPLY_GENERATION_SUPERSEDED');
  assert.equal(authority.assertCurrent(newToken,{contactId:'conv-1',fingerprint:'conv-1:msg-2'}),true);
});

test('a token cannot be reused with a different latest-message fingerprint',()=>{
  const authority=generationAuthority.createAuthority();
  const token=authority.begin('conv-1','conv-1:msg-1');
  assert.throws(()=>authority.assertCurrent(token,{contactId:'conv-1',fingerprint:'conv-1:msg-2'}),error=>error?.code==='AI_REPLY_GENERATION_SUPERSEDED');
});
