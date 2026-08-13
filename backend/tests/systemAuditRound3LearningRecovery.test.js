'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const service=require('../services/replyFeedbackLearningService');
test('transaction-bound feedback no longer depends on crash-recovery projection jobs',()=>{const status=service.status();assert.equal(status.mode,'transaction-bound-immutable-signal-ledger');assert.equal(status.customRetryQueue,false);});
test('send-only and do-not-learn outcomes remain excluded deterministically',()=>{for(const mode of ['send_only','exception','do_not_learn'])assert.equal(service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:mode,conversationId:'c',contactId:'p',learningMode:mode}).skipped,true);});
