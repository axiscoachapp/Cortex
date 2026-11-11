-- Patient context for the assistant: what a returning patient's record gives the model.
-- Owner: Claude. Replaces public.retrieve_patient_context from 20261029000200 (same signature and grants).
--
-- Measured on 2026-11-11 with a synthetic patient of 16 consultations (docs/reviews/2026-11-10/
-- revisao-geral/AVALIACAO_IA_PACIENTE_ANTIGO.md). The previous version:
-- 1. built the query with websearch_to_tsquery, which requires EVERY word of the question in the
--    same consultation, so ordinary questions matched nothing and the ranking fell back to recency;
-- 2. returned ts_headline excerpts, which for a non-matching query are only the first 100 words of
--    each note: the plan (at the end) was cut from every consultation, including the last one;
-- 3. reported truncated = false for those excerpts;
-- 4. dropped every consultation beyond 12 without telling the model they existed.
--
-- Now:
-- - any word of the question counts (OR), and the rank orders by how much matches;
-- - the 4 most recent consultations always come, plus the 8 best matches among the others;
-- - each selected note comes whole when it has up to 6000 characters; a longer one comes as excerpts
--   around the matched words (or its beginning without a match), and only then `truncated` is true;
-- - consultations left out come as an index line (date, complaint, start of the assessment), up
--   to 40, so the model knows what exists and can say where to look;
-- - the result is ordered by date, most recent first, as the prompt says.
create or replace function public.retrieve_patient_context(p_user_id uuid, p_patient_id uuid, p_question text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_terms text;
  v_query tsquery;
  v_consultations jsonb;
  v_index jsonb;
  v_documents jsonb;
  v_consultation_count integer;
  v_document_count integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and user_id = p_user_id and deletion_requested_at is null) then
    raise exception 'Patient not found' using errcode = '42501';
  end if;

  -- Lexemes of the question joined with OR. They are already stemmed, so the 'simple' configuration
  -- parses them back without stemming twice. A question made only of stop words gives no query.
  select string_agg('''' || replace(lexeme, '''', '''''') || '''', ' | ')
    into v_terms
    from unnest(tsvector_to_array(to_tsvector('portuguese', left(coalesce(p_question, ''), 4000)))) as lexeme;
  if v_terms is not null then v_query := to_tsquery('simple', v_terms); end if;

  select count(*) into v_consultation_count from public.consultations where patient_id = p_patient_id and user_id = p_user_id;
  select count(*) into v_document_count from public.patient_files where patient_id = p_patient_id and user_id = p_user_id;

  with base as (
    select c.id, c.created_at, c.chief_complaint, coalesce(c.soap_note, '') as note,
      case when v_query is null then 0
        else ts_rank_cd(to_tsvector('portuguese', coalesce(c.chief_complaint, '') || ' ' || coalesce(c.soap_note, '')), v_query) end as score,
      row_number() over (order by c.created_at desc, c.id) as recency
    from public.consultations c
    where c.patient_id = p_patient_id and c.user_id = p_user_id
  ), picked as (
    select * from base order by (recency <= 4) desc, score desc, created_at desc, id limit 12
  ), rest as (
    select b.* from base b where not exists (select 1 from picked p where p.id = b.id) order by b.created_at desc, b.id limit 40
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'created_at', p.created_at, 'chief_complaint', p.chief_complaint,
        -- A note that fits comes whole. A longer one comes as excerpts around the matched words when
        -- there is a match (the evidence may be far from the start), otherwise as its beginning.
        'soap_note', case when length(p.note) <= 6000 then p.note
          when p.score > 0 then left(ts_headline('portuguese', p.note, v_query, 'MaxWords=600,MinWords=200,MaxFragments=4,StartSel=[,StopSel=]'), 6000)
          else left(p.note, 6000) end,
        'truncated', length(p.note) > 6000) order by p.created_at desc, p.id), '[]'::jsonb) from picked p),
    (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'chief_complaint', r.chief_complaint,
        -- Start of the assessment when the note has the usual "**A" heading; otherwise the start of the note.
        'excerpt', left(regexp_replace(substr(r.note, greatest(strpos(r.note, '**A'), 1)), '\s+', ' ', 'g'), 320))
        order by r.created_at desc, r.id), '[]'::jsonb) from rest r)
    into v_consultations, v_index;

  select coalesce(jsonb_agg(to_jsonb(r) - 'score' order by r.created_at desc, r.id), '[]'::jsonb) into v_documents from (
    select d.id, d.created_at, d.file_name, left(d.body, 2000) as ai_summary, d.ai_review_status, length(d.body) > 2000 as truncated,
      case when v_query is null then 0 else ts_rank_cd(to_tsvector('portuguese', d.file_name || ' ' || d.body), v_query) end as score
    from (
      select f.id, f.created_at, f.file_name, f.ai_review_status,
        coalesce(case when f.ai_review_status = 'accepted' then f.ai_review_receipt->>'note'
                      when f.ai_review_status = 'pending' then f.ai_summary else null end, '') as body
      from public.patient_files f where f.patient_id = p_patient_id and f.user_id = p_user_id
    ) d
    order by score desc, d.created_at desc, d.id limit 12
  ) r;

  return jsonb_build_object('consultations', v_consultations, 'index', v_index, 'documents', v_documents,
    'coverage', jsonb_build_object(
      'consultationsTotal', v_consultation_count, 'documentsTotal', v_document_count,
      'consultationsRetrieved', jsonb_array_length(v_consultations), 'consultationsIndexed', jsonb_array_length(v_index),
      'documentsRetrieved', jsonb_array_length(v_documents),
      'limited', v_consultation_count > jsonb_array_length(v_consultations) or v_document_count > jsonb_array_length(v_documents)));
end;
$$;

revoke all on function public.retrieve_patient_context(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.retrieve_patient_context(uuid, uuid, text) to service_role;
