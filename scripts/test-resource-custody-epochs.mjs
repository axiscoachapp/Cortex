import assert from 'node:assert/strict';

// Imported only by the owned local DB harness. Never accepts an external target.
export async function exerciseResourceCustody({ sql, result, session, required, accounts, patients, clinic }) {
  const checks = [];
  const busy = /40001: Custody changed concurrently; retry the transaction/;
  const refused = response => { assert.notEqual(response.status, 0); assert.match(response.stderr, busy); };
  const id = (kind, n) => `fb${kind}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const users = [1, 2, 3, 4].map(n => id('10', n));
  sql(`insert into auth.users(id,email) values ${users.map((uid, n) => `('${uid}','resource-epoch-${n}@example.invalid')`).join(',')};`);
  const appointmentSql = (appointment, patient = null) => {
    const hour = String(11 + Number(appointment.slice(-2))).padStart(2, '0');
    return `insert into public.appointments(id,user_id,patient_id,title,start_time,end_time) values('${appointment}','${users[0]}',${patient ? `'${patient}'` : 'null'},'Synthetic resource appointment','2099-12-02T${hour}:00Z','2099-12-02T${hour}:30Z');`;
  };
  const auditSql = appointment => `insert into public.reception_audit(clinic_id,actor_user_id,action,resource_id) values('${clinic}','${accounts[0]}','synthetic_resource_fence','${appointment}');`;
  const mark = user => `insert into public.account_deletion_requests(user_id) values('${user}');`;
  const touch = key => `select cortex_private.touch_custody_resources(array['${key}']);`;
  async function overlap(name, firstSql, secondSql, verify = null) {
    const first = session();
    try {
      first.send('begin;' + firstSql + "select 'EPOCH_HELD';"); await first.held();
      refused(result("begin;set local lock_timeout='0';set local statement_timeout='2s';" + secondSql + 'commit;'));
      required(await first.end('rollback;'));
      if (verify) assert.equal(sql(verify), 't');
    } finally { await first.end('rollback;'); }
    checks.push(name);
  }
  // Both real-table orders of the missing polymorphic parent counterexample.
  const future = id('20', 1), reverse = id('20', 2);
  await overlap('absent appointment: open audit refuses future parent creation', auditSql(future), appointmentSql(future),
    `select not exists(select 1 from public.appointments where id='${future}')`);
  await overlap('absent appointment reverse: uncommitted parent refuses audit', appointmentSql(reverse), auditSql(reverse));
  // Preserve legitimate audit-before-parent behavior after a commit, and ensure
  // its now-visible restrictive reference prevents the owner's deletion intent.
  sql(auditSql(future) + appointmentSql(future));
  const intentAfterAudit = result(mark(users[0]));
  assert.notEqual(intentAfterAudit.status, 0); assert.match(intentAfterAudit.stderr, /P4092: Administrative custody/);
  checks.push('committed audit before parent stays valid and then prevents owner deletion');

  const template = id('30', 1);
  sql(`insert into public.document_templates(id,user_id,name,content) values('${template}',null,'Synthetic builtin','Synthetic');`);
  const settings = `insert into public.user_settings(user_id,active_template_id) values('${users[1]}','${template}');`;
  const changeOwner = `update public.document_templates set user_id='${users[2]}' where id='${template}';`;
  await overlap('NULL-owned template: open settings refuses new owner', settings, changeOwner,
    `select user_id is null from public.document_templates where id='${template}'`);
  await overlap('NULL-owned template reverse: owner change refuses settings', changeOwner, settings);
  sql(settings);
  assert.equal(sql(`select active_template_id='${template}' from public.user_settings where user_id='${users[1]}'`), 't');
  checks.push('builtin template reference remains usable after committed setup');
  await overlap('removing reference fences only the OLD NULL-owned template resource', touch('document_template:' + template),
    `update public.user_settings set active_template_id=null where user_id='${users[1]}';`);

  // First tuple creation is covered before the unique index can wait. This
  // key deliberately has no corresponding application parent row.
  const lazy = 'appointment:' + id('40', 1);
  await overlap('two lazy initializations refuse immediately without unique-index wait', touch(lazy), touch(lazy));
  const definition = sql("select pg_get_functiondef('cortex_private.touch_custody_resources(text[])'::regprocedure)");
  const withoutTry = definition.replace(/  if not pg_try_advisory_xact_lock\([\s\S]*?  end if;/, '');
  assert.notEqual(definition, withoutTry, 'Advisory fault injection did not change the helper');
  const unsafeHolder = session();
  try {
    sql(withoutTry);
    unsafeHolder.send('begin;' + touch(lazy) + "select 'EPOCH_HELD';"); await unsafeHolder.held();
    const waiting = result("begin;set local lock_timeout='0';set local statement_timeout='2s';" + touch(lazy) + 'commit;');
    assert.notEqual(waiting.status, 0); assert.match(waiting.stderr, /57014: canceling statement due to statement timeout/);
    required(await unsafeHolder.end('rollback;'));
  } finally { await unsafeHolder.end('rollback;'); sql(definition); }
  checks.push('removing advisory try is detected as unique-index wait/57014 instead of immediate 40001');
  for (const existing of [false, true]) {
    const key = 'appointment:' + id('40', existing ? 3 : 2);
    if (existing) sql(touch(key));
    const old = session();
    try {
      old.send("begin isolation level repeatable read;select count(*) from cortex_private.custody_resource_epochs;select 'EPOCH_HELD';");
      await old.held(); sql(touch(key));
      const stale = await old.end(touch(key) + 'commit;');
      assert.notEqual(stale.status, 0); assert.match(stale.stderr, /40001: could not serialize access/);
    } finally { await old.end('rollback;'); }
    checks.push(existing ? 'RR snapshot rejects resource version changed after snapshot' : 'RR snapshot rejects resource tuple initialized after snapshot');
  }
  const keyOwner = session(), sameUuid = id('40', 4);
  try {
    keyOwner.send('begin;' + touch('appointment:' + sameUuid) + "select 'EPOCH_HELD';"); await keyOwner.held();
    sql(touch('patient:' + sameUuid)); required(await keyOwner.end('rollback;'));
  } finally { await keyOwner.end('rollback;'); }
  checks.push('resource type namespaces keep identical UUIDs independent');

  async function staleReal(name, snapshot, concurrent, write, verify) {
    const old = session();
    try {
      old.send('begin isolation level repeatable read;' + snapshot + "select 'EPOCH_HELD';"); await old.held();
      sql(concurrent);
      const stale = await old.end(write + 'commit;');
      assert.notEqual(stale.status, 0); assert.match(stale.stderr, /40001: could not serialize access/);
      assert.equal(sql(verify), 't');
    } finally { await old.end('rollback;'); }
    checks.push(name);
  }
  const afterSnapshot = id('20', 4), oldCreator = id('20', 5);
  await staleReal('RR real audit rejects parent/resource created after snapshot', 'select count(*) from public.appointments;',
    appointmentSql(afterSnapshot), auditSql(afterSnapshot), `select not exists(select 1 from public.reception_audit where resource_id='${afterSnapshot}')`);
  await staleReal('RR real parent creation rejects audit committed after snapshot', 'select count(*) from public.reception_audit;',
    auditSql(oldCreator), appointmentSql(oldCreator), `select not exists(select 1 from public.appointments where id='${oldCreator}')`);
  const rrTemplate = id('30', 3), reverseTemplate = id('30', 4), rrSettingsUser = id('60', 2);
  sql(`insert into auth.users(id,email) values('${rrSettingsUser}','rr-resource-settings@example.invalid');
    insert into public.document_templates(id,name,content) values('${rrTemplate}','Synthetic RR builtin','Synthetic'),('${reverseTemplate}','Synthetic reverse RR builtin','Synthetic');`);
  await staleReal('RR real settings rejects template ownership changed after snapshot', 'select count(*) from public.document_templates;',
    `update public.document_templates set user_id='${users[0]}' where id='${rrTemplate}';`,
    `insert into public.user_settings(user_id,active_template_id) values('${users[2]}','${rrTemplate}');`,
    `select not exists(select 1 from public.user_settings where user_id='${users[2]}')`);
  await staleReal('RR real template ownership rejects new reference committed after snapshot', 'select count(*) from public.user_settings;',
    `insert into public.user_settings(user_id,active_template_id) values('${rrSettingsUser}','${reverseTemplate}');`,
    `update public.document_templates set user_id='${users[2]}' where id='${reverseTemplate}';`,
    `select user_id is null from public.document_templates where id='${reverseTemplate}'`);

  // Holding only a patient resource (no account epoch) proves the second-level
  // appointment.patient_id lookup cannot omit its resource fence.
  const patient = id('50', 1), appointment = id('20', 3);
  sql(`insert into public.patients(id,user_id,name,status) values('${patient}','${users[0]}','Synthetic indirect patient','novo');` + appointmentSql(appointment, patient));
  await overlap('audit fences the indirect patient of an appointment', touch('patient:' + patient), auditSql(appointment));
  await overlap('parent DELETE uses the same resource fence', auditSql(appointment), `delete from public.appointments where id='${appointment}';`);

  // BEFORE auth init must work even when an alphabetically earlier AFTER hook
  // writes application data in the same INSERT statement.
  const seeded = id('60', 1);
  sql(`create function cortex_private.lab_after_auth_settings() returns trigger language plpgsql security definer set search_path='' as $$ begin
    insert into public.user_settings(user_id) values(new.id);return new;end $$;
    create trigger a_lab_settings after insert on auth.users for each row execute function cortex_private.lab_after_auth_settings();
    insert into auth.users(id,email) values('${seeded}','resource-auth-after@example.invalid');
    drop trigger a_lab_settings on auth.users;drop function cortex_private.lab_after_auth_settings();`);
  assert.equal(sql(`select exists(select 1 from public.user_settings where user_id='${seeded}') and exists(select 1 from cortex_private.account_custody_epochs where user_id='${seeded}')`), 't');
  checks.push('BEFORE auth epoch permits a real AFTER hook to insert settings');

  // Preserve the preflight that forbids deleting an owner whose template is
  // still used by a different account; prove only genuinely permitted cascades.
  const owned = id('30', 2);
  sql(`insert into public.document_templates(id,user_id,name,content) values('${owned}','${users[3]}','Synthetic cascade template','Synthetic');
    update public.user_settings set active_template_id='${owned}' where user_id='${users[1]}';`);
  const foreign = result(`delete from auth.users where id='${users[3]}';`);
  assert.notEqual(foreign.status, 0); assert.match(foreign.stderr, /P4090:/);
  sql(`update public.user_settings set active_template_id=null where user_id='${users[1]}';
    insert into public.user_settings(user_id,active_template_id) values('${users[3]}','${owned}');
    ${mark(users[3])}delete from auth.users where id='${users[3]}';`);
  assert.equal(sql(`select not exists(select 1 from public.user_settings where user_id='${users[3]}')
    and exists(select 1 from cortex_private.account_custody_epochs where user_id='${users[3]}')
    and exists(select 1 from cortex_private.custody_resource_epochs where resource_key='document_template:${owned}')`), 't');
  sql(`update public.user_settings set active_template_id='${template}' where user_id='${users[1]}';
    delete from public.document_templates where id='${template}';`);
  assert.equal(sql(`select active_template_id is null from public.user_settings where user_id='${users[1]}'`), 't');
  checks.push('foreign template dependency still denies Auth deletion; eligible own cascade and builtin SET NULL preserve tombstones');
  assert.equal(sql("select not has_table_privilege('authenticated','cortex_private.custody_resource_epochs','select') and not has_table_privilege('service_role','cortex_private.custody_resource_epochs','insert') and not has_function_privilege('authenticated','cortex_private.touch_custody_resources(text[])','execute')"), 't');
  checks.push('resource ledger and helper remain private to database guards');
  // Keep a positive check on the original unrelated patients after all cases.
  assert.equal(sql(`select count(*) from public.patients where id=any(array['${patients[0]}'::uuid,'${patients[1]}'::uuid])`), '2');
  return checks;
}
