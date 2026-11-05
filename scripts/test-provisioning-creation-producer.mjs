import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Owned Native Auth laboratory only; no standalone target/credential input.
export async function exerciseCreationProducer({sql,fixture,begin,birth,query,ctx,clinic,red}){
 const f=fixture(),missingSession=randomUUID();
 const generation=sql(`select provisioning_authority_generation from public.clinic_members where clinic_id='${clinic}' and user_id='${ctx.sub}'`);
 const factor=sql(`select factor_id from auth.sessions where id='${ctx.session_id}'`);
 const operation=`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${f.op}','${f.id}')`;
 const intent=`insert into provision_intent_lab.intents(operation_id,planned_user_id,actor_id,session_id,clinic_id,factor_id,expires_at,membership_generation)
  values('${f.op}','${f.id}','${ctx.sub}','${missingSession}','${clinic}','${factor}',clock_timestamp()+interval '1 hour','${generation}')`;
 assert.throws(()=>begin(f,{...ctx,session_id:missingSession}),/Human intent session unavailable/);
 const service="grant usage on schema provision_identity_lab,provision_intent_lab to service_role;grant select,insert on provision_identity_lab.operations,provision_intent_lab.intents to service_role;set local role service_role;";
 if(red){
  for(const prefix of ['',service]){
   const accepted=sql(`begin;${prefix}${operation};${intent};select phase='prepared' and session_id='${missingSession}' and expires_at>clock_timestamp()+interval '30 minutes' from provision_intent_lab.intents where operation_id='${f.op}';rollback;`);
   assert.equal(accepted,'t');
  }
  return {creationProducerProofPassed:false,directPreparedRowsWithInvalidSessionAccepted:true,ownerAndTemporarilyGrantedService:true,authorizedProducerRejectedInvalidSession:true};
 }
 const checks=[],creator='set local role provision_create_writer_lab;';
 const refused=(statement,code,prefix='')=>sql(`begin;${prefix}do $$ begin begin ${statement};raise exception 'Expected creation producer refusal';exception when sqlstate '${code}' then null;end;end $$;rollback;`);
 for(const prefix of ['',service])refused(operation,'P4109',prefix);
 sql(`begin;${creator}${operation};commit;`); // parent only, explicit installer fixture
 for(const prefix of ['',service])refused(intent,'P4109',prefix);
 const replica="set local session_replication_role='replica';set local request.jwt.claim.role='provision_create_writer_lab';";
 refused(`insert into provision_identity_lab.operations(operation_id,planned_user_id) values(gen_random_uuid(),gen_random_uuid())`,'P4109',replica);
 refused(intent,'P4109',replica);
 assert.equal(sql(`select count(*) from provision_intent_lab.intents where operation_id='${f.op}'`),'0');
 checks.push('Owner/service/replica/GUC cannot INSERT operations or intents with a nonexistent session; form/binding checks still precede producer checks');

 const positive=fixture(),original=begin(positive,ctx);await birth(positive);
 assert.equal(JSON.parse(sql(`begin;set local request.jwt.claim.role='service_role';${query(positive,ctx)};commit;`)).phase,'confirmed');
 assert.deepEqual(begin(positive,ctx),{...original,phase:'confirmed'});
 const lockOnly=fixture();begin(lockOnly,ctx);
 refused(`update provision_intent_lab.intents set phase='confirmed' where operation_id='${lockOnly.op}'`,'P4107',creator);
 assert.equal(sql(`select provision_identity_lab.target_exists('${positive.id}') and not provision_identity_lab.target_exists('${missingSession}')`),'t');
 checks.push('Private creator keeps Native birth/confirmation and exact replay; UPDATE(phase) permits replay locking but cannot produce confirmation; minimal existence reader matches present/absent target');

 const controlled=fixture();
 for(const [table,trigger,write,where] of [
  ['provision_identity_lab.operations','operation_creation_producer',`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${controlled.op}','${controlled.id}')`,`operation_id='${controlled.op}' and planned_user_id='${controlled.id}'`],
  ['provision_intent_lab.intents','intent_creation_producer',intent,`operation_id='${f.op}' and session_id='${missingSession}' and expires_at>clock_timestamp()+interval '30 minutes'`],
 ]){
  assert.equal(sql(`begin;alter table ${table} disable trigger ${trigger};${write};select exists(select 1 from ${table} where ${where});rollback;`),'t');
  assert.equal(sql(`select tgenabled='A' from pg_trigger where tgrelid='${table}'::regclass and tgname='${trigger}'`),'t');
  assert.equal(sql(`select count(*) from ${table} where ${where}`),'0');
  refused(write,'P4109');
 }
 const allowedFunctions=['provision_intent_lab.begin_intent(uuid,uuid,uuid,uuid,uuid,text,bigint)',
  'provision_intent_lab.assert_context(uuid,uuid,uuid,text,bigint)','provision_membership_lab.current_generation(uuid,uuid)',
  'provision_identity_lab.acquire_reservation_keys(uuid,uuid)','provision_intent_lab.fence_current_receipt(uuid,uuid)',
  'provision_intent_lab.assert_final_deadlines(uuid,uuid,bigint,timestamptz)','provision_identity_lab.target_exists(uuid)'];
 const inserts=['operations.operation_id','operations.planned_user_id','intents.operation_id','intents.planned_user_id','intents.actor_id','intents.session_id','intents.clinic_id','intents.factor_id','intents.expires_at','intents.membership_generation'].sort();
 const columnsSql=privilege=>`select coalesce(jsonb_agg(c.relname||'.'||a.attname order by c.relname||'.'||a.attname),'[]') from pg_attribute a join pg_class c on c.oid=a.attrelid where c.oid in ('provision_identity_lab.operations'::regclass,'provision_intent_lab.intents'::regclass) and a.attnum>0 and not a.attisdropped and has_column_privilege('provision_create_writer_lab',c.oid,a.attnum,'${privilege}')`;
 const effective=privilege=>JSON.parse(sql(columnsSql(privilege)));
 assert.deepEqual(effective('insert'),inserts);assert.deepEqual(effective('update'),['intents.phase']);
 const extraInsert=JSON.parse(sql(`begin;grant insert(phase) on provision_identity_lab.operations to provision_create_writer_lab;${columnsSql('insert')};rollback;`));
 assert.deepEqual(extraInsert,[...inserts,'operations.phase'].sort());assert.deepEqual(effective('insert'),inserts);
 const functionAudit=`(select array_agg(p.oid order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('provision_intent_lab','provision_identity_lab','provision_membership_lab') and has_function_privilege('provision_create_writer_lab',p.oid,'execute'))=array(select signature::regprocedure::oid from unnest(array[${allowedFunctions.map(s=>`'${s}'`).join(',')}]) signature order by 1)`;
 assert.equal(sql('select '+functionAudit),'t');
 assert.equal(sql(`begin;grant execute on function provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean) to provision_create_writer_lab;select ${functionAudit};rollback;`),'f');assert.equal(sql('select '+functionAudit),'t');
 assert.equal(sql("select not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls from pg_roles where rolname='provision_create_writer_lab'"),'t');
 assert.equal(sql("select count(*) from pg_auth_members where roleid='provision_create_writer_lab'::regrole or member='provision_create_writer_lab'::regrole"),'0');
 assert.equal(sql("select count(*) from pg_proc where proowner='provision_create_writer_lab'::regrole"),'1');
 assert.equal(sql("select count(*) from pg_namespace where has_schema_privilege('provision_create_writer_lab',oid,'create')"),'0');
 assert.equal(sql("select has_any_column_privilege('provision_create_writer_lab','provision_identity_lab.operations','select') or has_table_privilege('provision_create_writer_lab','provision_identity_lab.operations','delete,truncate,trigger') or has_table_privilege('provision_create_writer_lab','provision_intent_lab.intents','delete,truncate,trigger')"),'f');
 for(const table of ['auth.users','auth.sessions','auth.mfa_factors'])assert.equal(sql(`select has_any_column_privilege('provision_create_writer_lab','${table}','select,insert,update,references') or has_table_privilege('provision_create_writer_lab','${table}','delete,truncate,trigger')`),'f');
 for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_function_privilege('${role}','provision_identity_lab.target_exists(uuid)','execute') or pg_has_role('${role}','provision_create_writer_lab','member')`),'f');
 checks.push('Only each disabled INSERT guard exposes the matching raw write; rollback restores refusal. Exact EXECUTE and INSERT/UPDATE column allowlists, bad-grant control and private role/Auth ACL are verified');
 return {creationProducerProofPassed:true,creationChecks:checks,creationWithoutNativeSessionDenied:true,privateCreationProducer:true,creationGuardControlsPassed:2,creationAclNegativeControlPassed:true,creationAclNegativeControlsPassed:2,installerFixtureImpersonationExplicit:true};
}
