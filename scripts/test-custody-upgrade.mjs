import assert from 'node:assert/strict';

// Exercises the actual reserved migration against the predecessor, not a
// copied installation body. Called only by the owned disposable DB harness.
export async function exerciseCustodyUpgrade({ sql, result, session, required, accounts, patients, migration }) {
  const checks = [];
  const legacyUser = 'fc100000-0000-4000-8000-000000000001';
  sql(`insert into auth.users(id,email) values('${legacyUser}','legacy-custody-upgrade@example.invalid');`);
  const apply = (busyCase = false) => result("set default_transaction_isolation='repeatable read';set lock_timeout='0';set statement_timeout='" + (busyCase ? '2s' : '25s') + "';" + migration);
  const noPartialSchema = () => assert.equal(sql("select to_regclass('cortex_private.account_custody_epochs') is null and to_regclass('cortex_private.custody_resource_epochs') is null"), 't');
  async function blockedUpgrade(name, holderSql, expected, commit) {
    const holder = session();
    try {
      holder.send('begin;' + holderSql + "select 'EPOCH_HELD';"); await holder.held();
      const revision = sql('select revision from cortex_private.custody_epoch');
      const failed = apply(true); assert.notEqual(failed.status, 0); assert.match(failed.stderr, expected);
      noPartialSchema();
      assert.equal(sql('select revision from cortex_private.custody_epoch'), revision, 'Failed installation advanced the legacy epoch');
      required(await holder.end(commit ? 'commit;' : 'rollback;'));
    } finally { await holder.end('rollback;'); }
    checks.push(name);
  }
  await blockedUpgrade('upgrade refuses an open old deletion intent and leaves no partial schema',
    `insert into public.account_deletion_requests(user_id) values('${legacyUser}');`, /40001: Custody installation busy/, true);
  // The internal writer has no authenticated EXECUTE grant. Invoke its actual
  // body as the RPC's definer, retaining the doctor's claims; do not grant it.
  await blockedUpgrade('upgrade refuses the internal old model writer before its table INSERT',
    `set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='${accounts[0]}';select public.document_snippet_writer();`,
    /40001: Custody installation busy/, false);
  await blockedUpgrade('pre-barrier table writer refuses installation NOWAIT and rolls back bridge increment',
    'lock table public.patients in row exclusive mode;', /55P03: could not obtain lock/, false);

  const oldSnapshot = session();
  try {
    oldSnapshot.send("begin isolation level repeatable read;select count(*) from public.patients;select count(*) from auth.users;select 'EPOCH_HELD';"); await oldSnapshot.held();
    const before = Number(sql('select revision from cortex_private.custody_epoch'));
    required(apply());
    checks.push('installation forces READ COMMITTED despite RR session default and coexists with old Auth readers');
    assert.equal(Number(sql('select revision from cortex_private.custody_epoch')), before + 1);
    const clinic = 'fc200000-0000-4000-8000-000000000001';
    sql(`insert into public.clinics(id,name,created_by) values('${clinic}','Synthetic custody upgrade','${accounts[0]}');`);
    const attemptedReference = result(`insert into public.clinic_contacts(clinic_id,name,created_by,request_id) values('${clinic}','Synthetic refused after upgrade','${legacyUser}',gen_random_uuid());`);
    assert.notEqual(attemptedReference.status, 0); assert.match(attemptedReference.stderr, /55000: Account deletion in progress/);
    assert.equal(sql(`select exists(select 1 from public.account_deletion_requests where user_id='${legacyUser}') and not exists(select 1 from public.clinic_contacts where created_by='${legacyUser}')`), 't');
    checks.push('retry installs atomically after old holder commits and preserves its deletion intent');
    const stale = await oldSnapshot.end(`insert into public.consultation_drafts(user_id,patient_id) values('${accounts[0]}','${patients[0]}') on conflict(user_id,patient_id) do update set content='{}';commit;`);
    assert.notEqual(stale.status, 0); assert.match(stale.stderr, /40001: could not serialize access/);
    assert.match(stale.stderr, /touch_custody_resources/);
    checks.push('RR writer from before installation cannot bypass newly installed resource epochs');
  } finally { await oldSnapshot.end('rollback;'); }

  const legacyOnly = session();
  try {
    legacyOnly.send("begin;select revision from cortex_private.custody_epoch for update;select 'EPOCH_HELD';"); await legacyOnly.held();
    sql(`insert into public.consultation_drafts(user_id,patient_id) values('${accounts[1]}','${patients[1]}') on conflict(user_id,patient_id) do update set content='{}';`);
    required(await legacyOnly.end('rollback;'));
  } finally { await legacyOnly.end('rollback;'); }
  checks.push('new runtime writes succeed while the retained legacy singleton row is locked');
  return checks;
}
