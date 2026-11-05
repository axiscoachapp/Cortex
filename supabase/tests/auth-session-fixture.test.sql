-- Metadata fixture only: no live Auth server, bearer validation or real MFA.
begin;
insert into auth.users(id,email) values('af510000-0000-4000-8000-000000000001','auth-fixture@example.invalid');
insert into auth.mfa_factors(id,user_id,status,factor_type)
 values('af520000-0000-4000-8000-000000000001','af510000-0000-4000-8000-000000000001','verified','totp');
insert into auth.sessions(id,user_id,factor_id,aal)
 values('af530000-0000-4000-8000-000000000001','af510000-0000-4000-8000-000000000001','af520000-0000-4000-8000-000000000001','aal2');
-- Native sessions allow nullable factor/AAL/deadlines and refreshed_at has no TZ.
insert into auth.sessions(id,user_id) values('af530000-0000-4000-8000-000000000002','af510000-0000-4000-8000-000000000001');
do $$ begin
 assert exists(select 1 from auth.sessions where id='af530000-0000-4000-8000-000000000002'
  and factor_id is null and aal is null and not_after is null and created_at is null and updated_at is null and refreshed_at is null),'Nullable native session fields changed';
 begin insert into auth.sessions(id,user_id) values(gen_random_uuid(),null);
  raise exception 'Fixture accepted an ownerless session';exception when not_null_violation then null;end;
 begin insert into auth.sessions(id,user_id,aal) values(gen_random_uuid(),'af510000-0000-4000-8000-000000000001','unknown');
  raise exception 'Fixture accepted an unknown assurance';exception when invalid_text_representation then null;end;
 begin insert into auth.mfa_factors(user_id,status,factor_type) values('af510000-0000-4000-8000-000000000001','unknown','totp');
  raise exception 'Fixture accepted an unknown factor status';exception when invalid_text_representation then null;end;
 begin insert into auth.mfa_factors(user_id,status,factor_type) values(null,'verified','totp');
  raise exception 'Fixture accepted an ownerless factor';exception when not_null_violation then null;end;
 begin insert into auth.mfa_factors(user_id,status,factor_type) values('af510000-0000-4000-8000-000000000001',null,'totp');
  raise exception 'Fixture accepted a factor without status';exception when not_null_violation then null;end;
end $$;
-- Table ACL checks alone miss a per-column grant, including for BYPASSRLS.
savepoint fixture_column_acl;
grant select(id) on auth.sessions to service_role;
do $$ begin
 assert not has_table_privilege('service_role','auth.sessions','SELECT'),'Column control unexpectedly granted the whole table';
 assert has_any_column_privilege('service_role','auth.sessions','SELECT'),'Column ACL control was not installed';
end $$;
set local role service_role;
select count(id) from auth.sessions;
reset role;
-- Preserve any preexisting grant for the negative assertion below to detect.
rollback to savepoint fixture_column_acl;
release savepoint fixture_column_acl;
-- Native factor_id has no FK: removing a factor does not prove a live factor
-- merely because its old UUID remains on a session. The authorizer must join.
delete from auth.mfa_factors where id='af520000-0000-4000-8000-000000000001';
do $$ begin
 assert exists(select 1 from auth.sessions where id='af530000-0000-4000-8000-000000000001' and factor_id='af520000-0000-4000-8000-000000000001'),'Fixture invented a factor cascade';
end $$;
-- Keep a second factor alive so the user cascade assertion is non-vacuous.
insert into auth.mfa_factors(id,user_id,status,factor_type)
 values('af520000-0000-4000-8000-000000000002','af510000-0000-4000-8000-000000000001','unverified','phone');
do $$ begin
 assert exists(select 1 from auth.mfa_factors where id='af520000-0000-4000-8000-000000000002'),'Factor cascade control is absent';
end $$;
delete from auth.users where id='af510000-0000-4000-8000-000000000001';
do $$ declare r text; t text;begin
 assert not exists(select 1 from auth.sessions where user_id='af510000-0000-4000-8000-000000000001'),'Session user cascade missing';
 assert not exists(select 1 from auth.mfa_factors where user_id='af510000-0000-4000-8000-000000000001'),'Factor user cascade missing';
 foreach r in array array['anon','authenticated','service_role'] loop
  foreach t in array array['auth.sessions','auth.mfa_factors'] loop
   assert not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),'Client received Auth table privileges';
   assert not has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE,REFERENCES'),'Client received Auth column privileges';
  end loop;
 end loop;
end $$;
rollback;
