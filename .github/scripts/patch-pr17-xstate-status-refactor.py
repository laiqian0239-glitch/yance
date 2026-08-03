#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parent / 'refactor-pr17-xstate-status.py'
source = path.read_text(encoding='utf-8')
before = r'''function inspectSchema23StartupBinding(repositoryRoot) {
  const storePath = path.join(repositoryRoot, 'backend/lib/r32SqliteStore.js');
  const migrationPath = path.join(repositoryRoot, 'backend/migrations/architectureClosureV2WpB.js');
  if (!fs.existsSync(storePath) || !fs.existsSync(migrationPath)) {
    return Object.freeze({ applied: false, storePath: 'backend/lib/r32SqliteStore.js', migrationPath: 'backend/migrations/architectureClosureV2WpB.js' });
  }
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const applied = /requireSchema23StartupRegistration\(\)/u.test(storeSource)
    && /applyArchitectureClosureV2WpB\(store\.db/u.test(storeSource)
    && /TARGET_SCHEMA_VERSION\s*=\s*23\b/u.test(migrationSource)
    && /023_architecture_closure_v2_wp_b/u.test(migrationSource);
  return Object.freeze({
    applied,
    storePath: 'backend/lib/r32SqliteStore.js',
    migrationPath: 'backend/migrations/architectureClosureV2WpB.js'
  });
}
'''
after = r'''function inspectSchema23StartupBinding(repositoryRoot) {
  const storeRelativePath = 'backend/lib/r32SqliteStore.js';
  const migrationRelativePath = 'backend/migrations/architectureClosureV2WpB.js';
  const migrationEngineRelativePath = 'backend/migrations/architectureClosureV2WpBEngine.js';
  const storePath = path.join(repositoryRoot, storeRelativePath);
  const migrationPath = path.join(repositoryRoot, migrationRelativePath);
  const migrationEnginePath = path.join(repositoryRoot, migrationEngineRelativePath);
  if (!fs.existsSync(storePath) || !fs.existsSync(migrationPath) || !fs.existsSync(migrationEnginePath)) {
    return Object.freeze({
      applied: false,
      storePath: storeRelativePath,
      migrationPath: migrationRelativePath,
      migrationEnginePath: migrationEngineRelativePath
    });
  }
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const migrationSource = fs.readFileSync(migrationPath, 'utf8');
  const migrationEngineSource = fs.readFileSync(migrationEnginePath, 'utf8');
  const applied = /requireSchema23StartupRegistration\(\)/u.test(storeSource)
    && /applyArchitectureClosureV2WpB\(store\.db/u.test(storeSource)
    && /const engine = require\('\.\/architectureClosureV2WpBEngine'\)/u.test(migrationSource)
    && /engine\.applyArchitectureClosureV2WpB\(db, options\)/u.test(migrationSource)
    && /TARGET_SCHEMA_VERSION\s*=\s*23\b/u.test(migrationEngineSource)
    && /MIGRATION_ID\s*=\s*'023_architecture_closure_v2_wp_b'/u.test(migrationEngineSource);
  return Object.freeze({
    applied,
    storePath: storeRelativePath,
    migrationPath: migrationRelativePath,
    migrationEnginePath: migrationEngineRelativePath
  });
}
'''
count = source.count(before)
if count != 1:
    raise RuntimeError(f'expected one stale Schema 23 binding detector, found {count}')
path.write_text(source.replace(before, after, 1), encoding='utf-8')
print('PR17_XSTATE_STATUS_REFACTOR_PATCHED')
