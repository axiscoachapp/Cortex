begin;
insert into auth.users(id,email) values('e1000000-0000-4000-8000-000000000001','contacts-admin@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('test.contacts_clinic',public.create_clinic('Clínica Diretório')::text,true);
reset role;
-- Same timestamp forces cursor tie-breaking by UUID, as with a bulk migration.
insert into public.clinic_contacts(clinic_id,name,phone,created_by,request_id)
select current_setting('test.contacts_clinic')::uuid,'Contato sintético '||n,'',
 'e1000000-0000-4000-8000-000000000001',gen_random_uuid() from generate_series(1,2500) n;
insert into public.clinic_contacts(clinic_id,name,phone,phone_normalized,created_by,request_id)
values(current_setting('test.contacts_clinic')::uuid,'Legado sem DDD','9999-1234',null,'e1000000-0000-4000-8000-000000000001',gen_random_uuid());
set local role authenticated;
do $$ declare page jsonb; next_page jsonb; begin
 page:=public.reception_contacts(current_setting('test.contacts_clinic')::uuid,'',null);
 assert jsonb_array_length(page->'items')=50 and page->>'nextCursor' is not null,'Contact directory is unbounded';
 next_page:=public.reception_contacts(current_setting('test.contacts_clinic')::uuid,'',(page->>'nextCursor')::uuid);
 assert jsonb_array_length(next_page->'items')=50,'Contact cursor lost tied records';
 assert not exists(select 1 from jsonb_array_elements(page->'items') a join jsonb_array_elements(next_page->'items') b on a->>'id'=b->>'id'),'Contact pagination repeated records';
 page:=public.reception_contacts(current_setting('test.contacts_clinic')::uuid,'99991234',null);
 assert jsonb_array_length(page->'items')=1 and page->'items'->0->>'phone'='9999-1234','Raw legacy phone was lost or silently assigned a DDD';
 assert (page->'items'->0)-array['id','name','phone','createdAt']='{}'::jsonb,'Contact projection exposed nonadministrative fields';
 begin perform public.reception_create_contact(current_setting('test.contacts_clinic')::uuid,'Manual sem DDD','99991234',gen_random_uuid());raise exception 'Ambiguous manual phone accepted';exception when invalid_parameter_value then null;end;
 -- Family numbers are intentionally nonunique and do not merge administrative identities.
 assert public.reception_create_contact(current_setting('test.contacts_clinic')::uuid,'Responsável um','41999991234',gen_random_uuid())
  <>public.reception_create_contact(current_setting('test.contacts_clinic')::uuid,'Responsável dois','41999991234',gen_random_uuid()),'Family contacts were merged by phone';
 begin perform public.reception_contacts('e9000000-0000-4000-8000-000000000001','',null);raise exception 'Foreign clinic directory read';exception when insufficient_privilege then null;end;
end $$;
rollback;
