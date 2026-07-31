'use strict';
const crypto=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
function encodings(secret){const raw=Buffer.from(String(secret),'utf8');const digest=crypto.createHash('sha256').update(raw).digest();return[
 ['plaintext',raw],['token-hex',Buffer.from(raw.toString('hex'),'ascii')],['token-base64',Buffer.from(raw.toString('base64'),'ascii')],
 ['sha256-hex',Buffer.from(digest.toString('hex'),'ascii')],['sha256-base64',Buffer.from(digest.toString('base64'),'ascii')]
];}
function walk(root){const out=[];if(!fs.existsSync(root))return out;for(const e of fs.readdirSync(root,{withFileTypes:true})){const f=path.join(root,e.name);if(e.isDirectory())out.push(...walk(f));else out.push(f);}return out;}
function scanBuffers(secret,surfaces){const needles=encodings(secret);const findings=[];for(const surface of surfaces){const bytes=Buffer.isBuffer(surface.bytes)?surface.bytes:Buffer.from(String(surface.bytes||''));for(const [encoding,needle] of needles){if(needle.length&&bytes.indexOf(needle)>=0)findings.push({surface:surface.name,encoding});}}return findings;}
function scanFiles(secret,root){return scanBuffers(secret,walk(root).map(file=>({name:path.relative(root,file).replaceAll(path.sep,'/'),bytes:fs.readFileSync(file)})));}
function assertNoTokenLeaks(secret,surfaces){const findings=scanBuffers(secret,surfaces);if(findings.length){const reasonCode='WP2_API_SESSION_SECRET_LEAK_DETECTED';const error=new Error(`${reasonCode}: API session secret or correlatable encoding leaked to a persistence surface`);error.reasonCode=reasonCode;error.code=reasonCode;error.findings=findings;throw error;}return{status:'PASS',findingCount:0,scannedSurfaceCount:surfaces.length};}
module.exports={encodings,walk,scanBuffers,scanFiles,assertNoTokenLeaks};
