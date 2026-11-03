alter table public.patients add column cpf text;
alter table public.patients add column sex text;
alter table public.patients add column health_insurance text;

create function public.valid_patient_cpf(value text) returns boolean language plpgsql immutable set search_path='' as $$
declare digits text; total integer; digit integer; n integer; i integer;
begin
  if value is null or trim(value)='' then return true; end if;
  if value !~ '^[0-9.[:space:]-]+$' then return false; end if;
  digits:=regexp_replace(value,'[^0-9]','','g');
  if digits !~ '^[0-9]{11}$' or digits ~ '^([0-9])\1{10}$' then return false; end if;
  for n in 9..10 loop
    total:=0;
    for i in 1..n loop total:=total+substring(digits from i for 1)::integer*(n+2-i); end loop;
    digit:=(total*10)%11;
    if digit=10 then digit:=0; end if;
    if substring(digits from n+1 for 1)::integer<>digit then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.valid_patient_cpf(text) from public,anon;
grant execute on function public.valid_patient_cpf(text) to authenticated,service_role;

create function public.validate_patient_registration() returns trigger language plpgsql set search_path='' as $$
begin
  -- Validate only newly entered/changed fields. Legacy charts can still receive
  -- unrelated clinical updates without destructive normalization of old values.
  if tg_op='INSERT' or new.name is distinct from old.name then
    new.name:=trim(new.name);
    if new.name is null or length(new.name) not between 2 and 200 or new.name !~ '[[:alpha:]]' or lower(regexp_replace(new.name,'[^[:alpha:]]','','g')) ~ '^([[:alpha:]])\1{2,}$' then raise exception 'Nome de paciente inválido' using errcode='23514'; end if;
  end if;
  if tg_op='INSERT' or new.profession is distinct from old.profession then
    new.profession:=trim(new.profession);
    if length(new.profession)>200 or lower(regexp_replace(new.profession,'[^[:alpha:]]','','g')) ~ '^([[:alpha:]])\1{2,}$' then raise exception 'Profissão inválida' using errcode='23514'; end if;
  end if;
  if (tg_op='INSERT' or new.age is distinct from old.age) and new.age is not null and new.age not between 0 and 130 then raise exception 'Idade inválida' using errcode='23514'; end if;
  if (tg_op='INSERT' or new.date_of_birth is distinct from old.date_of_birth) and new.date_of_birth>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data de nascimento futura' using errcode='23514'; end if;
  if tg_op='INSERT' or new.cpf is distinct from old.cpf then
    if not public.valid_patient_cpf(new.cpf) then raise exception 'CPF inválido' using errcode='23514'; end if;
    new.cpf:=nullif(regexp_replace(coalesce(new.cpf,''),'[^0-9]','','g'),'');
  end if;
  if (tg_op='INSERT' or new.sex is distinct from old.sex) and new.sex is not null and new.sex not in ('feminino','masculino','intersexo','nao_informado') then raise exception 'Sexo inválido' using errcode='23514'; end if;
  if (tg_op='INSERT' or new.health_insurance is distinct from old.health_insurance) and length(new.health_insurance)>120 then raise exception 'Convênio inválido' using errcode='23514'; end if;
  if (tg_op='INSERT' or new.email is distinct from old.email) and nullif(trim(new.email),'') is not null and (length(new.email)>254 or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'E-mail inválido' using errcode='23514'; end if;
  if (tg_op='INSERT' or new.phone is distinct from old.phone) and nullif(trim(new.phone),'') is not null and (new.phone !~ '^[+0-9[:space:]().-]+$' or length(regexp_replace(new.phone,'[^0-9]','','g')) not between 10 and 15) then raise exception 'Telefone inválido' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.validate_patient_registration() from public,anon,authenticated;
create trigger validate_patient_registration before insert or update on public.patients for each row execute function public.validate_patient_registration();
