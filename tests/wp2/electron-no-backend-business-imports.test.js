'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');const ROOT=path.resolve(__dirname,'../..');
function walk(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...walk(f));else if(/\.(?:js|cjs|mjs)$/.test(e.name))out.push(f);}return out;}
test('Electron source has no direct, dynamic, aliased, shared, or duplicate business runtime imports',()=>{
 const violations=[];const files=walk(path.join(ROOT,'electron'));
 for(const file of files){const text=fs.readFileSync(file,'utf8');const rel=path.relative(ROOT,file).replaceAll(path.sep,'/');
  const importPatterns=[/require\s*\(\s*[^)]*backend\/(?:core|services|repositories|routes|store)/g,/import\s+[^;]*from\s*['"][^'"]*backend\//g,/require\s*\(\s*['"][^'"]*shared\/core\/(?:lifecycleManager|contracts|errors)['"]\s*\)/g,/\brequire\s*\(\s*[A-Za-z_$][\w$]*\s*\)/g];
  for(const pattern of importPatterns)if(pattern.test(text))violations.push({file:rel,pattern:String(pattern)});
  if(/class\s+(?:CoreRuntime|AccountContext|SecurityGuard|LifecycleManager)\b/.test(text))violations.push({file:rel,pattern:'duplicate-business-class'});
 }
 assert.deepEqual(violations,[]);
});
