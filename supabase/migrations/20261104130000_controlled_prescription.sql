-- D8 (04/11/2026): Receita de Controle Especial in Cortex. Contract:
-- docs/prescriptions/RECEITA_CONTROLE_ESPECIAL.md. Owner: Claude
-- (prescription domain), reserved in coordination/ESTADO.md.
--
-- 1. New document type. The rules (lists C1/C5 and adendos, 3 items, quantity
--    in words, patient address and CPF) live in generate-prescription.
-- 2. Prescriber CPF, required for anabolic steroids (list C5, Lei 9.965/2000).
--    Stored as 11 digits with a valid check digit; only the owner reads it.

alter table public.prescriptions drop constraint if exists prescriptions_doc_type_check;
alter table public.prescriptions add constraint prescriptions_doc_type_check
  check (doc_type in ('receita_simples', 'receita_antimicrobiano', 'atestado', 'solicitacao_exames', 'receita_controle_especial'));

alter table public.user_settings
  add column prescriber_cpf text,
  add constraint user_settings_prescriber_cpf_valid check (
    prescriber_cpf is null or (prescriber_cpf ~ '^[0-9]{11}$' and public.valid_patient_cpf(prescriber_cpf))
  );

-- Same contract as 20261104100000 plus 'prescriber_cpf'. Both runtime guards
-- are declared explicitly: CREATE OR REPLACE would otherwise drop them.
create or replace function public.update_user_settings(p_patch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_template uuid; v_phone text; v_rqe text; v_cpf text;
begin
  perform public.assert_clinical_actor();
  perform public.assert_session_assurance();
  if v_user is null then raise exception 'Não autorizado' using errcode = '42501'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in (
      'specialty','live_copilot_enabled','doctor_name','crm_number','crm_uf','professional_address','active_template_id',
      'professional_phone','rqe','prescriber_cpf'
    )
  ) then raise exception 'Configuração inválida' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_each(p_patch) e where
    (e.key in ('specialty','doctor_name','crm_number','crm_uf','professional_address','professional_phone','rqe','prescriber_cpf') and
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
  v_phone := nullif(trim(p_patch->>'professional_phone'), '');
  v_rqe := nullif(trim(p_patch->>'rqe'), '');
  v_cpf := nullif(regexp_replace(coalesce(p_patch->>'prescriber_cpf', ''), '[^0-9]', '', 'g'), '');
  if v_phone is not null and (v_phone !~ '^[+0-9 ().-]+$'
      or length(regexp_replace(v_phone, '[^0-9]', '', 'g')) not between 10 and 15) then
    raise exception 'Telefone profissional inválido: informe com DDD' using errcode = '22023';
  end if;
  if v_rqe is not null and (length(v_rqe) > 60 or v_rqe ~ '[[:cntrl:]]') then
    raise exception 'RQE inválido' using errcode = '22023';
  end if;
  if v_cpf is not null and (trim(p_patch->>'prescriber_cpf') !~ '^[0-9.[:space:]-]+$' or v_cpf !~ '^[0-9]{11}$' or not public.valid_patient_cpf(v_cpf)) then
    raise exception 'CPF do prescritor inválido' using errcode = '22023';
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
    prescriber_cpf = case when p_patch ? 'prescriber_cpf' then v_cpf else prescriber_cpf end,
    active_template_id = case when p_patch ? 'active_template_id' then v_template else active_template_id end,
    updated_at = now()
  where user_id = v_user;
end;
$$;
revoke all on function public.update_user_settings(jsonb) from public, anon;
grant execute on function public.update_user_settings(jsonb) to authenticated, service_role;
