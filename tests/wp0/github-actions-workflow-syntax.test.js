'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const workflowRoot = path.join(repoRoot, '.github', 'workflows');

function listWorkflowFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listWorkflowFiles(absolute));
    else if (/\.ya?ml$/i.test(entry.name)) files.push(absolute);
  }
  return files.sort();
}

function leadingSpaces(line) {
  return line.length - line.trimStart().length;
}

function isQuotedOrBlockScalar(value) {
  return value.startsWith('"') || value.startsWith("'") || /^[>|][+-]?(?:\s+#.*)?$/.test(value);
}

function findUnsafePlainScalarColons(source) {
  const violations = [];
  let blockIndent = null;
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const indent = leadingSpaces(raw);

    if (blockIndent !== null) {
      if (!trimmed || indent > blockIndent) continue;
      blockIndent = null;
    }

    const mapping = raw.match(/^\s*[A-Za-z0-9_.-]+:\s*(.*)$/);
    if (!mapping) continue;
    const value = mapping[1].trim();
    if (!value || value.startsWith('#')) continue;
    if (/^[>|][+-]?(?:\s+#.*)?$/.test(value)) {
      blockIndent = indent;
      continue;
    }
    if (isQuotedOrBlockScalar(value)) continue;

    const commentStart = value.search(/\s+#/);
    const scalar = (commentStart >= 0 ? value.slice(0, commentStart) : value).trimEnd();
    if (scalar.includes(': ')) violations.push({ line: index + 1, value: scalar });
  }
  return violations;
}

test('workflow YAML quotes plain mapping scalars that contain colon-space', () => {
  assert.deepEqual(findUnsafePlainScalarColons('description: Deferred: publish\n'), [
    { line: 1, value: 'Deferred: publish' }
  ]);
  assert.deepEqual(findUnsafePlainScalarColons('description: "Deferred: publish"\n'), []);
});

test('all GitHub workflow files avoid invalid plain scalar colon-space values', () => {
  const violations = [];
  for (const file of listWorkflowFiles(workflowRoot)) {
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const violation of findUnsafePlainScalarColons(fs.readFileSync(file, 'utf8'))) {
      violations.push(`${relative}:${violation.line}: ${violation.value}`);
    }
  }
  assert.deepEqual(violations, []);
});
