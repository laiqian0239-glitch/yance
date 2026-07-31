'use strict';

const defaultDomainProjection = require('./domainEventProjectionAuthority').singleton;
const defaultLearningScheduler = require('./learningSynthesisScheduler').singleton;
const defaultOperationalBridge = require('./domainOperationalEventBridge').singleton;
const { singleton: defaultRepository } = require('../repositories/platformCoreRepository');
const defaultRuntimeEvidence = require('./architectureRuntimeEvidenceService');

const AUTHORITY = 'ArchitectureRuntimeHealthAuthority';
function clean(value){return String(value==null?'':value).trim();}
function safe(fn,fallback){try{return fn();}catch(error){return {...fallback,available:false,reasonCode:clean(error.code)||'ARCHITECTURE_RUNTIME_STATUS_FAILED',message:clean(error.message)};}}
function snapshot(options={}){
  const domainProjection=options.domainProjection||defaultDomainProjection;
  const learningScheduler=options.learningScheduler||defaultLearningScheduler;
  const repository=options.repository||defaultRepository;
  const operationalBridge=options.operationalBridge||defaultOperationalBridge;
  const runtimeEvidence=options.runtimeEvidence||defaultRuntimeEvidence;
  const projection=safe(()=>domainProjection.snapshot(),{authority:'DomainEventProjectionAuthority',state:'unavailable',convergence:{blocking:1,converged:false}});
  const convergence=projection.convergence||safe(()=>domainProjection.convergence(),{blocking:1,converged:false});
  const learning=safe(()=>learningScheduler.snapshot(),{authority:'LearningSynthesisScheduler',started:false,running:false,pending:false,lastRun:null});
  const lastLearning=learning.lastRun||null;
  const eventBridge=safe(()=>operationalBridge.snapshot(),{authority:'DomainOperationalEventBridge',started:false,captured:0,failed:1});
  const runtimeIntegrity=safe(()=>runtimeEvidence.integrityStatus(),{authority:'ArchitectureRuntimeEvidenceAuthority',checkedActiveQueue:0,commandFailures:1,routeFailures:0,releaseBlocking:1,complete:false});
  const projectionBlocking=Number(convergence.blocking||0);
  const projectionAudited=projection.state!=='not-audited'&&Boolean(projection.completedAt||projection.scanned!=null);
  const projectionFailed=projection.available===false||Boolean(projection.code&&projection.converged===false);
  const learningFailed=Boolean(lastLearning&&lastLearning.ok===false);
  const learningUnavailable=learning.available===false;
  const learningStopped=learning.started===false&&learningScheduler?.snapshot!=null;
  const reasons=[];
  if(!projectionAudited)reasons.push({code:'DOMAIN_EVENT_PROJECTION_NOT_AUDITED',domain:'projection',severity:'blocked'});
  if(projectionFailed)reasons.push({code:'DOMAIN_EVENT_PROJECTION_AUDIT_FAILED',domain:'projection',severity:'blocked',reasonCode:clean(projection.code||projection.reasonCode)});
  if(projectionBlocking>0)reasons.push({code:'DOMAIN_EVENT_PROJECTION_BLOCKING',domain:'projection',severity:'blocked',count:projectionBlocking});
  if(learningUnavailable)reasons.push({code:'LEARNING_SYNTHESIS_STATUS_UNAVAILABLE',domain:'learning',severity:'degraded'});
  if(learningStopped)reasons.push({code:'LEARNING_SYNTHESIS_SCHEDULER_STOPPED',domain:'learning',severity:'degraded'});
  if(learningFailed)reasons.push({code:'LEARNING_SYNTHESIS_LAST_RUN_FAILED',domain:'learning',severity:'degraded',errors:(lastLearning.errors||[]).length});
  const eventBridgeFailed=eventBridge.available===false||Number(eventBridge.failed||0)>0;
  if(eventBridgeFailed)reasons.push({code:'DOMAIN_OPERATIONAL_EVENT_CAPTURE_FAILED',domain:'event-bridge',severity:'blocked',count:Number(eventBridge.failed||0),reasonCode:clean(eventBridge.reasonCode)});
  if(runtimeIntegrity.complete!==true)reasons.push({code:'ARCHITECTURE_RUNTIME_EVIDENCE_INCOMPLETE',domain:'runtime-evidence',severity:'blocked'});
  if(Number(runtimeIntegrity.releaseBlocking||0)>0)reasons.push({code:'OUTBOX_OR_AI_ROUTE_RECEIPT_INVALID',domain:'runtime-evidence',severity:'blocked',count:Number(runtimeIntegrity.releaseBlocking||0)});
  let identityPending=0;
  try{identityPending=repository.listIdentityAudits({limit:1000}).filter(row=>clean(row.operation)==='merge'&&!repository.listIdentityOperationReceipts({auditId:row.audit_id,status:'rolled-back',limit:1}).length).length;}catch(_){}
  const releaseBlocked=reasons.some(row=>row.severity==='blocked');
  return{
    authority:AUTHORITY,schemaVersion:2,generatedAt:new Date().toISOString(),
    state:releaseBlocked?'blocked':reasons.length?'degraded':'healthy',releaseBlocked,degraded:reasons.length>0,
    projection:{audited:projectionAudited,blocking:projectionBlocking,converged:Boolean(convergence.converged),snapshot:projection},
    eventBridge:{started:Boolean(eventBridge.started),captured:Number(eventBridge.captured||0),failed:Number(eventBridge.failed||0),healthy:!eventBridgeFailed,snapshot:eventBridge},
    runtimeEvidence:{checkedActiveQueue:Number(runtimeIntegrity.checkedActiveQueue||0),commandFailures:Number(runtimeIntegrity.commandFailures||0),routeFailures:Number(runtimeIntegrity.routeFailures||0),releaseBlocking:Number(runtimeIntegrity.releaseBlocking||0),complete:runtimeIntegrity.complete===true},
    learning:{started:Boolean(learning.started),running:Boolean(learning.running),pending:Boolean(learning.pending),lastRun:lastLearning,healthy:!learningUnavailable&&!learningFailed&&!learningStopped},
    identity:{activeMergeAudits:identityPending},reasons,
    policy:{messageTransportMayContinue:true,aiMemoryPromotionAllowed:!releaseBlocked,releasePromotionAllowed:!releaseBlocked}
  };
}
function assertReleaseReady(options={}){const status=snapshot(options);if(status.releaseBlocked){const error=Object.assign(new Error('架构运行治理存在阻断项，禁止晋升发布。'),{code:'ARCHITECTURE_RUNTIME_RELEASE_BLOCKED',status:409,architectureHealth:status});throw error;}return status;}
module.exports={AUTHORITY,snapshot,assertReleaseReady};
