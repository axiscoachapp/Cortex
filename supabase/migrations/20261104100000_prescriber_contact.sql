-- Prescriber contact on documents: professional phone and RQE.
-- RDC Anvisa 471/2021 requires the prescriber's phone on antimicrobial
-- prescriptions; Res. CFM 2.381/2024 asks for phone or e-mail and the RQE
-- (specialist registration) when there is one. Owner: Claude (prescription
-- domain), reserved in coordination/ESTADO.md.

alter table public.user_settings
  add column professional_phone text,
  add column rqe text;

alter table public.user_settings
  add constraint user_settings_professional_phone_valid check (
    professional_phone is null
    or (professional_phone ~ '^[+0-9 ().-]+$'
        and length(regexp_replace(professional_phone, '[^0-9]', '', 'g')) between 10 and 15)
  ),
  add constraint user_settings_rqe_valid check (
    rqe is null or (length(rqe) between 1 and 60 and rqe !~ '[[:cntrl:]]')
  );

-- Same contract as before plus the two new keys. Both guards that earlier
-- migrations injected at runtime (session assurance and clinical actor) are
-- declared explicitly here: CREATE OR REPLACE would otherwise drop them.
create or replace function public.update_user_settings(p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_template uuid; v_phone text; v_rqe text;
begin
  perform public.assert_clinical_actor();
  perform public.assert_session_assurance();
  if v_user is null then raise exception 'Não autorizado' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in (
      'specialty','live_copilot_enabled','doctor_name','crm_number','crm_uf','professional_address','active_template_id',
      'professional_phone','rqe'
    )
  ) then raise exception 'Configuração inválida' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_each(p_patch) e where
    (e.key in ('specialty','doctor_name','crm_number','crm_uf','professional_address','professional_phone','rqe') and
      (jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 1000)) or
    (e.key = 'live_copilot_enabled' and jsonb_typeof(e.value) <> 'boolean') or
    (e.key = 'active_template_id' and jsonb_typeof(e.value) not in ('string','null'))
  ) then raise exception 'Tipo de configuração inválido' using errcode = '22023'; end if;
  if p_patch ? 'active_template_id' then
    v_template := (p_patch->>'active_template_id')::uuid;
    if v_template is not null and not exists (
      select 1 from public.document_templates where id = v_template and (user_id is null or user_id = v_user)
    ) then raise exception 'Modelo não autorizado' using errcode = '42501'; end if;
  end if;
  -- Empty text clears the optional contact fields; invalid values get a clear message.
  v_phone := nullif(trim(p_patch->>'professional_phone'), '');
  v_rqe := nullif(trim(p_patch->>'rqe'), '');
  if v_phone is not null and (v_phone !~ '^[+0-9 ().-]+$'
      or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 10 and 15) then
    raise exception 'Telefone profissional inválido: informe com DDD' using errcode = '22023';
  end if;
  if v_rqe is not null and (length(v_rqe) > 60 or v_rqe ~ '[[:cntrl:]]') then
    raise exception 'RQE inválido' using errcode = '22023';
  end if;
  insert into public.user_settings(user_id) values (v_user) on conflict (user_id) do nothing;
  update public.user_settings set
    specialty = case when p_patch ? 'specialty' then p_patch->>'specialty' else specialty end,
    live_copilot_enabled = case when p_patch ? 'live_copilot_enabled' then (p_patch->>'live_copilot_enabled')::boolean else live_copilot_enabled end,
    doctor_name = case when p_patch ? 'doctor_name' then trim(p_patch->>'doctor_name') else doctor_name end,
    crm_number = case when p_patch ? 'crm_number' then trim(p_patch->>'crm_number') else crm_number end,
    crm_uf = case when p_patch ? 'crm_uf' then upper(trim(p_patch->>'crm_uf')) else crm_uf end,
    professional_address = case when p_patch ? 'professional_address' then trim(p_patch->>'professional_address') else professional_address end,
    professional_phone = case when p_patch ? 'professional_phone' then v_phone else professional_phone end,
    rqe = case when p_patch ? 'rqe' then v_rqe else rqe end,
    active_template_id = case when p_patch ? 'active_template_id' then v_template else active_template_id end,
    updated_at = now()
  where user_id = v_user;
end;
$$;
revoke all on function public.update_user_settings(jsonb) from public, anon;
grant execute on function public.update_user_settings(jsonb) to authenticated, service_role;
