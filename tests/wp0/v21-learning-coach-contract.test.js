'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Learning Coach uses the existing Letta runtime and assistant-ui/tool-ui adapters', () => {
  for (const file of [
    'electron/learningCoachTools.js',
    'electron/lettaAgentRuntime.js',
    'integration/element-module/src/learningAssistantRuntime.ts',
    'integration/element-module/src/LearningToolUiAdapter.tsx'
  ]) assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} must exist`);

  const tools = read('electron/learningCoachTools.js');
  assert.match(tools, /propose_persona_change|propose_relationship_policy_change|propose_regression_case|propose_prompt_program_change|propose_tomorrow_journey/u);
  const ui = read('integration/element-module/src/LearningToolUiAdapter.tsx');
  assert.match(ui, /approval-card|ApprovalCard/u);
  assert.match(ui, /question-flow|QuestionFlow/u);
  assert.match(ui, /progress-tracker|ProgressTracker/u);
});
