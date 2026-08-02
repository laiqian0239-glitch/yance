(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.YanceCredentialMutationReceipt=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clean(value){return String(value==null?'':value).trim()}
  function normalize(result={}){
    const source=result&&typeof result==='object'?result:{};
    const mutationCommitted=source.mutationCommitted===true||source.mutation?.transactionState==='COMMITTED';
    const runtimeConfirmed=source.runtimeConfirmed===true;
    const requestId=clean(source.requestId||source.mutation?.requestId);
    const reasonCode=clean(source.reasonCode||source.code||source.error);
    const message=clean(source.message);
    return {
      ok:source.ok===true&&mutationCommitted&&runtimeConfirmed,
      mutationCommitted,
      runtimeConfirmed,
      requestId,
      reasonCode,
      message,
      raw:source
    };
  }

  function assertSaved(result){
    const receipt=normalize(result);
    if(receipt.ok)return receipt;
    const committed=receipt.mutationCommitted===true;
    const defaultMessage=committed
      ?'API Key 已写入 Windows 安全存储，但 AI 运行时尚未确认应用该凭据。'
      :'API Key 未写入 Windows 安全存储。';
    const detail=receipt.message&&receipt.message!==defaultMessage?` 原因：${receipt.message}`:'';
    const error=new Error(`${defaultMessage}${detail}`);
    error.code=receipt.reasonCode||(committed?'CREDENTIAL_RUNTIME_CONFIRMATION_FAILED':'CREDENTIAL_SAVE_NOT_CONFIRMED');
    error.reasonCode=error.code;
    error.mutationCommitted=committed;
    error.runtimeConfirmed=receipt.runtimeConfirmed;
    error.requestId=receipt.requestId;
    error.receipt=receipt;
    throw error;
  }

  return {normalize,assertSaved};
});
