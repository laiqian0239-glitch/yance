'use strict';

const core = require('./externalActionOutboxAuthorityCore');

const WP_B_INTENT_IDEMPOTENCY_CONFLICT = 'WP_B_INTENT_IDEMPOTENCY_CONFLICT';
const LATE_RESULT = core.RECEIPT_TYPES.LATE_RESULT;
const externalActionOutboxAuthority = new core.ExternalActionOutboxAuthority();

function intentContentSha256(input = {}) {
  return core.normalizeIntentCommand(input).intentContentSha256;
}

function recordLateResult(input = {}) {
  return externalActionOutboxAuthority.recordLateResult(input);
}

module.exports = externalActionOutboxAuthority;
for (const [name, value] of Object.entries(core)) {
  Object.defineProperty(module.exports, name, {
    value,
    enumerable: true,
    writable: false,
    configurable: false
  });
}
Object.defineProperties(module.exports, {
  intentContentSha256: {
    value: intentContentSha256,
    enumerable: true,
    writable: false,
    configurable: false
  },
  recordLateResult: {
    value: recordLateResult,
    enumerable: true,
    writable: false,
    configurable: false
  },
  WP_B_INTENT_IDEMPOTENCY_CONFLICT: {
    value: WP_B_INTENT_IDEMPOTENCY_CONFLICT,
    enumerable: true,
    writable: false,
    configurable: false
  },
  LATE_RESULT: {
    value: LATE_RESULT,
    enumerable: true,
    writable: false,
    configurable: false
  }
});
Object.freeze(module.exports);
