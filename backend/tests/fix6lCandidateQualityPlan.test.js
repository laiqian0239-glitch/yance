'use strict';

// V21 Model Brain / LiteLLM retired the Yance-owned physical quality route planner
// (authority.routePlan / ROUTE_STATE): candidate-vs-production gating is owned by the
// execution mode and Model Brain hard qualification, while physical routing is LiteLLM.
// The surviving contract here is evidence isolation: a candidate-only historical receipt
// can never be promoted into delivery learning or formal qualification evidence, and the
// retired physical routeReceipt entry point stays fail-closed.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const authority = require('../services/aiQualityRouteAuthority');

process.env.YANCE_AI_ROUTE_RECEIPT_SECRET = 'test-only-route-receipt-secret-0123456789abcdef';

function signedCandidateReceipt() {
  const payload = {
    authority: 'AIQualityRouteAuthority',
    schemaVersion: 2,
    task: 'quick_reply',
    selectedModelId: 'cloud-d9e82540c0683a44f8',
    qualityTier: 'high',
    executionMode: 'candidate-only',
    deliveryEligible: false,
    formalReceiptEligible: false,
    learningEligible: false,
    humanReviewRequired: true
  };
  const receiptHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const receiptSignature = crypto
    .createHmac('sha256', Buffer.from(process.env.YANCE_AI_ROUTE_RECEIPT_SECRET))
    .update(receiptHash)
    .digest('base64url');
  return { ...payload, receiptHash, receiptSignature };
}

test('candidate-only historical receipt cannot become formal qualification evidence by default', () => {
  const receipt = signedCandidateReceipt();
  assert.throws(
    () => authority.verifyRouteReceipt(receipt, { task: 'quick_reply' }),
    error => error.code === 'AI_QUALITY_ROUTE_RECEIPT_FORMAL_INELIGIBLE'
  );
});

test('waiving formal eligibility still blocks a candidate receipt from delivery learning', () => {
  const receipt = signedCandidateReceipt();
  assert.throws(
    () => authority.verifyRouteReceipt(receipt, { task: 'quick_reply', requireFormalReceiptEligible: false }),
    error => error.code === 'AI_QUALITY_ROUTE_RECEIPT_LEARNING_INELIGIBLE'
  );
});

test('candidate receipt stays readable as history but remains learning/formal ineligible', () => {
  const receipt = signedCandidateReceipt();
  const verified = authority.verifyRouteReceipt(receipt, {
    task: 'quick_reply',
    requireFormalReceiptEligible: false,
    requireLearningEligible: false
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.historical, true);
  assert.equal(verified.learningEligible, false);
  assert.equal(verified.qualityTier, 'high');
});

test('retired physical routeReceipt planner remains a fail-closed LiteLLM boundary', () => {
  assert.throws(
    () => authority.routeReceipt({ task: 'quick_reply' }),
    error => error.code === 'MODEL_ROUTING_MANAGED_BY_LITELLM'
  );
});
