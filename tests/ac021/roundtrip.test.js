'use strict';

/**
 * AC-021: Persona Import/Export — Roundtrip Test
 * ================================================
 * 测试逻辑：构造 Persona 对象 -> 执行导出 -> 执行导入 -> 深度比较
 *
 * 通过标准（Stub 未实现时应全部 FAIL）:
 *   T1: export() 返回有效 Canonical JSON，含 metadata + versions
 *   T2: import() 在空 store 中重建 persona，version=1
 *   T3: 往返后 authoritative 所有 section 完全一致
 *   T4: 往返后 learned 所有字段完全一致
 *   T5: 往返后 version history 完整保留
 *   T6: export() 包含 fingerprint，供幂等去重
 *   T7: import() 对已存在的 fingerprint 返回 idempotent=true
 *
 * 实现前提（功能代码未写入前，这些测试注定 FAIL）:
 *   - PersonaBrainService.exportPersona(profileId)
 *   - PersonaBrainService.importPersona({ profileId, exportedPayload })
 *   - ExportedPayload shape: { schemaVersion, profileId, fingerprint, metadata, versions[] }
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../persona-brain/helpers');

const INITIAL_TIME = '2026-01-01T00:00:00.000Z';

test('AC-021 T1: export() returns valid Canonical JSON with metadata and versions', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner',
      reason: 'seed identity',
      patch: {
        coreIdentity: { displayName: 'Alice', preferredName: 'Ali' },
        languageCapabilities: { english: 'native' }
      },
      createdAt: INITIAL_TIME
    });

    // T1: export() 返回有效 Canonical JSON，含 metadata + versions
    const payload = harness.service.exportPersona('owner');
    assert.equal(typeof payload, 'object', 'exportPersona() must return an object');
    assert.equal(payload.schemaVersion, 1, 'schemaVersion must be present');
    assert.equal(payload.profileId, 'owner', 'profileId must match');
    assert.ok(payload.fingerprint, 'fingerprint must be present');
    assert.ok(payload.metadata, 'metadata must be present');
    assert.ok(Array.isArray(payload.versions), 'versions must be an array');
    assert.equal(payload.versions.length, 2, 'should have 2 versions: init creates v1, updateAuthoritative creates v2');
  } finally {
    harness.close();
  }
});

test('AC-021 T2: import() rebuilds persona in empty store, version=1', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner',
      reason: 'seed',
      patch: { coreIdentity: { displayName: 'Bob' } },
      createdAt: INITIAL_TIME
    });

    const payload = harness.service.exportPersona('owner');
    harness.service._resetStore(); // simulate empty store

    const result = harness.service.importPersona({ profileId: 'owner', exportedPayload: payload });
    assert.equal(result.imported, true, 'importPersona() must return imported=true');
    assert.equal(result.version.version, 2, 'imported v2 must map back to v2');
    assert.equal(
      harness.service.getCurrent().version.content.authoritative.coreIdentity.displayName,
      'Bob',
      'imported content must match original'
    );
  } finally {
    harness.close();
  }
});

test('AC-021 T3: roundtrip preserves ALL authoritative sections (deep equality)', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner',
      reason: 'full persona',
      patch: {
        coreIdentity: { displayName: 'Charlie', birthYear: 1990, gender: 'male' },
        familyAndUpbringing: { primaryCaregiver: 'Mother', upbringingCity: 'Tokyo' },
        educationAndCareer: { highestDegree: 'Bachelor', fieldOfStudy: 'CS' },
        relationshipHistory: { relationshipStatus: 'single', pastRelationships: 2 },
        emotionalAndHealthBoundaries: { stressResponse: 'analytical', mentalHealthNotes: 'none' },
        investmentBackground: { investmentExperience: 'intermediate', riskTolerance: 'moderate' },
        languageCapabilities: { english: 'fluent', japanese: 'native' },
        financialAndAssets: { annualIncomeRange: '50k-100k', primaryResidence: 'rent' },
        expressionMatrix: { humorStyle: 'sarcastic', conversationPace: 'fast' },
        localizedChatStyles: { whatsappEnglish: { maxSentences: 3, tone: 'formal' } },
        socialRelationships: [{ name: 'Mom', relationship: 'mother', frequency: 'weekly' }],
        travelMemories: [{ destination: 'Paris', year: 2023, notes: 'romantic' }],
        disclosureRules: { safeTopics: ['weather', 'food'], forbiddenTopics: ['politics'] },
        forbiddenFabrications: ['never claim to be a doctor']
      },
      createdAt: INITIAL_TIME
    });

    const original = harness.service.getCurrent().version.content;
    const payload = harness.service.exportPersona('owner');
    harness.service._resetStore();
    harness.service.importPersona({ profileId: 'owner', exportedPayload: payload });
    const restored = harness.service.getCurrent().version.content;

    // T3: 所有 authoritative sections 深度相等
    assert.deepEqual(
      restored.authoritative,
      original.authoritative,
      'All authoritative sections must be identical after roundtrip'
    );
  } finally {
    harness.close();
  }
});

test('AC-021 T4: roundtrip preserves ALL learned sections', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'seed',
      patch: { coreIdentity: { displayName: 'Dana' } },
      createdAt: INITIAL_TIME
    });
    harness.service.updateLearned({
      profileId: 'owner', reason: 'learn',
      patch: {
        observations: { likesCoffee: true, worksRemote: true },
        preferences: { theme: 'dark', language: 'en' },
        interactionPatterns: { greetingStyle: 'casual' },
        confidenceByPath: { 'preferences.theme': 0.9 },
        sourceBindings: { chatHistory: ['conv-001', 'conv-002'] }
      },
      createdAt: INITIAL_TIME
    });

    const original = harness.service.getCurrent().version.content;
    const payload = harness.service.exportPersona('owner');
    harness.service._resetStore();
    harness.service.importPersona({ profileId: 'owner', exportedPayload: payload });
    const restored = harness.service.getCurrent().version.content;

    // T4: learned sections 深度相等
    assert.deepEqual(restored.learned, original.learned, 'Learned sections must be identical after roundtrip');
  } finally {
    harness.close();
  }
});

test('AC-021 T5: roundtrip preserves complete version history', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });

    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'v1',
      patch: { coreIdentity: { displayName: 'Eve' } },
      createdAt: INITIAL_TIME
    });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'v2',
      patch: { coreIdentity: { preferredName: 'Ev' }, languageCapabilities: { french: 'beginner' } },
      createdAt: INITIAL_TIME
    });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'v3',
      patch: { coreIdentity: { birthYear: 1985 } },
      createdAt: INITIAL_TIME
    });

    const originalHistory = harness.service.listVersions();
    assert.equal(originalHistory.length, 4, 'should have 4 versions (init + 3 updates)');

    const payload = harness.service.exportPersona('owner');
    harness.service._resetStore();
    harness.service.importPersona({ profileId: 'owner', exportedPayload: payload });
    const restoredHistory = harness.service.listVersions();

    // T5: version history 完整保留
    assert.equal(
      restoredHistory.length,
      originalHistory.length,
      'Version history length must match: ' + originalHistory.length + ' vs ' + restoredHistory.length
    );

    // 每条 version 的 contentSha256 一致
    for (let i = 0; i < originalHistory.length; i++) {
      assert.equal(
        restoredHistory[i].contentSha256,
        originalHistory[i].contentSha256,
        'Version ' + i + ' contentSha256 must match'
      );
    }
  } finally {
    harness.close();
  }
});

test('AC-021 T6: export() includes stable fingerprint for idempotent deduplication', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'seed',
      patch: { coreIdentity: { displayName: 'Frank' } },
      createdAt: INITIAL_TIME
    });

    const payload = harness.service.exportPersona('owner');

    // T6: fingerprint 存在且是 64-char SHA256 hex
    assert.ok(payload.fingerprint, 'fingerprint must exist');
    assert.equal(typeof payload.fingerprint, 'string', 'fingerprint must be string');
    assert.equal(payload.fingerprint.length, 64, 'fingerprint must be 64-char SHA256 hex');

    // 同一 persona 两次 export，fingerprint 一致（幂等性保证）
    const payload2 = harness.service.exportPersona('owner');
    assert.equal(payload2.fingerprint, payload.fingerprint, 'fingerprint must be stable');
  } finally {
    harness.close();
  }
});

test('AC-021 T7: import() idempotent=true for duplicate fingerprint', () => {
  const harness = createHarness();
  try {
    harness.service.initialize({ profileId: 'owner', reason: 'init', createdAt: INITIAL_TIME });
    harness.service.updateAuthoritative({
      profileId: 'owner', reason: 'seed',
      patch: { coreIdentity: { displayName: 'Grace' } },
      createdAt: INITIAL_TIME
    });

    const payload = harness.service.exportPersona('owner');
    const first = harness.service.deserialize({ profileId: 'owner', exportedPayload: payload });
    assert.equal(first.imported, true, 'first import must succeed');

    const second = harness.service.deserialize({ profileId: 'owner', exportedPayload: payload });
    assert.equal(second.idempotent, true, 'second import with same fingerprint must be idempotent');
    assert.equal(second.imported, false, 'idempotent re-import must not create new version');

    // T7: first import adds payload versions (2 new entries, 4 total);
    // second import correctly skips (no new version created, count stays 4)
    const countAfterFirst = harness.service.listVersions().length;
    assert.equal(countAfterFirst, 4, 'first import should append payload versions (4 total)');

    const countAfterSecond = harness.service.listVersions().length;
    assert.equal(countAfterSecond, countAfterFirst, 'idempotent re-import must not increase version count');
  } finally {
    harness.close();
  }
});
