'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join('third_party', 'provenance.json');
const NOTICE_PATH = 'THIRD_PARTY_NOTICES.md';
const SHA40 = /^[0-9a-f]{40}$/u;
const PROJECT_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const SUPPORTED_MODES = new Set([
  'dependency',
  'patched_dependency',
  'sidecar',
  'controlled_fork',
  'source_port',
  'reference_only'
]);

function issue(code, detail = {}) {
  return { code, ...detail };
}

function isSafeRepositoryPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return false;
  if (value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)) return false;
  return value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function normalizedStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string'))].sort();
}

function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return [issue('REGISTRY_INVALID')];
  }
  if (registry.schemaVersion !== 1) errors.push(issue('SCHEMA_VERSION_UNSUPPORTED'));
  if (!registry.projectLicenseDecision
      || registry.projectLicenseDecision.status !== 'UNRESOLVED'
      || registry.projectLicenseDecision.approvedSpdx !== null) {
    errors.push(issue('PROJECT_LICENSE_DECISION_INVALID'));
  }
  const policyModes = registry.policy?.allowedIntegrationModes;
  if (!Array.isArray(policyModes)
      || policyModes.some(mode => !SUPPORTED_MODES.has(mode))
      || registry.policy?.exactCommitRequired !== true
      || registry.policy?.approvedRecordRequired !== true) {
    errors.push(issue('POLICY_INVALID'));
  }
  if (!Array.isArray(registry.projects)) {
    errors.push(issue('PROJECTS_INVALID'));
    return errors;
  }

  const ids = new Set();
  for (const [index, project] of registry.projects.entries()) {
    const context = { projectIndex: index, projectId: project?.id ?? null };
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      errors.push(issue('PROJECT_INVALID', context));
      continue;
    }
    if (typeof project.id !== 'string' || !PROJECT_ID.test(project.id)) {
      errors.push(issue('PROJECT_ID_INVALID', context));
    } else if (ids.has(project.id)) {
      errors.push(issue('PROJECT_ID_DUPLICATE', context));
    } else {
      ids.add(project.id);
    }
    if (typeof project.name !== 'string' || project.name.trim().length === 0) {
      errors.push(issue('PROJECT_NAME_INVALID', context));
    }
    if (typeof project.upstreamRepository !== 'string'
        || !/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?$/u.test(project.upstreamRepository)) {
      errors.push(issue('UPSTREAM_REPOSITORY_INVALID', context));
    }
    if (typeof project.upstreamCommit !== 'string' || !SHA40.test(project.upstreamCommit)) {
      errors.push(issue('UPSTREAM_COMMIT_INVALID', context));
    }
    if (typeof project.upstreamVersion !== 'string' || project.upstreamVersion.trim().length === 0) {
      errors.push(issue('UPSTREAM_VERSION_INVALID', context));
    }
    if (!SUPPORTED_MODES.has(project.integrationMode)
        || !registry.policy?.allowedIntegrationModes?.includes(project.integrationMode)) {
      errors.push(issue('INTEGRATION_MODE_UNSUPPORTED', context));
    }
    if (!project.license || typeof project.license.spdx !== 'string' || project.license.spdx.length === 0) {
      errors.push(issue('LICENSE_INVALID', context));
    }
    if (!isSafeRepositoryPath(project.license?.evidenceFile)) {
      errors.push(issue('LICENSE_PATH_INVALID', context));
    }
    for (const [field, prefix] of [['sourcePaths', 'SOURCE'], ['yancePaths', 'YANCE']]) {
      if (!Array.isArray(project[field]) || project[field].length === 0) {
        errors.push(issue(`${prefix}_PATHS_INVALID`, context));
        continue;
      }
      for (const value of project[field]) {
        if (!isSafeRepositoryPath(value)) {
          errors.push(issue(`${prefix}_PATH_INVALID`, { ...context, path: value }));
        }
      }
    }
    if (!Array.isArray(project.modifications) || project.modifications.length === 0) {
      errors.push(issue('MODIFICATIONS_INVALID', context));
    }
    if (!Array.isArray(project.obligations) || project.obligations.length === 0) {
      errors.push(issue('OBLIGATIONS_INVALID', context));
    }
    if (project.review?.status !== 'APPROVED') {
      errors.push(issue('REVIEW_NOT_APPROVED', context));
    }
    if (!Array.isArray(project.review?.evidence) || project.review.evidence.length === 0) {
      errors.push(issue('REVIEW_EVIDENCE_MISSING', context));
    }
  }
  return errors;
}

function renderNotice(registry) {
  const projects = [...(Array.isArray(registry?.projects) ? registry.projects : [])]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const lines = [
    '# Third-Party Notices',
    '',
    'This file is generated deterministically from `third_party/provenance.json`.',
    'The Yance project license decision remains unresolved; this notice records upstream attribution only.',
    ''
  ];
  for (const project of projects) {
    lines.push(`## ${project.name}`);
    lines.push('');
    lines.push(`- Registry ID: \`${project.id}\``);
    lines.push(`- Upstream: ${project.upstreamRepository}`);
    lines.push(`- Version: \`${project.upstreamVersion}\``);
    lines.push(`- Commit: \`${project.upstreamCommit}\``);
    lines.push(`- Integration mode: \`${project.integrationMode}\``);
    lines.push(`- License: \`${project.license.spdx}\``);
    lines.push(`- License evidence: \`${project.license.evidenceFile}\``);
    lines.push(`- Modifications: ${normalizedStrings(project.modifications).join(' ')}`);
    lines.push(`- Obligations: ${normalizedStrings(project.obligations).join(' ')}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function loadRegistry(root) {
  const registryPath = path.join(root, REGISTRY_PATH);
  if (!fs.existsSync(registryPath)) {
    return { registry: null, errors: [issue('REGISTRY_MISSING', { path: REGISTRY_PATH })] };
  }
  try {
    return { registry: JSON.parse(fs.readFileSync(registryPath, 'utf8')), errors: [] };
  } catch (error) {
    return {
      registry: null,
      errors: [issue('REGISTRY_JSON_INVALID', { path: REGISTRY_PATH, message: error.message })]
    };
  }
}

function verifyRepository(root = process.cwd()) {
  const absoluteRoot = path.resolve(root);
  const loaded = loadRegistry(absoluteRoot);
  if (!loaded.registry) {
    return { ok: false, errors: loaded.errors, registry: null, projects: [], notice: null };
  }
  const registry = loaded.registry;
  const errors = [...validateRegistry(registry)];
  const registryProjects = Array.isArray(registry.projects) ? registry.projects : [];
  const projects = registryProjects.map(project => project.id).sort();
  for (const project of registryProjects) {
    if (isSafeRepositoryPath(project.license?.evidenceFile)
        && !fs.existsSync(path.join(absoluteRoot, project.license.evidenceFile))) {
      errors.push(issue('LICENSE_EVIDENCE_MISSING', {
        projectId: project.id,
        path: project.license.evidenceFile
      }));
    }
    for (const relativePath of Array.isArray(project.yancePaths) ? project.yancePaths : []) {
      if (isSafeRepositoryPath(relativePath) && !fs.existsSync(path.join(absoluteRoot, relativePath))) {
        errors.push(issue('YANCE_PATH_MISSING', { projectId: project.id, path: relativePath }));
      }
    }
  }
  const notice = renderNotice(registry);
  const noticePath = path.join(absoluteRoot, NOTICE_PATH);
  if (!fs.existsSync(noticePath)) {
    errors.push(issue('NOTICE_MISSING', { path: NOTICE_PATH }));
  } else if (fs.readFileSync(noticePath, 'utf8') !== notice) {
    errors.push(issue('NOTICE_DRIFT', { path: NOTICE_PATH }));
  }
  return { ok: errors.length === 0, errors, registry, projects, notice };
}

module.exports = {
  NOTICE_PATH,
  REGISTRY_PATH,
  isSafeRepositoryPath,
  loadRegistry,
  renderNotice,
  validateRegistry,
  verifyRepository
};
