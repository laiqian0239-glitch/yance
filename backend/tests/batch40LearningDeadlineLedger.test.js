'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const service=require('../services/replyFeedbackLearningService');
test('Learning outcome evidence is transaction-bound and has no custom projection scheduler',()=>{const s=service.status();assert.equal(s.customProjectionScheduler,false);assert.equal(s.customRetryQueue,false);assert.equal(s.automaticProfileMutation,false);});
test('do-not-learn blocks durable signal creation before persistence',()=>{const row=service.buildImmutableFeedbackSignal({eventType:'sent',outboxId:'o1',conversationId:'c1',contactId:'p1',learningMode:'do_not_learn'});assert.equal(row.skipped,true);assert.equal(row.reasonCode,'DO_NOT_LEARN');});
test('retired projection job infrastructure is absent',()=>{const root=path.resolve(__dirname,'..','..');for(const rel of ['backend/repositories/replyLearningProjectionRepository.js','backend/services/learningSynthesisScheduler.js'])assert.equal(fs.existsSync(path.join(root,rel)),false);});
