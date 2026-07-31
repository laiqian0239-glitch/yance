'use strict';

class CoreError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = 'CoreError';
    this.code = code || 'CORE_ERROR';
    this.status = Number(options.status || 500);
    this.details = options.details || null;
    this.cause = options.cause;
  }
}

function normalizeCoreError(error, fallback = 'CORE_OPERATION_FAILED') {
  if (error instanceof CoreError) return error;
  const normalized = new CoreError(error?.code || fallback, error?.message || String(error || fallback), {
    status: error?.status || 500,
    details: error?.details || null,
    cause: error
  });
  return normalized;
}

module.exports = { CoreError, normalizeCoreError };
