-- Owned laboratory only. No client/service grants or production facade.
begin;
create function provision_intent_lab.confirm_from_server(p_operation uuid,p_actor uuid,p_session uuid,p_aal text,p_exp bigint) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare clinic uuid;
begin
 select clinic_id into clinic from provision_intent_lab.intents where operation_id=p_operation;
 if not found then raise exception 'Clinic intent unavailable' using errcode='42501';end if;
 return provision_intent_lab.check_intent(p_operation,p_actor,p_session,clinic,p_aal,p_exp,true);
end $$;
revoke all on function provision_intent_lab.confirm_from_server(uuid,uuid,uuid,text,bigint) from public,anon,authenticated,service_role,
 provision_create_writer_lab,provision_confirm_writer_lab,provision_birth_writer_lab;
commit;
