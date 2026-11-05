import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';

// Native Auth owns these objects. Omit only the exact mock statements.
export function nativeApplicationBootstrap(source){
 const legacyMfa='CREATE TABLE auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id) on delete cascade,status text,factor_type text);';
 const fixtureStatements=[
  "CREATE TYPE auth.aal_level AS ENUM ('aal1','aal2','aal3');",
  "CREATE TYPE auth.factor_status AS ENUM ('unverified','verified');",
  "CREATE TYPE auth.factor_type AS ENUM ('totp','webauthn','phone');",
  'CREATE TABLE auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,status auth.factor_status not null,factor_type auth.factor_type not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());',
  'CREATE TABLE auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz,updated_at timestamptz,factor_id uuid,aal auth.aal_level,not_after timestamptz,refreshed_at timestamp without time zone);',
  'ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;',
  'ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;',
 ];
 const lines=source.split(/\r?\n/),legacy=lines.includes(legacyMfa);
 assert.ok(!legacy||!fixtureStatements.some(s=>lines.includes(s)),'Mixed Auth bootstrap profiles');
 const omitted=[
  'CREATE ROLE anon NOLOGIN;','CREATE ROLE authenticated NOLOGIN;','CREATE ROLE service_role NOLOGIN BYPASSRLS;','CREATE SCHEMA auth;',
  "CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz DEFAULT now(), raw_app_meta_data jsonb NOT NULL DEFAULT '{}');",
  "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;",
  "CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;",
  "CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;",
  ...(legacy?[legacyMfa]:fixtureStatements),
 ];
 for(const statement of omitted)assert.equal(lines.filter(l=>l===statement).length,1,'Unexpected mock bootstrap shape');
 const broad='GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,storage TO anon,authenticated,service_role;';assert.equal(lines.filter(l=>l===broad).length,1);
 return lines.filter(l=>!omitted.includes(l)).map(l=>l===broad
  ? 'GRANT EXECUTE ON FUNCTION auth.uid(),auth.role(),auth.jwt() TO anon,authenticated,service_role;\nGRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO anon,authenticated,service_role;':l).join('\n');
}
// Only the columns required by the agreed session/factor interface. This is
// deliberately not a copy of the full Native Auth schema or its defaults.
export function assertAuthFixtureProjection(sql){
 const definitions={mfa_factors:{id:['uuid',false],user_id:['uuid',false],status:['auth.factor_status',false],factor_type:['auth.factor_type',false],created_at:['timestamp with time zone',false],updated_at:['timestamp with time zone',false]},
  sessions:{id:['uuid',false],user_id:['uuid',false],aal:['auth.aal_level',true],factor_id:['uuid',true],not_after:['timestamp with time zone',true],created_at:['timestamp with time zone',true],updated_at:['timestamp with time zone',true],refreshed_at:['timestamp without time zone',true]}};
 const expected=Object.entries(definitions).flatMap(([table,cols])=>Object.entries(cols).map(([column,[type,nullable]])=>({table,column,type,nullable})))
  .sort((a,b)=>(a.table+'.'+a.column).localeCompare(b.table+'.'+b.column));
 const filter=Object.entries(definitions).map(([table,cols])=>`(c.relname='${table}' and a.attname in (${Object.keys(cols).map(c=>`'${c}'`).join(',')}))`).join(' or ');
 const actual=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'nullable',not a.attnotnull) order by c.relname,a.attname) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname='auth' and (${filter})`));
 assert.deepEqual(actual,expected,'Auth session/factor fixture projection differs');
 return actual;
}
export function installClinicSchema({sql,inputs,red}){
 const columnsQuery=`select md5(string_agg(c.relname||':'||c.relowner::text||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||a.attnum::text||':'||a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,''),'|' order by c.relname,a.attnum)) from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname='auth' and c.relname in ('users','sessions','mfa_factors')`;
 const columns=()=>sql(columnsQuery);
 const clientReadsQuery="select bool_and(not has_table_privilege(r,t,'select') and not has_any_column_privilege(r,t,'select')) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['auth.users','auth.sessions','auth.mfa_factors']) t";
 const enums=()=>sql("select md5(string_agg(t.typname||':'||t.typowner::text||':'||coalesce(t.typacl::text,'')||':'||e.enumlabel,'|' order by t.typname,e.enumsortorder)) from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='auth' and t.typname in ('aal_level','factor_status','factor_type')");
 const functions=()=>sql("select md5(string_agg(p.proowner::text||pg_get_functiondef(p.oid),'|' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname in ('uid','role','jwt','email')");
 const beforeColumns=columns(),beforeFunctions=functions(),beforeEnums=enums();
 const projection=inputs.sessionFixture?assertAuthFixtureProjection(sql):undefined;
 const bootstrap=nativeApplicationBootstrap(inputs.bootstrap);sql(bootstrap);
 for(const {path,source} of inputs.migrations){try{sql(source);}catch(error){throw new Error('Application snapshot install failed at '+path,{cause:error});}}
 sql(inputs.identity);sql(inputs.intent);sql(inputs.membership);
 if(!red)sql(inputs.composed);
 if(inputs.ledger)sql(inputs.ledger);
 assert.equal(columns(),beforeColumns,'Native Auth core columns/owners/table or column ACL/RLS flags changed');assert.equal(functions(),beforeFunctions,'Native identity helper definition or owner changed');
 assert.equal(enums(),beforeEnums,'Native Auth enum definition/owner/ACL changed');
 assert.equal(sql(clientReadsQuery),'t','Native Auth table or column became readable by a client role');
 // A temporary column grant must trip both checks even though PostgreSQL's
 // table-wide SELECT predicate stays false. Roll back before any Auth traffic.
 const control=sql(`begin;do $acl$ declare original text;begin
 original:=(${columnsQuery});
 grant select(id) on auth.sessions to service_role;
 assert not has_table_privilege('service_role','auth.sessions','select');
 assert has_any_column_privilege('service_role','auth.sessions','select');
 assert (${clientReadsQuery}) is false;
 assert (${columnsQuery}) is distinct from original;
 end $acl$;set local role service_role;select count(id) from auth.sessions;reset role;rollback;`);
 assert.match(control,/^\d+$/,'Column grant did not permit the expected synthetic count');
 assert.equal(columns(),beforeColumns,'Column ACL control did not roll back');assert.equal(sql(clientReadsQuery),'t');
 return {sourceBaseline:inputs.baseline,migrations:inputs.migrations.length,nativeCoreColumnsOwnersAndTableAclUnchanged:true,nativeIdentityHelpersUnchanged:true,
  nativeTablesUnavailableToClientRoles:true,nativeColumnAclUnchanged:true,nativeColumnAclControlPassed:true,nativeEnumsOwnersAndAclUnchanged:true,nativeTableRlsFlagsUnchanged:true,ledgerBindingsInstalled:!!inputs.ledger,
  ...(inputs.sessionFixture?{fixtureProjectionVerified:true,fixtureProjection:projection,bootstrapOverlaySha256:createHash('sha256').update(inputs.bootstrap).digest('hex')}:{}),
  sqlSourceDigest:createHash('sha256').update([bootstrap,...inputs.migrations.map(m=>m.source)].join('\n')).digest('hex')};
}

export async function exerciseProvisioningClinicAuthority({auth,rest,adminJwt,version,call,sql,syntheticSecrets,preparation,red,ledger,asyncHttp,pause,holderSession,restartAuth}){
 const password=randomBytes(24).toString('hex');syntheticSecrets.push(password);
 const created=await call(auth,'/admin/users',adminJwt,{email:'clinic-authority@example.invalid',password,email_confirm:true});assert.equal(created.status,200);
 const login=await call(auth,'/token?grant_type=password',adminJwt,{email:'clinic-authority@example.invalid',password});assert.equal(login.status,200);
 syntheticSecrets.push(login.body.access_token,login.body.refresh_token);
 const context=async token=>{
  const user=await call(auth,'/user',token);assert.equal(user.status,200);
  const c=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
  assert.equal(c.sub,user.body.id);assert.equal(c.role,'authenticated');assert.ok(['aal1','aal2'].includes(c.aal)&&Number.isSafeInteger(c.exp));
  for(const id of [c.sub,c.session_id])assert.match(id,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  return {...c,token};
 };
 const aal1=await context(login.body.access_token);
 const factor=await call(auth,'/factors',login.body.access_token,{factor_type:'totp',friendly_name:'Synthetic clinic authority'});assert.equal(factor.status,200);syntheticSecrets.push(factor.body.totp.secret);
 assert.match(factor.body.id,/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
 const code=()=>{
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of factor.body.totp.secret.replace(/=+$/,''))bits+=alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5,'0');
  const key=Buffer.from(bits.match(/.{8}/g).map(p=>parseInt(p,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
  const digest=createHmac('sha1',key).update(counter).digest(),offset=digest[19]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
 };
 const upgrade=async token=>{
  const challenge=await call(auth,'/factors/'+factor.body.id+'/challenge',token,{});assert.equal(challenge.status,200);
  const upgraded=await call(auth,'/factors/'+factor.body.id+'/verify',token,{challenge_id:challenge.body.id,code:code()});assert.equal(upgraded.status,200);
  syntheticSecrets.push(upgraded.body.access_token,upgraded.body.refresh_token);const c=await context(upgraded.body.access_token);assert.equal(c.aal,'aal2');return c;
 };
 const fresh=async()=>{const l=await call(auth,'/token?grant_type=password',adminJwt,{email:'clinic-authority@example.invalid',password});assert.equal(l.status,200);syntheticSecrets.push(l.body.access_token,l.body.refresh_token);return upgrade(l.body.access_token);};
 const ctx=await upgrade(login.body.access_token);
 const clinicCreated=await call(rest,'/rpc/create_clinic',ctx.token,{p_name:'Synthetic native clinic'});assert.equal(clinicCreated.status,200);
 const clinic=clinicCreated.body;assert.match(clinic,/^[0-9a-f-]{36}$/);
 sql(`insert into provision_intent_lab.members values('${clinic}','${ctx.sub}','admin','active');`);
 const trusted=q=>sql(`begin;set local request.jwt.claim.role='service_role';${q};commit;`);
 const generation=()=>trusted(`select provision_membership_lab.current_generation('${clinic}','${ctx.sub}')`);
 const args=c=>`'${c.sub}','${c.session_id}','${clinic}','${c.aal}',${c.exp}`;
 const fixture=()=>({op:randomUUID(),id:randomUUID(),email:'clinic-target-'+randomUUID()+'@example.invalid'});
 const begin=(f,c)=>JSON.parse(trusted(`select provision_intent_lab.begin_intent('${f.op}','${f.id}',${args(c)})`));
 const query=(f,c,finish=true)=>`select provision_intent_lab.check_intent('${f.op}',${args(c)},${finish})`;
 const refused=(q,code='42501')=>trusted(`do $$ begin begin perform ${q.slice(7)};raise exception 'Expected composed intent refusal';exception when sqlstate '${code}' then null;end;end $$`);
 const birth=async f=>{const r=await call(auth,'/admin/users',adminJwt,{id:f.id,email:f.email,email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:f.op,cortex_provision_revision:1}});assert.equal(r.status,200);assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`),'t');};
 const live=async c=>{assert.equal((await call(auth,'/user',c.token)).status,200);assert.equal(sql(`select count(*) from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id and f.user_id=s.user_id where s.id='${c.session_id}' and s.user_id='${c.sub}' and f.id='${factor.body.id}' and f.status='verified'`),'1');};
 const where=`clinic_id='${clinic}' and user_id='${ctx.sub}'`;
 const report={syntheticOnly:true,labOnly:true,authVersion:version,...preparation,nativeTotpAal2:true,clinicCreatedByAuthenticatedDataApi:true,productionAuthorizationImplemented:false};
 if(red){
  const originalGeneration=generation(),f=fixture();begin(f,ctx);await birth(f);
  sql(`begin;update public.clinic_members set role='doctor' where ${where};update public.clinic_members set role='admin' where ${where};commit;`);
  assert.notEqual(generation(),originalGeneration);await live(ctx);
  const outcome=JSON.parse(trusted(query(f,ctx)));
  return {...report,realGenerationChanged:true,sameNativeSessionAndFactorStillLive:true,nativeBirthReceipt:true,fixtureOnlyCandidateAccepted:outcome.phase==='confirmed',compositionProofPassed:false};
 }
 const checks=['Native Auth schema/helpers preserved; real TOTP/AAL2 actor creates the real clinic through authenticated Data API'];
 const deniedAal1=fixture();refused(`select provision_intent_lab.begin_intent('${deniedAal1.op}','${deniedAal1.id}',${args(aal1)})`);
 checks.push('Captured AAL1 context cannot reserve a real-clinic intent after account factor verification');
 const positive=fixture(),initial=begin(positive,ctx);assert.equal(initial.membership_generation,generation());await birth(positive);
 assert.equal(JSON.parse(trusted(query(positive,ctx))).phase,'confirmed');assert.equal(begin(positive,ctx).expires_at,initial.expires_at);
 checks.push('Native birth receipt and original real membership generation confirm; exact replay keeps identity and deadline');
 if(ledger){
  const intentWhere=`operation_id='${positive.op}'`,opWhere=intentWhere;
  const temporaryWriter="grant usage on schema provision_identity_lab,provision_intent_lab to service_role;grant select,insert,update,delete,truncate on provision_identity_lab.operations,provision_intent_lab.intents to service_role;set local role service_role;";
  const expectWrite=(statement,code,service=false,replica=false)=>sql(`begin;${replica?"set local session_replication_role='replica';":''}${service?temporaryWriter:''}do $$ begin begin ${statement};raise exception 'Expected ledger refusal';exception when sqlstate '${code}' then null;end;end $$;rollback;`);
  const intentChanges=['operation_id=gen_random_uuid()','planned_user_id=gen_random_uuid()','actor_id=gen_random_uuid()','clinic_id=gen_random_uuid()','session_id=gen_random_uuid()','factor_id=gen_random_uuid()',"expires_at=expires_at+interval '1 hour'",'membership_generation=gen_random_uuid()'];
  for(const service of [false,true]){
   for(const change of intentChanges)expectWrite(`update provision_intent_lab.intents set ${change} where ${intentWhere}`,'P4101',service);
   for(const change of ['operation_id=gen_random_uuid()','planned_user_id=gen_random_uuid()','revision=revision+1','birth_transaction=null','birth_transaction=pg_current_xact_id()'])expectWrite(`update provision_identity_lab.operations set ${change} where ${opWhere}`,'P4101',service);
   sql(`begin;${service?temporaryWriter:''}update provision_intent_lab.intents set phase=phase,expires_at=expires_at where ${intentWhere};update provision_identity_lab.operations set phase=phase,revision=revision where ${opWhere};rollback;`);
  }
  checks.push('Owner and temporarily granted service writers cannot replace any captured intent binding or identity/XID; no-op writes remain valid');
  for(const service of [false,true]){
   expectWrite(`insert into provision_identity_lab.operations(operation_id,planned_user_id,phase,birth_transaction) values(gen_random_uuid(),gen_random_uuid(),'auth_created',pg_current_xact_id())`,'P4103',service);
   expectWrite(`insert into provision_intent_lab.intents select (jsonb_populate_record(null::provision_intent_lab.intents,to_jsonb(i)||jsonb_build_object('operation_id',gen_random_uuid(),'planned_user_id',gen_random_uuid(),'phase','confirmed'))).* from provision_intent_lab.intents i where ${intentWhere}`,'P4103',service);
   const reservedOp=randomUUID(),reservedId=randomUUID(),wrongId=randomUUID();
   expectWrite(`insert into provision_identity_lab.operations(operation_id,planned_user_id) values('${reservedOp}','${reservedId}');insert into provision_intent_lab.intents select (jsonb_populate_record(null::provision_intent_lab.intents,to_jsonb(i)||jsonb_build_object('operation_id','${reservedOp}','planned_user_id','${wrongId}','phase','prepared'))).* from provision_intent_lab.intents i where ${intentWhere}`,'P4104',service);
  }
  checks.push('Direct INSERT cannot start with a confirmed intent/birth receipt or attach an intent to a different reserved UUID');
  for(const service of [false,true])for(const table of ['provision_intent_lab.intents','provision_identity_lab.operations']){
   expectWrite(`delete from ${table} where ${intentWhere}`,'P4102',service);
   expectWrite(`truncate ${table} cascade`,'P4102',service);
  }
  checks.push('Owner and temporarily granted service DELETE/TRUNCATE cannot erase either ledger for replacement');
  expectWrite(`update provision_intent_lab.intents set expires_at=expires_at+interval '1 hour' where ${intentWhere}`,'P4101',false,true);
  expectWrite(`delete from provision_identity_lab.operations where ${opWhere}`,'P4102',false,true);
  sql(`begin;alter table provision_intent_lab.intents disable trigger intent_binding;do $$ declare original timestamptz;begin select expires_at into original from provision_intent_lab.intents where ${intentWhere};update provision_intent_lab.intents set expires_at=expires_at+interval '1 hour' where ${intentWhere};assert (select expires_at>original from provision_intent_lab.intents where ${intentWhere}),'Disabled trigger did not expose deadline replacement';end $$;rollback;`);
  assert.equal(sql("select bool_and(tgenabled='A') from pg_trigger where not tgisinternal and tgname in ('operation_binding','operation_history','intent_binding','intent_history')"),'t');
  expectWrite(`update provision_intent_lab.intents set expires_at=expires_at+interval '1 hour' where ${intentWhere}`,'P4101');
  assert.equal(begin(positive,ctx).expires_at,initial.expires_at);
  checks.push('ALWAYS guards reject replica DML; disabling only the lab guard exposes deadline replacement, rollback restores the original valid replay');
 }
 const actorState=()=>sql(`select u.xmin::text||':'||s.xmin::text||':'||m.xmin::text||':'||e.revision::text from auth.users u join auth.sessions s on s.user_id=u.id join public.clinic_members m on m.user_id=u.id and m.clinic_id='${clinic}' join cortex_private.account_custody_epochs e on e.user_id=u.id where u.id='${ctx.sub}' and s.id='${ctx.session_id}'`);
 // Start with RR/deletion: this is the regression that the old receipt read missed.
 for(const [isolation,change] of [['repeatable read','delete'],['read committed','delete'],['repeatable read','metadata'],['read committed','metadata']]){
  const f=fixture();begin(f,ctx);await birth(f);await live(ctx);
  const unchanged=actorState(),child=holderSession();let output='',errors='',ended=false;
  child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{errors+=d;});const done=new Promise(resolve=>child.once('close',status=>resolve(status)));
  try{
   child.stdin.write(`\\set VERBOSITY verbose\nbegin isolation level ${isolation};select count(*) from auth.users;select 'RECEIPT_SNAPSHOT';\n`);
   let ready=false;for(let n=0;n<100;n++){if(output.includes('RECEIPT_SNAPSHOT')){ready=true;break;}await pause();}assert.ok(ready);
   const changed=change==='delete'?await call(auth,'/admin/users/'+f.id,adminJwt,undefined,'DELETE')
    :await call(auth,'/admin/users/'+f.id,adminJwt,{app_metadata:{cortex_provision_revision:2}},'PUT');
   assert.equal(changed.status,200);assert.equal(actorState(),unchanged,'Target mutation unexpectedly changed an actor guard row');
   assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),change==='delete'?'0':'1');
   assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`),'f');
   ended=true;child.stdin.end("set local request.jwt.claim.role='service_role';"+query(f,ctx)+';commit;\n');
   const status=await done;
   if(status===0)throw Object.assign(new Error('Removed or changed identity confirmed from an old receipt snapshot'),{receiptEvidence:{...report,receiptRedOnly:true,isolation,change,nativeMutationStatus:changed.status,currentReceipt:false,actorGuardRowsUnchanged:true,staleConfirmationAccepted:true,compositionProofPassed:false}});
   assert.match(errors,/40001/);
   assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),'prepared');
  }finally{if(!ended)child.stdin.end('rollback;\n');await done;}
  checks.push('Native target '+change+' after an established '+isolation+' snapshot refuses confirmation without changing actor authority');
 }
 for(const change of ['delete','metadata']){
  const f=fixture();begin(f,ctx);await birth(f);assert.equal(JSON.parse(trusted(query(f,ctx))).phase,'confirmed');
  const changed=change==='delete'?await call(auth,'/admin/users/'+f.id,adminJwt,undefined,'DELETE')
   :await call(auth,'/admin/users/'+f.id,adminJwt,{app_metadata:{cortex_provision_revision:2}},'PUT');
  assert.equal(changed.status,200);assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),change==='delete'?'0':'1');
  refused(query(f,ctx,false),'40001');refused(query(f,ctx,true),'40001');
  refused(`select provision_intent_lab.begin_intent('${f.op}','${f.id}',${args(ctx)})`,'40001');
  checks.push('A confirmed history cannot be returned as current after native target '+change+', by check or begin replay');
 }
 // Confirmation wins first: the native DELETE must actually wait on its target.
 {
  const f=fixture();begin(f,ctx);await birth(f);const child=holderSession();let output='',ended=false,request;
  child.stdout.on('data',d=>{output+=d;});const done=new Promise(resolve=>child.once('close',status=>resolve(status)));
  const end=async()=>{if(!ended){ended=true;child.stdin.end('commit;\n');}assert.equal(await done,0);};
  try{
   child.stdin.write("begin;set local request.jwt.claim.role='service_role';"+query(f,ctx)+";select 'TARGET_HELD='||pg_backend_pid();\n");let pid;
   for(let n=0;n<100;n++){const m=/TARGET_HELD=(\d+)/.exec(output);if(m){pid=Number(m[1]);break;}await pause();}assert.ok(pid);
   request=asyncHttp({url:auth+'/admin/users/'+f.id,method:'DELETE',headers:{Authorization:'Bearer '+adminJwt}});
   let observed=false;for(let n=0;n<40;n++){if(sql(`select exists(select 1 from pg_stat_activity where usename='supabase_auth_admin' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid)))`)==='t'){observed=true;break;}await pause();}assert.ok(observed,'Native delete did not wait on the target confirmation fence');
   await end();assert.equal((await request).status,200);
  }finally{await end();if(request)await Promise.allSettled([request]);}
  assert.equal(sql(`select count(*) from auth.users where id='${f.id}'`),'0');refused(query(f,ctx,false),'40001');
  checks.push('Confirmation-first ordering actually fences the native DELETE; replay after deletion refuses');
 }
 // The native session may expire while a later fence is being acquired.
 // Inject a delay only into our private lab function, after assert_context.
 {
  const session=await fresh();assert.equal(sql(`select not_after is null from auth.sessions where id='${session.session_id}'`),'t');
  const original=sql("select pg_get_functiondef('provision_intent_lab.fence_current_receipt(uuid,uuid)'::regprocedure)");
  sql('create sequence provision_intent_lab.deadline_fence_probe;');
  try{
   for(const mode of ['check','begin']){
    const f=fixture();begin(f,session);await birth(f);if(mode==='begin')assert.equal(JSON.parse(trusted(query(f,session))).phase,'confirmed');
    const delayed=original.replace(/begin\r?\n/,`begin\n if not exists(select 1 from auth.sessions where id='${session.session_id}' and not_after>clock_timestamp()) then raise exception 'Deadline probe entered too late';end if;\n perform nextval('provision_intent_lab.deadline_fence_probe');perform pg_sleep(5);\n`);
    assert.notEqual(delayed,original);sql(delayed);
    const before=sql('select last_value::text||is_called::text from provision_intent_lab.deadline_fence_probe');
    sql(`update auth.sessions set not_after=clock_timestamp()+interval '4 seconds' where id='${session.session_id}';`);
    refused(mode==='check'?query(f,session):`select provision_intent_lab.begin_intent('${f.op}','${f.id}',${args(session)})`);
    assert.notEqual(sql('select last_value::text||is_called::text from provision_intent_lab.deadline_fence_probe'),before,'Deadline fence was never reached before expiry');
    assert.equal(sql(`select s.not_after<=clock_timestamp() and to_timestamp(${session.exp})>clock_timestamp() and i.expires_at>clock_timestamp() from auth.sessions s cross join provision_intent_lab.intents i where s.id='${session.session_id}' and i.operation_id='${f.op}'`),'t');
    assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),mode==='check'?'prepared':'confirmed');
    sql(original);sql(`update auth.sessions set not_after=null where id='${session.session_id}';`);
   }
  }finally{sql(original);sql(`update auth.sessions set not_after=null where id='${session.session_id}';`);}
  assert.equal(sql("select pg_get_functiondef('provision_intent_lab.fence_current_receipt(uuid,uuid)'::regprocedure)"),original);
  checks.push('Native session not_after expiring inside the target fence refuses both confirmation and confirmed begin replay with bearer and intent still valid');
 }
 const aba=fixture(),old=begin(aba,ctx);await birth(aba);
 sql(`update public.clinic_members set role='doctor' where ${where};`);refused(query(aba,ctx));
 sql(`update public.clinic_members set role='admin' where ${where};`);assert.notEqual(generation(),old.membership_generation);await live(ctx);refused(query(aba,ctx));
 checks.push('Role loss and real membership ABA refuse the original intent while the same native session/factor stay live');
 const status=fixture();begin(status,ctx);await birth(status);
 sql(`begin;update public.clinic_members set status='inactive' where ${where};update public.clinic_members set status='active' where ${where};commit;`);await live(ctx);refused(query(status,ctx));
 checks.push('Real membership status ABA cannot restore a native-context intent');
 const noop=fixture(),noopStart=begin(noop,ctx);await birth(noop);
 sql(`update public.clinic_members set updated_at=clock_timestamp(),provisioning_authority_generation=gen_random_uuid() where ${where};`);
 assert.equal(generation(),noopStart.membership_generation);assert.equal(JSON.parse(trusted(query(noop,ctx))).phase,'confirmed');
 checks.push('A no-op membership write cannot change the captured generation or invalidate a valid native-context intent');
 const another=await fresh(),sessionBound=fixture();begin(sessionBound,ctx);await birth(sessionBound);
 refused(query(sessionBound,another));refused(`select provision_intent_lab.begin_intent('${sessionBound.op}','${sessionBound.id}',${args(another)})`,'22023');
 checks.push('A new genuine AAL2 native session cannot adopt the old session-bound operation');
 const logged=fixture();begin(logged,another);await birth(logged);assert.equal((await call(auth,'/logout?scope=global',another.token,{})).status,204);
 assert.equal(sql(`select count(*) from auth.sessions where id='${another.session_id}'`),'0');refused(query(logged,another));assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${logged.op}')`),'t');
 checks.push('Native logout after real-clinic Auth birth refuses confirmation and preserves the identity receipt');
 sql(`create function provision_intent_lab.pause_clinic_birth() returns trigger language plpgsql set search_path='' as $$ begin if new.raw_user_meta_data ? 'clinic_birth_wait' then perform pg_advisory_xact_lock((new.raw_user_meta_data->>'clinic_birth_wait')::bigint);end if;return new;end $$;create trigger zz_clinic_birth_pause after insert on auth.users for each row execute function provision_intent_lab.pause_clinic_birth();`);
 const inFlight=async(c,change)=>{
  const f=fixture();begin(f,c);assert.equal(JSON.parse(trusted(query(f,c,false))).phase,'prepared');
  const key=Math.floor(Math.random()*1000000000)+1,child=holderSession();let output='',request,ended=false;
  child.stdout.on('data',d=>{output+=d;});const done=new Promise(resolve=>child.once('close',code=>resolve(code)));
  const end=async()=>{if(!ended){ended=true;child.stdin.end('commit;\n');}assert.equal(await done,0);};
  try{
   child.stdin.write(`begin;select pg_advisory_xact_lock(${key});select 'CLINIC_HELD='||pg_backend_pid();\n`);let pid;
   for(let n=0;n<100;n++){const m=/CLINIC_HELD=(\d+)/.exec(output);if(m){pid=Number(m[1]);break;}await pause();}assert.ok(pid);
   request=asyncHttp({url:auth+'/admin/users',method:'POST',timeout:15000,headers:{Authorization:'Bearer '+adminJwt,'Content-Type':'application/json'},body:JSON.stringify({id:f.id,email:f.email,email_confirm:true,app_metadata:{account_type:'reception',cortex_provision_operation:f.op,cortex_provision_revision:1},user_metadata:{clinic_birth_wait:key}})});
   let observed=false;for(let n=0;n<40;n++){if(sql(`select exists(select 1 from pg_stat_activity where usename='supabase_auth_admin' and wait_event_type='Lock' and ${pid}=any(pg_blocking_pids(pid)))`)==='t'){observed=true;break;}await pause();}assert.ok(observed,'Native birth never reached the owned holder');
   await change();await end();assert.equal((await request).status,200);
  }finally{await end();if(request)await Promise.allSettled([request]);}
  assert.equal(sql(`select provision_identity_lab.has_birth_receipt('${f.op}')`),'t');refused(query(f,c));assert.equal(sql(`select phase from provision_intent_lab.intents where operation_id='${f.op}'`),'prepared');
 };
 const active=await fresh();
 await inFlight(active,async()=>{sql(`begin;update public.clinic_members set role='doctor' where ${where};update public.clinic_members set role='admin' where ${where};commit;`);await live(active);});
 checks.push('Observed in-flight native birth after real membership ABA keeps the new identity but refuses administrative confirmation');
 await restartAuth({GOTRUE_JWT_EXP:'8'});
 try{
  const short=await fresh();assert.ok(short.exp-Math.floor(Date.now()/1000)<=12);
  await inFlight(short,async()=>{let expired=false;for(let n=0;n<60;n++){if(sql(`select clock_timestamp()>=to_timestamp(${short.exp})`)==='t'){expired=true;break;}await pause();}assert.ok(expired);assert.equal(sql(`select count(*) from auth.sessions where id='${short.session_id}'`),'1');});
 }finally{await restartAuth({GOTRUE_JWT_EXP:'3600'});}
 checks.push('Observed in-flight native birth after actual bearer expiry refuses confirmation even with the native session still present');
 for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`select has_schema_privilege('${role}','provision_intent_lab','usage') or has_schema_privilege('${role}','provision_membership_lab','usage')`),'f');
 assert.equal((await call(rest,'/rpc/check_intent',active.token,{p_operation:positive.op})).status,404);
 for(const table of ['clinic_members','clinic_staff_members','patients','consultations'])assert.equal(sql(`select count(*) from public.${table} where user_id in (select planned_user_id from provision_intent_lab.intents)`),'0');
 assert.equal(sql('select count(*) from public.staff_doctor_scopes'),'0');
 checks.push('Private composition stays absent from Data API and creates no target clinic/staff/chart memberships or scopes');
 assert.equal(checks.length,19+(ledger?4:0));
 return {...report,checks,compositionProofPassed:true,...(ledger?{ledgerBindingsProofPassed:true}:{}),notCovered:['authority of privileged INSERT/phase writers and UUID reservation races','production intent custody/install/upgrade','credential or historical Auth event generation and recovery','team membership, consent requests, legacy service cutover and app APIs/UI']};
}
