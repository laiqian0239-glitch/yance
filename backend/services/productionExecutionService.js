'use strict';

const aiGateway = require('./aiGateway');
const executionModeAuthority = require('./aiExecutionModeAuthority');

class ProductionExecutionService {
  constructor({ gateway = aiGateway } = {}) { this.gateway = gateway; }

  productionPayload(payload = {}) {
    const policy = executionModeAuthority.policyFor(executionModeAuthority.EXECUTION_MODE.PRODUCTION);
    return {
      ...payload,
      options: {
        ...(payload.options && typeof payload.options === 'object' ? payload.options : {}),
        executionMode: policy.mode
      }
    };
  }

  submit(payload = {}) { return this.gateway.submit(this.productionPayload(payload)); }

  async execute(payload = {}) {
    const policy = executionModeAuthority.policyFor(executionModeAuthority.EXECUTION_MODE.PRODUCTION);
    const result = await this.gateway.execute(this.productionPayload(payload));
    return {
      ...result,
      executionMode: policy.mode,
      deliveryEligible: result.deliveryEligible !== false,
      formalReceiptEligible: result.formalReceiptEligible !== false
    };
  }
}

const productionExecutionService = new ProductionExecutionService();
module.exports = productionExecutionService;
module.exports.ProductionExecutionService = ProductionExecutionService;
