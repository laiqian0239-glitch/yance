'use strict';

class AppRuntimeError extends Error {
  constructor(reasonCode, message, options = {}) {
    super(message || reasonCode);
    this.name = 'AppRuntimeError';
    this.reasonCode = reasonCode || 'APP_RUNTIME_ERROR';
    this.code = this.reasonCode;
    this.status = Number(options.status || 500);
    this.details = options.details || null;
    this.failedPhase = options.failedPhase || null;
  }
}

function normalizeRuntimeError(error, fallback = 'APP_RUNTIME_OPERATION_FAILED') {
  if (error instanceof AppRuntimeError) return error;
  return new AppRuntimeError(error?.reasonCode || error?.code || fallback, error?.message || String(error || fallback), {
    status: error?.status || 500,
    details: error?.details || null,
    failedPhase: error?.failedPhase || null
  });
}

module.exports = { AppRuntimeError, normalizeRuntimeError };
