alter table public.user_settings drop constraint if exists user_settings_specialty_check;
alter table public.user_settings add constraint user_settings_specialty_check check(specialty in (
 'geral','psiquiatria','cardiologia','pediatria','ginecologia','prenatal','urologia','dermatologia','neurologia','ortopedia','endocrinologia'
));
