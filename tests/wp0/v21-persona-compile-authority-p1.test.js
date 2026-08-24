'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createPersonaBrain } = require('../../backend/personaBrain');

const ROOT = path.resolve(__dirname, '..', '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`);
  return source.slice(start, end);
}

test('createPersonaBrain compileContext compatibility facade delegates to effective scoped authority', () => {
  const calls = [];
  const service = {
    compileEffectiveContext(scope, options) {
      calls.push({ scope, options });
      return { authority: 'effective', scope };
    }
  };
  const brain = createPersonaBrain({
    store: {},
    repository: {},
    candidateCoordinator: {},
    validator: {},
    service
  });
  const compileOptions = { baseContext: { trace: 'compat-facade' } };

  const result = brain.compileContext('profile-runtime', compileOptions);

  assert.deepEqual(result, {
    authority: 'effective',
    scope: { profileId: 'profile-runtime' }
  });
  assert.deepEqual(calls, [{
    scope: { profileId: 'profile-runtime' },
    options: compileOptions
  }]);
});

test('HTTP compile-context route delegates profile and scope inputs to effective compiler', () => {
  const source = readSource('backend/routes/personaBrain.js');
  const helper = functionSource(source, 'compilePersonaContext', 'createPersonaBrainRouter');

  assert.match(helper, /brain\.compileEffectiveContext\s*\(/u);
  assert.doesNotMatch(helper, /brain\.compileContext\s*\(/u);
  for (const field of ['profileId', 'contactId', 'conversationId', 'globalScopeId']) {
    assert.match(helper, new RegExp(`\\b${field}\\b`, 'u'), `${field} must be carried into effective scope`);
  }
});

test('contextAwareReplyBrain cannot silently downgrade from effective Persona authority', () => {
  const source = readSource('backend/services/contextAwareReplyBrain.js');

  assert.doesNotMatch(
    source,
    /persona\.compileContext\s*\(\s*['"]owner['"]\s*,/u,
    'runtime reply generation must not fall back to profile-only Persona compilation'
  );
});
