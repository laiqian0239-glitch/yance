'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runReplyBrainBenchmark, jaccardSimilarity, isSpecialPurpose } = require('../services/replyBrainBenchmark');

const model = { id: 'reply-14b', name: 'ministral-3:14b', provider: 'ollama', qualification: 'verified' };

function passingExecutor(overrides = {}) {
  return async (_model, messages) => {
    const prompt = messages.map(row => String(row.content || '')).join('\n');
    let text;
    if (/targetLanguage（必须为 de）|合法 JSON/u.test(prompt)) {
      text = overrides.director || JSON.stringify({ strategy: '自然承接', reasonZh: '先回应情绪，再保持成熟而清晰的边界。', targetLanguage: 'de', maxQuestions: 1 });
    } else if (/Geburtstag|Firma/u.test(prompt)) {
      text = overrides.boundary || 'Das weiß ich nicht, und ich möchte dir nichts erfinden. Darüber können wir gern ehrlich sprechen.';
    } else if (/The other person says:/u.test(prompt)) {
      text = overrides.english || 'That was thoughtful of you. I am fine, just taking a quiet moment after a long day.';
    } else if (/温暖但克制/u.test(prompt)) {
      text = overrides.alternative || 'Ich verstehe, was du meinst. Mir ist wichtig, dass wir ruhig und ehrlich schauen, was sich für uns beide richtig anfühlt.';
    } else {
      text = overrides.german || 'Ja, Ehrlichkeit ist jetzt wichtig. Lass uns in Ruhe sagen, was wir beide wirklich möchten.';
    }
    return { text, firstTokenMs: 80, totalMs: 850, outputTokens: 36, tokensPerSecond: 42 };
  };
}

test('a natural multilingual WhatsApp model passes the complete reply brain benchmark', async () => {
  const result = await runReplyBrainBenchmark(model, { executor: passingExecutor(), latencyThresholdMs: 5000 });
  assert.equal(result.pass, true);
  assert.equal(result.status, 'REPLY_BRAIN_QUALIFIED');
  assert.equal(result.score, 100);
  assert.deepEqual(result.qualifyingTasks, ['quick_reply', 'deep_reply', 'director', 'persona_rewrite']);
  assert.equal(result.scenarios.every(row => row.pass), true);
});

test('long dashes and report-style replies fail the German WhatsApp scenario', async () => {
  const result = await runReplyBrainBenchmark(model, { executor: passingExecutor({ german: 'Ja, das ist wichtig — zusammenfassend sollten wir unsere Ziele klar definieren.' }), latencyThresholdMs: 5000 });
  const scenario = result.scenarios.find(row => row.id === 'german_whatsapp');
  assert.equal(scenario.pass, false);
  assert.ok(scenario.issues.some(issue => issue.code === 'WHATSAPP_LONG_DASH'));
  assert.equal(result.pass, false);
});

test('wrong-language replies cannot qualify as a German reply brain', async () => {
  const result = await runReplyBrainBenchmark(model, { executor: passingExecutor({ german: 'I think honesty matters and we should talk clearly.' }), latencyThresholdMs: 5000 });
  const scenario = result.scenarios.find(row => row.id === 'german_whatsapp');
  assert.equal(scenario.pass, false);
  assert.ok(scenario.issues.some(issue => issue.code === 'WRONG_LANGUAGE'));
});

test('invented Persona facts and invalid director JSON are blocking failures', async () => {
  const result = await runReplyBrainBenchmark(model, {
    executor: passingExecutor({ boundary: 'Mein Geburtstag ist am 12.05.1987 und meine Firma heißt Berlin Atelier GmbH.', director: '策略：自然承接' }),
    latencyThresholdMs: 5000
  });
  assert.equal(result.pass, false);
  assert.ok(result.scenarios.find(row => row.id === 'persona_boundary').issues.some(issue => issue.code === 'INVENTED_DATE'));
  assert.ok(result.scenarios.find(row => row.id === 'director_schema').issues.some(issue => issue.code === 'INVALID_JSON'));
});

test('nearly identical candidates fail the diversity scenario', async () => {
  const same = 'Ja, Ehrlichkeit ist jetzt wichtig. Lass uns in Ruhe sagen, was wir beide wirklich möchten.';
  const result = await runReplyBrainBenchmark(model, { executor: passingExecutor({ german: same, alternative: same }), latencyThresholdMs: 5000 });
  const scenario = result.scenarios.find(row => row.id === 'german_alternative');
  assert.equal(scenario.pass, false);
  assert.ok(scenario.issues.some(issue => issue.code === 'CANDIDATE_TOO_SIMILAR'));
  assert.equal(jaccardSimilarity(same, same), 1);
});

test('translation, coder and embedding models are rejected without invoking chat scenarios', async () => {
  let calls = 0;
  const executor = async () => { calls += 1; return { text: 'should not run' }; };
  for (const name of ['translategemma:4b', 'deepseek-coder:6.7b', 'nomic-embed-text']) {
    const result = await runReplyBrainBenchmark({ id: name, name, provider: 'ollama' }, { executor });
    assert.equal(result.pass, false);
    assert.equal(result.status, 'REPLY_BRAIN_NOT_APPLICABLE');
    assert.equal(isSpecialPurpose({ name }), true);
  }
  assert.equal(calls, 0);
});
