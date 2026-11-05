-- Independent R2/R3 retest in a new disposable database, synthetic only.
-- Historical RED probe stays in signature-late-failure.sql.
begin;
insert into auth.users(id,email) values('d1900000-0000-4000-8000-000000000001','delta@example.invalid');
insert into auth.mfa_factors(id,user_id,status,factor_type) values('d1950000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000001','verified','totp');
insert into auth.sessions(id,user_id,factor_id,aal) values('d1960000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000001','d1950000-0000-4000-8000-000000000001','aal2');
insert into public.patients(id,user_id,name,age,last_visit,status)
 values('d1910000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000001','Synthetic delta',30,current_date,'novo');
insert into public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,doc_type,issuance_snapshot)
 select ('d1920000-0000-4000-8000-00000000000'||n)::uuid,'d1900000-0000-4000-8000-000000000001',
 'd1910000-0000-4000-8000-000000000001','rx/d1900000-0000-4000-8000-000000000001/d1920000-0000-4000-8000-00000000000'||n||'.pdf','synthetic',now()+interval '1 day','receita_simples',
 jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',repeat('a',64),'template_version','test','issued_at',now())
 from generate_series(1,3) n;
create temp table delta_results(destination text,refusal text,resulting_state text,attempts integer,cleanup boolean);
grant insert on delta_results to service_role;
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ declare u uuid:='d1900000-0000-4000-8000-000000000001';o uuid;r uuid;i integer;s text;code text;j jsonb;returned jsonb;
 a jsonb:=jsonb_build_object('sessionId','d1960000-0000-4000-8000-000000000001','aal','aal2','exp',floor(extract(epoch from clock_timestamp()))::bigint+3600);
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');begin
 for i in 1..3 loop
  perform public.signature_activate_session(u,'vidaas',('d1930000-0000-4000-8000-00000000000'||i)::uuid,clock_timestamp()+interval '1 hour',repeat('c',64),
   '{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}',a);
  o:=('d1940000-0000-4000-8000-00000000000'||i)::uuid;r:=('d1920000-0000-4000-8000-00000000000'||i)::uuid;
  perform public.signature_reserve(u,o,r,repeat('a',64),a);
  perform public.signature_advance(u,o,'prepared',d,a);
  perform public.signature_advance(u,o,'psc_requested',d||'{"attempt":0}',a);
  perform public.signature_close(u,o,'ambiguous','{"attempt":1}');
  perform public.signature_advance(u,o,'psc_requested',d||'{"humanRetry":true,"attempt":1}',a);
  s:=case i when 2 then 'stored' else 'ambiguous' end;
  if s='stored' then
   perform public.signature_advance(u,o,s,jsonb_build_object('attempt',2,'stagedPath','rx/'||u::text||'/'||r::text||'/signed-'||o::text||'.pdf','signedSha256',repeat('f',64)),a);
  else perform public.signature_close(u,o,s,'{"attempt":2}');end if;
  if i=3 then
   code:=null;
   returned:=null;
   begin returned:=public.signature_advance(u,o,'prepared',d,a);
   exception when others then get stacked diagnostics code=returned_sqlstate;end;
   assert code is null and returned @> jsonb_build_object('operation_id',o,'state','ambiguous','psc_attempts',2,'cleanup_pending',false),'Prepared did not return current history';
   j:=public.signature_reserve(u,o,r,repeat('a',64),a);
   insert into delta_results values('prepared_after_ambiguous',code,j->>'state',(j->>'psc_attempts')::integer,(j->>'cleanup_pending')::boolean);
   perform public.signature_revoke_session(u);s:='ambiguous_psc_revoked';
  end if;
  code:=null;
  begin
   if i=3 then
    j:=public.signature_advance(u,o,'stored',jsonb_build_object('attempt',1,'stagedPath','rx/'||u::text||'/'||r::text||'/signed-'||o::text||'.pdf','signedSha256',repeat('f',64)),a);
   else j:=public.signature_close(u,o,'failed','{"attempt":1,"code":"psc_rejected"}');end if;
  exception when others then get stacked diagnostics code=returned_sqlstate;
  end;
  -- Reserve is an idempotent public read of the current operation.
  j:=public.signature_reserve(u,o,r,repeat('a',64),a);
  insert into delta_results values(s,code,j->>'state',(j->>'psc_attempts')::integer,(j->>'cleanup_pending')::boolean);
  if i=3 then
   -- The stale stored answer must not cancel ambiguous/2. An explicit retry
   -- of that current attempt is pertinent and sees revocation before it can
   -- increment the attempt counter or authorize another PSC request.
   j:=public.signature_advance(u,o,'psc_requested',d||'{"humanRetry":true,"attempt":2}',a);
   assert j @> jsonb_build_object('operation_id',o,'state','cancelled_by_revocation','psc_attempts',2,'cleanup_pending',true),'Pertinent attempt did not observe PSC revocation';
   code:=null;
   returned:=null;
   begin returned:=public.signature_complete(u,o,'abc','Synthetic issuer',a);
   exception when others then get stacked diagnostics code=returned_sqlstate;end;
   assert code is null and returned @> jsonb_build_object('operation_id',o,'state','cancelled_by_revocation','psc_attempts',2,'cleanup_pending',true),'Complete did not return current history';
   j:=public.signature_reserve(u,o,r,repeat('a',64),a);
   insert into delta_results values('complete_after_cancelled',code,j->>'state',(j->>'psc_attempts')::integer,(j->>'cleanup_pending')::boolean);
  end if;
 end loop;
end $$;
reset role;
select jsonb_agg(to_jsonb(d) order by destination) from delta_results d;
rollback;
