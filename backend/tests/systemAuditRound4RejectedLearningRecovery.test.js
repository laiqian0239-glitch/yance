'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const service=require('../services/replyFeedbackLearningService');
test('rejection evidence is idempotent and contains no rejection text',()=>{const row=service.buildImmutableFeedbackSignal({eventType:'rejected',candidateId:'c1',contactId:'p',conversationId:'v',hasExplicitRejectionReason:true,personaTruthReceipt:{pass:true}});assert.equal(row.signal.negativeEvidence,true);assert.equal(JSON.stringify(row.signal).includes('rejectionReason'),false);});
