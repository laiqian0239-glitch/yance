'use strict';
const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');const {DatabaseSync}=require('node:sqlite');
function derived(value){return crypto
  .createHash(
    'sha256'
  )
  .update(value)
  .digest('hex');}
function mutate(root,secret){const value=secret;const passThrough=input=>input;const digest=derived(passThrough(value));const values={
 'logs/backend.log':`auth fingerprint ${digest}`,
 'diagnostics/session.json':JSON.stringify({sessionFingerprint:digest}),
 'crash/error.json':JSON.stringify({metadata:{authDigest:digest}}),
 'electron-store/store.json':JSON.stringify({helper:{fingerprint:digest}}),
 'localStorage/000.log':digest,
 'IndexedDB/000.log':digest
};for(const [rel,value] of Object.entries(values)){const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
 const dbFile=path.join(root,'store','yance.db');fs.mkdirSync(path.dirname(dbFile),{recursive:true});const db=new DatabaseSync(dbFile);db.exec('CREATE TABLE IF NOT EXISTS mutation(value TEXT)');db.prepare('INSERT INTO mutation(value) VALUES(?)').run(digest);db.close();return digest;}
module.exports={mutate};
