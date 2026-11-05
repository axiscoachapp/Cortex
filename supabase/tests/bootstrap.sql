-- Minimal Supabase schemas for disposable PostgreSQL policy tests. No external services.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, email_confirmed_at timestamptz DEFAULT now(), raw_app_meta_data jsonb NOT NULL DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
CREATE TYPE auth.aal_level AS ENUM ('aal1','aal2','aal3');
CREATE TYPE auth.factor_status AS ENUM ('unverified','verified');
CREATE TYPE auth.factor_type AS ENUM ('totp','webauthn','phone');
CREATE TABLE auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,status auth.factor_status not null,factor_type auth.factor_type not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
CREATE TABLE auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,created_at timestamptz,updated_at timestamptz,factor_id uuid,aal auth.aal_level,not_after timestamptz,refreshed_at timestamp without time zone);
ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,storage TO anon,authenticated,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
-- Supabase's legacy public-schema defaults include direct function grants.
-- Revoking PUBLIC alone must not appear to secure a function in these tests.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
