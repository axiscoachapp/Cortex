import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';

export const overlayProfiles=Object.freeze({
 identity:'55103f3d827db3700a93322ec41c8be1b664a9ebbe8206ebf0f6f11ebc21bcd0',
 intent:'6dbe973ba8b17433271dcb311478aca5a19d933d804b8cab66807cdb66a7bb2e',
 membership:'18dc68d5726ead8159862c5350d107cf506b6ba63f7b533faf413e9c683c7250',
 composed:'e0e815355e89bc8909a2e1c5d413d19bf667aeeab07fd5d7e13d77b8eb3bc132',
 ledger:'a4f8e131a49227ac342a39d51a4a31b5ef4f86887bf835080325c036b0c90695',
 birthProducer:'bdff7696e2b8c0fd4509da01a3307208b15358ca0788e27846d1d82c0b4551d1',
 reservationKeys:'4ff80b1a738d07b70d2bde18812f50bffa28d7654a478ad6eae5f6eebdf19738',
 confirmationProducer:'cc118469765bd81a1b4eb0846e87b3dc05f06377b4a6cf03162a1bc229138941',
 creationProducer:'3e7eb9f91deb038b156c24f0cce90b47fd901d738ba4bc68e6dd512020b00d3f',
 confirmationBoundary:'89f3d888bc196d749a53d29e18af2655d0f69326c3d81b054e9b28b33ad2188b',
});
export const installLocks=Object.freeze({auth:'lock table auth.users in share row exclusive mode nowait;',membership:'lock table public.clinic_members in access exclusive mode nowait;'});
const hash=s=>createHash('sha256').update(s).digest('hex');
const keys=Object.keys(overlayProfiles);
export function composeAtomicInstall(overlays){
 assert.ok(overlays&&typeof overlays==='object'&&!Array.isArray(overlays));assert.deepEqual(Object.keys(overlays).sort(),[...keys].sort());
 const chunks=keys.map((key,index)=>{
  assert.equal(typeof overlays[key],'string');const source=overlays[key].replaceAll('\r\n','\n').trim(),lines=source.split('\n');
  const begin=lines.filter(l=>l.trim()==='begin;').length,commit=lines.filter(l=>l.trim()==='commit;').length;
  assert.equal(begin,index<2?0:1,'Unexpected transaction profile: '+key);assert.equal(commit,index<2?0:1,'Unexpected transaction profile: '+key);
  const settings=lines.filter(l=>/^\s*set transaction\b/i.test(l));assert.ok(settings.every(l=>l==='set transaction isolation level read committed;'));
  if(index>=2){assert.equal(lines.filter(l=>l.trim()&&!l.trim().startsWith('--'))[0],'begin;');assert.equal(lines.at(-1),'commit;');}
  assert.equal(hash(source),overlayProfiles[key],'Unreviewed overlay profile: '+key);
  return [key,lines.filter(l=>!['begin;','commit;','set transaction isolation level read committed;'].includes(l)).join('\n')];
 });
 const capture=`create temp table _provision_install_bodies on commit drop as select
 pg_get_functiondef('provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean)'::regprocedure) as confirmation,
 (select prosrc from pg_proc where oid='provision_intent_lab.begin_intent(uuid,uuid,uuid,uuid,uuid,text,bigint)'::regprocedure) as creation;`;
 const bodyCheck=`do $install_bodies$ declare expected record;site text:='exists(select 1 from auth.users where id=p_planned)';begin
 select * into expected from _provision_install_bodies;
 if pg_get_functiondef('provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean)'::regprocedure) is distinct from expected.confirmation then raise exception 'Confirmation body changed' using errcode='P4111';end if;
 if length(expected.creation)-length(replace(expected.creation,site,''))<>length(site)
 or (select prosrc from pg_proc where oid='provision_intent_lab.begin_intent(uuid,uuid,uuid,uuid,uuid,text,bigint)'::regprocedure) is distinct from replace(expected.creation,site,'provision_identity_lab.target_exists(p_planned)') then raise exception 'Creation body changed' using errcode='P4111';end if;
 end $install_bodies$;`;
 return ['begin;','set transaction isolation level read committed;',installLocks.auth,installLocks.membership,
  ...chunks.flatMap(([key,body])=>key==='reservationKeys'?[body,capture]:[body]),bodyCheck,'commit;'].join('\n');
}
export function installWithLateFault(source){
 assert.ok(source.endsWith('\ncommit;'));
 return source.slice(0,-'commit;'.length)+"do $install_fault$ begin raise exception 'Intentional late installation failure' using errcode='P4110';end $install_fault$;\ncommit;";
}

function catalogFingerprint(sql){
 const spaces="n.nspname in ('provision_identity_lab','provision_intent_lab','provision_membership_lab')";
 const tables=`(${spaces} or c.oid in ('auth.users'::regclass,'public.clinic_members'::regclass))`;
 return sql(`select md5(jsonb_build_object(
  'roles',(select jsonb_agg(jsonb_build_array(oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls) order by rolname) from pg_roles where rolname in ('provision_birth_writer_lab','provision_confirm_writer_lab','provision_create_writer_lab')),
  'members',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor) from pg_auth_members m where m.roleid in(select oid from pg_roles where rolname like 'provision_%_writer_lab') or m.member in(select oid from pg_roles where rolname like 'provision_%_writer_lab')),
  'schemas',(select jsonb_agg(jsonb_build_array(n.oid,n.nspname,n.nspowner,n.nspacl) order by n.nspname) from pg_namespace n where ${spaces}),
  'columns',(select jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relkind,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,a.attnum,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl,pg_get_expr(d.adbin,d.adrelid)) order by c.oid,a.attnum) from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where ${tables}),
  'functions',(select jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,pg_get_functiondef(p.oid)) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${spaces}),
  'triggers',(select jsonb_agg(jsonb_build_array(t.oid,t.tgrelid,t.tgenabled,pg_get_triggerdef(t.oid)) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and ${tables}),
  'constraints',(select jsonb_agg(jsonb_build_array(k.oid,k.conrelid,pg_get_constraintdef(k.oid)) order by k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where ${tables}),
  'indexes',(select jsonb_agg(jsonb_build_array(i.indexrelid,pg_get_indexdef(i.indexrelid)) order by i.indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where ${tables})
 )::text)`);
}
function privateRows(sql){return sql("select md5(jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o) order by operation_id) from provision_identity_lab.operations o),'intents',(select jsonb_agg(to_jsonb(i) order by operation_id) from provision_intent_lab.intents i))::text)");}
function refusal(result,code){assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp('ERROR:\\s+'+code+':'));}
function session(openSession){
 const child=openSession();let output='',errors='',closed=false;
 child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{errors+=data;});
 const done=new Promise(resolve=>child.once('close',status=>{closed=true;resolve({status,errors});}));
 return {child,done,output:()=>output,closed:()=>closed};
}
async function until(pause,read){for(let i=0;i<60;i++){const value=read();if(value)return value;await pause();}throw new Error('Installation barrier not observed');}

export async function exerciseAtomicInstallation({sql,rawSql,openSession,pause,inputs,red}){
 const overlays=Object.fromEntries(keys.map(key=>[key,inputs[key]])),source=composeAtomicInstall(overlays),late=installWithLateFault(source);
 const actor=randomUUID(),clinic=randomUUID();
 sql(`begin;insert into auth.users(id,email) values('${actor}','atomic-fixture@example.invalid');insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic installation fixture','${actor}');insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${actor}','admin','active');commit;`);
 const fixtureDigest=()=>sql(`select md5(jsonb_build_object('user',(select to_jsonb(u) from auth.users u where id='${actor}'),'clinic',(select to_jsonb(c) from public.clinics c where id='${clinic}'),'member',(select to_jsonb(m) from public.clinic_members m where clinic_id='${clinic}' and user_id='${actor}'))::text)`);
 const originalCatalog=catalogFingerprint(sql),originalFixture=fixtureDigest();
 if(red){
  for(const key of keys.slice(0,6))sql(overlays[key]);
  refusal(rawSql("do $$ begin raise exception 'Intentional late installation failure' using errcode='P4110';end $$;"),'P4110');
  assert.notEqual(catalogFingerprint(sql),originalCatalog);
  assert.equal(sql("select exists(select 1 from pg_roles where rolname='provision_birth_writer_lab') and not exists(select 1 from pg_roles where rolname in ('provision_confirm_writer_lab','provision_create_writer_lab'))"),'t');
  return {atomicInstallRedOnly:true,atomicInstallProofPassed:false,separateTransactionsLeavePartialProtocol:true,lateFailureObserved:'P4110',completedOverlays:6,remainingOverlays:4};
 }
 refusal(rawSql(late),'P4110');assert.equal(catalogFingerprint(sql),originalCatalog);assert.equal(fixtureDigest(),originalFixture);
 const checks=['Late failure after every protocol DDL rolls back schemas, roles, guards, owners/ACL and membership column, preserving the existing synthetic fixture'];
 for(const [kind,writing] of [
  ['auth',`insert into auth.users(id,email) values('${randomUUID()}','atomic-held@example.invalid') returning 1;`],
  ['membership',`update public.clinic_members set updated_at=clock_timestamp() where clinic_id='${clinic}' and user_id='${actor}' returning 1;`],
 ]){
  const holder=session(openSession);let released=false,control;
  const release=async()=>{if(!released){released=true;holder.child.stdin.end('rollback;\n');}assert.equal((await holder.done).status,0);};
  try{
   holder.child.stdin.write(`begin;${writing}select 'INSTALL_HELD='||pg_backend_pid();\n`);
   const pid=await until(pause,()=>/INSTALL_HELD=(\d+)/.exec(holder.output())?.[1]);assert.match(holder.output(),/^1$/m);
   const refused=rawSql(source);refusal(refused,'55P03');assert.match(refused.stderr,/could not obtain lock on relation/);assert.doesNotMatch(refused.stderr,/lock timeout|statement timeout/);
   assert.equal(holder.closed(),false);assert.equal(sql(`select state='idle in transaction' from pg_stat_activity where pid=${Number(pid)}`),'t');
   assert.equal(catalogFingerprint(sql),originalCatalog);assert.equal(fixtureDigest(),originalFixture);
   const lock=installLocks[kind],first=late.indexOf(lock);assert.ok(first>=0&&first<late.indexOf('create schema provision_identity_lab'));
   const blocking=late.replace(lock,lock.replace(' nowait',''));assert.notEqual(blocking,late);
   control=session(openSession);control.child.stdin.end("set statement_timeout='20s';set lock_timeout='12s';select 'INSTALL_CONTROL='||pg_backend_pid();"+blocking);
   const controlPid=await until(pause,()=>/INSTALL_CONTROL=(\d+)/.exec(control.output())?.[1]);
   const relation=kind==='auth'?'auth.users':'public.clinic_members',mode=kind==='auth'?'ShareRowExclusiveLock':'AccessExclusiveLock';
   await until(pause,()=>sql(`select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.pid=${Number(controlPid)} and a.wait_event_type='Lock' and ${Number(pid)}=any(pg_blocking_pids(a.pid)) and not l.granted and l.relation='${relation}'::regclass and l.mode='${mode}' and position('${lock.replace(' nowait','')}' in a.query)>0)`)==='t');
   await release();const result=await control.done;assert.notEqual(result.status,0);assert.match(result.errors,/ERROR:\s+P4110:/);
   assert.equal(catalogFingerprint(sql),originalCatalog);assert.equal(fixtureDigest(),originalFixture);
  }finally{await release();if(control)await control.done;}
  checks.push('Actual '+kind+' writer keeps its transaction open while installation refuses55P03; removing only its NOWAIT waits on the holder, then reaches the late failure and rolls back');
 }
 const installed=rawSql(source);assert.equal(installed.status,0,installed.stderr);
 assert.equal(sql("select count(*) from pg_roles where rolname in ('provision_birth_writer_lab','provision_confirm_writer_lab','provision_create_writer_lab')"),'3');
 return {atomicInstallProofPassed:true,atomicInstallCommitted:true,atomicInstallChecks:checks,atomicLateFailureRollbackPassed:true,atomicWriterControlsPassed:2,atomicNowaitMessagesVerified:true,atomicBodyHeaderWaitsVerified:true,atomicBodiesVerified:true};
}
export function verifyAtomicRepeat({sql,rawSql,inputs,checks}){
 const before=catalogFingerprint(sql),rows=privateRows(sql),source=composeAtomicInstall(Object.fromEntries(keys.map(key=>[key,inputs[key]])));
 refusal(rawSql(source),'42P06');assert.equal(catalogFingerprint(sql),before);assert.equal(privateRows(sql),rows);
 const all=[...checks,'Reinstallation on an existing namespace with Native protocol history is refused42P06 without changing catalog or ledger rows; no repair DROP or history adoption'];assert.equal(all.length,4);
 return {atomicInstallChecks:all,atomicRepeatWithHistoryRefused:true};
}
