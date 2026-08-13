'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const service=require('../services/replyFeedbackLearningService');
test('reply feedback idempotency is bound to the immutable outcome identity',()=>{const a=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o1',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});const b=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o1',contactId:'p',conversationId:'c',personaTruthReceipt:{pass:true}});assert.equal(a.idempotencyKey,b.idempotencyKey);assert.equal(a.signalId,b.signalId);});
