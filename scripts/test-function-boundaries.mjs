import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Called only with the disposable database owned by test-database.mjs. Every
// fault is transaction-local; a failed psql connection rolls it back on exit.
export function testFunctionBoundaryRegressions(container) {
  const suite = readFileSync('supabase/tests/reception-function-boundaries.test.sql', 'utf8');
  const sql = source => spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres',
    '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: "set statement_timeout='15s';set lock_timeout='5s';\n" + source,
    encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
  });
  const cases = [
    {
      name: 'new authenticated definer requires review',
      fault: `create function public.boundary_test_probe() returns jsonb language sql security definer set search_path='' as $$ select '{}'::jsonb $$;
        revoke all on function public.boundary_test_probe() from public,anon;`,
      marker: 'Unreviewed authenticated SECURITY DEFINER API: boundary_test_probe()',
    },
    {
      name: 'private helper granted to authenticated',
      fault: 'grant execute on function public.storage_parent_is_live(text,text) to authenticated;',
      marker: 'Unreviewed authenticated SECURITY DEFINER API: storage_parent_is_live(text,text)',
    },
    {
      name: 'private helper granted to anon',
      fault: 'grant execute on function public.has_foreign_deletion_children(text,uuid,uuid) to anon;',
      marker: 'Anonymous SECURITY DEFINER API: has_foreign_deletion_children(text,uuid,uuid)',
    },
    {
      name: 'clinical redefine loses identity guard',
      fault: `create or replace function public.workspace_directory(p_limit integer default 100) returns jsonb
        language plpgsql stable security definer set search_path='' as $$ begin return '{}'::jsonb; end $$;`,
      marker: 'Reception reached clinical RPC: workspace_directory(integer)',
    },
    {
      name: 'clinical redefine bypasses inactive reception only',
      fault: `create or replace function public.workspace_directory(p_limit integer default 100) returns jsonb
        language plpgsql stable security definer set search_path='' as $$ begin
        if exists(select 1 from public.clinic_staff_members where user_id=auth.uid() and active) then
          perform public.assert_clinical_actor(); end if; return '{}'::jsonb; end $$;`,
      marker: 'Reception reached clinical RPC: workspace_directory(integer)',
    },
    {
      name: 'shared RPC resource denial cannot masquerade as identity guard',
      fault: `create or replace function public.check_shared_patient_access(p_patient_id uuid) returns jsonb
        language plpgsql security definer set search_path='' as $$ begin
        raise exception 'Patient unavailable' using errcode='42501'; end $$;`,
      marker: 'Reception reached clinical RPC: check_shared_patient_access(uuid)',
    },
    {
      name: 'knowledge redefine loses reception target guard',
      fault: `do $$ declare definition text; begin
        select pg_get_functiondef('public.match_knowledge(uuid,vector,integer)'::regprocedure) into definition;
        assert position('not public.is_reception_account(p_user_id) and ' in definition)>0, 'Mutation target missing';
        execute replace(definition,'not public.is_reception_account(p_user_id) and ',''); end $$;`,
      marker: 'Reception retrieved previously owned knowledge',
    },
  ];
  for (const { name, fault, marker } of cases) {
    // A replacement callback preserves SQL dollar quotes literally; a string
    // replacement would interpret $$ and silently turn it into a single $.
    const mutated = suite.replace(/^begin;$/m, () => 'begin;\n' + fault);
    assert.notEqual(mutated, suite, 'Suite transaction boundary missing');
    const result = sql(mutated);
    assert.notEqual(result.status, 0, 'Regression was not detected: ' + name);
    assert.match(result.stderr, /ERROR:\s+P0004:/, 'Expected assertion failure for ' + name + ': ' + result.stderr);
    assert.ok(result.stderr.includes(marker), 'Wrong failure for ' + name + ': ' + result.stderr);
    process.stdout.write('Passed function boundary fault: ' + name + '\n');
  }
  const clean = sql(suite);
  assert.equal(clean.status, 0, 'Fault leaked outside its rollback: ' + clean.stderr);
  process.stdout.write('Passed function boundary fault rollback and clean rerun\n');
}
