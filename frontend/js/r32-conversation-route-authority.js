(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.YanceConversationRouteAuthority=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function text(value){return value===undefined||value===null?'':String(value).trim()}
  function addAlias(target,value){
    if(Array.isArray(value)){value.forEach(item=>addAlias(target,item));return}
    if(value&&typeof value==='object'){
      ['id','accountId','account_id','sourceAccountId','source_account_id','pageId','page_id','authAccountKey','auth_account_key'].forEach(key=>addAlias(target,value[key]));
      return
    }
    const normalized=text(value);if(normalized)target.add(normalized)
  }
  function accountIdentityAliases(account={}){
    const aliases=new Set();
    [
      account.id,account.accountId,account.account_id,account.canonicalAccountId,account.canonical_account_id,
      account.adapterAccountId,account.adapter_account_id,account.authAccountKey,account.auth_account_key,
      account.externalId,account.external_id,account.sourceAccountId,account.source_account_id,
      account.pageId,account.page_id,account.page,account.user,
      account.metadata?.pageId,account.metadata?.page_id,account.metadata?.authAccountKey,account.metadata?.auth_account_key,
      account.metadata?.accountKey,account.metadata?.account_key,account.metadata?.openClawAccountId,account.metadata?.open_claw_account_id,
      account.metadata?.whatsappAccountId,account.metadata?.whatsapp_account_id,account.metadata?.resolvedAuthAccountKey,account.metadata?.resolved_auth_account_key,
      account.metadata?.livePage,account.metadata?.page,account.metadata?.liveUser,account.metadata?.user,
      account.metadata?.sourceAccountId,account.metadata?.source_account_id,account.metadata?.sourceAccountIds,account.metadata?.source_account_ids,
      account.metadata?.aliases,account.routeAliases,account.route_aliases,account.aliases
    ].forEach(value=>addAlias(aliases,value));
    return [...aliases]
  }
  function lifecycleOf(account={}){return text(account.lifecycleState||account.lifecycle_state||account.state||account.status).toLowerCase()}
  function canAttemptSend(account={}){return account.canAttemptSend===true||(account.canAttemptSend==null&&account.canSend===true)}
  function capabilityBlock(account={}){
    const lifecycle=lifecycleOf(account);
    if(account.authorizationPending===true||account.authorization_pending===true||account.metadata?.authorizationPending===true||account.metadata?.authorization_pending===true||lifecycle==='pending-auth')return 'authorization-pending';
    if(lifecycle==='reauthorize'||lifecycle==='logged-out'||lifecycle==='credential-expired'||lifecycle==='token-expired')return 'reauthorization-required';
    if(lifecycle==='paused')return 'paused';
    if(['merged','tombstoned','migrating','deleted','cancelled'].includes(lifecycle))return 'lifecycle-unavailable';
    if(!canAttemptSend(account))return 'not-sendable';
    return ''
  }
  function explain(result={}){
    const identity={
      'missing-binding':'当前会话缺少发送账号绑定',
      'unresolved-binding':'当前会话绑定的账号标识尚未在账号中心解析',
      'platform-mismatch':'当前会话平台与绑定账号平台不一致'
    }[result.identityConflict];
    if(identity)return identity;
    return {
      'authorization-pending':'账号已绑定，正在等待平台授权完成',
      'reauthorization-required':'账号已绑定，但平台凭据明确要求重新授权',
      'paused':'账号已绑定但当前处于暂停状态',
      'lifecycle-unavailable':'账号已合并、迁移或删除，当前不可发送',
      'not-sendable':'账号已绑定，但真实发送能力尚未通过平台确认'
    }[result.capabilityBlock]||''
  }
  function resolve(accounts=[],contact={},options={}){
    const boundId=text(contact.accountId||contact.account_id||contact.sourceAccountId||contact.source_account_id);
    const platform=text(contact.platform).toLowerCase();
    if(!boundId){const result={account:null,identityConflict:'missing-binding',capabilityBlock:'',sendable:false,reconciledAlias:false};return {...result,reason:explain(result)}}
    const account=(accounts||[]).find(row=>accountIdentityAliases(row).includes(boundId))||null;
    if(!account){const result={account:null,identityConflict:'unresolved-binding',capabilityBlock:'',sendable:false,reconciledAlias:false};return {...result,reason:explain(result)}}
    if(text(account.platform).toLowerCase()!==platform){const result={account,identityConflict:'platform-mismatch',capabilityBlock:'',sendable:false,reconciledAlias:!accountIdentityAliases(account).includes(text(account.id))||text(account.id)!==boundId};return {...result,reason:explain(result)}}
    const block=capabilityBlock(account),result={account,identityConflict:'',capabilityBlock:block,sendable:!block,reconciledAlias:text(account.id)!==boundId};
    return {...result,reason:explain(result)}
  }
  return {accountIdentityAliases,canAttemptSend,capabilityBlock,resolve,explain}
});
