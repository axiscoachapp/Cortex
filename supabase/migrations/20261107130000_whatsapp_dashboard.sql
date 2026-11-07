-- Reception dashboard (K2/1) aggregate for whatsapp-api `dashboard`. Owner: Claude (C4); consumer and
-- review: Codex. Contract: docs/product/clinic-crm/RECEPTION_DASHBOARD_READ.md and the v1.4 section of
-- docs/product/whatsapp/CONTRATO.md. Read only; returns counts and user ids, never message content,
-- phones or patient identifiers.
--
-- - Cycle: only the latest opening of each conversation (opened_at); reopenings replace history,
--   so coverage is 'latest_cycle_only'.
-- - Start: earliest inbound message created_at at or after opened_at; the cohort is the cycles that
--   started in [p_from, p_to).
-- - First human send: earliest outbound message with sent_by set, status sent/delivered/read, created_at
--   at or after the start. Bot and automation messages (sent_by null), pending, unknown and failed do
--   not count. Seconds between the two created_at (elapsed time, not business hours).
-- - openNow: every open conversation of the clinic at the snapshot, by current owner. An owner who is
--   no longer eligible (same rule as act/assign) counts only in assignedToIneligible.
create function public.whatsapp_dashboard(p_clinic uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cohort jsonb; open_now jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception 'Escolha um período de até 31 dias' using errcode = '22023';
  end if;
  with cycles as (
    select c.id, c.status,
      (select min(m.created_at) from public.whatsapp_messages m
        where m.conversation_id = c.id and m.direction = 'in' and m.created_at >= c.opened_at) as started_at
    from public.whatsapp_conversations c where c.clinic_id = p_clinic
  ), cohort_rows as (
    select y.status, y.started_at,
      (select min(m.created_at) from public.whatsapp_messages m
        where m.conversation_id = y.id and m.direction = 'out' and m.sent_by is not null
          and m.status in ('sent', 'delivered', 'read') and m.created_at >= y.started_at) as first_human
    from cycles y where y.started_at >= p_from and y.started_at < p_to
  )
  select jsonb_build_object(
    'incomingCycles', count(*),
    'withHumanSend', count(first_human),
    'withoutHumanSend', count(*) - count(first_human),
    'medianFirstHumanSendSeconds', round((percentile_cont(0.5) within group (order by extract(epoch from first_human - started_at))
      filter (where first_human is not null))::numeric),
    'closedWithoutHumanSend', count(*) filter (where first_human is null and status = 'closed'))
  into cohort from cohort_rows;

  with open_rows as (
    select c.assigned_to,
      c.assigned_to is not null and (
        exists (select 1 from public.clinic_staff_members s where s.clinic_id = p_clinic and s.user_id = c.assigned_to and s.active)
        or exists (select 1 from public.clinic_members m where m.clinic_id = p_clinic and m.user_id = c.assigned_to and m.role = 'admin' and m.status = 'active')
      ) as eligible
    from public.whatsapp_conversations c where c.clinic_id = p_clinic and c.status = 'open'
  )
  select jsonb_build_object(
    'total', count(*),
    'unassigned', count(*) filter (where assigned_to is null),
    'assignedToIneligible', count(*) filter (where assigned_to is not null and not eligible),
    'owners', coalesce((select jsonb_agg(jsonb_build_object('userId', o.assigned_to, 'openCount', o.n) order by o.assigned_to)
      from (select assigned_to, count(*) as n from open_rows where eligible group by assigned_to) o), '[]'::jsonb))
  into open_now from open_rows;

  return jsonb_build_object('cohort', cohort, 'openNow', open_now);
end $$;

revoke all on function public.whatsapp_dashboard(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_dashboard(uuid, timestamptz, timestamptz) to service_role;
