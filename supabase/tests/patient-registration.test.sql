begin;
insert into auth.users(id,email) values('f0000000-0000-4000-8000-000000000001','registration@example.invalid');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
do $$ declare patient uuid; begin
  insert into public.patients(user_id,name,age,status,cpf,phone,email,sex,health_insurance) values(auth.uid(),'Li',0,'novo','529.982.247-25','11999999999','synthetic@example.invalid','nao_informado','Convênio sintético') returning id into patient;
  assert (select cpf='52998224725' and age=0 from public.patients where id=patient),'Newborn or normalized CPF lost';
  update public.patients set phone='21999999999',email='edited@example.invalid' where id=patient;
  assert (select phone='21999999999' and email='edited@example.invalid' from public.patients where id=patient),'Contact editor did not persist';
  begin insert into public.patients(user_id,name,status) values(auth.uid(),'hhh','novo'); raise exception 'Placeholder name accepted'; exception when check_violation then null; end;
  begin update public.patients set profession='jjj' where id=patient; raise exception 'Placeholder profession accepted'; exception when check_violation then null; end;
  begin update public.patients set cpf='11111111111' where id=patient; raise exception 'Invalid CPF accepted'; exception when check_violation then null; end;
  begin update public.patients set email='invalid' where id=patient; raise exception 'Invalid email accepted'; exception when check_violation then null; end;
  begin update public.patients set phone='12' where id=patient; raise exception 'Invalid phone accepted'; exception when check_violation then null; end;
  begin update public.patients set age=-1 where id=patient; raise exception 'Negative age accepted'; exception when check_violation then null; end;
end $$;
rollback;
