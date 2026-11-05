-- Frozen-handler retest only. Synthetic, disposable database, no provider.
begin;
insert into auth.users(id,email) values('d2900000-0000-4000-8000-000000000001','handler-review@example.invalid');
insert into auth.mfa_factors(id,user_id,status,factor_type) values('d2950000-0000-4000-8000-000000000001','d2900000-0000-4000-8000-000000000001','verified','totp');
insert into auth.sessions(id,user_id,factor_id,aal) values('d2960000-0000-4000-8000-000000000001','d2900000-0000-4000-8000-000000000001','d2950000-0000-4000-8000-000000000001','aal2');
insert into public.patients(id,user_id,name,age,last_visit,status)
 values('d2910000-0000-4000-8000-000000000001','d2900000-0000-4000-8000-000000000001','Synthetic handler',30,current_date,'novo');
insert into public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,doc_type,issuance_snapshot)
 select ('d2920000-0000-4000-8000-00000000000'||n)::uuid,'d2900000-0000-4000-8000-000000000001',
 'd2910000-0000-4000-8000-000000000001','rx/d2900000-0000-4000-8000-000000000001/d2920000-0000-4000-8000-00000000000'||n||'.pdf','synthetic',now()+interval '1 day','receita_simples',
 jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',repeat('a',64),'template_version','test','issued_at',now()) from generate_series(1,4) n;
create temp table resume_results(method text,observed text,token_refusal text,state_after text,cleanup_pending boolean,prepared_preserved boolean,new_reservation_state text);
grant insert on resume_results to service_role;
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ declare u uuid:='d2900000-0000-4000-8000-000000000001';s uuid;o uuid;r uuid;i integer;observed text;tcode text;j jsonb;k jsonb;attempt integer;
 a jsonb:=jsonb_build_object('sessionId','d2960000-0000-4000-8000-000000000001','aal','aal2','exp',floor(extract(epoch from clock_timestamp()))::bigint+3600);
 d jsonb:=jsonb_build_object('preparedSha256',repeat('b',64),'toBeSignedSha256',repeat('c',64),'policyOid','2.16.76.1.7.1.11.1.1');
begin
 for i in 1..4 loop
  s:=('d2930000-0000-4000-8000-00000000000'||i)::uuid;
  o:=('d2940000-0000-4000-8000-00000000000'||i)::uuid;r:=('d2920000-0000-4000-8000-00000000000'||i)::uuid;
  perform public.signature_activate_session(u,'vidaas',s,clock_timestamp()+interval '1 hour',repeat('c',64),'{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}',a);
  perform public.signature_reserve(u,o,r,repeat('a',64),a);
  perform public.signature_advance(u,o,'prepared',d,a);
  attempt:=case when i%2=0 then 1 else 0 end;observed:=case when attempt=0 then 'prepared' else 'ambiguous' end;
  if attempt=1 then perform public.signature_advance(u,o,'psc_requested',d||'{"attempt":0}',a);perform public.signature_close(u,o,'ambiguous','{"attempt":1}');end if;
  -- Live-session control: a closing step cannot fabricate revocation.
  j:=public.signature_close(u,o,'cancelled_by_revocation',jsonb_build_object('expectedState',observed,'attempt',attempt));
  if j->>'state' is distinct from observed then raise exception 'Live PSC session was cancelled';end if;
  perform public.signature_revoke_session(u);
  tcode:=null;
  begin perform public.signature_session_token(u,s,1,a);exception when others then get stacked diagnostics tcode=returned_sqlstate;end;
  if i<=2 then
   j:=public.signature_close(u,o,'cancelled_by_revocation',jsonb_build_object('expectedState',observed,'attempt',attempt+1));
   if j->>'state' is distinct from observed then raise exception 'Stale attempt changed operation';end if;
   j:=public.signature_close(u,o,'cancelled_by_revocation',jsonb_build_object('expectedState','reserved','attempt',attempt));
   if j->>'state' is distinct from observed then raise exception 'Stale state changed operation';end if;
   -- Authorized close, checked before reserve can repair it.
   j:=public.signature_close(u,o,'cancelled_by_revocation',jsonb_build_object('expectedState',observed,'attempt',attempt));
   if j->>'state' is distinct from 'cancelled_by_revocation'
    or (j->>'cleanup_pending')::boolean is distinct from (attempt=1)
    or j->>'prepared_pdf_sha256' is distinct from repeat('b',64)
    or j->>'to_be_signed_sha256' is distinct from repeat('c',64) then
    raise exception 'Authorized close did not settle before reserve';
   end if;
  end if;
  perform public.signature_activate_session(u,'vidaas',gen_random_uuid(),clock_timestamp()+interval '1 hour',repeat('c',64),'{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}',a);
  k:=public.signature_reserve(u,gen_random_uuid(),r,repeat('a',64),a);
  -- Real persisted state/replay, not the memory mirror used by the handler probe.
  j:=public.signature_reserve(u,o,r,repeat('a',64),a);
  insert into resume_results values(case when i<=2 then 'close' else 'new_reserve' end,observed,tcode,j->>'state',(j->>'cleanup_pending')::boolean,
   j->>'prepared_pdf_sha256'=repeat('b',64) and j->>'to_be_signed_sha256'=repeat('c',64),k->>'state');
 end loop;
end $$;
reset role;
select jsonb_agg(to_jsonb(r) order by method,observed) from resume_results r;
rollback;
