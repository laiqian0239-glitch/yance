'use strict';

// OD-004 契约验收（沿用 P0-A/B 旧标准：node:sqlite :memory: + node --test）
// 锁定 Persona 运行时 API 规范命名与编译产物形状：
//   - brain.compileContext(profileId, options) 为运行时入口
//   - compilePersonaContext(versionRecord, options) 为纯函数
//   - 产物必须携带 personaVersionId（活跃版本号）与 policyHash（contentSha256）
//   - 任何构建失败 -> safeFallback:true，退回当前安全 AI 链

const test = require('node:test');
const assert = require('node:assert');
const { DatabaseSync } = require('node:sqlite');
const { createPersonaBrain } = require('../../personaBrain');
const { compilePersonaContext } = require('../../personaBrain/compiler');

function makeStore() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}

function makeVersionRecord(overrides = {}) {
  return Object.assign({
    version: 3,
    content: {
      schemaVersion: 1,
      profileId: 'owner',
      authoritative: {
        disclosureRules: { health: 'ask' },
        forbiddenFabrications: ['fake-income']
      },
      learned: { preferences: { tone: 'warm' }, interactionPatterns: {} },
      metadata: { title: '妈妈', locale: 'zh-CN' }
    },
    contentSha256: 'abc123deadbeef'
  }, overrides);
}

test('OD-004: compilePersonaContext 绑定 personaVersionId + policyHash', () => {
  const rec = makeVersionRecord();
  const out = compilePersonaContext(rec);
  assert.strictEqual(out.safeFallback, false);
  assert.strictEqual(out.personaVersionId, 3);
  assert.strictEqual(out.policyHash, 'abc123deadbeef');
  assert.strictEqual(out.context.persona.available, true);
  assert.strictEqual(out.context.persona.profileId, 'owner');
  assert.deepStrictEqual(out.context.persona.disclosureRules, { health: 'ask' });
  assert.deepStrictEqual(out.context.persona.forbiddenFabrications, ['fake-income']);
  assert.strictEqual(out.context.persona.learned.preferences.tone, 'warm');
});

test('OD-004: 缺失版本记录 -> safeFallback', () => {
  const out = compilePersonaContext(null);
  assert.strictEqual(out.safeFallback, true);
  assert.strictEqual(out.personaVersionId, null);
  assert.strictEqual(out.policyHash, null);
  assert.strictEqual(out.context.persona.available, false);
});

test('OD-004: 非法版本号 -> safeFallback', () => {
  const out = compilePersonaContext(makeVersionRecord({ version: 0 }));
  assert.strictEqual(out.safeFallback, true);
  assert.strictEqual(out.reason, 'invalid-version');
});

test('OD-004: 缺 contentSha256（policyHash）-> safeFallback', () => {
  const out = compilePersonaContext(makeVersionRecord({ contentSha256: '' }));
  assert.strictEqual(out.safeFallback, true);
  assert.strictEqual(out.reason, 'missing-policy-hash');
});

test('OD-004: baseContext 合并 + policy 透传', () => {
  const rec = makeVersionRecord();
  const out = compilePersonaContext(rec, { baseContext: { channel: 'telegram' }, policy: { maxTokens: 800 } });
  assert.strictEqual(out.context.channel, 'telegram');
  assert.strictEqual(out.context.policy.maxTokens, 800);
  assert.strictEqual(out.context.persona.available, true);
});

test('OD-004: 集成 - 真实 store 中 brain.compileContext 绑定活跃版本', () => {
  const store = makeStore();
  const brain = createPersonaBrain({ store });
  const init = brain.service.initialize({});
  assert.strictEqual(init.created, true);

  const current = brain.service.getCurrent('owner');
  const compiled = brain.compileContext('owner');
  assert.strictEqual(compiled.safeFallback, false);
  assert.strictEqual(compiled.personaVersionId, current.version.version);
  assert.strictEqual(compiled.policyHash, current.version.contentSha256);
  assert.strictEqual(compiled.policyHash.length > 0, true);
});

test('OD-004: 集成 - 未初始化 profile -> safeFallback', () => {
  const store = makeStore();
  const brain = createPersonaBrain({ store });
  const compiled = brain.compileContext('owner');
  assert.strictEqual(compiled.safeFallback, true);
  assert.strictEqual(compiled.reason, 'profile-not-initialized');
});

test('V21 Persona P0: compiler exposes SillyTavern-backed structured composition without legacy flat style prompt', () => {
  const rec = makeVersionRecord({
    content: {
      schemaVersion: 1,
      profileId: 'owner',
      authoritative: {
        coreIdentity: { mode: 'verified_real' },
        personaProfile: { personality: ['warm'], expressionHabits: ['short replies'] },
        replyStylePolicy: { directions: { ambiguity: 30, matureWarm: 40 }, intensity: 'natural' },
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: { preferences: {}, interactionPatterns: {} },
      metadata: { title: 'Owner', locale: 'de-DE' }
    }
  });

  const out = compilePersonaContext(rec, {
    socialContext: { customer: { relationshipStage: 'warming' } },
    composition: {
      relationshipCard: { relationshipStage: 'warming' },
      localeProfile: { locale: 'de-DE' },
      chatRegister: { channel: 'whatsapp', register: 'native_short_form' },
      exampleDialogues: [{ user: 'Na?', assistant: 'Na du 😄' }]
    }
  });

  assert.strictEqual(out.safeFallback, false);
  assert.strictEqual(out.context.persona.composition.sourceAuthority, 'SillyTavern/SillyTavern@51ad27fb86d39a3daca3adaa970375c9670c12df');
  assert.strictEqual(Array.isArray(out.context.persona.composition.units), true);
  assert.strictEqual(out.context.persona.truthSafePacket.style.prompt, undefined);
  assert.strictEqual(out.context.persona.truthSafePacket.runtimeAuthority.pass, true);
  assert.strictEqual(out.context.persona.composition.units.some(unit => unit.identifier === 'exampleDialogues'), true);
});

test('V21 Persona P0 V2: saved structured Persona fields feed live composition without request-side composition overrides', () => {
  const rec = makeVersionRecord({
    content: {
      schemaVersion: 1,
      profileId: 'owner',
      authoritative: {
        coreIdentity: { mode: 'verified_real' },
        personaProfile: {
          description: 'owner presentation',
          characterCard: {
            name: 'Mira',
            description: 'dry and curious',
            personality: 'warm but concise',
            scenario: 'late evening chat',
            characterNote: { content: 'keep it compact', depth: 2, role: 'system' }
          },
          exampleDialogues: [{ user: 'Na?', assistant: 'Na du 😄' }],
          localeProfile: { locale: 'de-AT' },
          chatRegister: { channel: 'whatsapp', register: 'native_short_form' }
        },
        replyStylePolicy: { directions: { ambiguity: 30, humor: 20 }, intensity: 'natural' },
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: { preferences: {}, interactionPatterns: {} },
      metadata: { title: 'Owner', locale: 'de-DE' }
    }
  });

  const out = compilePersonaContext(rec, {
    socialContext: { customer: { platform: 'whatsapp', relationshipStage: 'warming' }, incomingMessage: { text: 'Na?' } }
  });

  assert.strictEqual(out.safeFallback, false);
  assert.strictEqual(out.context.persona.composition.characterCard.name, 'Mira');
  assert.strictEqual(out.context.persona.composition.localeProfile.locale, 'de-AT');
  assert.strictEqual(out.context.persona.composition.chatRegister.register, 'native_short_form');
  assert.strictEqual(out.context.persona.composition.exampleDialogues.length, 1);
  assert.strictEqual(out.context.persona.composition.units.some(unit => unit.identifier === 'charDescription'), true);
  assert.strictEqual(out.context.persona.composition.units.some(unit => unit.identifier === 'exampleDialogues'), true);
  const note = out.context.persona.composition.units.find(unit => unit.identifier === 'characterNote');
  assert.ok(note);
  assert.strictEqual(note.injectionDepth, 2);
});

test('V21 Persona P0 V2: derived native register clamps unsupported metadata locale when no register override exists', () => {
  const rec = makeVersionRecord({
    content: {
      schemaVersion: 1,
      profileId: 'owner',
      authoritative: {
        coreIdentity: { mode: 'verified_real' },
        personaProfile: { description: 'owner presentation' },
        replyStylePolicy: { directions: {}, intensity: 'natural' },
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: { preferences: {}, interactionPatterns: {} },
      metadata: { title: 'Owner', locale: 'fr-FR' }
    }
  });
  const out = compilePersonaContext(rec, { socialContext: { customer: { platform: 'whatsapp' } } });
  assert.strictEqual(out.safeFallback, false);
  assert.strictEqual(out.context.persona.composition.chatRegister.locale, 'de-DE');
  assert.strictEqual(out.context.persona.composition.chatRegister.register, 'native_short_form');
});

test('V21 Persona semantic repair: requested nested Character Card book wins before persisted fallback', () => {
  const rec = makeVersionRecord({
    content: {
      schemaVersion: 1,
      profileId: 'owner',
      authoritative: {
        coreIdentity: { mode: 'verified_real' },
        personaProfile: {
          characterCard: {
            name: 'Persisted Mira',
            characterBook: {
              entries: [{ keys: ['signal'], content: 'PERSISTED-BOOK', enabled: true }]
            }
          }
        },
        replyStylePolicy: { directions: {}, intensity: 'natural' },
        disclosureRules: {},
        forbiddenFabrications: []
      },
      learned: { preferences: {}, interactionPatterns: {} },
      metadata: { title: 'Owner', locale: 'de-DE' }
    }
  });

  const out = compilePersonaContext(rec, {
    socialContext: { customer: { platform: 'whatsapp' }, incomingMessage: { text: 'signal' } },
    composition: {
      characterCard: {
        name: 'Requested Mira',
        characterBook: {
          entries: [{ keys: ['signal'], content: 'REQUESTED-NESTED-BOOK', enabled: true }]
        }
      }
    }
  });

  assert.strictEqual(out.safeFallback, false);
  assert.strictEqual(out.context.persona.composition.characterBookMatches.some(row => row.content === 'REQUESTED-NESTED-BOOK'), true);
  assert.strictEqual(out.context.persona.composition.characterBookMatches.some(row => row.content === 'PERSISTED-BOOK'), false);
});
