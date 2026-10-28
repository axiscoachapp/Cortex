-- A password-only session cannot bypass an enrolled second factor through direct API requests.
create function public.session_assurance_ok() returns boolean language sql stable security definer set search_path='' as $$
 select auth.role()='service_role' or (auth.uid() is not null and (
   auth.jwt()->>'aal'='aal2' or not exists(select 1 from auth.mfa_factors f where f.user_id=auth.uid() and f.status='verified')
 ));
$$;
revoke all on function public.session_assurance_ok() from public,anon;
grant execute on function public.session_assurance_ok() to authenticated,service_role;
create function public.assert_session_assurance() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.session_assurance_ok(),false) then raise exception 'Verifique o segundo fator da sessão' using errcode='42501'; end if;
end $$;
revoke all on function public.assert_session_assurance() from public,anon;
grant execute on function public.assert_session_assurance() to authenticated,service_role;
do $$ declare table_name text; begin
 foreach table_name in array array['patients','appointments','consultations','consultation_drafts','patient_files','prescriptions','clinical_record_revisions','clinical_work_items','clinical_work_revisions','document_templates','knowledge_documents','knowledge_chunks','knowledge_review_events','user_settings','patient_shares','shared_chart_entries','chart_access_audit'] loop
   execute format('create policy session_assurance on public.%I as restrictive for all to authenticated using(public.session_assurance_ok()) with check(public.session_assurance_ok())',table_name);
 end loop;
end $$;
create policy session_assurance on storage.objects as restrictive for all to authenticated using(public.session_assurance_ok()) with check(public.session_assurance_ok());

-- Preserve the existing validated settings/revocation contracts while adding
-- the same assurance gate used by the new authenticated RPCs.
do $$ declare signature text; definition text; begin
 foreach signature in array array['public.update_user_settings(jsonb)','public.revoke_prescription(uuid)','public.get_integration_status(uuid)'] loop
   select pg_get_functiondef(signature::regprocedure) into definition;
   definition:=regexp_replace(definition,'\mBEGIN\M',E'BEGIN\n  PERFORM public.assert_session_assurance();','i');
   execute definition;
 end loop;
end $$;
