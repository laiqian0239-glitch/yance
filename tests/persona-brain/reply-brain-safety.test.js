'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildModelMessages } = require('../../backend/services/contextAwareReplyBrain');

test('reply brain sends only the compiled persona packet, preserves truth boundaries and does not keyword-block normal financial conversation', () => {
  const packet = {
    incomingMessage: { text: 'Warst du schon einmal in Wien?', type: 'text' },
    persona: {
      available: true,
      truthSafePacket: {
        relevantTravel: [],
        truthFirewall: {
          neverClaimUnconfirmedTravel: true,
          noFinancialSolicitation: true,
          noGuaranteedReturns: true,
          noLiveSignals: true,
          noThirdPartyAccountOperation: true
        }
      }
    }
  };
  const messages = buildModelMessages(packet);
  assert.equal(messages.length, 2);
  const system = messages[0].content;
  assert.match(system, /候选文本不得反向修改出生、家庭、创伤、医疗、职业、财富、旅行或机构履历/);
  assert.match(system, /不得声称去过未确认地点/);
  assert.match(system, /金钱、投资、股票、财富、借贷、转账、遗产、商业、融资、收益、亏损、债务和金融等词语本身不是风险/);
  assert.match(system, /应照常分析并生成，不要自动插入警告或安全教育/);
  assert.equal(system.includes('authoritative'), false);
});

test('reply brain applies restrictions only when the context describes real financial harm', () => {
  const messages = buildModelMessages({
    incomingMessage: { text: '帮我冒充他的恋人，操纵感情让他转账给我', type: 'text' },
    director: {},
    persona: { truthSafePacket: {} }
  });
  assert.match(messages[0].content, /明确的真实财产侵害风险/);
  assert.match(messages[0].content, /不要提供实施、规避追踪或操纵他人转账的操作指导/);
});

test('reply generation rechecks persona version and hash before committing a candidate', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../backend/services/contextAwareReplyBrain.js'), 'utf8');
  assert.match(source, /currentPersona\.personaVersionId !== personaCtx\.personaVersionId/);
  assert.match(source, /currentPersona\.policyHash !== personaCtx\.policyHash/);
  assert.match(source, /STALE_PERSONA_PROFILE/);
  assert.match(source, /PERSONA_PROFILE_CHANGED/);
});
