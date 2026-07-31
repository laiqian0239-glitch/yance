'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createAuthorityHarness, tempRoot } = require('./helpers');

test('legacy SQLite is opened read-only and no marker is written into Yance27', async () => {
  const parent = tempRoot(); const currentRoot = path.join(parent,'.yance'); const legacyRoot = path.join(parent,'.yance27'); const storeDir=path.join(legacyRoot,'store'); fs.mkdirSync(storeDir,{recursive:true});
  const file=path.join(storeDir,'yance-r32.db'); const db=new DatabaseSync(file); db.exec("CREATE TABLE runtime_state(id INTEGER PRIMARY KEY,state_version INTEGER NOT NULL,operating_mode TEXT NOT NULL) STRICT; INSERT INTO runtime_state VALUES(1,1,'normal');"); db.close();
  const before=fs.statSync(file); const h=await createAuthorityHarness({parent,currentRoot,legacyRoot,initialize:false});
  try { h.migration.ensureAuthority(); const after=fs.statSync(file); assert.equal(after.size,before.size); assert.equal(Math.trunc(after.mtimeMs),Math.trunc(before.mtimeMs)); assert.equal(fs.existsSync(path.join(legacyRoot,'runtime_migration_receipt')),false); }
  finally { await h.close(); }
});
