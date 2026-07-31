'use strict';
const assert=require('node:assert/strict'); const test=require('node:test'); const fs=require('node:fs'); const path=require('node:path');
test('production source has no fallback from authority failure to legacy mode',()=>{
  const server=fs.readFileSync(path.resolve(__dirname,'../../backend/server.js'),'utf8');
  const boot=fs.readFileSync(path.resolve(__dirname,'../../backend/runtime/BootCoordinator.js'),'utf8');
  assert.equal(server.includes('process.env.YANCE_SAFE_MODE'),false);
  assert.equal(server.includes('safeModeService.enter'),false);
  assert.equal(boot.includes('safe-mode-state.json'),false);
  assert.equal(boot.includes('YANCE_SAFE_MODE'),false);
  assert.equal(boot.includes('desktopSettings'),false);
});
