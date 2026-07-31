'use strict';

const operationalProjector = require('./domainOperationalProjector');

const AUTHORITY = 'OperationalProjectionReceiptAuthority';
const PROJECTOR_NAME = 'operational-projection';
const PROJECTOR_VERSION = 'round13-v2';
function clean(value){return String(value==null?'':value).trim();}
function verifyAndRecord(input={}){
  const eventLog=input.eventLog;
  const repository=input.repository||eventLog?.repository;
  const store=input.store||repository?.store?.();
  const eventId=clean(input.eventId||input.created?.event?.eventId||input.created?.event?.event_id);
  if(!eventLog||!repository||!store||!eventId)return null;
  const event=repository.getDomainEvent(eventId);
  if(!event)return null;
  const expected=operationalProjector.projection({...event,payload:event.payload||{}});
  const actual=operationalProjector.actualFor({...event,payload:event.payload||{}},store,{accountStateProvider:input.accountStateProvider});
  const targetRefs=Array.isArray(input.targetRefs)?input.targetRefs:[];
  if(actual==null){
    return eventLog.recordProjectionFailure({eventId,projectorName:PROJECTOR_NAME,projectorVersion:PROJECTOR_VERSION,failureCode:'DOMAIN_OPERATIONAL_TARGET_MISSING',failureReason:`eventType=${clean(event.event_type)}`,targetRefs});
  }
  if(!operationalProjector.isVerified(actual)){
    return eventLog.recordShadowProjection({eventId,projectorName:PROJECTOR_NAME,projectorVersion:PROJECTOR_VERSION,expectedProjection:expected,actualProjection:actual,targetRefs});
  }
  return eventLog.recordAppliedProjection({eventId,projectorName:PROJECTOR_NAME,projectorVersion:PROJECTOR_VERSION,projection:actual,targetRefs});
}
module.exports={AUTHORITY,PROJECTOR_NAME,PROJECTOR_VERSION,verifyAndRecord};
