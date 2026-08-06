'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const TOOL_PATH = path.join(ROOT, 'tools', 'layered-ci', 'github-actions-workflow.js');
const CHECKOUT_REF = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/layered-ci-task.yml',
  '.github/workflows/reviewed-candidate-a6.yml'
]);

function indentation(line) {
  return line.length - line.trimStart().length;
}

function inspectBaselineCheckoutCredentials(text, workflowPath) {
  const findings = [];
  const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s+)?uses:\s*actions\/checkout@[0-9a-f]{40}\s*(?:#.*)?$/u.exec(lines[index]);
    if (!match) continue;
    const usesIndent = match[1].length;
    let withIndent = null;
    const values = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const raw = lines[cursor];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = indentation(raw);
      if (indent <= usesIndent && /^-\s+/u.test(trimmed)) break;
      if (/^with:\s*(?:#.*)?$/u.test(trimmed)) {
        withIndent = indent;
        continue;
      }
      if (withIndent !== null && indent > withIndent) {
        const exact = /^persist-credentials:\s*([^#\s]+)\s*(?:#.*)?$/u.exec(trimmed);
        if (exact) values.push(exact[1]);
        else if (/^persist-credentials\s*:/u.test(trimmed)) values.push('__INVALID_SYNTAX__');
      }
    }
    if (values.length !== 1 || values[0].toLowerCase() !== 'false') {
      findings.push({
        path: workflowPath,
        line: index + 1,
        values
      });
    }
  }
  return findings;
}

test('authorized baseline has no checkout step retaining repository credentials', () => {
  const findings = WORKFLOW_PATHS.flatMap(workflowPath => inspectBaselineCheckoutCredentials(
    fs.readFileSync(path.join(ROOT, ...workflowPath.split('/')), 'utf8'),
    workflowPath
  ));
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('shared workflow parser fails closed for missing, enabled, expression, duplicate and malformed inputs', () => {
  assert.equal(
    fs.existsSync(TOOL_PATH),
    true,
    'shared GitHub Actions workflow parser must exist before this contract can pass'
  );
  delete require.cache[require.resolve(TOOL_PATH)];
  const {
    inspectCheckoutCredentials,
    inspectRepositoryCheckoutCredentials
  } = require(TOOL_PATH);

  const disabled = inspectCheckoutCredentials(`steps:\n  - name: Checkout\n    uses: ${CHECKOUT_REF}\n    with:\n      persist-credentials: false\n`, {
    workflowPath: '.github/workflows/disabled.yml'
  });
  assert.deepEqual(disabled.findings, []);

  for (const [name, yaml, code] of [
    ['missing', `steps:\n  - uses: ${CHECKOUT_REF}\n`, 'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE'],
    ['enabled', `steps:\n  - uses: ${CHECKOUT_REF}\n    with:\n      persist-credentials: true\n`, 'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE'],
    ['expression', `steps:\n  - uses: ${CHECKOUT_REF}\n    with:\n      persist-credentials: \${{ github.event.repository.private }}\n`, 'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE'],
    ['duplicate', `steps:\n  - uses: ${CHECKOUT_REF}\n    with:\n      persist-credentials: false\n      persist-credentials: false\n`, 'CHECKOUT_PERSIST_CREDENTIALS_DUPLICATE'],
    ['malformed', `steps:\n  - uses: ${CHECKOUT_REF}\n    with:\n      persist-credentials : false\n`, 'CHECKOUT_PERSIST_CREDENTIALS_SYNTAX_INVALID']
  ]) {
    const report = inspectCheckoutCredentials(yaml, {
      workflowPath: `.github/workflows/${name}.yml`
    });
    assert.equal(report.findings.length, 1, name);
    assert.equal(report.findings[0].code, code, name);
  }

  assert.deepEqual(
    inspectRepositoryCheckoutCredentials(ROOT, WORKFLOW_PATHS).findings,
    []
  );
});
