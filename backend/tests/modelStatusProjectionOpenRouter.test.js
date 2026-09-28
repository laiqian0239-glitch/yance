'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const projection = require('../services/modelStatusProjection');

const runtime = { health: 'healthy', runtimeAvailable: true, complexityRouter: 'ComplexityRouter', strictTagFiltering: true };

test('passed OpenRouter smoke suppresses stale historical error fields', () => {
  const result = projection.project({ models: [], openRouter: {
    connectionState: 'ready', onboardingSmokeStatus: 'passed', logicalModelBrainSmoke: true,
    onboardingSmokeErrorCode: 'OPENROUTER_ONBOARDING_SMOKE_FAILED', onboardingSmokeError: 'old failure'
  } }, { modelBrainRuntime: runtime });
  assert.equal(result.openRouter.connectionState, 'ready');
  assert.equal(result.openRouter.onboardingSmokeStatus, 'passed');
  assert.equal(result.openRouter.onboardingSmokeErrorCode, '');
  assert.equal(result.openRouter.onboardingSmokeError, '');
});

test('failed OpenRouter smoke preserves current diagnostic fields', () => {
  const result = projection.project({ models: [], openRouter: {
    connectionState: 'degraded', onboardingSmokeStatus: 'failed',
    onboardingSmokeErrorCode: 'OPENROUTER_ONBOARDING_SMOKE_FAILED', onboardingSmokeError: 'current failure'
  } }, { modelBrainRuntime: runtime });
  assert.equal(result.openRouter.onboardingSmokeErrorCode, 'OPENROUTER_ONBOARDING_SMOKE_FAILED');
  assert.equal(result.openRouter.onboardingSmokeError, 'current failure');
});
