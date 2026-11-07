// Focused real-IndexedDB cancellation probe; no app, authentication or server data.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';

const args=process.argv.slice(2);assert.ok(args.length===1&&/^--run=[a-z0-9-]+$/.test(args[0]),'Expected unique --run');
const target=resolve('src/lib/recordingRescue.ts'),source=await readFile(target,'utf8'),sha256=createHash('sha256').update(source).digest('hex');
const cache=await mkdtemp(join(tmpdir(),'cortex-recording-abort-')),errors=[],blocked=[];
let app,browser,context,result,failure,cleanupVerified=false;
try{
  app=await createServer({configFile:false,cacheDir:cache,optimizeDeps:{entries:[target]},server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',plugins:[{name:'frozen-metadata-reader',enforce:'pre',load(id){return resolve(id.split('?')[0]).toLowerCase()===target.toLowerCase()?source:null;}}]});
  await app.listen();const origin='http://127.0.0.1:'+app.httpServer.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true});context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){blocked.push(url.origin);return route.abort();}if(url.pathname==='/__metadata_probe')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Synthetic IDB probe</title>'});return route.continue();});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/__metadata_probe');
  result=await page.evaluate(async()=>{
    const lib=await import('/src/lib/recordingRescue.ts'),uid='11111111-1111-4111-8111-111111111111';
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('cortex-recording-rescue',1);r.onupgradeneeded=()=>r.result.createObjectStore('recordings',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readwrite');tx.objectStore('recordings').put({id:uid,userId:uid,patientId:uid,createdAt:'2026-11-07T01:00:00Z',blob:new Blob(['SYNTHETIC AUDIO']),comments:['Synthetic'],patientName:'Synthetic'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    const open=IDBObjectStore.prototype.openCursor,close=IDBDatabase.prototype.close,active=new AbortController(),tracked=new Set();let aborted,transactionAborted=0,closed=0,finishAbort;
    const abortDone=new Promise(resolve=>{finishAbort=resolve;});
    IDBDatabase.prototype.close=function(){if(tracked.has(this))closed++;return close.call(this);};
    IDBObjectStore.prototype.openCursor=function(...args){const r=open.apply(this,args);tracked.add(this.transaction.db);this.transaction.addEventListener('abort',()=>{transactionAborted++;finishAbort();},{once:true});r.addEventListener('success',()=>active.abort(),{once:true});return r;};
    try{await lib.listRescuedRecordingMetadata(uid,active.signal);}catch(error){aborted=error.name;}
    finally{IDBObjectStore.prototype.openCursor=open;IDBDatabase.prototype.close=close;}
    await abortDone;
    const after=await lib.listRescuedRecordingMetadata(uid);return {aborted,transactionAborted,closed,preservedMetadata:after};
  });
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,50)));
  assert.equal(result.aborted,'AbortError');assert.equal(result.transactionAborted,1);assert.equal(result.closed,1);assert.equal(result.preservedMetadata.length,1);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  assert.equal(createHash('sha256').update(await readFile(target)).digest('hex'),sha256,'Reader source drift');
}catch(error){failure={name:error.name,message:error.message};}
finally{
  await context?.close();await browser?.close();await app?.close();
  assert.ok(resolve(cache).startsWith(resolve(tmpdir())+'\\')&&basename(cache).startsWith('cortex-recording-abort-')&&!(await lstat(cache)).isSymbolicLink(),'Unexpected cache target');
  await rm(cache,{recursive:true});try{await lstat(cache);}catch(error){if(error.code==='ENOENT')cleanupVerified=true;else throw error;}
}
const report={completed:!failure,source:'src/lib/recordingRescue.ts',sha256,result,errors,blocked,failure,cleanupVerified};
await writeFile(resolve('docs/reviews/2026-11-07/local-recording',args[0].slice(6)+'.json'),JSON.stringify(report,null,2),{flag:'wx'});
process.stdout.write(JSON.stringify(report)+'\n');if(failure||!cleanupVerified)process.exitCode=1;
