import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { patientId,uid } from './clinic-review-api.mjs';

export async function auditRecoveryNotice({api,app,scene,capture,checks,screens,errors,blocked,localReview=false,requests=[],consoleErrors=[],errorResponses=[],failedRequests=[]}) {
  const before=structuredClone(api.displayData);
  for(const width of [375,768,1280,1920]) {
    api.recoveryNotice.reset();
    const page=await scene(app,'review','/');
    await page.clock.setFixedTime(new Date('2026-11-05T15:00:00Z'));
    const region=page.getByRole('region',{name:'Consultas para retomar'});
    await capture(page,app,'review','/',width,async()=>{
      await expect(region).toBeVisible();
      await expect(region.getByRole('button',{name:/Retomar consulta de/})).toHaveCount(3);
      for(const text of ['Processamento pendente','Aguardando revisão','Nova tentativa necessária'])await expect(region.getByText(text,{exact:true})).toBeVisible();
    },'recovery-notices');
    const origin=await page.evaluate(()=>performance.timeOrigin);
    api.recoveryNotice.setMode('unavailable');
    await region.getByRole('button',{name:'Atualizar consultas para retomar'}).click();
    await capture(page,app,'review','/',width,async()=>{
      await expect(region.getByRole('alert')).toBeVisible();
      await expect(region.getByRole('button',{name:/Retomar consulta de/})).toHaveCount(0);
    },'recovery-unavailable',{navigate:false});
    api.recoveryNotice.setMode('valid');
    await region.getByRole('button',{name:'Tentar verificar consultas'}).click();
    await capture(page,app,'review','/',width,async()=>{
      await expect(region.getByRole('button',{name:/Retomar consulta de/})).toHaveCount(3);
    },'recovery-refreshed',{navigate:false});
    assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
    api.recoveryNotice.setMode('empty');
    await region.getByRole('button',{name:'Atualizar consultas para retomar'}).click();
    await capture(page,app,'review','/',width,async()=>{
      await expect(region).toHaveCount(0);
    },'recovery-empty',{navigate:false});
    checks.push({width,unavailableRowsHidden:true,recoverySameDocument:true,emptyHidden:true});
    if([375,1920].includes(width)) {
      api.recoveryNotice.setMode('valid'); await page.goto(app.origin+'/');
      const resume=region.getByRole('button',{name:'Retomar consulta de Paciente Exemplo A',exact:true});
      await expect(resume).toBeVisible(); await resume.focus(); await resume.press('Enter');
      await capture(page,app,'review','/',width,async()=>{
        await expect(page).toHaveURL(app.origin+'/?patient='+patientId);
        await expect(page.getByText('Há uma consulta preservada para este paciente. Retome a revisão ou tente processar o áudio novamente.',{exact:true})).toBeVisible();
      },'recovery-patient',{navigate:false});
      api.recoveryNotice.makeReview(patientId);
      const mobileHome=page.getByRole('button',{name:'Início',exact:true});
      await (await mobileHome.isVisible()?mobileHome:page.getByRole('button',{name:'Haddad Nicola — Início',exact:true})).click();
      await expect(region.getByText('Aguardando revisão',{exact:true})).toHaveCount(2);
      page.once('dialog',dialog=>dialog.accept());
      await region.getByRole('button',{name:'Retomar consulta de Paciente Exemplo A',exact:true}).click();
      await capture(page,app,'review','/',width,async()=>{
        await expect(page.getByRole('dialog')).toContainText('Revisão sintética atualizada em outra aba');
        await expect(page).toHaveURL(app.origin+'/?patient='+patientId);
      },'recovery-same-patient-fresh',{navigate:false});
      checks.push({width,keyboardResumeExactPatient:true,existingRecoveryCommands:true,samePatientFreshRead:true});
    }
  }
  if(localReview)await auditLocalRecordings({api,app,scene,capture,checks});
  api.recoveryNotice.reset(); assert.deepEqual(api.displayData,before);
  assert.deepEqual(api.recoveryNotice.unexpected,[]);assert.ok(api.recoveryNotice.calls.length>=20);
  for(const key of ['workspaceWrites','patientWrites','appointmentWrites','briefings','checklists','chat'])assert.equal(api.metrics[key],0,key);
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  for(const screen of screens)assert.ok(screen.overflow<=1&&screen.dialogHorizontalOverflow<=1&&!screen.dialogOutsideViewport&&screen.dialogActionReachable!==false&&!screen.missingLabels.length&&!screen.missingButtons.length&&!screen.brokenText.length,'Recovery notice layout clipped');
  if(localReview){
    const readPosts=new Set(['/auth/v1/token',...['clinic_access','workspace_directory','list_patient_chat_turns','get_integration_status','sharing_overview','protocol_sharing_overview'].map(name=>'/rest/v1/rpc/'+name)]);
    assert.ok(requests.length>0&&requests.every(r=>r.method==='POST'?readPosts.has(r.path):['GET','HEAD'].includes(r.method)&&(r.path==='/auth/v1/user'||/^\/rest\/v1\/[a-z_]+$/.test(r.path))),'Recovery opened an unexpected API command or transport');
    assert.equal(errorResponses.length,12);assert.equal(errorResponses.filter(r=>r.path==='/rest/v1/consultation_drafts'&&r.status===503).length,8);assert.equal(errorResponses.filter(r=>r.path==='/rest/v1/patients'&&r.status===503).length,4);
    assert.equal(consoleErrors.length,12);assert.ok(consoleErrors.every(r=>/503/.test(r.message)));
    assert.ok(failedRequests.every(r=>r.method==='HEAD'&&r.path==='/rest/v1/patients'&&r.status===200&&r.reason==='net::ERR_ABORTED'),'Unexpected failed request');
    assert.equal(screens.length,42);checks.push({completeApiLedger:true,onlyReadsAndSyntheticLogin:true,noAudioTransport:true,expected503:12,observedHead200Aborts:failedRequests.length});
  }
}

async function auditLocalRecordings({api,app,scene,capture,checks}){
  for(const width of [320,375,1280,1920]){
    api.recoveryNotice.reset();
    const page=await scene(app,'review','/');
    const seed=async(extra=false)=>page.evaluate(async({uid,patientId,extra})=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('cortex-recording-rescue',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('recordings'))r.result.createObjectStore('recordings',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const base={userId:uid,patientId,patientName:'NOME_LOCAL_OBSOLETO',mimeType:'audio/webm',comments:['Comentário sintético privado'],createdAt:'2026-11-06T18:30:00Z',blob:new Blob(['SYNTHETIC LOCAL AUDIO'],{type:'audio/webm'})};
      await new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readwrite'),s=tx.objectStore('recordings');
        if(extra)s.put({...base,id:'c1000000-0000-4000-8000-000000000006'});
        else for(const row of [
          {...base,id:'c1000000-0000-4000-8000-000000000001'},
          {...base,id:'c1000000-0000-4000-8000-000000000002'},
          {...base,id:'c1000000-0000-4000-8000-000000000003',patientId:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'},
          {...base,id:'c1000000-0000-4000-8000-000000000004',userId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',patientName:'NOME_OUTRO_ATOR'},
          {...base,id:'c1000000-0000-4000-8000-000000000005',patientId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'},
        ])s.put(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
      });db.close();
    },{uid,patientId,extra});
    const snapshot=()=>page.evaluate(async()=>{
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('cortex-recording-rescue',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const rows=await new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readonly'),r=tx.objectStore('recordings').getAll();tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);});db.close();
      return Promise.all(rows.map(async r=>({...r,blob:[...new Uint8Array(await r.blob.arrayBuffer())]})));
    });
    await seed();const original=await snapshot();await page.goto(app.origin+'/');
    const region=page.getByRole('region',{name:'Áudios locais para retomar'}),open=region.getByRole('button',{name:'Abrir áudios locais de Paciente Exemplo A',exact:true});
    const take=async(variant,action)=>capture(page,app,'review','/',width,action,variant,{navigate:false,viewportOnly:true});
    await take('local-audio-notice',async()=>{
      await expect(region.getByRole('button',{name:/Abrir áudios locais de/})).toHaveCount(2);await expect(region.getByText('2 gravações neste navegador',{exact:true})).toBeVisible();
      await expect(region.getByText(/1 gravação local sem paciente disponível/)).toBeVisible();await expect(region.getByText(/NOME_LOCAL_OBSOLETO|NOME_OUTRO_ATOR|PACIENTE_COM_EXCLUSAO_SOLICITADA/)).toHaveCount(0);
      const controls=[];
      for(const button of await region.getByRole('button').all()){
        await button.scrollIntoViewIfNeeded();controls.push(await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {height:r.height,left:r.left,right:r.right,viewport:innerWidth,onTop:!!hit&&el.contains(hit)};}));
      }
      assert.ok(controls.every(c=>c.height>=44&&c.left>=-1&&c.right<=c.viewport+1&&c.onTop));checks.push({width,localControls:controls});
    });
    const origin=await page.evaluate(()=>performance.timeOrigin);
    api.recoveryNotice.setLocalMode('unavailable');await region.getByRole('button',{name:'Atualizar áudios locais'}).click();
    await take('local-audio-owner-denied',async()=>{await expect(region.getByRole('alert')).toBeVisible();await expect(region.getByRole('button',{name:/Abrir áudios locais de/})).toHaveCount(0);});
    api.recoveryNotice.setLocalMode('valid');await region.getByRole('button',{name:'Tentar verificar áudios locais'}).click();
    await take('local-audio-owner-recovered',async()=>{await expect(open).toBeVisible();await open.scrollIntoViewIfNeeded();});assert.equal(await page.evaluate(()=>performance.timeOrigin),origin);
    await open.focus();await open.press('Enter');
    await take('local-audio-patient',async()=>{
      await expect(page).toHaveURL(app.origin+'/?patient='+patientId);
      await expect(page.getByRole('status').filter({hasText:'Uma gravação desta consulta foi interrompida'})).toHaveCount(2);
    });
    const home=page.getByRole('button',{name:'Início',exact:true});await (await home.isVisible()?home:page.getByRole('button',{name:'Haddad Nicola — Início',exact:true})).click();
    await seed(true);const withExtra=await snapshot();await region.getByRole('button',{name:'Atualizar áudios locais'}).click();await expect(region.getByText('3 gravações neste navegador',{exact:true})).toBeVisible();
    page.once('dialog',d=>d.accept());await open.click();
    await take('local-audio-same-patient',async()=>{await expect(page.getByRole('status').filter({hasText:'Uma gravação desta consulta foi interrompida'})).toHaveCount(3);});
    assert.deepEqual(await snapshot(),withExtra);assert.deepEqual(withExtra.filter(r=>r.id!=='c1000000-0000-4000-8000-000000000006'),original);
    checks.push({width,localOwnershipFresh:true,localUnavailablePreserved:true,foreignActorHidden:true,storedNamesHidden:true,localBytesAndCommentsPreserved:true,samePatientRechecked:true,noProcessing:true});
    if(width===375){
      await (await home.isVisible()?home:page.getByRole('button',{name:'Haddad Nicola — Início',exact:true})).click();
      await page.evaluate(()=>{window.localOpen=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw new DOMException('Synthetic local storage unavailable','SecurityError');};});
      await region.getByRole('button',{name:'Atualizar áudios locais'}).click();await take('local-audio-storage-denied',async()=>{await expect(region.getByRole('alert')).toBeVisible();await expect(open).toHaveCount(0);});
      await page.evaluate(()=>{indexedDB.open=window.localOpen;delete window.localOpen;});await region.getByRole('button',{name:'Tentar verificar áudios locais'}).click();await expect(open).toBeVisible();
      const result=await page.evaluate(async({uid,patientId})=>{
        const lib=await import('/src/lib/recordingRescue.ts');
        const aborted=new AbortController();aborted.abort();let abortName;
        try{await lib.listRescuedRecordingMetadata(uid,aborted.signal);}catch(e){abortName=e.name;}
        const db=await new Promise(resolve=>{const r=indexedDB.open('cortex-recording-rescue',1);r.onsuccess=()=>resolve(r.result);});
        await new Promise((resolve,reject)=>{const tx=db.transaction('recordings','readwrite');for(let index=0;index<103;index++)tx.objectStore('recordings').put({id:'c2000000-0000-4000-8000-'+String(index).padStart(12,'0'),userId:uid,patientId,patientName:'NOME_LOCAL_OBSOLETO',mimeType:'audio/webm',comments:[],blob:new Blob(['SYNTHETIC BOUNDED AUDIO']),createdAt:'2026-11-07T01:00:00Z'});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
        const rows=await lib.listRescuedRecordingMetadata(uid);
        const cursorOpen=IDBObjectStore.prototype.openCursor,dbClose=IDBDatabase.prototype.close,active=new AbortController(),tracked=new Set();
        let activeAbortName,transactionAborted=0,closed=0,finishAbort;
        const abortDone=new Promise(resolve=>{finishAbort=resolve;});
        IDBDatabase.prototype.close=function(){if(tracked.has(this))closed++;return dbClose.call(this);};
        IDBObjectStore.prototype.openCursor=function(...args){const request=cursorOpen.apply(this,args);tracked.add(this.transaction.db);this.transaction.addEventListener('abort',()=>{transactionAborted++;finishAbort();},{once:true});request.addEventListener('success',()=>active.abort(),{once:true});return request;};
        try{await lib.listRescuedRecordingMetadata(uid,active.signal);}catch(e){activeAbortName=e.name;}
        finally{IDBObjectStore.prototype.openCursor=cursorOpen;IDBDatabase.prototype.close=dbClose;}
        await abortDone;
        return {abortName,rows,activeAbortName,transactionAborted,closed};
      },{uid,patientId});
      assert.equal(result.abortName,'AbortError');assert.equal(result.rows.length,51);assert.ok(result.rows.every(r=>Object.keys(r).sort().join(',')==='createdAt,id,patientId'));
      assert.equal(result.activeAbortName,'AbortError');assert.equal(result.transactionAborted,1);assert.equal(result.closed,1);
      assert.equal(result.rows[0].id,'c2000000-0000-4000-8000-000000000102');assert.equal(result.rows.at(-1).id,'c2000000-0000-4000-8000-000000000052');
      const bounded=await snapshot();await region.getByRole('button',{name:'Atualizar áudios locais'}).click();
      await take('local-audio-bounded',async()=>{await expect(region.getByText('50 gravações neste navegador',{exact:true})).toBeVisible();await expect(region.getByText(/50 gravações locais mais recentes/)).toBeVisible();});
      assert.deepEqual(await snapshot(),bounded);checks.push({localStorageFailureRetry:true,realIndexedDbMetadataOnly:true,bounded51:true,tieOrderVerified:true,abortBeforeRead:true,abortDuringCursor:true,transactionAborted:result.transactionAborted,connectionClosed:result.closed,boundedRowsPreserved:true});
    }
  }
}
