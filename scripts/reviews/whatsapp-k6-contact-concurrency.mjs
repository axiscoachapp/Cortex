// Real PostgreSQL sessions in the caller's owned disposable container. No provider or network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';

const signature='public.whatsapp_automation_begin(uuid,integer,uuid,timestamptz,text,text,text,jsonb)';
const contact='e6300000-0000-4000-8000-000000000001',appointment='e6700000-0000-4000-8000-000000000003';
const admin='e6100000-0000-4000-8000-000000000001';
const oldPhone='5541999980002',newPhone='5541999970007';
const service="set local role service_role;select set_config('request.jwt.claim.role','service_role',true);";
const human=`set local role authenticated;select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claim.sub','${admin}',true);`;

export async function exerciseContactFence({docker,containerId,seed,setup}) {
  assert.match(containerId,/^[0-9a-f]{64}$/);
  const required=result=>{assert.equal(result.status,0,result.stderr||result.error?.message);return result.stdout;};
  const sql=text=>required(docker(['exec','-i',containerId,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-A','-t','--quiet'],"set statement_timeout='10s';set lock_timeout='8s';\n"+text)).trim();
  const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
  const until=async(read,label)=>{for(let n=0;n<60;n++){const value=read();if(value)return value;await pause();}throw new Error('Fixture barrier not observed: '+label);};
  const sessions=[];
  const start=()=>{
    const application='cortex-k6-contact-'+randomUUID();
    const child=spawn('docker',['--context','desktop-linux','exec','-i',containerId,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-A','-t','--quiet'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='',closed=false;
    child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
    child.on('error',error=>{err+=error.message;});child.stdin.on('error',error=>{err+=error.code??error.message;});
    const done=new Promise(resolve=>child.once('close',status=>{closed=true;resolve({status,err});}));
    const entry={application,child,done,pid:null,closed:()=>closed,out:()=>out,err:()=>err,send:text=>child.stdin.write(text+'\n')};
    sessions.push(entry);
    entry.send(`set application_name='${application}';set statement_timeout='12s';set lock_timeout='10s';select 'K6_PID='||pg_backend_pid();`);
    return entry;
  };
  const identify=async session=>{
    const pid=await until(()=>session.out().match(/^K6_PID=(\d+)$/m)?.[1]??(session.closed()?(()=>{throw new Error(session.err()||'Session closed before PID');})():null),'session PID');
    session.pid=Number(pid);assert.ok(Number.isSafeInteger(session.pid)&&session.pid>0);return session.pid;
  };
  const marker=async(session,name)=>until(()=>session.out().includes(name)||(session.closed()?(()=>{throw new Error(session.err()||'Session closed before '+name);})():false),name);
  const waitOn=async(waiter,holder)=>{
    const row=await until(()=>{
      const value=sql(`select json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'waitEvent',wait_event) from pg_stat_activity where pid=${waiter.pid} and application_name='${waiter.application}' and wait_event_type='Lock' and ${holder.pid}=any(pg_blocking_pids(pid));`);
      return value?JSON.parse(value):null;
    },'owned waiter blocked by owned holder');
    return row;
  };
  const zeroReceipts=()=>assert.equal(sql('select (select count(*) from public.whatsapp_automation_runs)+(select count(*) from public.whatsapp_messages where direction=\'out\');'),'0','K6_CONTACT_CONFLICT_CONSUMED_RECEIPT');
  const seeded=sql(seed+setup+"select 'K6_RULE='||id from rule;commit;");
  const rule=seeded.match(/^K6_RULE=([0-9a-f-]{36})$/m)?.[1];assert.match(rule??'',/^[0-9a-f-]{36}$/);
  sql(`begin;${service}insert into public.whatsapp_opt_ins(clinic_id,wa_id,source,recorded_by) values('e6200000-0000-4000-8000-000000000001','${newPhone}','recepcao','${admin}');commit;`);
  const reserve=phone=>`public.whatsapp_automation_begin('${rule}',(select revision from public.whatsapp_automations where id='${rule}'),'${appointment}',(select start_time from public.appointments where id='${appointment}'),'${phone}',null,'Synthetic','{}')`;
  const original=sql(`select pg_get_functiondef('${signature}'::regprocedure);`);
  assert.equal((original.match(/for share nowait/gi)??[]).length,1,'Expected exactly one contact NOWAIT fence');
  const catalog=()=>sql(`select md5(row(proowner,proacl,proconfig,prosecdef,prosrc)::text) from pg_proc where oid='${signature}'::regprocedure;`);
  const originalCatalog=catalog();
  const restore=()=>{sql(original);assert.equal(catalog(),originalCatalog,'Production definition/privileges were not restored in the lab');};
  const proof=[];
  let phase='hold authorized correction';
  try {
    const holder=start();await identify(holder);
    holder.send(`begin;${human}select public.reception_update_contact('${contact}',(public.reception_contact_edit('${contact}')->>'revision')::integer,'Synthetic corrected','41999970007');\n\\echo K6_CONTACT_HELD`);
    await marker(holder,'K6_CONTACT_HELD');
    await until(()=>sql(`select state='idle in transaction' from pg_stat_activity where pid=${holder.pid};`)==='t','contact edit idle in transaction');
    assert.equal(sql(`select phone_normalized from public.clinic_contacts where id='${contact}';`),oldPhone,'Uncommitted correction unexpectedly visible');
    sql(`begin;${service}do $$ declare r jsonb;begin r:=${reserve(oldPhone)};assert r is null,'K6_CONTACT_LOCK_DID_NOT_DEFER';end $$;commit;`);
    zeroReceipts();assert.equal(holder.closed(),false);
    proof.push({name:'contact_edit_defers_without_receipt',passed:true,holderIdle:true});

    // Paired waiting control: removing NOWAIT must actually reach the holder.
    phase='waiting control';
    sql(original.replace(/for share nowait/i,'for share'));
    const waiting=start();await identify(waiting);
    waiting.send(`begin;${service}select ${reserve(oldPhone)};`);
    const blocked=await waitOn(waiting,holder);
    assert.equal(sql(`select pg_cancel_backend(${waiting.pid});`),'t');
    const cancelled=await waiting.done;assert.notEqual(cancelled.status,0);assert.match(cancelled.err,/57014/);
    restore();zeroReceipts();
    proof.push({name:'waiting_control_observed',passed:true,...blocked,cancelSqlstate:'57014'});

    // Paired absent-barrier control: the old phone is reservable while the edit is uncommitted.
    phase='absent fence control';
    sql(original.replace(/for share nowait/i,''));
    sql(`begin;${service}do $$ declare r jsonb;begin r:=${reserve(oldPhone)};assert r->>'skipped'='false' and r->>'messageId' is not null,'Missing-fence control did not reserve';assert (select recipient='${oldPhone}' from public.whatsapp_messages where id=(r->>'messageId')::uuid),'Missing-fence control recipient mismatch';end $$;rollback;`);
    restore();zeroReceipts();
    proof.push({name:'absent_fence_control_reserves_old_snapshot',passed:true,rolledBack:true});

    phase='commit correction and retry fresh snapshot';
    holder.send('commit;\n\\q');assert.equal((await holder.done).status,0,holder.err());
    assert.equal(sql(`select phone_normalized from public.clinic_contacts where id='${contact}';`),newPhone);
    // A stale recipient is rejected. Roll back this refusal so the fresh attempt is independently tested.
    sql(`begin;${service}do $$ declare r jsonb;begin r:=${reserve(oldPhone)};assert r->>'skipped'='true','K6_OLD_PHONE_ACCEPTED_AFTER_CORRECTION';assert not exists(select 1 from public.whatsapp_messages where direction='out'),'K6_OLD_PHONE_MESSAGE_AFTER_CORRECTION';end $$;rollback;`);
    zeroReceipts();

    const reservation=start();await identify(reservation);
    reservation.send(`begin;${service}do $$ declare r jsonb;begin r:=${reserve(newPhone)};assert r->>'skipped'='false' and r->>'to'='${newPhone}','K6_FRESH_PHONE_NOT_RESERVED';assert (select recipient='${newPhone}' from public.whatsapp_messages where id=(r->>'messageId')::uuid),'K6_FRESH_RECIPIENT_NOT_FIXED';end $$;\n\\echo K6_RESERVATION_HELD`);
    await marker(reservation,'K6_RESERVATION_HELD');
    await until(()=>sql(`select state='idle in transaction' from pg_stat_activity where pid=${reservation.pid};`)==='t','reservation idle in transaction');
    proof.push({name:'fresh_snapshot_retry_after_commit',passed:true,separateConsentFixture:true,stalePhoneRejected:true});

    phase='reservation blocks next correction';
    const writer=start();await identify(writer);
    writer.send(`begin;${human}select public.reception_update_contact('${contact}',(public.reception_contact_edit('${contact}')->>'revision')::integer,'Synthetic corrected again','41999980002');commit;\n\\echo K6_WRITER_DONE\n\\q`);
    const writerBlocked=await waitOn(writer,reservation);
    assert.equal(sql(`select phone_normalized from public.clinic_contacts where id='${contact}';`),newPhone);
    reservation.send('commit;\n\\q');assert.equal((await reservation.done).status,0,reservation.err());
    assert.equal((await writer.done).status,0,writer.err());assert.ok(writer.out().includes('K6_WRITER_DONE'));
    assert.equal(sql(`select phone_normalized from public.clinic_contacts where id='${contact}';`),oldPhone);
    assert.equal(sql(`select count(*) from public.whatsapp_messages where direction='out' and recipient='${newPhone}';`),'1');
    assert.equal(sql('select count(*) from public.whatsapp_automation_runs;'),'1');
    proof.push({name:'reservation_snapshot_blocks_contact_correction_until_commit',passed:true,...writerBlocked,postCommitEditAllowed:true});
    assert.equal(catalog(),originalCatalog);
    return proof.map(item=>({...item,definitionRestored:true,definitionSha256:createHash('sha256').update(original).digest('hex')}));
  } catch(error) {
    error.message='Contact probe ('+phase+'): '+error.message;
    error.contactProof=proof;
    throw error;
  } finally {
    for(const session of sessions)if(!session.closed()) {
      if(session.pid)sql(`select pg_terminate_backend(${session.pid}) where exists(select 1 from pg_stat_activity where pid=${session.pid} and application_name='${session.application}');`);
      session.child.stdin.end();await session.done;
    }
    restore();
  }
}
