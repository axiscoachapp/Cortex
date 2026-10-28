-- Bounded summary loading, exact counts and today's linked patients without clinical blobs.
create function public.workspace_directory(p_limit integer default 100) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; begin
 perform public.assert_session_assurance();
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501';end if;
 with owned as materialized (
   select id,name,age,date_of_birth,profession,last_visit,status,revision,phone,email from public.patients
   where user_id=auth.uid() and deletion_requested_at is null
 ), chosen as (
   (select id from owned order by name,id limit greatest(1,least(p_limit,200)))
   union (select id from owned order by last_visit desc nulls last,id limit 5)
   union (select id from owned where status='retorno' order by last_visit asc nulls last,id limit 4)
   union (select distinct p.id from owned p join public.appointments a on a.patient_id=p.id and a.user_id=auth.uid()
      where (a.start_time at time zone 'America/Sao_Paulo')::date=(now() at time zone 'America/Sao_Paulo')::date order by p.id limit 200)
 )
 select jsonb_build_object('patients',coalesce((select jsonb_agg(to_jsonb(p) order by p.name,p.id) from owned p join chosen c using(id)),'[]'::jsonb),
   'counts',jsonb_build_object('total',(select count(*) from owned),'new',(select count(*) from owned where status='novo'),'returns',(select count(*) from owned where status='retorno')))
 into result;
 return result;
end $$;
revoke all on function public.workspace_directory(integer) from public,anon;
grant execute on function public.workspace_directory(integer) to authenticated;
