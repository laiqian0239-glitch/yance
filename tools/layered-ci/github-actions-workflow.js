'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CHECKOUT_REFERENCE = /^actions\/checkout@[0-9a-f]{40}$/u;
const CONTROL_OR_GLOB = /[\u0000-\u001f\u007f*?[\]]/u;

function issue(code, workflowPath, line, message, values = []) {
  return Object.freeze({
    code,
    path: workflowPath,
    line,
    message,
    values: Object.freeze([...values])
  });
}

function repositoryPath(value) {
  const candidate = String(value || '');
  if (!candidate
    || candidate !== candidate.trim()
    || candidate.startsWith('/')
    || candidate.startsWith('./')
    || candidate.endsWith('/')
    || candidate.includes('\\')
    || /^[A-Za-z]:\//u.test(candidate)
    || CONTROL_OR_GLOB.test(candidate)) return '';
  const segments = candidate.split('/');
  return segments.some(segment => !segment || segment === '.' || segment === '..') ? '' : candidate;
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function stripInlineComment(value) {
  const index = value.search(/\s+#/u);
  return (index === -1 ? value : value.slice(0, index)).trim();
}

function parseCheckoutUse(line) {
  const direct = /^(\s*)-\s+uses:\s*(.*?)\s*$/u.exec(line);
  if (direct) {
    const reference = stripInlineComment(direct[2]);
    return CHECKOUT_REFERENCE.test(reference)
      ? { reference, stepIndent: direct[1].length, keyIndent: direct[1].length + 2 }
      : null;
  }
  const named = /^(\s*)uses:\s*(.*?)\s*$/u.exec(line);
  if (!named) return null;
  const reference = stripInlineComment(named[2]);
  return CHECKOUT_REFERENCE.test(reference)
    ? { reference, stepIndent: Math.max(0, named[1].length - 2), keyIndent: named[1].length }
    : null;
}

function findStepEnd(lines, startIndex, stepIndent) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = indentation(raw);
    if (indent <= stepIndent && /^-\s+/u.test(trimmed)) return index;
    if (indent < stepIndent && /^[A-Za-z0-9_.-]+:/u.test(trimmed)) return index;
  }
  return lines.length;
}

function inspectCheckoutCredentials(text, options = {}) {
  const workflowPath = repositoryPath(options.workflowPath || '.github/workflows/unknown.yml')
    || '.github/workflows/unknown.yml';
  const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const findings = [];
  const checkoutSteps = [];

  for (let index = 0; index < lines.length; index += 1) {
    const use = parseCheckoutUse(lines[index]);
    if (!use) continue;
    const endIndex = findStepEnd(lines, index, use.stepIndent);
    const values = [];
    let malformed = false;
    let withCount = 0;

    for (let cursor = index + 1; cursor < endIndex; cursor += 1) {
      const raw = lines[cursor];
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = indentation(raw);
      if (indent !== use.keyIndent) continue;
      if (/^with:\s*(?:#.*)?$/u.test(trimmed)) {
        withCount += 1;
        for (let child = cursor + 1; child < endIndex; child += 1) {
          const childRaw = lines[child];
          const childTrimmed = childRaw.trim();
          if (!childTrimmed || childTrimmed.startsWith('#')) continue;
          const childIndent = indentation(childRaw);
          if (childIndent <= use.keyIndent) break;
          if (!/^persist-credentials/u.test(childTrimmed)) continue;
          const exact = /^persist-credentials:\s*(.*?)\s*$/u.exec(childTrimmed);
          if (!exact) {
            malformed = true;
            continue;
          }
          values.push(stripInlineComment(exact[1]));
        }
      } else if (/^with\s*:/u.test(trimmed)) {
        malformed = true;
      }
    }

    let finding = null;
    if (malformed || withCount > 1) {
      finding = issue(
        'CHECKOUT_PERSIST_CREDENTIALS_SYNTAX_INVALID',
        workflowPath,
        index + 1,
        'actions/checkout credential input must use one exact with block and exact persist-credentials key',
        values
      );
    } else if (values.length > 1) {
      finding = issue(
        'CHECKOUT_PERSIST_CREDENTIALS_DUPLICATE',
        workflowPath,
        index + 1,
        'actions/checkout persist-credentials input must occur exactly once',
        values
      );
    } else if (values.length !== 1 || values[0] !== 'false') {
      finding = issue(
        'CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE',
        workflowPath,
        index + 1,
        'actions/checkout must explicitly set persist-credentials: false',
        values
      );
    }
    if (finding) findings.push(finding);
    checkoutSteps.push(Object.freeze({
      path: workflowPath,
      line: index + 1,
      reference: use.reference,
      persistCredentials: finding ? null : false
    }));
  }

  return Object.freeze({
    ok: findings.length === 0,
    findings: Object.freeze(findings),
    checkoutSteps: Object.freeze(checkoutSteps)
  });
}

function inspectRepositoryCheckoutCredentials(root, workflowPaths) {
  const repositoryRoot = path.resolve(String(root || ''));
  const findings = [];
  const checkoutSteps = [];
  if (!Array.isArray(workflowPaths)) {
    findings.push(issue(
      'CHECKOUT_WORKFLOW_PATHS_INVALID',
      '.github/workflows',
      0,
      'workflowPaths must be an array'
    ));
  } else {
    for (const value of workflowPaths) {
      const workflowPath = repositoryPath(value);
      if (!workflowPath) {
        findings.push(issue(
          'CHECKOUT_WORKFLOW_PATH_INVALID',
          String(value || ''),
          0,
          'workflow path must be an exact repository path'
        ));
        continue;
      }
      let text;
      try {
        text = fs.readFileSync(path.join(repositoryRoot, ...workflowPath.split('/')), 'utf8');
      } catch (error) {
        findings.push(issue(
          'CHECKOUT_WORKFLOW_READ_FAILED',
          workflowPath,
          0,
          error.message
        ));
        continue;
      }
      const report = inspectCheckoutCredentials(text, { workflowPath });
      findings.push(...report.findings);
      checkoutSteps.push(...report.checkoutSteps);
    }
  }
  findings.sort((left, right) => (
    left.path.localeCompare(right.path, 'en')
    || left.line - right.line
    || left.code.localeCompare(right.code, 'en')
  ));
  checkoutSteps.sort((left, right) => left.path.localeCompare(right.path, 'en') || left.line - right.line);
  return Object.freeze({
    ok: findings.length === 0,
    findings: Object.freeze(findings),
    checkoutSteps: Object.freeze(checkoutSteps)
  });
}

module.exports = Object.freeze({
  inspectCheckoutCredentials,
  inspectRepositoryCheckoutCredentials,
  repositoryPath
});
