-- This operation updates the active list only after the physician accepts the
-- exact saved medication entry against both source and patient revisions.
create function public.approve_medication_reconciliation(p_item_id uuid,p_item_revision integer,p_patient_revision integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare item public.clinical_work_items; patient public.patients; entry jsonb; updated_entry jsonb;
 result jsonb:='[]'::jsonb; matched boolean:=false; key text; state text; effective_date text;
begin
 perform public.assert_session_assurance();
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_item_revision is null or p_patient_revision is null then raise exception 'Review revisions required' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,123));
 select * into item from public.clinical_work_items where id=p_item_id and user_id=auth.uid() and kind='medication' for update;
 if not found then raise exception 'Medication entry unavailable' using errcode='42501'; end if;
 select * into patient from public.patients where id=item.patient_id and user_id=auth.uid() and deletion_requested_at is null for update;
 if not found or exists(select 1 from public.account_deletion_requests where user_id=auth.uid()) then raise exception 'Patient unavailable' using errcode='42501'; end if;
 if item.status='approved' and item.details ? 'reconciledAt' then return true; end if;
 if item.revision is distinct from p_item_revision or patient.revision is distinct from p_patient_revision then raise exception 'Clinical source changed; compare before approval' using errcode='40001'; end if;
 if item.status<>'open' or jsonb_typeof(patient.medications) is distinct from 'array' then raise exception 'Medication list unavailable'; end if;
 key:=lower(trim(item.title)); state:=item.details->>'state'; effective_date:=item.details->>'date';
 if key='' or state not in ('active','changed','stopped') or nullif(trim(item.content),'') is null or (state<>'stopped' and nullif(trim(item.details->>'dosage'),'') is null) then raise exception 'Review name, dose, instructions and state'; end if;
 for entry in select value from jsonb_array_elements(patient.medications) loop
  if lower(trim(entry->>'name'))=key then
   if state<>'stopped' and not matched then
    updated_entry:=entry||jsonb_build_object('name',trim(item.title),'dosage',trim(item.details->>'dosage'),'instructions',item.content,
      'startedAt',coalesce(nullif(entry->>'startedAt',''),effective_date),'sourceRecordId',item.id,'lastReconciledAt',now());
    result:=result||jsonb_build_array(updated_entry);
   end if;
   matched:=true;
  else result:=result||jsonb_build_array(entry); end if;
 end loop;
 if not matched and state<>'stopped' then
  result:=result||jsonb_build_array(jsonb_build_object('name',trim(item.title),'dosage',trim(item.details->>'dosage'),'instructions',item.content,'startedAt',effective_date,'sourceRecordId',item.id,'lastReconciledAt',now()));
 end if;
 update public.patients set medications=result where id=patient.id;
 update public.clinical_work_items set status='approved',details=details||jsonb_build_object('reconciledAt',now(),'reconciledBy',auth.uid(),'patientRevisionBefore',patient.revision) where id=item.id;
 return true;
end;
$$;
revoke all on function public.approve_medication_reconciliation(uuid,integer,integer) from public,anon;
grant execute on function public.approve_medication_reconciliation(uuid,integer,integer) to authenticated;
