'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const OWNERSHIP_DIMENSIONS = [
  'lifecycle',
  'state',
  'retry',
  'recovery',
  'resolution',
  'materialization',
];

const BUILT_IN_SHADOW_PATTERNS = [
  {
    id: 'MATRIX_PEER_USER_BY_ROOM_ID',
    regex: /\bmatrixPeerUserByRoomId\b/giu,
  },
  {
    id: 'ROOM_MEMBER_AVATAR_USER_BY_ROOM_ID',
    regex: /\b(?:room|matrix)[A-Za-z0-9_$]*(?:peer|member|avatar|user)[A-Za-z0-9_$]*ByRoomId\b/giu,
  },
  {
    id: 'ROOM_MEMBER_AVATAR_USER_SHADOW_LOOKUP',
    regex: /\b(?:room|matrix)[A-Za-z0-9_$]*(?:peer|member|avatar|user)[A-Za-z0-9_$]*(?:Map|Index|Cache|Lookup)\b/giu,
  },
];

const MAX_SCAN_BYTES = 10 * 1024 * 1024;

function usage(command = 'admission.js') {
  return `Yance Mature Authority Audit\n\nUsage:\n  node ${command} --manifest <path> [--repo-root <path>] [--output <path>]\n  node ${command} --help\n\nThe command emits JSON evidence. GREEN exits 0; fail-closed RED exits 2.`;
}

function parseArgs(argv, options = {}) {
  const values = {};
  const allowed = new Set(['--manifest', '--repo-root', '--output']);
  if (options.proof) allowed.add('--admission');

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      values.help = true;
      continue;
    }
    if (!allowed.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    values[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return values;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeRepoPath(value) {
  if (!nonEmptyString(value)) throw new Error('Path must be a non-empty string.');
  if (value.includes('\0')) throw new Error('Path contains a NUL byte.');
  const portable = value.replace(/\\/g, '/');
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:\//u.test(portable) || portable.startsWith('//')) {
    throw new Error('Path must be repository-relative.');
  }
  const normalized = path.posix.normalize(portable);
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new Error('Path must stay inside the repository.');
  }
  return normalized.replace(/^\.\//u, '');
}

function resolveInside(repoRoot, repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  const resolvedRoot = path.resolve(repoRoot);
  const resolved = path.resolve(resolvedRoot, ...normalized.split('/'));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Resolved path escapes the repository.');
  }
  return { normalized, resolved };
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  const normalized = normalizeRepoPath(pattern);
  let expression = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '*' && normalized[index + 1] === '*') {
      if (normalized[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += escapeRegex(character);
    }
  }
  return new RegExp(`^${expression}$`, 'iu');
}

function matchesAny(repoPath, patterns) {
  return patterns.some((pattern) => globToRegex(pattern).test(repoPath));
}

function readJsonFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  return { bytes, value: JSON.parse(bytes.toString('utf8')) };
}

function createEvidence(kind, phase, manifestPath) {
  return {
    schemaVersion: 1,
    kind,
    phase,
    status: 'RED',
    auditId: null,
    capability: null,
    manifestPath: manifestPath ? path.resolve(manifestPath) : null,
    manifestSha256: null,
    checkedAt: new Date().toISOString(),
    checks: [],
    violations: [],
    scan: {
      files: [],
      builtInPatterns: BUILT_IN_SHADOW_PATTERNS.map(({ id }) => id),
      additionalPatterns: [],
    },
  };
}

function auditManifest({ manifest, manifestBytes, manifestPath, repoRoot, phase = 'admission' }) {
  const evidence = createEvidence(
    phase === 'proof' ? 'yance-mature-authority-proof' : 'yance-mature-authority-admission',
    phase,
    manifestPath,
  );
  evidence.manifestSha256 = sha256(manifestBytes);

  const violation = (code, message, file = undefined) => {
    evidence.violations.push({ code, message, ...(file ? { file } : {}) });
  };
  const check = (id, ok, detail) => {
    evidence.checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
    return ok;
  };

  if (!isObject(manifest)) {
    violation('MANIFEST_NOT_OBJECT', 'Manifest must be a JSON object.');
    return evidence;
  }

  evidence.auditId = nonEmptyString(manifest.auditId) ? manifest.auditId.trim() : null;
  evidence.capability = nonEmptyString(manifest.capability) ? manifest.capability.trim() : null;

  if (!check('manifest-schema-version', manifest.schemaVersion === 1, 'schemaVersion must equal 1.')) {
    violation('UNSUPPORTED_MANIFEST_SCHEMA', 'schemaVersion must equal 1.');
  }
  if (!check('audit-identity', Boolean(evidence.auditId && evidence.capability), 'auditId and capability must be non-empty strings.')) {
    violation('MISSING_AUDIT_IDENTITY', 'auditId and capability are required.');
  }

  const authority = manifest.authority;
  const productOwner = isObject(authority) && nonEmptyString(authority.productOwner)
    ? authority.productOwner.trim()
    : null;
  const matureOwners = isObject(authority) && Array.isArray(authority.matureOwners)
    ? authority.matureOwners.filter(nonEmptyString).map((owner) => owner.trim())
    : [];
  const uniqueMatureOwners = [...new Set(matureOwners)];
  const ownerShapeOk = Boolean(
    productOwner
      && uniqueMatureOwners.length > 0
      && uniqueMatureOwners.length === (authority?.matureOwners?.length ?? 0)
      && !uniqueMatureOwners.includes(productOwner),
  );
  if (!check('declared-mature-owners', ownerShapeOk, 'A distinct productOwner and non-empty unique matureOwners are required.')) {
    violation('INVALID_OWNER_DECLARATION', 'Mature owners must be explicit, unique, non-empty, and distinct from the Product owner.');
  }

  let ownershipOk = true;
  for (const dimension of OWNERSHIP_DIMENSIONS) {
    const declaration = authority?.ownership?.[dimension];
    const owner = isObject(declaration) && nonEmptyString(declaration.owner) ? declaration.owner.trim() : null;
    const source = isObject(declaration) && nonEmptyString(declaration.source) ? declaration.source.trim() : null;
    const dimensionOk = Boolean(owner && source && uniqueMatureOwners.includes(owner) && owner !== productOwner);
    if (!dimensionOk) {
      ownershipOk = false;
      violation(
        'MATURE_OWNERSHIP_NOT_PRESERVED',
        `${dimension} must remain with a declared mature owner and cite its source.`,
      );
    }
  }
  check('mature-owner-retains-all-capability-ownership', ownershipOk, OWNERSHIP_DIMENSIONS.join(', '));

  const integration = manifest.integration;
  const permittedRoles = new Set(['stateless-projection', 'thin-adapter']);
  const integrationShapeOk = isObject(integration) && permittedRoles.has(integration.role);
  if (!check('thin-product-integration', integrationShapeOk, 'integration.role must be stateless-projection or thin-adapter.')) {
    violation('INVALID_PRODUCT_INTEGRATION_ROLE', 'The Product integration must be a stateless projection or thin adapter.');
  }

  const forbiddenFlags = [
    ['addsSecondOwner', 'SECOND_OWNER_DECLARED'],
    ['shadowAuthority', 'SHADOW_AUTHORITY_DECLARED'],
    ['parallelLifecycle', 'PARALLEL_LIFECYCLE_DECLARED'],
    ['mirrorState', 'MIRROR_STATE_DECLARED'],
    ['customFallback', 'CUSTOM_FALLBACK_DECLARED'],
  ];
  let flagsOk = true;
  for (const [field, code] of forbiddenFlags) {
    if (integration?.[field] !== false) {
      flagsOk = false;
      violation(code, `integration.${field} must be explicitly false.`);
    }
  }
  const productStateOk = Array.isArray(integration?.productOwnedCapabilityState)
    && integration.productOwnedCapabilityState.length === 0;
  if (!productStateOk) {
    flagsOk = false;
    violation(
      'PRODUCT_OWNED_CAPABILITY_STATE',
      'productOwnedCapabilityState must be an explicitly empty array; Product-owned mature capability state is forbidden.',
    );
  }
  check('no-second-authority', flagsOk, 'Second owner, shadow authority, parallel lifecycle, mirror state, fallback, and Product-owned capability state are forbidden.');

  const publicSeam = integration?.publicSeam;
  const publicSeamOk = Boolean(
    isObject(publicSeam)
      && nonEmptyString(publicSeam.name)
      && nonEmptyString(publicSeam.owner)
      && uniqueMatureOwners.includes(publicSeam.owner.trim())
      && publicSeam.kind === 'public'
      && publicSeam.narrowest === true,
  );
  if (!check('narrowest-mature-public-seam', publicSeamOk, 'The seam must be public, narrowest, named, and owned by a declared mature owner.')) {
    violation('PUBLIC_SEAM_NOT_ADMITTED', 'A named narrowest public seam owned by the mature owner is mandatory.');
  }

  const changes = Array.isArray(manifest.mutation?.changes) ? manifest.mutation.changes : [];
  const allowedPaths = Array.isArray(manifest.pathPolicy?.allowedPaths) ? manifest.pathPolicy.allowedPaths : [];
  const forbiddenPaths = Array.isArray(manifest.pathPolicy?.forbiddenPaths) ? manifest.pathPolicy.forbiddenPaths : [];
  let pathPolicyOk = changes.length > 0 && allowedPaths.length > 0 && forbiddenPaths.length > 0;
  const normalizedChanges = [];

  if (!pathPolicyOk) {
    violation('INCOMPLETE_PATH_POLICY', 'At least one mutation, allowed path pattern, and forbidden path pattern are required.');
  }

  try {
    for (const pattern of [...allowedPaths, ...forbiddenPaths]) globToRegex(pattern);
    for (const change of changes) {
      if (!isObject(change) || !['add', 'modify', 'delete'].includes(change.action)) {
        pathPolicyOk = false;
        violation('INVALID_MUTATION_ACTION', 'Each mutation change requires action add, modify, or delete.');
        continue;
      }
      const normalized = normalizeRepoPath(change.path);
      normalizedChanges.push({ path: normalized, action: change.action });
      if (!matchesAny(normalized, allowedPaths)) {
        pathPolicyOk = false;
        violation('MUTATION_OUTSIDE_ALLOWED_PATHS', `${normalized} is outside allowedPaths.`, normalized);
      }
      if (matchesAny(normalized, forbiddenPaths)) {
        pathPolicyOk = false;
        violation('MUTATION_IN_FORBIDDEN_PATH', `${normalized} matches forbiddenPaths.`, normalized);
      }
    }
  } catch (error) {
    pathPolicyOk = false;
    violation('INVALID_REPOSITORY_PATH', error.message);
  }
  check('mutation-path-policy', pathPolicyOk, 'All declared mutations must be repository-relative, allowed, and not forbidden.');

  const declaredIntegrationFiles = Array.isArray(manifest.sourceScan?.integrationFiles)
    ? manifest.sourceScan.integrationFiles
    : [];
  const declaredOwnerFiles = Array.isArray(manifest.sourceScan?.ownerFiles)
    ? manifest.sourceScan.ownerFiles
    : [];
  const additionalPatterns = Array.isArray(manifest.sourceScan?.additionalForbiddenPatterns)
    ? manifest.sourceScan.additionalForbiddenPatterns
    : [];
  const scanPaths = new Map();
  const pathRoles = new Map();
  let scanPlanOk = declaredIntegrationFiles.length > 0 && declaredOwnerFiles.length > 0;

  if (!scanPlanOk) {
    violation(
      'SOURCE_SCAN_EMPTY',
      'sourceScan.integrationFiles and sourceScan.ownerFiles must each contain at least one file.',
    );
  }

  try {
    for (const [role, files] of [
      ['integration', declaredIntegrationFiles],
      ['owner', declaredOwnerFiles],
    ]) {
      for (const file of files) {
        const entry = resolveInside(repoRoot, file);
        if (pathRoles.has(entry.normalized)) {
          scanPlanOk = false;
          violation(
            'AMBIGUOUS_SOURCE_ROLE',
            `${entry.normalized} cannot be both an integration file and an owner file.`,
            entry.normalized,
          );
          continue;
        }
        pathRoles.set(entry.normalized, role);
        const exists = fs.existsSync(entry.resolved);
        const declaredChange = normalizedChanges.find((change) => change.path === entry.normalized);
        const mayBeAbsent = phase === 'admission'
          ? declaredChange?.action === 'add'
          : declaredChange?.action === 'delete';
        if (!exists && !mayBeAbsent) {
          scanPlanOk = false;
          violation('DECLARED_SOURCE_MISSING', `${entry.normalized} does not exist.`, entry.normalized);
        }
        if (exists) scanPaths.set(entry.normalized, { absolutePath: entry.resolved, role });
      }
    }
    for (const change of normalizedChanges) {
      const entry = resolveInside(repoRoot, change.path);
      const role = pathRoles.get(entry.normalized);
      if (!role) {
        scanPlanOk = false;
        violation(
          'MUTATION_SOURCE_ROLE_UNDECLARED',
          `${change.path} must appear in exactly one of sourceScan.integrationFiles or sourceScan.ownerFiles.`,
          change.path,
        );
      }
      const exists = fs.existsSync(entry.resolved);
      if (phase === 'admission') {
        if ((change.action === 'modify' || change.action === 'delete') && !exists) {
          scanPlanOk = false;
          violation('PRE_MUTATION_SOURCE_MISSING', `${change.path} must exist before ${change.action}.`, change.path);
        }
        if (exists && role) scanPaths.set(entry.normalized, { absolutePath: entry.resolved, role });
      } else if (change.action === 'delete') {
        if (exists) {
          scanPlanOk = false;
          violation('EXPECTED_DELETION_NOT_MATERIALIZED', `${change.path} still exists after the mutation.`, change.path);
        }
      } else if (!exists) {
        scanPlanOk = false;
        violation('POST_MUTATION_SOURCE_MISSING', `${change.path} must exist after ${change.action}.`, change.path);
      } else {
        if (role) scanPaths.set(entry.normalized, { absolutePath: entry.resolved, role });
      }
    }
  } catch (error) {
    scanPlanOk = false;
    violation('INVALID_SCAN_PATH', error.message);
  }

  const compiledPatterns = [...BUILT_IN_SHADOW_PATTERNS];
  for (const pattern of additionalPatterns) {
    try {
      if (!isObject(pattern) || !nonEmptyString(pattern.id) || !nonEmptyString(pattern.regex)) {
        throw new Error('Each additional pattern needs non-empty id and regex.');
      }
      const flags = nonEmptyString(pattern.flags) ? pattern.flags : 'gu';
      const regex = new RegExp(pattern.regex, flags.includes('g') ? flags : `${flags}g`);
      compiledPatterns.push({ id: `CUSTOM_${pattern.id}`, regex });
      evidence.scan.additionalPatterns.push(pattern.id);
    } catch (error) {
      scanPlanOk = false;
      violation('INVALID_ADDITIONAL_PATTERN', error.message);
    }
  }

  let sourceScanOk = scanPlanOk;
  let ownerSeamFound = false;
  let scannedIntegrationFiles = 0;
  let scannedOwnerFiles = 0;
  for (const [repoPath, scanTarget] of scanPaths) {
    try {
      const { absolutePath, role } = scanTarget;
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) throw new Error('Scan target is not a file.');
      if (stat.size > MAX_SCAN_BYTES) throw new Error(`Scan target exceeds ${MAX_SCAN_BYTES} bytes.`);
      const bytes = fs.readFileSync(absolutePath);
      if (bytes.includes(0)) throw new Error('Binary or NUL-containing source cannot be authority-scanned.');
      const source = bytes.toString('utf8');
      evidence.scan.files.push({ path: repoPath, role, sha256: sha256(bytes), bytes: bytes.length });

      if (role === 'owner') {
        scannedOwnerFiles += 1;
        if (publicSeamOk && source.includes(publicSeam.name.trim())) ownerSeamFound = true;
      } else {
        scannedIntegrationFiles += 1;
        for (const pattern of compiledPatterns) {
          pattern.regex.lastIndex = 0;
          const match = pattern.regex.exec(source);
          if (match) {
            sourceScanOk = false;
            const prefix = source.slice(0, match.index);
            const line = prefix.split(/\r?\n/u).length;
            violation(
              'SHADOW_AUTHORITY_SOURCE_PATTERN',
              `${pattern.id} matched ${JSON.stringify(match[0])} at line ${line}.`,
              repoPath,
            );
          }
        }
      }
    } catch (error) {
      sourceScanOk = false;
      violation('SOURCE_SCAN_FAILED', `${repoPath}: ${error.message}`, repoPath);
    }
  }
  if (scannedIntegrationFiles === 0 || scannedOwnerFiles === 0) sourceScanOk = false;
  check(
    'integration-shadow-authority-scan',
    sourceScanOk,
    `${scannedIntegrationFiles} integration source file(s) scanned with mandatory patterns.`,
  );
  if (!ownerSeamFound) {
    violation(
      'PUBLIC_SEAM_NOT_FOUND_IN_OWNER_SOURCE',
      'The declared publicSeam.name must occur in at least one declared mature-owner source file.',
    );
  }
  check(
    'mature-public-seam-source-presence',
    ownerSeamFound,
    `${scannedOwnerFiles} mature-owner source file(s) inspected for the declared seam.`,
  );

  if (phase === 'proof') {
    const localChecks = Array.isArray(manifest.localProof?.checks) ? manifest.localProof.checks : [];
    let localProofOk = localChecks.length > 0;
    if (!localProofOk) violation('LOCAL_PROOF_MISSING', 'localProof.checks must contain at least one executed check.');
    for (const localCheck of localChecks) {
      const checkOk = Boolean(
        isObject(localCheck)
          && nonEmptyString(localCheck.id)
          && nonEmptyString(localCheck.command)
          && localCheck.status === 'PASS'
          && nonEmptyString(localCheck.evidence),
      );
      if (!checkOk) {
        localProofOk = false;
        violation('LOCAL_PROOF_NOT_GREEN', 'Every local proof receipt needs id, command, status PASS, and preserved evidence.');
      }
    }
    check('executed-local-proof-receipts', localProofOk, `${localChecks.length} local proof receipt(s) declared.`);
  }

  evidence.status = evidence.violations.length === 0 && evidence.checks.every((item) => item.status === 'PASS')
    ? 'GREEN'
    : 'RED';
  return evidence;
}

function writeEvidence(evidence, outputPath) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

function main(argv = process.argv.slice(2)) {
  let args;
  let evidence;
  try {
    args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!args.manifest) throw new Error('--manifest is required.');
    const manifestPath = path.resolve(args.manifest);
    const repoRoot = path.resolve(args.repoRoot || process.cwd());
    const { bytes, value } = readJsonFile(manifestPath);
    evidence = auditManifest({
      manifest: value,
      manifestBytes: bytes,
      manifestPath,
      repoRoot,
      phase: 'admission',
    });
    writeEvidence(evidence, args.output);
    return evidence.status === 'GREEN' ? 0 : 2;
  } catch (error) {
    evidence = createEvidence('yance-mature-authority-admission', 'admission', args?.manifest);
    evidence.violations.push({ code: 'AUDIT_EXECUTION_ERROR', message: error.message });
    writeEvidence(evidence, args?.output);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  auditManifest,
  createEvidence,
  parseArgs,
  readJsonFile,
  sha256,
  usage,
  writeEvidence,
};
