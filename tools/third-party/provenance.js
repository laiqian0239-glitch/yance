'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FULL_SHA = /^[0-9a-f]{40}$/u;
const PROJECT_ID = /^[a-z0-9][a-z0-9._-]*$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const GITHUB_HTTPS_REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u;
const SUPPORTED_SCHEMA_VERSION = 1;
const APPROVED_REVIEW_STATUS = 'APPROVED';

function issue(code, issuePath, message) {
  return { code, path: issuePath, message };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeRepositoryPath(value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) return false;
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return !segments.includes('..') && !segments.includes('') && normalized !== '.';
}

function validateStringArray(value, issuePath, code, errors, options = {}) {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    errors.push(issue(code, issuePath, options.allowEmpty ? 'must be an array' : 'must be a non-empty array'));
    return;
  }

  value.forEach((entry, index) => {
    if (!isNonEmptyString(entry)) {
      errors.push(issue(code, `${issuePath}[${index}]`, 'must be a non-empty string'));
    }
  });
}

function validatePathArray(value, issuePath, code, errors, options = {}) {
  validateStringArray(value, issuePath, code, errors, options);
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (isNonEmptyString(entry) && !isSafeRepositoryPath(entry)) {
      errors.push(issue(code, `${issuePath}[${index}]`, 'must be a safe repository-relative path'));
    }
  });
}

function validateRegistry(registry) {
  const errors = [];

  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return [issue('REGISTRY_INVALID', '$', 'must be a JSON object')];
  }

  if (registry.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    errors.push(issue('SCHEMA_VERSION_UNSUPPORTED', 'schemaVersion', `must equal ${SUPPORTED_SCHEMA_VERSION}`));
  }

  const licenseDecision = registry.projectLicenseDecision;
  if (!licenseDecision || typeof licenseDecision !== 'object' || Array.isArray(licenseDecision)) {
    errors.push(issue('PROJECT_LICENSE_DECISION_INVALID', 'projectLicenseDecision', 'must be an object'));
  } else {
    if (!['UNRESOLVED', 'APPROVED'].includes(licenseDecision.status)) {
      errors.push(issue('PROJECT_LICENSE_STATUS_INVALID', 'projectLicenseDecision.status', 'must be UNRESOLVED or APPROVED'));
    }
    if (licenseDecision.status === 'APPROVED' && !isNonEmptyString(licenseDecision.approvedSpdx)) {
      errors.push(issue('PROJECT_LICENSE_SPDX_REQUIRED', 'projectLicenseDecision.approvedSpdx', 'is required when project license is approved'));
    }
    if (licenseDecision.status === 'UNRESOLVED' && licenseDecision.approvedSpdx !== null) {
      errors.push(issue('PROJECT_LICENSE_SPDX_MUST_BE_NULL', 'projectLicenseDecision.approvedSpdx', 'must be null while unresolved'));
    }
  }

  const policy = registry.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    errors.push(issue('POLICY_INVALID', 'policy', 'must be an object'));
  }

  const allowedModes = new Set(Array.isArray(policy?.allowedIntegrationModes) ? policy.allowedIntegrationModes : []);
  if (policy?.exactCommitRequired !== true) {
    errors.push(issue('EXACT_COMMIT_POLICY_REQUIRED', 'policy.exactCommitRequired', 'must be true'));
  }
  if (policy?.approvedRecordRequired !== true) {
    errors.push(issue('APPROVED_RECORD_POLICY_REQUIRED', 'policy.approvedRecordRequired', 'must be true'));
  }
  validateStringArray(policy?.allowedIntegrationModes, 'policy.allowedIntegrationModes', 'INTEGRATION_MODES_INVALID', errors);

  if (!Array.isArray(registry.projects)) {
    errors.push(issue('PROJECTS_INVALID', 'projects', 'must be an array'));
    return errors;
  }

  const seenIds = new Set();
  registry.projects.forEach((project, index) => {
    const base = `projects[${index}]`;
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      errors.push(issue('PROJECT_INVALID', base, 'must be an object'));
      return;
    }

    if (!isNonEmptyString(project.id) || !PROJECT_ID.test(project.id)) {
      errors.push(issue('PROJECT_ID_INVALID', `${base}.id`, 'must match lowercase project ID syntax'));
    } else if (seenIds.has(project.id)) {
      errors.push(issue('PROJECT_ID_DUPLICATE', `${base}.id`, `duplicate project id ${project.id}`));
    } else {
      seenIds.add(project.id);
    }

    if (!isNonEmptyString(project.name)) {
      errors.push(issue('PROJECT_NAME_REQUIRED', `${base}.name`, 'must be a non-empty string'));
    }
    if (!isNonEmptyString(project.upstreamRepository) || !GITHUB_HTTPS_REPOSITORY.test(project.upstreamRepository)) {
      errors.push(issue('UPSTREAM_REPOSITORY_INVALID', `${base}.upstreamRepository`, 'must be an HTTPS GitHub repository URL'));
    }
    if (!isNonEmptyString(project.upstreamCommit) || !FULL_SHA.test(project.upstreamCommit)) {
      errors.push(issue('UPSTREAM_COMMIT_INVALID', `${base}.upstreamCommit`, 'must be a lowercase 40-character hexadecimal commit'));
    }
    if (!isNonEmptyString(project.upstreamVersion)) {
      errors.push(issue('UPSTREAM_VERSION_REQUIRED', `${base}.upstreamVersion`, 'must be a non-empty string'));
    }
    if (!isNonEmptyString(project.integrationMode) || !allowedModes.has(project.integrationMode)) {
      errors.push(issue('INTEGRATION_MODE_UNSUPPORTED', `${base}.integrationMode`, 'must be listed in policy.allowedIntegrationModes'));
    }

    if (!project.license || typeof project.license !== 'object' || Array.isArray(project.license)) {
      errors.push(issue('LICENSE_INVALID', `${base}.license`, 'must be an object'));
    } else {
      if (!isNonEmptyString(project.license.spdx)) {
        errors.push(issue('LICENSE_SPDX_REQUIRED', `${base}.license.spdx`, 'must be a non-empty SPDX identifier'));
      }
      if (!isSafeRepositoryPath(project.license.evidenceFile) || !project.license.evidenceFile.startsWith('third_party/licenses/')) {
        errors.push(issue('LICENSE_PATH_INVALID', `${base}.license.evidenceFile`, 'must be a safe path under third_party/licenses/'));
      }
    }

    const sourcePathsMayBeEmpty = project.integrationMode === 'dependency';
    validatePathArray(project.sourcePaths, `${base}.sourcePaths`, 'SOURCE_PATH_INVALID', errors, { allowEmpty: sourcePathsMayBeEmpty });
    validatePathArray(project.yancePaths, `${base}.yancePaths`, 'YANCE_PATH_INVALID', errors, { allowEmpty: project.integrationMode === 'reference_only' });
    validateStringArray(project.modifications, `${base}.modifications`, 'MODIFICATIONS_REQUIRED', errors);
    validateStringArray(project.obligations, `${base}.obligations`, 'OBLIGATIONS_REQUIRED', errors);

    if (!project.review || typeof project.review !== 'object' || Array.isArray(project.review)) {
      errors.push(issue('REVIEW_INVALID', `${base}.review`, 'must be an object'));
    } else {
      if (project.review.status !== APPROVED_REVIEW_STATUS) {
        errors.push(issue('REVIEW_NOT_APPROVED', `${base}.review.status`, 'must be APPROVED'));
      }
      if (!isNonEmptyString(project.review.reviewedAt) || !ISO_DATE.test(project.review.reviewedAt)) {
        errors.push(issue('REVIEW_DATE_INVALID', `${base}.review.reviewedAt`, 'must use YYYY-MM-DD'));
      }
      validateStringArray(project.review.evidence, `${base}.review.evidence`, 'REVIEW_EVIDENCE_REQUIRED', errors);
    }
  });

  return errors;
}

function loadRegistry(repoRoot) {
  const registryPath = path.join(repoRoot, 'third_party', 'provenance.json');
  const raw = fs.readFileSync(registryPath, 'utf8');
  return JSON.parse(raw);
}

function renderNotice(registry) {
  const lines = [
    '# Third-Party Notices',
    '',
    'This file is generated from `third_party/provenance.json`.',
    'Do not edit it manually.',
    '',
    `Yance project license decision: **${registry.projectLicenseDecision.status}**`,
    ''
  ];

  const projects = [...registry.projects].sort((left, right) => left.id.localeCompare(right.id, 'en'));
  if (projects.length === 0) {
    lines.push('No third-party source integrations are registered.', '');
    return `${lines.join('\n')}`;
  }

  for (const project of projects) {
    lines.push(
      `## ${project.name}`,
      '',
      `- Registry ID: \`${project.id}\``,
      `- Upstream: ${project.upstreamRepository}`,
      `- Version: \`${project.upstreamVersion}\``,
      `- Commit: \`${project.upstreamCommit}\``,
      `- Integration mode: \`${project.integrationMode}\``,
      `- License: \`${project.license.spdx}\``,
      `- License evidence: \`${project.license.evidenceFile}\``,
      '- Upstream source paths:'
    );
    if (project.sourcePaths.length === 0) lines.push('  - None recorded for dependency-only integration.');
    else project.sourcePaths.forEach(value => lines.push(`  - \`${value}\``));
    lines.push('- Yance integration paths:');
    if (project.yancePaths.length === 0) lines.push('  - None; reference-only integration.');
    else project.yancePaths.forEach(value => lines.push(`  - \`${value}\``));
    lines.push('- Modifications:');
    project.modifications.forEach(value => lines.push(`  - ${value}`));
    lines.push('- Distribution obligations:');
    project.obligations.forEach(value => lines.push(`  - ${value}`));
    lines.push(`- Review: \`${project.review.status}\` on \`${project.review.reviewedAt}\``, '');
  }

  return `${lines.join('\n')}\n`;
}

function verifyRepository(repoRoot) {
  const errors = [];
  let registry;

  try {
    registry = loadRegistry(repoRoot);
  } catch (error) {
    const code = error instanceof SyntaxError ? 'REGISTRY_JSON_INVALID' : 'REGISTRY_MISSING';
    errors.push(issue(code, 'third_party/provenance.json', error.message));
    return { ok: false, errors, warnings: [], projects: [], registry: null, notice: null };
  }

  errors.push(...validateRegistry(registry));

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings: [],
      projects: Array.isArray(registry.projects)
        ? registry.projects.filter(project => project && typeof project.id === 'string').map(project => project.id)
        : [],
      registry,
      notice: null
    };
  }

  registry.projects.forEach((project, index) => {
    const licensePath = path.join(repoRoot, project.license.evidenceFile);
    if (!fs.existsSync(licensePath) || !fs.statSync(licensePath).isFile()) {
      errors.push(issue('LICENSE_EVIDENCE_MISSING', `projects[${index}].license.evidenceFile`, project.license.evidenceFile));
    }
    project.yancePaths.forEach((relativePath, pathIndex) => {
      const targetPath = path.join(repoRoot, relativePath);
      if (!fs.existsSync(targetPath)) {
        errors.push(issue('YANCE_PATH_MISSING', `projects[${index}].yancePaths[${pathIndex}]`, relativePath));
      }
    });
  });

  const notice = renderNotice(registry);
  const noticePath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
  let committedNotice = null;
  try {
    committedNotice = fs.readFileSync(noticePath, 'utf8');
  } catch (error) {
    errors.push(issue('NOTICE_MISSING', 'THIRD_PARTY_NOTICES.md', error.message));
  }
  if (committedNotice !== null && committedNotice !== notice) {
    errors.push(issue('NOTICE_DRIFT', 'THIRD_PARTY_NOTICES.md', 'must exactly match the deterministic registry projection'));
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
    projects: registry.projects.map(project => project.id),
    registry,
    notice
  };
}

module.exports = {
  loadRegistry,
  validateRegistry,
  renderNotice,
  verifyRepository,
  isSafeRepositoryPath
};
