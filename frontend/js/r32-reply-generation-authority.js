(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.YanceReplyGenerationAuthority=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  class ReplyGenerationSupersededError extends Error{
    constructor(message='回复生成已被更新的会话上下文取代'){
      super(message);this.name='ReplyGenerationSupersededError';this.code='AI_REPLY_GENERATION_SUPERSEDED';
    }
  }
  function normalize(value){return String(value||'').trim()}
  function createAuthority(){
    const revisions=new Map();
    function currentRevision(contactId){return Number(revisions.get(normalize(contactId))||0)}
    function invalidate(contactId){const id=normalize(contactId);if(!id)return 0;const next=currentRevision(id)+1;revisions.set(id,next);return next}
    function begin(contactId,fingerprint=''){
      const id=normalize(contactId);if(!id)throw new TypeError('contactId is required');
      const revision=invalidate(id);
      return Object.freeze({contactId:id,fingerprint:normalize(fingerprint),revision,startedAt:Date.now()})
    }
    function isCurrent(token,context={}){
      if(!token||!token.contactId)return false;
      const contactId=normalize(context.contactId||token.contactId);
      const fingerprint=normalize(context.fingerprint===undefined?token.fingerprint:context.fingerprint);
      return contactId===token.contactId&&currentRevision(contactId)===token.revision&&(!token.fingerprint||!fingerprint||fingerprint===token.fingerprint);
    }
    function assertCurrent(token,context={}){
      if(!isCurrent(token,context))throw new ReplyGenerationSupersededError(context.message||undefined);
      return true
    }
    return {begin,invalidate,isCurrent,assertCurrent,currentRevision}
  }
  return {createAuthority,ReplyGenerationSupersededError}
});
