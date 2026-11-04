import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Called only by the endpoint-pinned runner on its owned disposable database.
export async function exerciseAuthenticatedCutUpgrade({ sql, result, session, required, migration }) {
  const checks = [];
  assert.match(migration, /commit;\s*$/i);
  const heldMigration = migration.replace(/commit;\s*$/i, '');
  assert.equal(sql("select to_regprocedure('cortex_private.guard_authenticated_legacy_scope()') is null"), 't');
  for (const isolation of ['read committed', 'repeatable read']) {
    const admin = randomUUID(), doctor = randomUUID(), staff = randomUUID(), clinic = randomUUID();
    sql(`insert into auth.users(id,email) values('${admin}','${admin}@example.invalid'),('${doctor}','${doctor}@example.invalid'),('${staff}','${staff}@example.invalid');
      insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic cut upgrade','${admin}');
      insert into public.clinic_members(clinic_id,user_id,role,status) values('${clinic}','${admin}','admin','active'),('${clinic}','${doctor}','doctor','active');
      insert into public.clinic_staff_members(user_id,clinic_id,name) values('${staff}','${clinic}','Synthetic upgrade staff');
      insert into public.staff_doctor_scopes(clinic_id,staff_user_id,doctor_user_id) values('${clinic}','${staff}','${admin}');`);
    const claims = `set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${admin}';`;
    const old = session(), installer = session();
    try {
      // Warm both the old public setter plan and the old table-trigger cache,
      // then release their write locks before establishing the old snapshot.
      old.send(`begin;${claims}set local role authenticated;select public.update_reception_staff('${staff}',array['${admin}'::uuid],true);
        reset role;update public.staff_doctor_scopes set doctor_user_id=doctor_user_id where staff_user_id='${staff}';commit;
        begin isolation level ${isolation};select count(*) from public.staff_doctor_scopes;select 'REQUEST_HELD';`);
      await old.held();
      installer.send(heldMigration + "\nselect 'REQUEST_HELD';"); await installer.held();
      const pending = old.end(`set local lock_timeout='12s';${claims}set local role authenticated;select public.update_reception_staff('${staff}',array['${admin}'::uuid,'${doctor}'::uuid],true);commit;`);
      pending.catch(() => {});
      let blocked = false;
      for (let n = 0; n < 35; n++) {
        if (sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.application_name='${installer.name}'
          where w.application_name='${old.name}' and h.pid=any(pg_blocking_pids(w.pid)) and w.wait_event_type='Lock')`) === 't') { blocked = true; break; }
        await new Promise(done => setTimeout(done, 30));
      }
      assert.ok(blocked, 'Old writer never waited for the held installer');
      required(await installer.end('commit;'));
      const outcome = await pending;
      assert.notEqual(outcome.status, 0);
      assert.match(outcome.stderr, /42501: Authenticated legacy delegation requires physician approval/);
      assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${staff}' and doctor_user_id='${doctor}'`), '0');
      assert.equal(sql(`select count(*) from public.staff_doctor_scopes where staff_user_id='${staff}' and doctor_user_id='${admin}' and delegation_request_id is null`), '1');
      checks.push(`${isolation}: warmed old writer/snapshot waits for installer and cannot create a grant after its commit`);
      // Do not leave this installation fixture's scope in the later suites,
      // whose transactions intentionally start with an empty scope table.
      sql(`delete from public.staff_doctor_scopes where clinic_id='${clinic}' and staff_user_id='${staff}'`);
    } finally { await old.end('rollback;'); await installer.end('rollback;'); }
    // Restore only this prototype's newly created guard, before the runner's
    // final atomic installation and regular regression suites.
    sql('drop trigger zzz_authenticated_legacy_scope on public.staff_doctor_scopes;drop function cortex_private.guard_authenticated_legacy_scope();');
  }
  assert.equal(sql("select to_regprocedure('cortex_private.guard_authenticated_legacy_scope()') is null"), 't');
  return checks;
}
