'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Learning P0 runtime is thin OSS composition and delegates live model work to Model Brain V4', () => {
  for (const file of [
    'config/upstreams/v21-learning-growth-brain-p0.json',
    'runtime/learning-growth/python/learning_entrypoint.py',
    'backend/services/learningEvaluationAdapter.js',
    'backend/services/learningPromotionAdapter.js'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);

  const entry = read('runtime/learning-growth/python/learning_entrypoint.py');
  assert.match(entry, /DSPy|dspy/u);
  assert.match(entry, /GEPA|gepa/u);
  assert.match(entry, /APScheduler|apscheduler/u);
  assert.match(entry, /Presidio|presidio/u);
  assert.match(entry, /Model Brain|model.brain|model_brain/iu);
  assert.doesNotMatch(entry, /OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY/u);
});
