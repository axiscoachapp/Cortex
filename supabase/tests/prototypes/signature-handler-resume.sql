-- Frozen-handler review only. Synthetic, disposable database, no provider.
begin;
insert into auth.users(id,email) values('d2900000-0000-4000-8000-000000000001','handler-review@example.invalid');
insert into auth.mfa_factors(id,user_id,status,factor_type) values('d2950000-0000-4000-8000-000000000001','d2900000-0000-4000-8000-000000000001','verified','totp');
insert into auth.sessions(id,user_id,factor_id,aal) values('d2960000-0000-4000-8000-000000000001','d2900000-0000-4000-8000-000000000001','d2950000-0000-4000-8000-000000000001','aal2');
insert into public.patients(id,user_id,name,age,last_visit,status)
 values('d2910000-0000-4000-8000-000000000001','d2900000-0000-4000-8000-000000000001','Synthetic handler',30,current_date,'novo');
insert into public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,doc_type,issuance_snapshot)
 select ('d2920000-0000-4000-8000-00000000000'||n)::uuid,'d2900000-0000-4000-8000-000000000001',
 'd2910000-0000-4000-8000-000000000001','rx/d2900000-0000-4000-8000-000000000001/d2920000-0000-4000-8000-00000000000'||n||'.pdf','synthetic',now()+interval '1 day','receita_simples',
 jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',repeat('a',64),'template_version','test','issued_at',now()) from generate_series(1,2) n;
create temp table resume_results(observed text,token_refusal text,advance_refusal text,state_after text,new_reservation_refusal text);
grant insert on resume_results to service_role;
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ declare u uuid:='d2900000-0000-4000-8000-000000000001';s uuid;o uuid;r uuid;i integer;observed text;tcode text;acode text;ncode text;j jsonb;
 a jsonb:=jsonb_build_object('sessionId','d2960000-0000-4000-8000-000000000001','aal','aal2','exp',floor(extract(epoch from clock_timestamp()))::bigint+3600);
 d jsonb:=jsonb_build_object('preparedSha256',repeat('b',64),'toBeSignedSha256',repeat('c',64),'policyOid','2.16.76.1.7.1.11.1.1');
begin
 for i in 1..2 loop
  s:=('d2930000-0000-4000-8000-00000000000'||i)::uuid;
  o:=('d2940000-0000-4000-8000-00000000000'||i)::uuid;r:=('d2920000-0000-4000-8000-00000000000'||i)::uuid;
  perform public.signature_activate_session(u,'vidaas',s,clock_timestamp()+interval '1 hour',repeat('c',64),'{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}',a);
  perform public.signature_reserve(u,o,r,repeat('a',64),a);
  perform public.signature_advance(u,o,'prepared',d,a);
  if i=2 then perform public.signature_advance(u,o,'psc_requested',d||'{"attempt":0}',a);perform public.signature_close(u,o,'ambiguous','{"attempt":1}');end if;
  observed:=case i when 1 then 'prepared' else 'ambiguous' end;
  perform public.signature_revoke_session(u);
  tcode:=null;acode:=null;
  begin perform public.signature_session_token(u,s,1,a);exception when others then get stacked diagnostics tcode=returned_sqlstate;end;
  -- The real flow's P4031 recovery sends exactly this empty prepared step.
  begin perform public.signature_advance(u,o,'prepared','{}',a);exception when others then get stacked diagnostics acode=returned_sqlstate;end;
  j:=public.signature_reserve(u,o,r,repeat('a',64),a);
  -- Opening a new live PSC session does not release this document either.
  perform public.signature_activate_session(u,'vidaas',gen_random_uuid(),clock_timestamp()+interval '1 hour',repeat('c',64),'{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}',a);
  ncode:=null;
  begin perform public.signature_reserve(u,gen_random_uuid(),r,repeat('a',64),a);exception when others then get stacked diagnostics ncode=returned_sqlstate;end;
  insert into resume_results values(observed,tcode,acode,j->>'state',ncode);
 end loop;
end $$;
reset role;
select jsonb_agg(to_jsonb(r) order by observed) from resume_results r;
rollback;
