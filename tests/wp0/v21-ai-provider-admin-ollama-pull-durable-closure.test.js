'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, ...relativePath.split('/')), 'utf8');
}

test('Ollama pull provider administration is owned by AiGateway durable authority, not the model route', () => {
  const source = readText('backend/routes/models.js');
  assert.doesNotMatch(source, /require\(['"]\.\.\/services\/(?:ollamaClient|openAiCompatibleClient)['"]\)/u);
  assert.doesNotMatch(source, /ollamaClient\.pullModel/u);
  assert.match(source, /aiGateway\.pullLocalModel/u);
});
