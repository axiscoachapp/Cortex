import assert from 'node:assert/strict';

// Invoked only by the owned Native laboratory, no standalone DB URL.
export async function exerciseConfirmationProducer({sql,fixture,begin,birth,query,ctx,red}){
 const f=fixture();begin(f,ctx);
 assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),'0');
 assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`),'f');
 const statement=`update provision_intent_lab.intents set phase='confirmed' where operation_id='${f.op}'`;
 const service="grant usage on schema provision_intent_lab to service_role;grant select,update(phase) on provision_intent_lab.intents to service_role;set local role service_role;";
 const refused=(text,code,prefix='')=>sql(`begin;${prefix}do $$ begin begin ${text};raise exception 'Expected confirmation producer refusal';exception when sqlstate '${code}' then null;end;end $$;rollback;`);
 // A genuine context is insufficient without the current target receipt.
 refused(`perform ${query(f,ctx).slice(7)}`,'40001',"set local request.jwt.claim.role='service_role';");
 if(red){
  for(const prefix of ['',service])assert.equal(sql(`begin;${prefix}${statement};select phase from provision_intent_lab.intents where operation_id='${f.op}';rollback;`),'confirmed');
  return {confirmationProducerProofPassed:false,directConfirmationWithoutIdentityOrReceiptAccepted:true,ownerAndTemporarilyGrantedService:true,authorizedProcedureRefused:'40001'};
 }
 const checks=[];
 for(const prefix of ['',service]){
  refused(statement,'P4107',prefix);
  sql(`begin;${prefix}update provision_intent_lab.intents set phase=phase where operation_id='${f.op}';rollback;`);
 }
 refused(statement,'P4107',"set local session_replication_role='replica';set local request.jwt.claim.role='provision_confirm_writer_lab';");
 assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),'prepared');
 const nullWrite=`update provision_intent_lab.intents set phase=null where operation_id='${f.op}'`;
 refused(nullWrite,'P4108','set local role provision_confirm_writer_lab;');
 const guard="select pg_get_functiondef('provision_intent_lab.guard_confirmation_producer()'::regprocedure)",definition=sql(guard);
 const site="old.phase is distinct from 'prepared' or new.phase is distinct from 'confirmed'";assert.equal(definition.split(site).length,2);
 refused(nullWrite,'23502',definition.replace(site,"old.phase<>'prepared' or new.phase<>'confirmed'")+";set local role provision_confirm_writer_lab;");
 assert.equal(sql(guard),definition,'Null-sequence mutation did not roll back');
 refused(nullWrite,'P4108','set local role provision_confirm_writer_lab;');
 checks.push('Owner/service direct confirmation without a target receipt is denied; no-op remains valid and ALWAYS ignores replica/GUC role spoofing');

 const deadline=begin(f,ctx).expires_at;await birth(f);
 const confirmed=JSON.parse(sql(`begin;set local request.jwt.claim.role='service_role';${query(f,ctx)};commit;`));
 assert.equal(confirmed.phase,'confirmed');assert.equal(confirmed.operation_id,f.op);assert.equal(begin(f,ctx).expires_at,deadline);
 refused(`update provision_intent_lab.intents set phase='prepared' where operation_id='${f.op}'`,'P4108','set local role provision_confirm_writer_lab;');
 checks.push('Private producer confirms a legitimate Native birth through unchanged checks; replay keeps the deadline and even the producer cannot regress the phase');

 assert.equal(sql("select not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls from pg_roles where rolname='provision_confirm_writer_lab'"),'t');
 assert.equal(sql("select count(*) from pg_auth_members where roleid='provision_confirm_writer_lab'::regrole or member='provision_confirm_writer_lab'::regrole"),'0');
 assert.equal(sql("select count(*) from pg_proc where proowner='provision_confirm_writer_lab'::regrole"),'1');
 assert.equal(sql("select proowner='provision_confirm_writer_lab'::regrole from pg_proc where oid='provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean)'::regprocedure"),'t');
 assert.equal(sql("select count(*) from pg_namespace where has_schema_privilege('provision_confirm_writer_lab',oid,'create')"),'0');
 for(const table of ['auth.users','auth.sessions','auth.mfa_factors'])assert.equal(sql(`select has_any_column_privilege('provision_confirm_writer_lab','${table}','select,insert,update,references') or has_table_privilege('provision_confirm_writer_lab','${table}','delete,truncate,trigger')`),'f');
 assert.equal(sql("select has_table_privilege('provision_confirm_writer_lab','provision_intent_lab.intents','insert,delete,truncate,trigger') or has_any_column_privilege('provision_confirm_writer_lab','provision_identity_lab.operations','select,insert,update')"),'f');
 for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_function_privilege('${role}','provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean)','execute') or pg_has_role('${role}','provision_confirm_writer_lab','member')`),'f');
 const allowedFunctions=['provision_intent_lab.check_intent(uuid,uuid,uuid,uuid,text,bigint,boolean)',
  'provision_intent_lab.assert_context(uuid,uuid,uuid,text,bigint)','provision_membership_lab.current_generation(uuid,uuid)',
  'provision_identity_lab.acquire_reservation_keys(uuid,uuid)','provision_intent_lab.fence_current_receipt(uuid,uuid,boolean)',
  'provision_intent_lab.assert_final_deadlines(uuid,uuid,bigint,timestamptz)'];
 const acl=`(select array_agg(p.oid order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('provision_intent_lab','provision_identity_lab','provision_membership_lab') and has_function_privilege('provision_confirm_writer_lab',p.oid,'execute'))
  =array(select signature::regprocedure::oid from unnest(array[${allowedFunctions.map(s=>`'${s}'`).join(',')}]) signature order by 1)
  and (select count(*) from pg_attribute a where a.attrelid in ('provision_intent_lab.intents'::regclass,'provision_identity_lab.operations'::regclass)
   and a.attnum>0 and not a.attisdropped and has_column_privilege('provision_confirm_writer_lab',a.attrelid,a.attnum,'update'))=1
  and has_column_privilege('provision_confirm_writer_lab','provision_intent_lab.intents','phase','update')`;
 assert.equal(sql('select '+acl),'t');
 for(const grant of [
  'grant execute on function provision_intent_lab.begin_intent(uuid,uuid,uuid,uuid,uuid,text,bigint) to provision_confirm_writer_lab',
  'grant update(expires_at) on provision_intent_lab.intents to provision_confirm_writer_lab',
 ]){assert.equal(sql(`begin;${grant};select ${acl};rollback;`),'f');assert.equal(sql('select '+acl),'t');}
 const control=fixture();begin(control,ctx);
 const write=`update provision_intent_lab.intents set phase='confirmed' where operation_id='${control.op}'`;
 assert.equal(sql(`begin;alter table provision_intent_lab.intents disable trigger intent_confirmation_producer;${write};select phase from provision_intent_lab.intents where operation_id='${control.op}';rollback;`),'confirmed');
 assert.equal(sql("select tgenabled='A' from pg_trigger where tgrelid='provision_intent_lab.intents'::regclass and tgname='intent_confirmation_producer'"),'t');
 refused(write,'P4107');
 checks.push('Producer has one owned function and exact EXECUTE/UPDATE allowlist; bad function/column grants are detected and rolled back; guard-removal control restores the forgery and rollback restores refusal');
 return {confirmationProducerProofPassed:true,confirmationChecks:checks,confirmationWithoutReceiptDenied:true,confirmationNoopPreserved:true,privateConfirmationProducer:true,confirmationGuardControlPassed:true,confirmationAclNegativeControlsPassed:2,confirmationNullSequenceControlPassed:true};
}
