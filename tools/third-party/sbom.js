'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SRI_ALGORITHMS = new Map([
  ['sha1', 'SHA-1'],
  ['sha256', 'SHA-256'],
  ['sha384', 'SHA-384'],
  ['sha512', 'SHA-512']
]);

function issue(code, issuePath, message) {
  return { code, path: issuePath, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeLockPath(value) {
  if (value === '') return true;
  if (!isNonEmptyString(value) || path.isAbsolute(value) || value !== value.trim()) return false;
  const normalized = value.replaceAll('\\', '/');
  if (normalized !== value || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || /[\r\n\0-\x1f\x7f]/u.test(normalized)) return false;
  const segments = normalized.split('/');
  return !segments.includes('') && !segments.includes('.') && !segments.includes('..');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function serializeSbom(sbom) {
  return `${JSON.stringify(canonicalize(sbom), null, 2)}\n`;
}

function packageNameFromPath(lockPath, entry, packageJson) {
  if (lockPath === '') return entry.name || packageJson.name;
  if (isNonEmptyString(entry.name)) return entry.name;
  const marker = 'node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? lockPath : lockPath.slice(index + marker.length);
}

function packageVersion(lockPath, entry, packageJson) {
  if (lockPath === '') return entry.version || packageJson.version;
  return entry.version;
}

function encodePurlPart(value) {
  return encodeURIComponent(String(value));
}

function componentRef(name, version, lockPath) {
  return `pkg:npm/${encodePurlPart(name)}@${encodePurlPart(version)}?lock_path=${encodePurlPart(lockPath || '.')}`;
}

function parseSri(integrity) {
  if (!isNonEmptyString(integrity)) return null;
  const hashes = [];
  for (const token of integrity.trim().split(/\s+/u)) {
    const match = /^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/u.exec(token);
    if (!match) return null;
    const base64 = match[2];
    let decoded;
    try {
      decoded = Buffer.from(base64, 'base64');
    } catch {
      return null;
    }
    if (decoded.length === 0 || decoded.toString('base64').replace(/=+$/u, '') !== base64.replace(/=+$/u, '')) return null;
    hashes.push({ alg: SRI_ALGORITHMS.get(match[1]), content: decoded.toString('hex') });
  }
  return hashes.sort((left, right) => left.alg.localeCompare(right.alg, 'en') || left.content.localeCompare(right.content, 'en'));
}

function propertiesFor(lockPath, entry) {
  const properties = [{ name: 'yance:npm-lock:path', value: lockPath || '.' }];
  for (const flag of ['dev', 'optional', 'peer', 'inBundle', 'link']) {
    if (entry[flag] === true) properties.push({ name: `yance:npm-lock:${flag}`, value: 'true' });
  }
  return properties.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function buildComponent(lockPath, entry, packageJson) {
  const name = packageNameFromPath(lockPath, entry, packageJson);
  const version = packageVersion(lockPath, entry, packageJson);
  const purl = `pkg:npm/${encodePurlPart(name)}@${encodePurlPart(version)}`;
  const component = {
    type: lockPath === '' ? 'application' : 'library',
    'bom-ref': componentRef(name, version, lockPath),
    name,
    version,
    purl,
    properties: propertiesFor(lockPath, entry)
  };
  const hashes = parseSri(entry.integrity);
  if (hashes) component.hashes = hashes;
  if (isNonEmptyString(entry.resolved)) {
    component.externalReferences = [{ type: 'distribution', url: entry.resolved }];
  }
  return component;
}

function parentPackagePath(lockPath) {
  if (!lockPath) return '';
  const marker = '/node_modules/';
  const index = lockPath.lastIndexOf(marker);
  return index === -1 ? '' : lockPath.slice(0, index);
}

function resolveDependencyPath(packagePaths, fromPath, dependencyName) {
  let current = fromPath;
  while (true) {
    const candidate = current ? `${current}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (packagePaths.has(candidate)) return candidate;
    if (!current) return null;
    current = parentPackagePath(current);
  }
}

function dependencyNames(entry, isRoot) {
  const names = new Set();
  for (const field of isRoot ? ['dependencies', 'optionalDependencies', 'devDependencies'] : ['dependencies', 'optionalDependencies']) {
    const map = entry[field];
    if (!isObject(map)) continue;
    for (const name of Object.keys(map)) names.add(name);
  }
  return [...names].sort();
}

function buildSbom({ packageJson, packageLock }) {
  const packages = isObject(packageLock?.packages) ? packageLock.packages : {};
  const paths = Object.keys(packages).sort();
  const components = [];
  const refsByPath = new Map();
  for (const lockPath of paths) {
    const entry = isObject(packages[lockPath]) ? packages[lockPath] : {};
    const component = buildComponent(lockPath, entry, packageJson || {});
    components.push(component);
    refsByPath.set(lockPath, component['bom-ref']);
  }
  components.sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'], 'en'));
  const packagePaths = new Set(paths);
  const dependencies = [];
  for (const lockPath of paths) {
    const entry = isObject(packages[lockPath]) ? packages[lockPath] : {};
    const dependsOn = [];
    for (const name of dependencyNames(entry, lockPath === '')) {
      const resolved = resolveDependencyPath(packagePaths, lockPath, name);
      if (resolved !== null && refsByPath.has(resolved)) dependsOn.push(refsByPath.get(resolved));
    }
    dependencies.push({ ref: refsByPath.get(lockPath), dependsOn: [...new Set(dependsOn)].sort() });
  }
  dependencies.sort((left, right) => left.ref.localeCompare(right.ref, 'en'));
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    version: 1,
    components,
    dependencies
  };
}

function validateSource(packageJson, packageLock) {
  const errors = [];
  if (!isObject(packageJson)) errors.push(issue('PACKAGE_JSON_INVALID', 'package.json', 'must be a JSON object'));
  if (!isObject(packageLock)) return [issue('PACKAGE_LOCK_INVALID', 'package-lock.json', 'must be a JSON object')];
  if (packageLock.lockfileVersion !== 3) errors.push(issue('LOCKFILE_VERSION_UNSUPPORTED', 'package-lock.json', 'lockfileVersion must equal 3'));
  if (!isObject(packageLock.packages)) return [...errors, issue('LOCK_PACKAGES_INVALID', 'package-lock.json#packages', 'must be an object')];
  const paths = Object.keys(packageLock.packages).sort();
  const packagePaths = new Set(paths);
  for (const lockPath of paths) {
    const entry = packageLock.packages[lockPath];
    const base = `package-lock.json#packages[${JSON.stringify(lockPath)}]`;
    if (!isSafeLockPath(lockPath)) errors.push(issue('LOCK_PATH_INVALID', base, 'must be a safe normalized lockfile path'));
    if (!isObject(entry)) {
      errors.push(issue('LOCK_ENTRY_INVALID', base, 'must be an object'));
      continue;
    }
    const name = packageNameFromPath(lockPath, entry, packageJson || {});
    const version = packageVersion(lockPath, entry, packageJson || {});
    if (!isNonEmptyString(name)) errors.push(issue('PACKAGE_NAME_REQUIRED', base, 'package name could not be derived'));
    if (!isNonEmptyString(version)) errors.push(issue('PACKAGE_VERSION_REQUIRED', base, 'package version is required'));
    if (entry.integrity !== undefined && parseSri(entry.integrity) === null) {
      errors.push(issue('SRI_INVALID', `${base}.integrity`, 'must contain supported, valid SRI hash tokens'));
    }
    for (const dependencyName of dependencyNames(entry, lockPath === '')) {
      if (resolveDependencyPath(packagePaths, lockPath, dependencyName) === null) {
        errors.push(issue('DEPENDENCY_UNRESOLVED', base, `${dependencyName} cannot be resolved from ${lockPath || '.'}`));
      }
    }
  }
  return errors;
}

function validateSbom(sbom, source) {
  const errors = validateSource(source?.packageJson, source?.packageLock);
  if (!isObject(sbom)) return [...errors, issue('SBOM_INVALID', 'third_party/sbom.cdx.json', 'must be a JSON object')];
  if (sbom.bomFormat !== 'CycloneDX') errors.push(issue('SBOM_FORMAT_INVALID', 'bomFormat', 'must equal CycloneDX'));
  if (sbom.specVersion !== '1.7') errors.push(issue('SBOM_SPEC_VERSION_INVALID', 'specVersion', 'must equal 1.7'));
  if (Object.hasOwn(sbom, 'serialNumber')) errors.push(issue('SBOM_NONDETERMINISTIC_FIELD', 'serialNumber', 'must be absent'));
  if (Object.hasOwn(sbom.metadata || {}, 'timestamp')) errors.push(issue('SBOM_NONDETERMINISTIC_FIELD', 'metadata.timestamp', 'must be absent'));
  if (!Array.isArray(sbom.components)) errors.push(issue('SBOM_COMPONENTS_INVALID', 'components', 'must be an array'));
  if (!Array.isArray(sbom.dependencies)) errors.push(issue('SBOM_DEPENDENCIES_INVALID', 'dependencies', 'must be an array'));

  const refs = [];
  if (Array.isArray(sbom.components)) {
    sbom.components.forEach((component, index) => {
      if (!isObject(component) || !isNonEmptyString(component['bom-ref'])) errors.push(issue('BOM_REF_REQUIRED', `components[${index}]`, 'bom-ref is required'));
      else refs.push(component['bom-ref']);
    });
  }
  const seen = new Set();
  refs.forEach((ref, index) => {
    if (seen.has(ref)) errors.push(issue('BOM_REF_DUPLICATE', `components[${index}].bom-ref`, `duplicate bom-ref ${ref}`));
    seen.add(ref);
  });
  const refSet = new Set(refs);
  if (Array.isArray(sbom.dependencies)) {
    sbom.dependencies.forEach((dependency, index) => {
      if (!isObject(dependency) || !isNonEmptyString(dependency.ref) || !Array.isArray(dependency.dependsOn)) {
        errors.push(issue('DEPENDENCY_ENTRY_INVALID', `dependencies[${index}]`, 'must contain ref and dependsOn array'));
        return;
      }
      if (!refSet.has(dependency.ref)) errors.push(issue('DEPENDENCY_REF_UNKNOWN', `dependencies[${index}].ref`, dependency.ref));
      dependency.dependsOn.forEach((ref, depIndex) => {
        if (!refSet.has(ref)) errors.push(issue('DEPENDENCY_TARGET_UNKNOWN', `dependencies[${index}].dependsOn[${depIndex}]`, ref));
      });
    });
  }

  if (isObject(source?.packageJson) && isObject(source?.packageLock)) {
    const expected = buildSbom(source);
    if (JSON.stringify(canonicalize(sbom)) !== JSON.stringify(canonicalize(expected))) {
      errors.push(issue('SBOM_DRIFT', 'third_party/sbom.cdx.json', 'must exactly project the committed package-lock.json'));
    }
  }
  return errors;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function verifyRepository(repoRoot) {
  const errors = [];
  let packageJson;
  let packageLock;
  try {
    packageJson = readJson(path.join(repoRoot, 'package.json'));
  } catch (error) {
    errors.push(issue(error instanceof SyntaxError ? 'PACKAGE_JSON_PARSE_ERROR' : 'PACKAGE_JSON_MISSING', 'package.json', error.message));
  }
  try {
    packageLock = readJson(path.join(repoRoot, 'package-lock.json'));
  } catch (error) {
    errors.push(issue(error instanceof SyntaxError ? 'PACKAGE_LOCK_PARSE_ERROR' : 'PACKAGE_LOCK_MISSING', 'package-lock.json', error.message));
  }
  if (!packageJson || !packageLock) return { ok: false, errors, sbom: null, bytes: null };

  const expectedSbom = buildSbom({ packageJson, packageLock });
  const bytes = serializeSbom(expectedSbom);
  const sbomPath = path.join(repoRoot, 'third_party', 'sbom.cdx.json');
  let raw;
  let sbom;
  try {
    raw = fs.readFileSync(sbomPath, 'utf8');
    sbom = JSON.parse(raw);
  } catch (error) {
    errors.push(issue(error instanceof SyntaxError ? 'SBOM_JSON_INVALID' : 'SBOM_MISSING', 'third_party/sbom.cdx.json', error.message));
    return { ok: false, errors, sbom: expectedSbom, bytes };
  }
  errors.push(...validateSbom(sbom, { packageJson, packageLock }));
  if (raw !== serializeSbom(sbom)) {
    errors.push(issue('SBOM_NON_CANONICAL', 'third_party/sbom.cdx.json', 'must use canonical UTF-8 JSON bytes with one terminal LF'));
  }
  return { ok: errors.length === 0, errors, sbom, bytes };
}

module.exports = { buildSbom, serializeSbom, validateSbom, verifyRepository, isSafeLockPath, parseSri, resolveDependencyPath };
