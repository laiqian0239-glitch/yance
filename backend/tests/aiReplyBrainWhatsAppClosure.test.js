'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const whatsappStyle = require('../services/whatsappReplyStyleAuthority');
const { validateReplyCandidate } = require('../services/replyQualityGuard');
const { buildModelMessages } = require('../services/contextAwareReplyBrain');
const performancePolicy = require('../services/replyPerformancePolicy');

function packet(overrides = {}) {
  return {
    customer: { name: 'Alex', platform: 'whatsapp' },
    relationshipStage: 'warming',
    relationshipPotential: {},
    emotionalTrend: {},
    currentEmotion: {},
    interaction: {},
    preferences: {},
    feedbackLearning: {},
    replyStrategy: { recommendedLength: 'short', maxQuestions: 1 },
    relevantMemories: { confirmedFacts: [], userNotes: [], importantEvents: [], openLoops: [], promises: [], recurringInterests: [] },
    relationshipTimeline: [],
    recentSignals: [],
    recentMessages: [],
    incomingMessage: { text: 'Berlin fehlt mir manchmal.' },
    director: { avoidCandidates: [], mergeCandidates: [], mergeMode: false },
    persona: {
      truthSafePacket: {
        preferredLanguage: 'de',
        presentationProfile: {
          expressionHabits: ['short natural messages', 'at most one question', 'no repeated name', 'no em dash'],
          replyStylePreferences: ['mature warm', 'feminine'],
          forbiddenExpressions: ['generic seductive templates']
        },
        style: { prompt: '保持成熟温柔，不讨好。' }
      }
    },
    performanceMode: 'balanced',
    ...overrides
  };
}

test('qualification and runtime share the same WhatsApp style contract', () => {
  const qualification = whatsappStyle.qualificationPrompt();
  assert.match(qualification, /成熟、独立、事业型/);
  assert.match(qualification, /禁止使用长破折号/);
  const qualificationSource = fs.readFileSync(path.join(__dirname, '../services/modelQualification.js'), 'utf8');
  assert.match(qualificationSource, /whatsappReplyStyleAuthority\.qualificationPrompt\(\)/);
  const system = buildModelMessages(packet())[0].content;
  assert.match(system, /真实 WhatsApp 回复大脑/);
  assert.match(system, /禁止使用长破折号/);
  assert.match(system, /短而自然/);
  assert.match(system, /最多一个问题/);
  assert.match(system, /不要反复称呼对方名字/);
});

test('WhatsApp style guard blocks long dashes, report language and repeated names', () => {
  const dash = validateReplyCandidate('Das klingt schön — vielleicht irgendwann wieder.', packet());
  assert.equal(dash.pass, false);
  assert.ok(dash.issues.some(row => row.code === 'WHATSAPP_LONG_DASH'));

  const report = validateReplyCandidate('Zusammenfassend sollten wir das später erneut besprechen.', packet());
  assert.equal(report.pass, false);
  assert.ok(report.issues.some(row => row.code === 'WHATSAPP_REPORT_STYLE'));

  const repeated = whatsappStyle.validate('Alex, das klingt gut. Alex, erzähl mir später mehr.', packet());
  assert.equal(repeated.pass, false);
  assert.ok(repeated.issues.some(row => row.code === 'WHATSAPP_REPEATED_NAME'));
});

test('normal German WhatsApp reply passes the style guard', () => {
  const result = validateReplyCandidate('Das verstehe ich. Manchmal fehlt einem einfach dieses besondere Gefühl.', packet());
  assert.equal(result.pass, true);
});

test('backend is the candidate-count authority and balanced mode produces selection', () => {
  assert.equal(performancePolicy.policyFor({ performanceMode: 'rapid' }, {}).candidateCount, 3);
  assert.equal(performancePolicy.policyFor({ performanceMode: 'balanced' }, {}).candidateCount, 3);
  assert.equal(performancePolicy.policyFor({ performanceMode: 'deep' }, {}).candidateCount, 5);
});

test('merge prompt requires a fresh AI rewrite rather than concatenation', () => {
  const messages = buildModelMessages(packet({
    director: {
      mergeMode: true,
      mergeCandidates: ['Das klingt schön.', 'Ich verstehe, was du meinst.'],
      avoidCandidates: []
    }
  }));
  assert.match(messages[0].content, /不能简单拼接/);
  assert.match(messages[0].content, /用户选中的候选/);

  const ui = fs.readFileSync(path.join(__dirname, '../../frontend/js/r32-ui-runtime.js'), 'utf8');
  assert.match(ui, /async function mergeSelectedCandidates/);
  assert.match(ui, /mergeCandidates:selected\.map\(row=>row\.de\)/);
  assert.doesNotMatch(ui, /selected\.join\(' '\)/);
  assert.match(ui, /first\.performancePolicy\?\.candidateCount/);
});
