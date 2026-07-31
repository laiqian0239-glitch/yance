'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function extractFunction(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} not found`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

test('target contact functions contain no HTML string sinks', () => {
  const source = fs.readFileSync(path.join(root, 'frontend/js/r32-ui-runtime.js'), 'utf8');
  for (const name of ['openMergeDialog', 'renderWorkbench', 'renderIdentityList', 'renderIdentityDetail']) {
    const body = extractFunction(source, name);
    assert.doesNotMatch(body, /innerHTML|insertAdjacentHTML|outerHTML/);
    assert.match(body, /YanceContactSafeRenderers/);
  }
});

test('CSP removes script unsafe-inline and every application script is external', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'backend/server.js'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scripts.length > 0);
  for (const match of scripts) assert.match(match[1], /\bsrc\s*=/i, `inline script remains: ${match[0]}`);
  const directive = server.match(/"script-src [^"]+"/)?.[0] || '';
  assert.equal(directive, '"script-src \'self\'"');
  assert.doesNotMatch(directive, /unsafe-inline/);
  assert.ok(html.indexOf('/js/r32-security.js') < html.indexOf('/js/r32-contact-safe-renderers.js'));
  assert.ok(html.indexOf('/js/r32-contact-safe-renderers.js') < html.indexOf('/js/r32-ui-runtime.js'));
});
