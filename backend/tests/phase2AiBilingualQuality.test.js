'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSocialAnalysisPresentation } = require('../services/socialAnalysisPresentationService');
const terminology = require('../services/translationTerminologyService');
const { translateToChinese } = require('../services/bilingualUnderstandingService');
const learningQuality = require('../services/replyLearningQualityService');
const fs = require('node:fs');
const path = require('node:path');

test('social analysis presentation separates facts, inferences, risks and recommendations with evidence', () => {
  const result = buildSocialAnalysisPresentation({
    profile: {
      facts: { city: 'Berlin' },
      confirmed: [{ id: 'f1', text: 'Works in design', translatedZh: '从事设计工作', evidence: [{ quote: 'Ich arbeite im Design.', translatedZh: '我从事设计工作。', confidence: 0.95 }] }],
      inferences: [{ id: 'i1', text: 'May prefer short replies', translatedZh: '可能偏好简短回复', confidence: 0.62 }]
    },
    insights: {
      risks: [{ id: 'r1', text: 'Do not pressure for a meeting', translatedZh: '不要催促见面', confidence: 0.8 }],
      nextAction: 'Suggest two dates.',
      chineseUnderstanding: { nextAction: '建议两个日期。' }
    }
  });
  assert.equal(result.facts.some(row => row.displayText === '从事设计工作'), true);
  assert.equal(result.facts.some(row => row.title === 'city' && row.sourceText === 'Berlin' && row.displayText === '中文理解待生成' && row.translationPending === true), true);
  assert.equal(result.inferences[0].kind, 'inference');
  assert.equal(result.risks[0].displayText, '不要催促见面');
  assert.equal(result.recommendations.some(row => row.displayText === '建议两个日期。'), true);
  assert.equal(result.truthRules.inferencesAreNotFacts, true);
});

test('workspace trajectory wires the same four-layer authority without loading optional platform dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/workspaceService.js'), 'utf8');
  assert.match(source, /buildSocialAnalysisPresentation/);
  assert.match(source, /const analysisLayers = buildSocialAnalysisPresentation/);
  assert.match(source, /trajectoryFromInsight\(context\.insight[^)]*context\.analysis,\s*context\.relationshipProjection\s*\|\|\s*\{\}\)/s);
});

test('translation terminology protects URLs, numbers and user glossary terms', async () => {
  let prompt = '';
  const result = await translateToChinese({
    text: 'Meet Anna at 18:30 and open https://example.com. Project Aurora costs €120.',
    sourceLanguage: 'en',
    glossary: [{ source: 'Project Aurora', targetZh: 'Project Aurora' }]
  }, {
    aiGateway: {
      execute: async input => {
        prompt = input.messages[1].content;
        const placeholders = [...new Set(prompt.match(/⟦YANCE_TERM_\d+⟧/gu) || [])];
        return { model: 'translategemma:4b', text: `请在18:30与 Anna 见面，并确认 ${placeholders.join(' ')}。` };
      }
    }
  });
  assert.match(prompt, /YANCE_TERM_/);
  assert.match(result.translatedZh, /https:\/\/example\.com/);
  assert.match(result.translatedZh, /Project Aurora/);
  assert.match(result.translatedZh, /€120/);
  assert.equal(result.translationQuality.status, 'pass');
});

test('translation quality blocks missing numbers or links', () => {
  const pack = terminology.maskProtectedTerms('Pay €120 at https://example.com');
  const quality = terminology.assessChineseTranslation({
    sourceText: 'Pay €120 at https://example.com',
    translatedZh: '请付款。',
    mappings: pack.mappings
  });
  assert.equal(quality.status, 'blocking');
  assert.equal(quality.issues.some(row => row.code === 'NUMBER_MISMATCH'), true);
  assert.equal(quality.issues.some(row => row.code === 'URL_MISMATCH'), true);
});

test('learning quality uses real send/reject/edit/language and learning-hit evidence', () => {
  const quality = learningQuality.summarize([
    {
      eventType: 'sent', originalText: 'Danke!', finalText: 'Vielen Dank!', targetLanguage: 'German', modelId: 'qwen3.5:4b',
      generationMetadata: { learningApplication: { applied: [{ key: 'tone', value: 'warm' }] } }
    },
    {
      eventType: 'sent', originalText: 'Gerne.', finalText: 'Gerne.', targetLanguage: 'German', modelId: 'qwen3.5:4b',
      generationMetadata: { learningApplication: { applied: [] } }
    },
    { eventType: 'rejected', rejectionReason: '太长', modelId: 'qwen3.5:4b' }
  ]);
  assert.equal(quality.decisionCount, 3);
  assert.equal(quality.sentCount, 2);
  assert.equal(quality.rejectedCount, 1);
  assert.equal(quality.learningEligibleCount, 2);
  assert.equal(quality.learningHitCount, 1);
  assert.equal(quality.sufficientEvidence, true);
  assert.equal(quality.byModel[0].model, 'qwen3.5:4b');
});
