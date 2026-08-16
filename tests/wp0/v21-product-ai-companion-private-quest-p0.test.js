'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const shell = () => read('integration/element-module/src/product-experience/ProductExperienceShell.tsx');
const assistant = () => read('integration/element-module/src/product-experience/RelationshipAssistant.tsx');
const projection = () => read('integration/element-module/src/product-experience/experienceProjection.ts');

test('normal Product scene keeps Learning admin reachable only through explicit secondary settings', () => {
  const source = shell();
  assert.match(source, /import\s+\{\s*LearningWorkspace\s*\}\s+from\s+["']\.\.\/LearningWorkspace["']/u);
  assert.match(source, /\[learningAdminVisible,\s*setLearningAdminVisible\]\s*=\s*useState\(false\)/u);
  assert.match(source, /Learning controls/u);
  assert.match(source, /setLearningAdminVisible\(true\)/u);
  assert.match(source, /learningAdminVisible\s*\?\s*<LearningWorkspace\s*\/>\s*:\s*null/u);
  assert.match(source, /onToggle=\{[\s\S]*currentTarget\.open[\s\S]*setLearningAdminVisible\(false\)/u);
  assert.doesNotMatch(source, /<\/AnimatePresence>\s*<LearningWorkspace\s*\/>\s*<details/u);
});

test('selected relationship is passed into a relationship-native Private Quest', () => {
  assert.match(shell(), /<RelationshipAssistant[\s\S]*relationship=\{selectedRelationship\}/u);
  const source = assistant();
  assert.match(source, /RelationshipProjection/u);
  assert.match(source, /Private Quest/u);
  assert.match(source, /Current intention/u);
  assert.match(source, /Progress/u);
  assert.match(source, /Relationship insight/u);
  assert.match(source, /Next step/u);
  assert.doesNotMatch(source, /<dt>Letta<\/dt>|<dt>Agents<\/dt>|Recent context/u);
});

test('Private Quest preserves existing Parlant and conversation-scoped relationship authorities', () => {
  const source = projection();
  assert.match(source, /getParlantRelationshipGoal/u);
  assert.match(source, /relationshipConversationIdsByContactId/u);
  assert.match(source, /relationshipIntelligence\[conversationId\]/u);
  assert.doesNotMatch(source, /relationshipIntelligence\[stableContactId\]/u);
  assert.doesNotMatch(source, /relationshipPotential|customer_social_state|social_rule_projection|message_baseline/u);
});
