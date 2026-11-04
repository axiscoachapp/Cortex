-- Reference catalogs (20261105110000): read by signed-in users, written only by
-- the service role; prescription templates accept compounded formulas.
-- Synthetic rows only.
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
insert into public.exam_catalog(code,name,exam_group) values('40304361','Exame laboratorial sintético','laboratorio');
insert into public.cid10_catalog(code,description,kind,sex) values('N76.0','Diagnóstico sintético','subcategoria','F');
insert into public.medication_presentations(ggrem,registration9,product,presentation,eans) values('538912020009303','170560023','PRODUTO SINTÉTICO','10 MG X 30','{7891106000956}');
insert into public.dcb_catalog(dcb_number,name,classification) values(1,'substância sintética','IFA'),(1,'outra substância sintética','IFA');
insert into public.reference_catalog_versions(source,source_url,rows_loaded,sha256) values('tuss','https://example.invalid/tuss.zip',1,repeat('a',64));
reset role;

do $$ begin
 begin insert into public.exam_catalog(code,name,exam_group) values('123','x','laboratorio');
  raise exception 'Malformed TUSS code accepted';exception when check_violation then null;end;
 begin insert into public.cid10_catalog(code,description,kind) values('N760','x','subcategoria');
  raise exception 'Unformatted CID accepted';exception when check_violation then null;end;
 begin insert into public.reference_catalog_versions(source,source_url,rows_loaded,sha256) values('outro','https://x',1,repeat('a',64));
  raise exception 'Unknown catalog source accepted';exception when check_violation then null;end;
end $$;

-- Signed-in users read every catalog and write none.
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e9100000-0000-4000-8000-000000000001',true);
do $$ begin
 assert (select count(*) from public.exam_catalog)=1 and (select count(*) from public.cid10_catalog)=1
  and (select count(*) from public.medication_presentations)=1 and (select count(*) from public.dcb_catalog)=2
  and (select count(*) from public.reference_catalog_versions)=1,'Catalogs not readable by signed-in users';
 begin insert into public.exam_catalog(code,name,exam_group) values('40304362','Inserido pelo cliente','laboratorio');
  raise exception 'Client wrote a catalog';exception when insufficient_privilege then null;end;
 begin update public.cid10_catalog set description='alterado';
  raise exception 'Client changed a catalog';exception when insufficient_privilege then null;end;
 begin delete from public.dcb_catalog;
  raise exception 'Client deleted a catalog';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ declare t text; begin
 foreach t in array array['exam_catalog','cid10_catalog','medication_presentations','dcb_catalog','reference_catalog_versions'] loop
  assert not has_table_privilege('anon','public.'||t,'select'),'Anonymous read of '||t;
  assert (select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS off on '||t;
 end loop;
end $$;

-- Templates keep a compounded formula with the same limits as the server.
do $$ begin
 assert public.valid_snippet_items('[{"name":"Fórmula","dosage":"1 cápsula","instructions":"à noite","formula":{"components":[{"substance":"Substância sintética","amount":"100 mg"}],"vehicle":"Excipiente q.s.p.","form":"cápsula","quantity":"30 cápsulas"}}]'),
  'Valid formula refused in a template';
 assert public.valid_snippet_items('[{"name":"Comum","dosage":"1","instructions":"x"}]'),'Plain item refused';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[],"form":"cápsula","quantity":"30"}}]'),'Empty components accepted';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":"A","amount":"bastante"}],"form":"cápsula","quantity":"30"}}]'),'Amount without number accepted';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":"A","amount":"1 mg"}],"form":"cápsula","quantity":"30","price":1}}]'),'Unknown formula key accepted';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":"A","amount":"1 mg"}],"form":"cápsula","quantity":"muitas"}}]'),'Quantity without number accepted';
end $$;
rollback;
