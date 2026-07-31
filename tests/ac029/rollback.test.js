'use strict';

/**
 * AC-021: Context Migration — Rollback Test
 * ============================================
 * 测试逻辑：触发迁移进程 -> 注入模拟错误 -> 断言系统状态已回滚至迁移前快照
 *
 * 通过标准（Stub 未实现时应全部 FAIL）:
 *   T1: 迁移失败后，getCurrent() 返回迁移前的状态快照
 *   T2: 迁移失败后，listVersions() 不增加（无脏版本）
 *   T3: 迁移失败后，SQLite 迁移记录状态为 'failed'
 *   T4: 迁移失败后，迁移记录包含失败原因（error code/message）
 *   T5: 迁移成功后，getCurrent() 返回迁移后状态
 *   T6: 迁移成功后，listVersions() 包含新增版本
 *   T7: 幂等迁移（同 fingerprint 重复调用）不产生脏状态
 *
 * 实现前提（功能代码未写入前，T1-T4 测试注定 FAIL）:
 *   - service.migrateLegacy() 失败时触发 rollback 逻辑
 *   - repository.completeMigration({ migrationId, status: 'failed', report_json })
 *   - 回滚后 getCurrent() 不变
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../persona-brain/helpers');

const INITIAL_TIME = '2026-01-01T00:00:00.000Z';

/**
 * T1: 迁移失败后，getCurrent() 返回迁移前的状态快照
 * 策略：调用 migrateLegacy({ legacyDocument: ['not-an-object'] })，
 *      预期抛出 PERSONA_MIGRATION_SOURCE_INVALID，
 *      然后断言 getCurrent() == null（空 store 初始状态）
 */
test('AC-029 T1: getCurrent() returns pre-migration snapshot on migration failure', () => {
  const harness = createHarness();
  try {
    // 初始化 persona，状态快照 = { profileId: owner, activeVersion: 1, content: {...} }
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner',
      reason: 'seed',
      patch: { coreIdentity: { displayName: 'Pre-Migration Alice' } },
      createdAt: INITIAL_TIME
    });

    const preMigrationSnapshot = harness.service.getCurrent();
    assert.ok(preMigrationSnapshot, 'pre-migration snapshot must exist');
    const preVersion = preMigrationSnapshot.version.version;
    const preContentSha = preMigrationSnapshot.version.contentSha256;

    // T1: 触发迁移失败
    assert.throws(() => harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'corrupt-persona.json',
      legacyDocument: ['not-an-object'],  // 触发 PERSONA_MIGRATION_SOURCE_INVALID
      reason: 'test failure injection'
    }), error => {
      return error.code === 'PERSONA_MIGRATION_SOURCE_INVALID';
    }, 'migrateLegacy must throw with correct error code');

    // T1: 迁移失败后，getCurrent() 返回 pre-migration 快照（状态未变）
    const postMigrationSnapshot = harness.service.getCurrent();
    assert.ok(postMigrationSnapshot, 'getCurrent() must still return a snapshot after failed migration');
    assert.equal(
      postMigrationSnapshot.version.version,
      preVersion,
      'getCurrent() version must match pre-migration snapshot'
    );
    assert.equal(
      postMigrationSnapshot.version.contentSha256,
      preContentSha,
      'getCurrent() contentSha256 must match pre-migration snapshot'
    );
    assert.equal(
      postMigrationSnapshot.version.content.authoritative.coreIdentity.displayName,
      'Pre-Migration Alice',
      'getCurrent() content must be unchanged'
    );
  } finally {
    harness.close();
  }
});

/**
 * T2: 迁移失败后，listVersions() 不增加（无脏版本）
 */
test('AC-029 T2: listVersions() does not grow after migration failure (no dirty version)', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'seed',
      patch: { coreIdentity: { displayName: 'Bob' } },
      createdAt: INITIAL_TIME
    });

    const preVersions = harness.service.listVersions();
    assert.equal(preVersions.length, 2, 'should have 2 versions after init+update');

    // 触发迁移失败
    try {
      harness.service.migrateLegacy({
        profileId: 'owner',
        sourceKind: 'legacy-json',
        sourceId: 'invalid.json',
        legacyDocument: { invalid: ['also', 'invalid'] },
        reason: 'intentional failure'
      });
    } catch (_) { /* expected */ }

    // T2: listVersions() 长度不变
    const postVersions = harness.service.listVersions();
    assert.equal(
      postVersions.length,
      preVersions.length,
      'listVersions() length must not grow after failed migration: ' +
        preVersions.length + ' -> ' + postVersions.length
    );

    // 所有历史 contentSha256 不变
    for (let i = 0; i < preVersions.length; i++) {
      assert.equal(postVersions[i].contentSha256, preVersions[i].contentSha256,
        'Version ' + i + ' contentSha256 must not change after failed migration');
    }
  } finally {
    harness.close();
  }
});

/**
 * T3: 迁移失败后，SQLite 迁移记录状态为 'failed'
 */
test('AC-029 T3: SQLite migration run record has status=failed after failure', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });

    // 触发迁移失败
    try {
      harness.service.migrateLegacy({
        profileId: 'owner',
        sourceKind: 'legacy-json',
        sourceId: 'fail.json',
        legacyDocument: null,  // null is invalid
        reason: 'test'
      });
    } catch (_) { /* expected */ }

    // T3: 查询 SQLite migration_runs 表
    const runs = harness.store.db.prepare(
      'SELECT status, report_json FROM persona_brain_migration_runs ORDER BY started_at DESC LIMIT 1'
    ).all();

    assert.ok(runs.length > 0, 'at least one migration run must be recorded');
    assert.equal(runs[0].status, 'failed', 'migration run status must be failed');
  } finally {
    harness.close();
  }
});

/**
 * T4: 迁移失败后，迁移记录包含失败原因（error code/message）
 */
test('AC-029 T4: migration run record contains error code and message', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });

    try {
      harness.service.migrateLegacy({
        profileId: 'owner',
        sourceKind: 'legacy-json',
        sourceId: 'corrupt.json',
        legacyDocument: undefined,
        reason: 'test'
      });
    } catch (_) { /* expected */ }

    const runs = harness.store.db.prepare(
      'SELECT status, report_json FROM persona_brain_migration_runs ORDER BY started_at DESC LIMIT 1'
    ).all();

    // T4: report_json 包含错误码
    assert.ok(runs.length > 0, 'migration run must be recorded');
    const report = JSON.parse(runs[0].report_json || '{}');
    assert.ok(report.error, 'report must contain error field');
    assert.ok(
      report.error.includes('PERSONA_MIGRATION_SOURCE_INVALID') ||
      report.error.includes('PERSONA_'),
      'report error must contain persona error code'
    );
  } finally {
    harness.close();
  }
});

/**
 * T5: 迁移成功后，getCurrent() 返回迁移后状态
 */
test('AC-029 T5: getCurrent() returns post-migration state on success', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });

    const result = harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'persona-v1.json',
      legacyDocument: {
        title: 'Migrated Alice',
        identity: { displayName: 'Migrated Alice' },
        languages: { mandarin: 'native' }
      },
      reason: 'test migration'
    });

    // T5: migrateLegacy 成功返回
    assert.equal(result.migrated, true, 'migrateLegacy must return migrated=true on success');

    // T5: getCurrent() 返回迁移后 persona
    const current = harness.service.getCurrent();
    assert.ok(current, 'getCurrent() must return a persona after successful migration');
    assert.equal(
      current.version.content.authoritative.coreIdentity.displayName,
      'Migrated Alice',
      'displayName must come from migrated document'
    );
    assert.equal(
      current.version.content.authoritative.languageCapabilities.mandarin,
      'native',
      'language must be migrated'
    );
  } finally {
    harness.close();
  }
});

/**
 * T6: 迁移成功后，listVersions() 包含新增版本
 */
test('AC-029 T6: listVersions() includes new version after successful migration', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    const preVersions = harness.service.listVersions();
    assert.equal(preVersions.length, 1, 'should have 1 version after init');

    harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'persona-v2.json',
      legacyDocument: {
        identity: { displayName: 'Post-Migration Charlie' }
      },
      reason: 'test'
    });

    // T6: listVersions() 增加了 1
    const postVersions = harness.service.listVersions();
    assert.equal(
      postVersions.length,
      preVersions.length + 1,
      'listVersions() must grow by 1 after successful migration'
    );

    // operation 字段标记为 'migration'
    // listVersions() returns DESC (newest first), so [0] is the latest
    const latest = postVersions[0];
    assert.equal(latest.operation, 'migrate', 'latest version operation must be migrate');
  } finally {
    harness.close();
  }
});

/**
 * T7: 幂等迁移（同 fingerprint 重复调用）不产生脏状态
 */
test('AC-029 T7: idempotent migration does not produce dirty state', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });

    const legacyDoc = {
      identity: { displayName: 'Idempotent User' },
      languages: { korean: 'native' }
    };

    const first = harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'idempotent.json',
      legacyDocument: legacyDoc,
      reason: 'first migration'
    });
    assert.equal(first.migrated, true, 'first migration must succeed');

    const second = harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'idempotent.json',
      legacyDocument: legacyDoc,
      reason: 'duplicate migration'
    });
    assert.equal(second.idempotent, true, 'duplicate migration must be idempotent');
    assert.equal(second.migrated, false, 'idempotent re-migration must not create new version');

    // T7: listVersions() 长度不变（无脏版本）
    assert.equal(
      harness.service.listVersions().length,
      2,  // init + 1 migration
      'no extra version created by idempotent re-migration'
    );
  } finally {
    harness.close();
  }
});


/**
 * T8: 当前 schema 的默认空文档也必须被识别为无有效人设内容。
 */
test('AC-029 T8: current-schema default document is rejected without creating a version', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    const before = harness.service.getCurrent();
    const versionsBefore = harness.service.listVersions().length;
    const { createEmptyPersonaDocument } = require('../../backend/personaBrain/schema');

    assert.throws(() => harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'persona-brain-v1',
      sourceId: 'empty-v1.json',
      legacyDocument: createEmptyPersonaDocument('owner'),
      reason: 'reject empty current schema'
    }), error => error.code === 'PERSONA_MIGRATION_SOURCE_INVALID');

    const after = harness.service.getCurrent();
    assert.equal(harness.service.listVersions().length, versionsBefore);
    assert.equal(after.version.version, before.version.version);
    assert.equal(after.version.contentSha256, before.version.contentSha256);
  } finally {
    harness.close();
  }
});

/**
 * T9: 版本写入后、迁移完成记录写入前发生异常，整个版本提交必须回滚。
 */
test('AC-029 T9: completion failure rolls back version and leaves a failed migration record', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'seed',
      patch: { coreIdentity: { displayName: 'Atomic Alice' } },
      createdAt: INITIAL_TIME
    });
    const before = harness.service.getCurrent();
    const versionsBefore = harness.service.listVersions().length;

    assert.throws(() => harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'completion-failure.json',
      legacyDocument: { identity: { displayName: 'Must Not Commit' } },
      reason: 'inject completion failure',
      beforeCompleteMigration() {
        const error = new Error('injected completion failure');
        error.code = 'INJECTED_COMPLETION_FAILURE';
        throw error;
      }
    }), error => error.code === 'INJECTED_COMPLETION_FAILURE');

    const after = harness.service.getCurrent();
    assert.equal(harness.service.listVersions().length, versionsBefore, 'failed completion must not leave a new version');
    assert.equal(after.version.version, before.version.version);
    assert.equal(after.version.contentSha256, before.version.contentSha256);
    assert.equal(after.version.content.authoritative.coreIdentity.displayName, 'Atomic Alice');

    const run = harness.store.db.prepare(
      'SELECT status, report_json FROM persona_brain_migration_runs WHERE source_id=? ORDER BY started_at DESC LIMIT 1'
    ).get('completion-failure.json');
    assert.equal(run.status, 'failed');
    assert.match(run.report_json, /INJECTED_COMPLETION_FAILURE/);
  } finally {
    harness.close();
  }
});

/**
 * T10: 候选回复失效属于同一提交边界；失效失败时不得切换人设版本。
 */
test('AC-029 T10: candidate invalidation failure rolls back migration version atomically', () => {
  const harness = createHarness({
    candidateCoordinator: {
      invalidateForPersonaVersion() {
        const error = new Error('injected candidate invalidation failure');
        error.code = 'INJECTED_CANDIDATE_INVALIDATION_FAILURE';
        throw error;
      },
      countReverifyRequired() { return { candidates: 0, outbox: 0, total: 0 }; }
    }
  });
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    const before = harness.service.getCurrent();
    const versionsBefore = harness.service.listVersions().length;

    assert.throws(() => harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'candidate-failure.json',
      legacyDocument: { identity: { displayName: 'Must Roll Back' } },
      reason: 'inject candidate failure'
    }), error => error.code === 'INJECTED_CANDIDATE_INVALIDATION_FAILURE');

    const after = harness.service.getCurrent();
    assert.equal(harness.service.listVersions().length, versionsBefore);
    assert.equal(after.version.version, before.version.version);
    assert.equal(after.version.contentSha256, before.version.contentSha256);
    const run = harness.store.db.prepare(
      'SELECT status, report_json FROM persona_brain_migration_runs WHERE source_id=? ORDER BY started_at DESC LIMIT 1'
    ).get('candidate-failure.json');
    assert.equal(run.status, 'failed');
    assert.match(run.report_json, /INJECTED_CANDIDATE_INVALIDATION_FAILURE/);
  } finally {
    harness.close();
  }
});


/**
 * T11: 动态人设与回复风格字段属于可识别、可迁移内容，不能被识别器接受后又丢弃。
 */
test('AC-029 T11: personaProfile and replyStylePolicy migrate without data loss', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    const result = harness.service.migrateLegacy({
      profileId: 'owner',
      sourceKind: 'legacy-json',
      sourceId: 'dynamic-persona.json',
      legacyDocument: {
        personaProfile: {
          name: 'Dynamic User',
          city: 'Berlin',
          occupation: 'Designer'
        },
        replyStylePolicy: {
          intensity: 'bold',
          allowBoldInitiative: true
        }
      },
      reason: 'migrate dynamic persona fields'
    });

    assert.equal(result.migrated, true);
    const current = harness.service.getCurrent();
    assert.equal(current.version.content.authoritative.personaProfile.name, 'Dynamic User');
    assert.equal(current.version.content.authoritative.personaProfile.city, 'Berlin');
    assert.equal(current.version.content.authoritative.personaProfile.occupation, 'Designer');
    assert.equal(current.version.content.authoritative.replyStylePolicy.intensity, 'bold');
    assert.equal(current.version.content.authoritative.replyStylePolicy.allowBoldInitiative, true);
  } finally {
    harness.close();
  }
});
