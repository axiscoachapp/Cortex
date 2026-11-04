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
-- Codex 17:53: the formula predicate is total (never NULL) and matches the
-- server's formulaError: trimmed lengths, no control characters, vehicle ''
-- allowed but blank refused, JSON null and wrong types refused.
do $$ begin
 assert public.valid_snippet_formula('{}'::jsonb) is false,'Empty formula not false';
 assert public.valid_snippet_formula('{"components":[{"substance":"A","amount":"1 mg"}]}'::jsonb) is false,'Formula without form/quantity not false';
 assert public.valid_snippet_formula('null'::jsonb) is false,'JSON null formula not false';
 assert public.valid_snippet_formula('{"components":[{"substance":"A","amount":"1 mg"}],"form":null,"quantity":"30"}'::jsonb) is false,'Null form not false';
 assert not public.valid_snippet_items('[{"name":"F","formula":{}}]'),'Template with an empty formula accepted';
 assert not public.valid_snippet_items('[{"name":"F","formula":null}]'),'Template with a null formula accepted';
 assert not public.valid_snippet_items(jsonb_build_array(jsonb_build_object('name','F','formula',jsonb_build_object(
  'components',jsonb_build_array(jsonb_build_object('substance','A'||chr(10)||'B','amount','1 mg')),'form','cápsula','quantity','30')))),'Line break in a component accepted';
 assert not public.valid_snippet_items(jsonb_build_array(jsonb_build_object('name','F','formula',jsonb_build_object(
  'components',jsonb_build_array(jsonb_build_object('substance','A','amount','1 mg')),'form','cáp'||chr(9)||'sula','quantity','30')))),'Tab in the form accepted';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":"   ","amount":"1 mg"}],"form":"cápsula","quantity":"30"}}]'),'Blank substance accepted';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":"A","amount":"1 mg"}],"vehicle":"   ","form":"cápsula","quantity":"30"}}]'),'Blank vehicle accepted';
 assert public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":"A","amount":"1 mg"}],"vehicle":"","form":"cápsula","quantity":"30"}}]'),'Empty vehicle refused (server accepts it)';
 assert not public.valid_snippet_items(('[{"name":"F","formula":{"components":[{"substance":"A","amount":"1 mg"}],"form":"cápsula","quantity":"'||repeat('9',41)||'"}}]')::jsonb),'Quantity over 40 accepted';
 assert public.valid_snippet_items(('[{"name":"F","formula":{"components":[{"substance":"A","amount":"1 mg"}],"form":"cápsula","quantity":"  '||repeat('9',40)||'  "}}]')::jsonb),'Trimmed quantity of 40 refused';
 assert not public.valid_snippet_items('[{"name":"F","formula":{"components":[{"substance":1,"amount":"1 mg"}],"form":"cápsula","quantity":"30"}}]'),'Numeric substance accepted';
end $$;
-- Codex 19:10: Unicode spaces, code points outside the BMP and C1 controls
-- are refused, trim is U+0020 only and lengths count characters, exactly as
-- formulaError (same cases in src/lib/regulatedMedications.test.ts).
do $$
declare
 base jsonb := '{"components":[{"substance":"A","amount":"1 mg"}],"form":"cápsula","quantity":"30"}';
 comp jsonb;
begin
 comp := jsonb_build_array(jsonb_build_object('substance',U&'\00A0','amount','1 mg'));
 assert public.valid_snippet_formula(jsonb_set(base,'{components}',comp)) is false,'Substance of only NBSP accepted';
 comp := jsonb_build_array(jsonb_build_object('substance',repeat(U&'\+01F600',61),'amount','1 mg'));
 assert public.valid_snippet_formula(jsonb_set(base,'{components}',comp)) is false,'61 emoji accepted';
 assert public.valid_snippet_formula(jsonb_set(base,'{quantity}',to_jsonb('1'||repeat(U&'\00A0',40)))) is false,'Quantity with NBSP accepted';
 assert public.valid_snippet_formula(jsonb_set(base,'{form}',to_jsonb(U&'c\00E1psula \+01F48A'::text))) is false,'Emoji in the form accepted';
 comp := jsonb_build_array(jsonb_build_object('substance',U&'A\0085B','amount','1 mg'));
 assert public.valid_snippet_formula(jsonb_set(base,'{components}',comp)) is false,'C1 control accepted';
 assert public.valid_snippet_formula(jsonb_set(base,'{form}',to_jsonb(U&'\FEFFc\00E1psula'::text))) is false,'BOM accepted';
 comp := jsonb_build_array(jsonb_build_object('substance','A','amount',U&'1 mg\3000'));
 assert public.valid_snippet_formula(jsonb_set(base,'{components}',comp)) is false,'Ideographic space accepted';
 comp := jsonb_build_array(jsonb_build_object('substance',repeat(U&'\00E1',120),'amount','1 mg'));
 assert public.valid_snippet_formula(jsonb_set(base,'{components}',comp)) is true,'Accented substance of 120 refused';
 comp := jsonb_build_array(jsonb_build_object('substance',repeat(U&'\00E1',121),'amount','1 mg'));
 assert public.valid_snippet_formula(jsonb_set(base,'{components}',comp)) is false,'Accented substance of 121 accepted';
 assert public.valid_snippet_formula(base) is true,'Base formula refused';
end $$;
rollback;
