-- L5: leaving a clinic ends reception delegations; accepting another invitation
-- requires a new explicit grant. Keep every chart and administrative history.
create function cortex_private.revoke_inactive_doctor_scopes() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare removed integer;
begin
 -- A real write rejects old REPEATABLE READ snapshots. NOWAIT also orders this
 -- against grants without waiting behind their parent/FK or assignment locks.
 perform cortex_private.touch_custody_epoch();
 delete from public.staff_doctor_scopes where clinic_id=new.clinic_id and doctor_user_id=new.user_id;
 get diagnostics removed=row_count;
 if removed>0 then
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(new.clinic_id,auth.uid(),'doctor_scopes_revoked',new.user_id,jsonb_build_object('count',removed));
 end if;
 return null;
end $$;
create trigger reception_doctor_scopes_revoke after update of status on public.clinic_members
 for each row when(new.status<>'active') execute function cortex_private.revoke_inactive_doctor_scopes();

create function cortex_private.guard_active_scope_doctor() returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
 -- AFTER ROW, alphabetically after custody_reference: its epoch write must
 -- precede this fresh membership read, including for privileged direct writers.
 if not exists(select 1 from public.clinic_members where clinic_id=new.clinic_id and user_id=new.doctor_user_id and status='active') then
  raise exception 'Médico indisponível na clínica' using errcode='42501';
 end if;
 return null;
end $$;
create trigger reception_scope_active_doctor after insert or update on public.staff_doctor_scopes
 for each row execute function cortex_private.guard_active_scope_doctor();
revoke all on function cortex_private.revoke_inactive_doctor_scopes(),cortex_private.guard_active_scope_doctor()
 from public,anon,authenticated,service_role;

-- Repair only objectively inactive/invited memberships. Active grants have no
-- historical provenance sufficient to infer whether they were renewed.
do $$ declare r record;begin
 for r in with removed as (
  delete from public.staff_doctor_scopes s using public.clinic_members m
  where m.clinic_id=s.clinic_id and m.user_id=s.doctor_user_id and m.status<>'active'
  returning s.clinic_id,s.doctor_user_id
 ) select clinic_id,doctor_user_id,count(*) as count from removed group by clinic_id,doctor_user_id loop
  insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id,details)
   values(r.clinic_id,null,'doctor_scopes_revoked',r.doctor_user_id,jsonb_build_object('count',r.count));
 end loop;
end $$;
