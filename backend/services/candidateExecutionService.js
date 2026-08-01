'use strict';

const aiGateway = require('./aiGateway');
const executionModeAuthority = require('./aiExecutionModeAuthority');
const defaultTraceAuthority = require('./aiExecutionTraceAuthority');
const defaultDurableExecutionAuthority = require('./durableExecutionAuthority');

function clean(value) { return String(value == null ? '' : value).trim(); }

class CandidateExecutionService {
  constructor({
    gateway = aiGateway,
    traceAuthority = defaultTraceAuthority,
    durableExecutionAuthority = defaultDurableExecutionAuthority,
    ownerId = `candidate-execution-service:${process.pid}`
  } = {}) {
    this.gateway = gateway;
    this.traceAuthority = traceAuthority;
    this.durableExecutionAuthority = durableExecutionAuthority;
    this.ownerId = clean(ownerId) || `candidate-execution-service:${process.pid}`;
  }

  beginDurableExecution({ traceId, task }) {
    const durable = this.durableExecutionAuthority.createExecution({
      traceId,
      operationKind: 'ai-candidate-generation',
      idempotencyKey: `${traceId}:${clean(task) || 'unknown-task'}`,
      maxAttempts: 1,
      metadata: { operationKind: 'ai-candidate-generation' }
    });
    if (durable.state === 'CREATED') {
      return this.durableExecutionAuthority.claim({
        executionId: this.durableExecutionAuthority.schedule({
          executionId: durable.executionId,
          expectedGeneration: durable.generation,
          actor: this.ownerId,
          reasonCode: 'CANDIDATE_EXECUTION_SCHEDULED'
        }).executionId,
        expectedGeneration: durable.generation,
        ownerId: this.ownerId,
        reasonCode: 'CANDIDATE_EXECUTION_CLAIMED'
      });
    }
    if (['SCHEDULED', 'RETRY_SCHEDULED'].includes(durable.state)) {
      return this.durableExecutionAuthority.claim({
        executionId: durable.executionId,
        expectedGeneration: durable.generation,
        ownerId: this.ownerId,
        reasonCode: 'CANDIDATE_EXECUTION_CLAIMED'
      });
    }
    throw Object.assign(new Error(`Candidate execution already ${durable.state}`), {
      code: 'CANDIDATE_EXECUTION_ALREADY_EXISTS',
      status: 409,
      executionId: durable.executionId,
      executionState: durable.state,
      traceId
    });
  }

  async execute({ task, messages = [], route = {}, options = {}, routeTestId = '' } = {}) {
    const policy = executionModeAuthority.policyFor(executionModeAuthority.EXECUTION_MODE.CANDIDATE_ONLY);
    const trace = this.traceAuthority.start({
      routeTestId,
      task,
      executionMode: policy.mode,
      requestedMode: route?.requested?.primary?.mode || route?.primarySelection || '',
      requestedPrimary: route?.requested?.primary?.modelId || route?.requestedPrimary || '',
      requestedFallback: route?.requested?.fallback?.modelId || route?.requestedFallback || '',
      resolvedPrimary: route?.resolved?.primary?.modelId || route?.primary || '',
      resolvedFallback: route?.resolved?.fallback?.modelId || route?.fallback || '',
      allowConditional: true,
      humanReviewRequired: true
    });
    const id = trace.routeTestId;
    let durable = null;
    const candidateRoute = {
      ...(route && typeof route === 'object' ? route : {}),
      allowConditional: true,
      humanReviewRequired: true
    };
    this.traceAuthority.record(id, 'route-draft-validated', {
      task,
      executionMode: policy.mode,
      requestedMode: candidateRoute?.requested?.primary?.mode || candidateRoute.primarySelection || '',
      resolvedPrimary: candidateRoute?.resolved?.primary?.modelId || candidateRoute.primary || '',
      resolvedFallback: candidateRoute?.resolved?.fallback?.modelId || candidateRoute.fallback || '',
      allowConditional: true,
      humanReviewRequired: true,
      source: candidateRoute.source || 'candidate-execution-service'
    });
    try {
      durable = this.beginDurableExecution({ traceId: id, task });
      this.traceAuthority.record(id, 'durable-execution-claimed', {
        task,
        executionMode: policy.mode,
        executionId: durable.executionId,
        status: durable.state,
        source: 'DurableExecutionAuthority'
      });
      const result = await this.gateway.execute({
        task,
        messages,
        options: {
          ...(options && typeof options === 'object' ? options : {}),
          executionMode: policy.mode,
          routeTestId: id,
          executionId: durable.executionId,
          routeOverride: candidateRoute
        }
      });
      const projected = {
        ...result,
        routeTestId: id,
        traceId: id,
        executionId: durable.executionId,
        executionMode: policy.mode,
        humanReviewRequired: true,
        deliveryEligible: false,
        learningEligible: false,
        formalReceiptEligible: false
      };
      this.durableExecutionAuthority.succeed({
        executionId: durable.executionId,
        generation: durable.generation,
        ownerId: this.ownerId,
        receiptId: clean(projected.qualityRouteReceipt?.receiptHash || projected.qualityRouteReceipt?.receiptId),
        providerRequestId: clean(projected.providerRequestId || projected.requestId),
        reasonCode: 'CANDIDATE_EXECUTION_SUCCEEDED'
      });
      this.traceAuthority.complete(id, {
        task,
        executionMode: policy.mode,
        executionId: durable.executionId,
        modelId: projected.modelId,
        providerRequestId: projected.providerRequestId || projected.requestId || projected.qualityRouteReceipt?.providerRequestId || '',
        routeState: projected.qualityRouteReceipt?.routeState || '',
        fallbackUsed: projected.fallbackUsed === true,
        workerStarted: true,
        deliveryEligible: false,
        learningEligible: false,
        formalReceiptEligible: false,
        humanReviewRequired: true
      });
      return projected;
    } catch (error) {
      if (durable && ['RUNNING', 'WAITING_REMOTE'].includes(this.durableExecutionAuthority.get(durable.executionId)?.state)) {
        try {
          this.durableExecutionAuthority.fail({
            executionId: durable.executionId,
            generation: durable.generation,
            ownerId: this.ownerId,
            retryable: false,
            reasonCode: clean(error?.code || 'CANDIDATE_EXECUTION_FAILED')
          });
        } catch (durableError) {
          error.durableFailureCode = clean(durableError?.code || durableError?.message);
        }
      }
      this.traceAuthority.fail(id, error, {
        task,
        executionMode: policy.mode,
        executionId: durable?.executionId || '',
        reasonCode: error?.code || 'CANDIDATE_EXECUTION_FAILED',
        routeState: error?.qualityPlan?.state || '',
        resolvedPrimary: candidateRoute?.resolved?.primary?.modelId || candidateRoute.primary || '',
        resolvedFallback: candidateRoute?.resolved?.fallback?.modelId || candidateRoute.fallback || '',
        allowConditional: true,
        humanReviewRequired: true
      });
      error.routeTestId = id;
      error.traceId = id;
      error.executionId = durable?.executionId || clean(error.executionId);
      throw error;
    }
  }
}

const candidateExecutionService = new CandidateExecutionService();
module.exports = candidateExecutionService;
module.exports.CandidateExecutionService = CandidateExecutionService;
