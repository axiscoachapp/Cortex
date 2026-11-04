-- Read-only review reproduction in a new disposable database, synthetic only.
begin;
insert into auth.users(id,email) values('d1900000-0000-4000-8000-000000000001','delta@example.invalid');
insert into public.patients(id,user_id,name,age,last_visit,status)
 values('d1910000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000001','Synthetic delta',30,current_date,'novo');
insert into public.prescriptions(id,user_id,patient_id,storage_path,secret_code,expires_at,doc_type,issuance_snapshot)
 select ('d1920000-0000-4000-8000-00000000000'||n)::uuid,'d1900000-0000-4000-8000-000000000001',
 'd1910000-0000-4000-8000-000000000001','rx/d1900000-0000-4000-8000-000000000001/d1920000-0000-4000-8000-00000000000'||n||'.pdf','synthetic',now()+interval '1 day','receita_simples',
 jsonb_build_object('prescriber','{}'::jsonb,'patient','{}'::jsonb,'pdf_sha256',repeat('a',64),'template_version','test','issued_at',now())
 from generate_series(1,2) n;
create temp table delta_results(destination text,refusal text,resulting_state text,attempts integer,cleanup boolean);
grant insert on delta_results to service_role;
set local role service_role;
set local request.jwt.claim.role='service_role';
do $$ declare u uuid:='d1900000-0000-4000-8000-000000000001';o uuid;r uuid;i integer;s text;code text;j jsonb;
 d jsonb:=jsonb_build_object('preparedSha256',repeat('d',64),'toBeSignedSha256',repeat('e',64),'policyOid','2.16.76.1.7.1.11.1.1');begin
 perform public.signature_activate_session(u,'vidaas','d1930000-0000-4000-8000-000000000001',now()+interval '1 hour',repeat('c',64),
  '{"v":1,"keyId":"synthetic","nonce":"bm9uY2U=","ciphertext":"dG9rZW4="}');
 for i in 1..2 loop
  o:=('d1940000-0000-4000-8000-00000000000'||i)::uuid;r:=('d1920000-0000-4000-8000-00000000000'||i)::uuid;
  perform public.signature_reserve(u,o,r,repeat('a',64));
  perform public.signature_advance(u,o,'prepared',d);
  perform public.signature_advance(u,o,'psc_requested',d);
  perform public.signature_advance(u,o,'ambiguous','{"attempt":1}');
  perform public.signature_advance(u,o,'psc_requested',d||'{"humanRetry":true}');
  s:=case i when 1 then 'ambiguous' else 'stored' end;
  perform public.signature_advance(u,o,s,jsonb_build_object('attempt',2,'stagedPath','rx/'||u::text||'/'||r::text||'/signed-'||o::text||'.pdf','signedSha256',repeat('f',64)));
  code:=null;
  begin
   j:=public.signature_advance(u,o,'failed','{"attempt":1,"code":"psc_rejected"}');
  exception when others then get stacked diagnostics code=returned_sqlstate;
  end;
  -- Reserve is an idempotent public read of the current operation.
  j:=public.signature_reserve(u,o,r,repeat('a',64));
  insert into delta_results values(s,code,j->>'state',(j->>'psc_attempts')::integer,(j->>'cleanup_pending')::boolean);
 end loop;
end $$;
reset role;
select jsonb_agg(to_jsonb(d) order by destination) from delta_results d;
rollback;
