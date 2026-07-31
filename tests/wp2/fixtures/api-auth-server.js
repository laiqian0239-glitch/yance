'use strict';
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const {DatabaseSync}=require('node:sqlite');
const {createR32LocalApiSecurity}=require('../../../backend/middleware/r32LocalApiSecurity');const {authorizeWebSocketRequest,getApiSessionAuthStats}=require('../../../backend/security/apiSessionAuth');const {getDesktopStartupContext}=require('../../../backend/bootstrap/desktopStartupContext');
function produceRuntimeOutputs(){const root=String(process.env.WP2_RUNTIME_OUTPUT_DIR||'').trim();if(!root)return null;const files={
 'logs/backend.log':JSON.stringify({event:'api-auth-runtime-started',pid:process.pid}),
 'diagnostics/auth-session.json':JSON.stringify({authenticationSource:'desktop-startup-context',pid:process.pid,status:'active'}),
 'electron-store/store.json':JSON.stringify({desktop:{closeToTray:true}}),
 'localStorage/000.log':'desktop-ui-bootstrap-complete',
 'IndexedDB/000.log':'desktop-ui-cache-opened',
 'crash/metadata.json':JSON.stringify({lastCrash:null,pid:process.pid})
};for(const [rel,value] of Object.entries(files)){const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
 const dbFile=path.join(root,'store','yance.db');fs.mkdirSync(path.dirname(dbFile),{recursive:true});const db=new DatabaseSync(dbFile);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runtime_probe(event TEXT, pid INTEGER);');db.prepare('INSERT INTO runtime_probe(event,pid) VALUES(?,?)').run('api-auth-started',process.pid);return db;}
const runtimeDb=produceRuntimeOutputs();const security=createR32LocalApiSecurity({allowedOrigins:[]});
const server=http.createServer((req,res)=>{req.path=new URL(req.url,'http://127.0.0.1').pathname;req.ip=req.socket.remoteAddress;res.status=code=>{res.statusCode=code;return res;};res.json=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};security(req,res,()=>res.json({ok:true,ready:true,pid:process.pid,startupNonce:getDesktopStartupContext().startupNonce,authModule:getApiSessionAuthStats()}));});
server.on('upgrade',(req,socket)=>{if(!authorizeWebSocketRequest(req)){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nX-Yance-Api-Session-Auth: apiSessionAuth\r\n\r\n');});
server.listen(0,'127.0.0.1',()=>{const context=getDesktopStartupContext();if(process.send)process.send({type:'api-auth-ready',port:server.address().port,pid:process.pid,argvContainsToken:process.argv.includes(context.apiSessionToken),environmentContainsToken:Object.values(process.env).includes(context.apiSessionToken)});});
process.on('SIGTERM',()=>server.close(()=>{try{runtimeDb?.close();}catch{}process.exit(0);}));
