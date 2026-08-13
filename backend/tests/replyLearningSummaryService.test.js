'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('workspace exposes Learning V4 evidence status without a legacy summary authority',()=>{const root=path.resolve(__dirname,'..','..');const source=fs.readFileSync(path.join(root,'backend/services/workspaceService.js'),'utf8');assert.equal(source.includes('Learning V4 evidence/proposal/evaluation'),true);assert.doesNotMatch(source,/replyLearningSummaryService/u);assert.equal(source.includes('automaticProfileMutation: false'),true);});
