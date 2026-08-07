'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FULL_SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const EXACT_RELEASE_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const YAML_FILE = /\.ya?ml$/iu;
const LOCAL_ACTION_MANIFESTS = Object.freeze(['action.yml', 'action.yaml']);

function issue(code, issuePath, message, line) {
  const value = { code, path: issuePath, message };
  if (Number.isInteger(line)) value.line = line;
  return value;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeRepositoryPath(value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value) || value !== value.trim()) return false;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || /[\r\n\0-\x1f\x7f]/u.test(normalized)) return false;
  const segments = normalized.split('/');
  return !segments.includes('') && !segments.includes('.') && !segments.includes('..');
}

function isStrictDescendant(root, target) {
  const relative = path.relative(root, target);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function validateLock(lock) {
  const errors = [];
  if (!isObject(lock)) return [issue('ACTION_LOCK_INVALID', 'third_party/github-actions-lock.json', 'must contain a JSON object')];
  if (lock.schemaVersion !== 1) errors.push(issue('ACTION_LOCK_SCHEMA_UNSUPPORTED', 'schemaVersion', 'must equal 1'));
  if (lock.documentType !== 'YANCE_GITHUB_ACTIONS_LOCK') {
    errors.push(issue('ACTION_LOCK_DOCUMENT_TYPE_INVALID', 'documentType', 'must equal YANCE_GITHUB_ACTIONS_LOCK'));
  }
  if (!Array.isArray(lock.actions) || lock.actions.length === 0) {
    errors.push(issue('ACTION_LOCK_ENTRIES_INVALID', 'actions', 'must be a non-empty array'));
    return errors;
  }
  const seen = new Set();
  lock.actions.forEach((entry, index) => {
    const base = `actions[${index}]`;
    if (!isObject(entry)) {
      errors.push(issue('ACTION_LOCK_ENTRY_INVALID', base, 'must be an object'));
      return;
    }
    if (!isNonEmptyString(entry.repository) || !REPOSITORY.test(entry.repository)) {
      errors.push(issue('ACTION_REPOSITORY_INVALID', `${base}.repository`, 'must be owner/repository'));
    }
    if (!isNonEmptyString(entry.commit) || !FULL_SHA.test(entry.commit)) {
      errors.push(issue('ACTION_COMMIT_INVALID', `${base}.commit`, 'must be a lowercase 40-character commit'));
    }
    if (isNonEmptyString(entry.repository) && isNonEmptyString(entry.commit)) {
      const identity = `${entry.repository}@${entry.commit}`;
      if (seen.has(identity)) errors.push(issue('ACTION_LOCK_DUPLICATE', base, `duplicate action identity ${identity}`));
      seen.add(identity);
    }
    if (!isNonEmptyString(entry.reviewedTag)) {
      errors.push(issue('ACTION_REVIEWED_TAG_REQUIRED', `${base}.reviewedTag`, 'must be a non-empty string'));
    } else if (!EXACT_RELEASE_TAG.test(entry.reviewedTag)) {
      errors.push(issue('ACTION_REVIEWED_TAG_NOT_EXACT', `${base}.reviewedTag`, 'must be an exact vMAJOR.MINOR.PATCH release tag'));
    }
    if (!isNonEmptyString(entry.license)) errors.push(issue('ACTION_LICENSE_REQUIRED', `${base}.license`, 'must be a non-empty SPDX identifier'));
    if (!isSafeRepositoryPath(entry.licenseEvidence) || !entry.licenseEvidence.startsWith('third_party/licenses/')) {
      errors.push(issue('LICENSE_PATH_INVALID', `${base}.licenseEvidence`, 'must be a safe path under third_party/licenses/'));
    }
    if (entry.upstreamRepository !== undefined) {
      const expected = `https://github.com/${entry.repository}`;
      if (entry.upstreamRepository !== expected) {
        errors.push(issue('ACTION_UPSTREAM_REPOSITORY_INVALID', `${base}.upstreamRepository`, `must equal ${expected}`));
      }
    }
  });
  return errors;
}

function parseUsesLine(line) {
  const exact = /^(\s*)(?:(-\s+))?uses:\s*(.*?)\s*$/u.exec(line);
  if (exact) return { indent: exact[1].length, listItem: Boolean(exact[2]), value: exact[3] };
  const trimmed = line.trimStart();
  const flowCandidate = trimmed.replace(/^-\s+/u, '');
  const unsupportedUsesKey = /(?:^|[{,])\s*(?:uses|["']uses["'])\s*:/u;
  if (
    /^(?:-\s+)?uses\s*:/u.test(trimmed)
    || unsupportedUsesKey.test(flowCandidate)
  ) return { invalid: true };
  return null;
}

function stripInlineComment(value) {
  const commentIndex = value.search(/\s+#/u);
  return (commentIndex === -1 ? value : value.slice(0, commentIndex)).trim();
}

function yamlIndent(line) {
  return line.length - line.trimStart().length;
}

function checkoutStepBounds(lines, usesIndex, parsed) {
  let stepStart = usesIndex;
  let stepIndent = parsed.indent;
  let propertyIndent = parsed.listItem ? null : parsed.indent;

  if (!parsed.listItem) {
    for (let index = usesIndex - 1; index >= 0; index -= 1) {
      const raw = lines[index];
      if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
      const indent = yamlIndent(raw);
      const trimmed = raw.trim();
      if (indent >= parsed.indent) continue;
      if (/^-\s+/u.test(trimmed)) {
        stepStart = index;
        stepIndent = indent;
      }
      break;
    }
  }

  let stepEnd = lines.length;
  for (let index = stepStart + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const indent = yamlIndent(raw);
    const trimmed = raw.trim();
    if (indent < stepIndent || (indent === stepIndent && /^-\s+/u.test(trimmed))) {
      stepEnd = index;
      break;
    }
    if (propertyIndent === null && indent > stepIndent && /^[A-Za-z0-9_.-]+:/u.test(trimmed)) {
      propertyIndent = indent;
    }
  }

  return { stepStart, stepEnd, stepIndent, propertyIndent };
}

function checkoutPersistCredentials(lines, usesIndex, parsed) {
  const { stepStart, stepEnd, propertyIndent } = checkoutStepBounds(lines, usesIndex, parsed);
  if (!Number.isInteger(propertyIndent)) return undefined;

  let withIndex = -1;
  let withIndent = null;
  for (let index = stepStart; index < stepEnd; index += 1) {
    const raw = lines[index];
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (yamlIndent(raw) !== propertyIndent) continue;
    if (/^with:\s*(?:#.*)?$/u.test(raw.trim())) {
      withIndex = index;
      withIndent = propertyIndent;
      break;
    }
  }
  if (withIndex === -1) return undefined;

  for (let index = withIndex + 1; index < stepEnd; index += 1) {
    const raw = lines[index];
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const indent = yamlIndent(raw);
    if (indent <= withIndent) break;
    const match = /^persist-credentials:\s*(false|true)\s*(?:#.*)?$/iu.exec(raw.trim());
    if (match) return match[1].toLowerCase() === 'true';
  }
  return undefined;
}

function inspectWorkflowText(text, options = {}) {
  const workflowPath = options.workflowPath || '.github/workflows/unknown.yml';
  const allowLocalReusableWorkflows = options.allowLocalReusableWorkflows !== false;
  const lock = options.lock;
  const errors = validateLock(lock);
  const entries = new Map();
  for (const entry of Array.isArray(lock?.actions) ? lock.actions : []) {
    if (!isObject(entry)) continue;
    if (isNonEmptyString(entry.repository) && isNonEmptyString(entry.commit)) {
      entries.set(`${entry.repository}@${entry.commit}`, entry);
    }
  }
  const externalReferences = [];
  const checkoutSteps = [];
  const localReferences = [];
  const lines = String(text).replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');

  lines.forEach((line, index) => {
    const parsed = parseUsesLine(line);
    if (!parsed) return;
    if (parsed.invalid) {
      errors.push(issue('USES_SYNTAX_INVALID', workflowPath, 'uses must use exact `uses:` YAML key syntax', index + 1));
      return;
    }
    const target = stripInlineComment(parsed.value);
    if (target.includes('${{')) {
      errors.push(issue('ACTION_REF_NOT_EXACT', workflowPath, `${target} must use a lowercase 40-character commit`, index + 1));
      return;
    }
    if (!target || /["']/u.test(target) || /\s/u.test(target)) {
      errors.push(issue('USES_SYNTAX_INVALID', workflowPath, 'uses value must be one unquoted token', index + 1));
      return;
    }
    if (target.startsWith('./')) {
      const relativeTarget = target.slice(2);
      if (!isSafeRepositoryPath(relativeTarget)) {
        errors.push(issue('LOCAL_ACTION_PATH_INVALID', workflowPath, `${target} must remain within the repository`, index + 1));
        return;
      }
      const reusableWorkflow = relativeTarget.startsWith('.github/workflows/') && YAML_FILE.test(relativeTarget);
      if (reusableWorkflow) {
        if (!allowLocalReusableWorkflows) {
          errors.push(issue('LOCAL_WORKFLOW_REFERENCE_INVALID', workflowPath, 'composite actions cannot delegate to reusable workflows', index + 1));
        }
        return;
      }
      localReferences.push({ path: workflowPath, line: index + 1, target: relativeTarget });
      return;
    }
    if (target.startsWith('docker://')) {
      errors.push(issue('DOCKER_ACTION_FORBIDDEN', workflowPath, 'docker actions require a separate digest-bound policy', index + 1));
      return;
    }
    const at = target.lastIndexOf('@');
    const actionPath = at > 0 ? target.slice(0, at) : '';
    const ref = at > 0 ? target.slice(at + 1) : '';
    const segments = actionPath.split('/');
    if (segments.length < 2 || !segments[0] || !segments[1]) {
      errors.push(issue('USES_SYNTAX_INVALID', workflowPath, 'external action must be owner/repository[/path]@commit', index + 1));
      return;
    }
    const repository = `${segments[0]}/${segments[1]}`;
    if (!FULL_SHA.test(ref)) {
      errors.push(issue('ACTION_REF_NOT_EXACT', workflowPath, `${target} must use a lowercase 40-character commit`, index + 1));
      return;
    }
    const identity = `${repository}@${ref}`;
    externalReferences.push(identity);
    if (!entries.has(identity)) errors.push(issue('ACTION_NOT_LOCKED', workflowPath, `${identity} is not registered in the action lock`, index + 1));
    if (repository === 'actions/checkout') {
      const persistCredentials = checkoutPersistCredentials(lines, index, parsed);
      checkoutSteps.push({ path: workflowPath, line: index + 1, reference: identity, persistCredentials });
      if (persistCredentials !== false) {
        errors.push(issue('CHECKOUT_PERSIST_CREDENTIALS_NOT_FALSE', workflowPath, 'actions/checkout must explicitly set persist-credentials: false', index + 1));
      }
    }
  });

  return { errors, externalReferences, checkoutSteps, localReferences };
}

function listWorkflowFiles(root) {
  const workflowRoot = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(workflowRoot)) return [];
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && YAML_FILE.test(entry.name)) files.push(absolute);
    }
  };
  visit(workflowRoot);
  return files.sort();
}

function resolveLocalActionManifest(repoRoot, reference) {
  const root = path.resolve(repoRoot);
  const actionDirectory = path.resolve(root, reference.target);
  if (!isStrictDescendant(root, actionDirectory)) {
    return { error: issue('LOCAL_ACTION_PATH_INVALID', reference.path, `${reference.target} escapes the repository`, reference.line) };
  }
  if (!fs.existsSync(actionDirectory) || !fs.statSync(actionDirectory).isDirectory()) {
    return { error: issue('LOCAL_ACTION_MANIFEST_MISSING', reference.path, `${reference.target} must contain action.yml or action.yaml`, reference.line) };
  }

  let realRoot;
  let realActionDirectory;
  try {
    realRoot = fs.realpathSync(root);
    realActionDirectory = fs.realpathSync(actionDirectory);
  } catch (error) {
    return { error: issue('LOCAL_ACTION_MANIFEST_READ_FAILED', reference.path, error.message, reference.line) };
  }
  if (!isStrictDescendant(realRoot, realActionDirectory)) {
    return { error: issue('LOCAL_ACTION_PATH_INVALID', reference.path, `${reference.target} resolves outside the repository`, reference.line) };
  }

  const manifests = LOCAL_ACTION_MANIFESTS
    .map(name => path.join(actionDirectory, name))
    .filter(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (manifests.length === 0) {
    return { error: issue('LOCAL_ACTION_MANIFEST_MISSING', reference.path, `${reference.target} must contain action.yml or action.yaml`, reference.line) };
  }
  if (manifests.length !== 1) {
    return { error: issue('LOCAL_ACTION_MANIFEST_AMBIGUOUS', reference.path, `${reference.target} contains both action.yml and action.yaml`, reference.line) };
  }

  let canonicalManifest;
  try {
    canonicalManifest = fs.realpathSync(manifests[0]);
  } catch (error) {
    return { error: issue('LOCAL_ACTION_MANIFEST_READ_FAILED', reference.path, error.message, reference.line) };
  }
  if (!isStrictDescendant(realRoot, canonicalManifest)) {
    return { error: issue('LOCAL_ACTION_PATH_INVALID', reference.path, `${reference.target} manifest resolves outside the repository`, reference.line) };
  }
  return {
    absolute: manifests[0],
    canonical: canonicalManifest,
    relative: path.relative(root, manifests[0]).replaceAll(path.sep, '/')
  };
}

function verifyRepository(repoRoot) {
  const root = path.resolve(repoRoot);
  const lockPath = path.join(root, 'third_party', 'github-actions-lock.json');
  let lock;
  const errors = [];
  try {
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    errors.push(issue(error instanceof SyntaxError ? 'ACTION_LOCK_JSON_INVALID' : 'ACTION_LOCK_MISSING', 'third_party/github-actions-lock.json', error.message));
    return { ok: false, errors, externalReferences: [], checkoutSteps: [], lock: null };
  }
  errors.push(...validateLock(lock));
  for (const [index, entry] of (Array.isArray(lock.actions) ? lock.actions : []).entries()) {
    if (isSafeRepositoryPath(entry?.licenseEvidence)) {
      const evidencePath = path.join(root, entry.licenseEvidence);
      if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) {
        errors.push(issue('LICENSE_EVIDENCE_MISSING', `actions[${index}].licenseEvidence`, entry.licenseEvidence));
      }
    }
  }

  const externalReferences = [];
  const checkoutSteps = [];
  const lockValidationCodes = new Set([
    'ACTION_LOCK_SCHEMA_UNSUPPORTED',
    'ACTION_LOCK_DOCUMENT_TYPE_INVALID',
    'ACTION_LOCK_ENTRIES_INVALID',
    'ACTION_LOCK_ENTRY_INVALID',
    'ACTION_REPOSITORY_INVALID',
    'ACTION_COMMIT_INVALID',
    'ACTION_LOCK_DUPLICATE',
    'ACTION_REVIEWED_TAG_REQUIRED',
    'ACTION_REVIEWED_TAG_NOT_EXACT',
    'ACTION_LICENSE_REQUIRED',
    'LICENSE_PATH_INVALID',
    'ACTION_UPSTREAM_REPOSITORY_INVALID'
  ]);
  const scannedLocalActions = new Set();
  const activeLocalActions = new Set();

  const appendReport = report => {
    errors.push(...report.errors.filter(error => !lockValidationCodes.has(error.code)));
    externalReferences.push(...report.externalReferences);
    checkoutSteps.push(...report.checkoutSteps);
  };

  const scanLocalAction = reference => {
    const resolution = resolveLocalActionManifest(root, reference);
    if (resolution.error) {
      errors.push(resolution.error);
      return;
    }
    if (activeLocalActions.has(resolution.canonical)) {
      errors.push(issue('LOCAL_ACTION_CYCLE', reference.path, `${reference.target} creates a recursive local action cycle`, reference.line));
      return;
    }
    if (scannedLocalActions.has(resolution.canonical)) return;

    activeLocalActions.add(resolution.canonical);
    try {
      const report = inspectWorkflowText(fs.readFileSync(resolution.absolute, 'utf8'), {
        lock,
        workflowPath: resolution.relative,
        allowLocalReusableWorkflows: false
      });
      appendReport(report);
      for (const nestedReference of report.localReferences) scanLocalAction(nestedReference);
    } catch (error) {
      errors.push(issue('LOCAL_ACTION_MANIFEST_READ_FAILED', resolution.relative, error.message));
    } finally {
      activeLocalActions.delete(resolution.canonical);
      scannedLocalActions.add(resolution.canonical);
    }
  };

  for (const absolute of listWorkflowFiles(root)) {
    const workflowPath = path.relative(root, absolute).replaceAll(path.sep, '/');
    const report = inspectWorkflowText(fs.readFileSync(absolute, 'utf8'), {
      lock,
      workflowPath,
      allowLocalReusableWorkflows: true
    });
    appendReport(report);
    for (const reference of report.localReferences) scanLocalAction(reference);
  }

  const used = new Set(externalReferences);
  for (const [index, entry] of (Array.isArray(lock.actions) ? lock.actions : []).entries()) {
    if (!isObject(entry)) continue;
    const identity = `${entry.repository}@${entry.commit}`;
    if (FULL_SHA.test(entry.commit || '') && REPOSITORY.test(entry.repository || '') && !used.has(identity)) {
      errors.push(issue('ACTION_LOCK_ENTRY_UNUSED', `actions[${index}]`, `${identity} is not used by any workflow or referenced local action`));
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    externalReferences: [...new Set(externalReferences)].sort(),
    checkoutSteps: checkoutSteps.sort((left, right) => left.path.localeCompare(right.path, 'en') || left.line - right.line),
    lock
  };
}

module.exports = { inspectWorkflowText, validateLock, verifyRepository, isSafeRepositoryPath };
