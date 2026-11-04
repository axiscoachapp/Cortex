-- Prescription templates (migration 20261104110000). Synthetic users and drugs only.
begin;
insert into auth.users(id,email) values
 ('c4110000-0000-4000-8000-000000000001','snippet-doctor@example.invalid'),
 ('c4110000-0000-4000-8000-000000000002','snippet-other@example.invalid'),
 ('c4110000-0000-4000-8000-000000000004','snippet-mfa@example.invalid'),
 ('c4110000-0000-4000-8000-000000000005','snippet-deleting@example.invalid');
insert into auth.users(id,email,raw_app_meta_data) values
 ('c4110000-0000-4000-8000-000000000003','snippet-reception@example.invalid','{"account_type":"reception"}');

-- Privileges: reads through RLS, writes only through the RPCs.
do $$ begin
  assert not has_function_privilege('anon','public.save_document_snippet(uuid,integer,text,jsonb)','execute'), 'anon can save templates';
  assert not has_function_privilege('anon','public.archive_document_snippet(uuid,integer)','execute'), 'anon can archive templates';
  assert not has_function_privilege('authenticated','public.document_snippet_writer()','execute'), 'writer preamble is callable';
  assert not has_table_privilege('authenticated','public.document_snippets','insert'), 'authenticated can insert directly';
  assert not has_table_privilege('authenticated','public.document_snippets','update'), 'authenticated can update directly';
  assert not has_table_privilege('authenticated','public.document_snippets','delete'), 'authenticated can delete directly';
  assert not has_table_privilege('anon','public.document_snippets','select'), 'anon can read templates';
  assert pg_get_functiondef('public.document_snippet_writer()'::regprocedure) ~ 'assert_clinical_actor\(\)', 'writer lost the clinical-actor guard';
  assert pg_get_functiondef('public.document_snippet_writer()'::regprocedure) ~ 'assert_session_assurance\(\)', 'writer lost the session guard';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','c4110000-0000-4000-8000-000000000001',true);
create temp table t(id uuid, revision integer) on commit drop;
grant all on t to authenticated;
insert into t select (r->>'id')::uuid, (r->>'revision')::integer from public.save_document_snippet(null,null,
  '  Infecção urinária  ','[{"name":"Medicamento sintético A","dosage":"1 comprimido","instructions":"de 12 em 12 horas"}]') r;
do $$ declare v public.document_snippets; begin
  select * into v from public.document_snippets where id=(select id from t);
  assert v.name='Infecção urinária', 'name not trimmed';
  assert v.review_status='approved' and v.source='cortex' and v.revision=1 and (select revision from t)=1, 'new template state';
  assert v.owner_user_id='c4110000-0000-4000-8000-000000000001', 'owner not taken from the session';
end $$;

-- Update with the current revision; a stale revision is refused.
select public.save_document_snippet((select id from t),1,'Infecção urinária',
  '[{"name":"Medicamento sintético A","dosage":"1 comprimido","instructions":"de 8 em 8 horas"},{"name":"Medicamento sintético B"}]');
do $$ begin
  assert (select revision from public.document_snippets where id=(select id from t))=2, 'revision not incremented';
  assert (select jsonb_array_length(items) from public.document_snippets where id=(select id from t))=2, 'items not replaced';
  begin perform public.save_document_snippet((select id from t),1,'Outro nome','[{"name":"Medicamento sintético C"}]');
    raise exception 'Stale revision accepted';
  exception when sqlstate '40001' then null; end;
end $$;

-- Invalid input.
do $$ begin
  begin perform public.save_document_snippet(null,null,'   ','[{"name":"X"}]'); raise exception 'Empty name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,repeat('n',121),'[{"name":"X"}]'); raise exception 'Long name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,'Vazio','[]'); raise exception 'Empty items accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,'Muitos',(select jsonb_agg(jsonb_build_object('name','Item '||g)) from generate_series(1,16) g));
    raise exception '16 items accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,'Chave','[{"name":"X","patient":"y"}]'); raise exception 'Unknown item key accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,'Sem nome','[{"dosage":"1"}]'); raise exception 'Item without name accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,'Dose','[{"name":"X","dosage":1}]'); raise exception 'Numeric dosage accepted';
  exception when sqlstate '22023' then null; end;
  begin perform public.save_document_snippet(null,null,'Objeto','{"name":"X"}'); raise exception 'Non-array items accepted';
  exception when sqlstate '22023' then null; end;
end $$;

-- Direct writes are refused even for the owner.
do $$ begin
  begin update public.document_snippets set name='Direto' where id=(select id from t); raise exception 'Direct update accepted';
  exception when insufficient_privilege then null; end;
end $$;

-- Another doctor neither sees nor changes the template.
select set_config('request.jwt.claim.sub','c4110000-0000-4000-8000-000000000002',true);
do $$ begin
  assert not exists(select 1 from public.document_snippets), 'Template visible to another doctor';
  begin perform public.save_document_snippet((select id from t),2,'Tomado','[{"name":"X"}]'); raise exception 'Foreign update accepted';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.archive_document_snippet((select id from t),2); raise exception 'Foreign archive accepted';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- An imported template becomes approved only when its owner saves it.
reset role;
insert into public.document_snippets(id,owner_user_id,name,items,review_status,source,source_ref) values
 ('c4110000-0000-4000-8000-0000000000aa','c4110000-0000-4000-8000-000000000001','Modelo importado',
  '[{"name":"Medicamento sintético D"}]','imported_unreviewed','personalmed','synthetic-1');
set local role authenticated;
select set_config('request.jwt.claim.sub','c4110000-0000-4000-8000-000000000001',true);
select public.save_document_snippet('c4110000-0000-4000-8000-0000000000aa',1,'Modelo importado','[{"name":"Medicamento sintético D","dosage":"1 cápsula"}]');
do $$ begin
  assert (select review_status from public.document_snippets where id='c4110000-0000-4000-8000-0000000000aa')='approved', 'Saving did not approve the import';
  assert (select source from public.document_snippets where id='c4110000-0000-4000-8000-0000000000aa')='personalmed', 'Origin lost on review';
end $$;

-- Archive: then neither archive nor save again.
select public.archive_document_snippet((select id from t),2);
do $$ begin
  assert (select review_status from public.document_snippets where id=(select id from t))='archived', 'Not archived';
  begin perform public.archive_document_snippet((select id from t),3); raise exception 'Archived twice';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.save_document_snippet((select id from t),3,'Volta','[{"name":"X"}]'); raise exception 'Archived template edited';
  exception when sqlstate 'P0002' then null; end;
end $$;

-- Reception account: refused.
select set_config('request.jwt.claim.sub','c4110000-0000-4000-8000-000000000003',true);
do $$ begin
  begin perform public.save_document_snippet(null,null,'Recepção','[{"name":"X"}]'); raise exception 'Reception saved a template';
  exception when insufficient_privilege then null; end;
end $$;

-- Password-only session of an MFA-enrolled doctor: refused.
reset role;
insert into auth.mfa_factors(user_id,status,factor_type) values('c4110000-0000-4000-8000-000000000004','verified','totp');
set local role authenticated;
select set_config('request.jwt.claim.sub','c4110000-0000-4000-8000-000000000004',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin
  begin perform public.save_document_snippet(null,null,'Sem 2FA','[{"name":"X"}]'); raise exception 'aal1 session saved a template';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','',true);

-- Account deletion in progress: no new templates.
reset role;
insert into public.account_deletion_requests(user_id) values('c4110000-0000-4000-8000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.sub','c4110000-0000-4000-8000-000000000005',true);
do $$ begin
  begin perform public.save_document_snippet(null,null,'Em exclusão','[{"name":"X"}]'); raise exception 'Deleting account saved a template';
  exception when sqlstate '55000' then null; end;
end $$;

-- Templates go with their owner.
reset role;
delete from auth.users where id='c4110000-0000-4000-8000-000000000001';
do $$ begin
  assert not exists(select 1 from public.document_snippets where owner_user_id='c4110000-0000-4000-8000-000000000001'), 'Templates outlived the owner';
end $$;
rollback;
