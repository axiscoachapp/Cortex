import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// No external DB/env/credential target. Image versions are explicit, local-only
// and --pull=never. Every container/network belongs to this invocation.
const versions = process.argv.includes('--all') ? ['v2.197.0', 'v2.189.0'] : ['v2.197.0'];
const cleanupCheck = process.argv.includes('--check-cleanup');
const bindingMode = process.argv.includes('--binding');
assert.ok(process.argv.slice(2).every(arg => ['--all', '--check-cleanup', '--binding'].includes(arg)), 'Unknown lab option');
assert.ok(!(cleanupCheck && (process.argv.includes('--all') || bindingMode)), 'Choose normal lab or cleanup diagnostic');
const postgresImage = 'pgvector/pgvector:pg16';
const restImage = 'public.ecr.aws/supabase/postgrest:v16.5';
function required(result, stage) {
  // Do not echo Docker args, environment, Auth responses or container logs: they
  // may contain the random synthetic credentials retained only in memory.
  assert.equal(result.status, 0, 'Disposable lab failed at ' + stage);
  return result.stdout.trim();
}
assert.ok(!process.env.DOCKER_HOST, 'Lab refuses DOCKER_HOST overrides');
const contextRead = args => required(spawnSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 10000 }), 'local context metadata');
const contextName = contextRead(['context', 'show']);
const dockerEndpoint = JSON.parse(contextRead(['context', 'inspect', contextName, '--format', '{{json .Endpoints.docker.Host}}']));
assert.ok(/^npipe:\/{2,}\.\/pipe\/[^/]+$/.test(dockerEndpoint) || /^unix:\/\/\//.test(dockerEndpoint), 'Lab requires a verified local Docker pipe/socket');
const dockerEnvironment = { ...process.env };
for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete dockerEnvironment[key];
const dockerArgs = args => ['--host', dockerEndpoint, ...args];
const docker = (args, input, extraEnv = {}) => spawnSync('docker', dockerArgs(args), {
  input, env: { ...dockerEnvironment, ...extraEnv }, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
});
const pause = () => new Promise(done => setTimeout(done, 300));
const httpClientCode = `
  import {readFileSync} from 'node:fs';
  const q=JSON.parse(readFileSync(0,'utf8'));
  try {
    const r=await fetch(q.url,{method:q.method||'GET',headers:q.headers,body:q.body,signal:AbortSignal.timeout(q.timeout||10000)});
    const text=await r.text();console.log(JSON.stringify({status:r.status,body:text?JSON.parse(text):null}));
  } catch {console.log(JSON.stringify({status:0,body:null}));}
`;

const runs = cleanupCheck ? ['create', 'request'].map(fault => ({ version: 'v2.197.0', fault })) : versions.map(version => ({ version, fault: null }));
for (const { version, fault } of runs) {
  const prefix = 'cortex-password-lab-' + randomUUID().slice(0, 8);
  const names = { network: prefix, db: prefix + '-db', auth: prefix + '-auth', rest: prefix + '-rest', client: prefix + '-client' };
  const plannedContainers = new Set();
  const children = [];
  let networkPlanned = false;
  let report, failure;
  const expectedFault = new Error('Intentional owned-resource cleanup diagnostic');
  const jwtSecret = randomBytes(32).toString('hex');
  const syntheticSecrets = [jwtSecret];
  const adminJwt = (() => {
    const parts = [{ alg: 'HS256', typ: 'JWT' }, { role: 'service_role', aud: 'authenticated', iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 }]
      .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return parts + '.' + createHmac('sha256', jwtSecret).update(parts).digest('base64url');
  })();
  syntheticSecrets.push(adminJwt);
  const sql = source => {
    const result = docker(['exec', '-i', names.db, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], source);
    if (result.status !== 0) {
      let detail = result.stderr.split('\n').find(line => line.startsWith('ERROR:')) || 'SQL process failed';
      for (const secret of syntheticSecrets) detail = detail.replaceAll(secret, '[synthetic-secret]');
      throw new Error(detail);
    }
    return result.stdout.trim();
  };
  const start = (name, image, options, command = [], extraEnv = {}) => {
    plannedContainers.add(name);
    required(docker(['create', '--pull=never', '--label', 'cortex.test.run=' + prefix, '--name', name, '--network', names.network, ...options, image, ...command], undefined, extraEnv), 'container create');
    if (fault === 'create') throw expectedFault;
    required(docker(['start', name]), 'container start');
  };
  const observeChild = child => {
    const done = new Promise(resolveChild => { child.once('error', resolveChild); child.once('close', resolveChild); });
    child.stdin.on('error', () => {});
    children.push({ child, done });
  };
  // The HTTP client runs inside the internal network too: no published ports or
  // outbound route. Pass all request material on stdin, never CLI arguments.
  const transport = request => JSON.parse(required(docker(['exec', '-i', names.client, 'node', '--input-type=module', '-e', httpClientCode], JSON.stringify(request)), 'internal HTTP client'));
  const asyncHttp = (request, script = httpClientCode) => {
    const pending = new Promise((resolveRequest, reject) => {
    const child = spawn('docker', dockerArgs(['exec', '-i', names.client, 'node', '--input-type=module', '-e', script]), { env: dockerEnvironment, windowsHide: true });
    observeChild(child);
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Internal HTTP race timed out')); }, 20000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', () => { clearTimeout(timer); reject(new Error('Internal HTTP input failed')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('Internal HTTP race failed')); return; }
      try { resolveRequest(JSON.parse(output)); } catch { reject(new Error('Invalid internal HTTP JSON')); }
    });
    child.stdin.end(JSON.stringify(request));
    });
    // A request can fail while the main routine is still observing the barrier.
    // Observe rejection immediately, preserving it for the later await.
    pending.catch(() => {});
    return pending;
  };
  const ready = async (url, label) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (transport({ url, timeout: 1000 }).status === 200) return;
      await pause();
    }
    throw new Error(label + ' did not become ready (' + prefix + ')');
  };
  try {
    networkPlanned = true;
    required(docker(['network', 'create', '--internal', '--label', 'cortex.test.run=' + prefix, names.network]), 'network');
    start(names.db, postgresImage, ['--env', 'POSTGRES_HOST_AUTH_METHOD=trust']);
    let dbReady = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (docker(['exec', names.db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0) { dbReady = true; break; }
      await pause();
    }
    assert.ok(dbReady, 'Disposable database not ready');
    start(names.client, 'node:24-bookworm-slim', [], ['node', '-e', 'setInterval(()=>{},1000)']);
    if (fault === 'request') {
      const rejected = asyncHttp({}, 'console.log("{")');
      await new Promise(done => setTimeout(done, 1000));
      await assert.rejects(rejected, /Invalid internal HTTP JSON/);
      throw expectedFault;
    }
    sql(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create role authenticator login noinherit; grant anon,authenticated,service_role to authenticator;
      create role supabase_auth_admin login; create schema auth authorization supabase_auth_admin;
      alter role supabase_auth_admin set search_path=auth,public;
      grant usage,create on schema public to supabase_auth_admin;`);
    const authEnv = {
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999', API_EXTERNAL_URL: 'http://127.0.0.1',
      GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin@${names.db}:5432/postgres?sslmode=disable`,
      GOTRUE_SITE_URL: 'http://127.0.0.1', GOTRUE_DISABLE_SIGNUP: 'true', GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_MAILER_AUTOCONFIRM: 'true', GOTRUE_JWT_SECRET: jwtSecret, GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_JWT_EXP: '3600',
      GOTRUE_PASSWORD_MIN_LENGTH: '10', GOTRUE_SMTP_HOST: 'mail.synthetic.invalid', GOTRUE_SMTP_PORT: '25',
    };
    start(names.auth, 'public.ecr.aws/supabase/gotrue:' + version,
      Object.keys(authEnv).flatMap(key => ['--env', key]), [], authEnv);
    const auth = 'http://' + names.auth + ':9999';
    await ready(auth + '/health', 'Auth');
    sql(readFileSync('supabase/tests/prototypes/initial-password-auth.sql', 'utf8'));
    const restartAuth = async extraEnv => {
      required(docker(['rm', '--force', names.auth]), 'owned Auth restart');
      const nextEnv = { ...authEnv, ...extraEnv };
      start(names.auth, 'public.ecr.aws/supabase/gotrue:' + version, Object.keys(nextEnv).flatMap(key => ['--env', key]), [], nextEnv);
      await ready(auth + '/health', 'Auth restart');
    };
    const hookEnv = { GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'true', GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: 'pg-functions://postgres/password_lab/bind_access_token' };
    if (bindingMode) {
      sql(readFileSync('supabase/tests/prototypes/credential-session-binding.sql', 'utf8'));
      await restartAuth(hookEnv);
    }
    const restEnv = { PGRST_DB_URI: `postgres://authenticator@${names.db}:5432/postgres`, PGRST_DB_ANON_ROLE: 'anon',
      PGRST_DB_SCHEMAS: 'public', PGRST_JWT_SECRET: jwtSecret, PGRST_JWT_AUD: 'authenticated' };
    start(names.rest, restImage, Object.keys(restEnv).flatMap(key => ['--env', key]), [], restEnv);
    const rest = 'http://' + names.rest + ':3000';
    await ready(rest + '/', 'Data API');
    const call = async (base, path, token, body, method = body ? 'POST' : 'GET') => {
      return transport({ url: base + path, method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    };
    if (bindingMode) {
      const { exerciseCredentialBinding } = await import('./test-credential-binding.mjs');
      report = await exerciseCredentialBinding({ auth, rest, adminJwt, version, call, sql, asyncHttp, restartAuth: extra => restartAuth({ ...hookEnv, ...extra }),
        pause, syntheticSecrets, holderSession: () => {
          const child = spawn('docker', dockerArgs(['exec', '-i', names.db, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']), { env: dockerEnvironment, windowsHide: true });
          observeChild(child); child.stderr.resume(); return child;
        } });
    } else {
    const email = 'password-lab@example.invalid';
    const temporary = randomBytes(18).toString('hex');
    const personal = randomBytes(18).toString('hex');
    syntheticSecrets.push(temporary, personal);
    const createdUser = await call(auth, '/admin/users', adminJwt, { email, password: temporary, email_confirm: true,
      app_metadata: { initial_password_required: true }, user_metadata: { must_change_password: true } });
    assert.equal(createdUser.status, 200, 'Synthetic user creation failed');
    const userId = createdUser.body.id;
    assert.match(userId, /^[0-9a-f-]{36}$/);
    sql(`insert into public.lab_owner_only values('${userId}','Synthetic private row');insert into public.lab_guarded values('${userId}','Synthetic private row');`);
    const login = password => call(auth, '/token?grant_type=password', adminJwt, { email, password });
    const a = await login(temporary), b = await login(temporary);
    assert.equal(a.status, 200); assert.equal(b.status, 200);
    const read = (table, session) => call(rest, '/' + table + '?select=payload', session.body.access_token);
    const count = async (table, session) => { const result = await read(table, session); assert.equal(result.status, 200, 'Data API read failed'); return result.body.length; };
    const checks = [];
    assert.equal(await count('lab_owner_only', a), 1);
    assert.equal(await count('lab_guarded', a), 0);
    checks.push('owner RLS alone exposes the synthetic row before rotation; live pending-state guard denies it');
    assert.equal((await call(auth, '/user', a.body.access_token, { data: { must_change_password: false } }, 'PUT')).status, 200);
    assert.equal(await count('lab_guarded', a), 0);
    const illegal = await call(auth, '/user', a.body.access_token, { app_metadata: { initial_password_required: false } }, 'PUT');
    assert.equal(illegal.status, 403);
    assert.equal(sql(`select raw_app_meta_data->>'initial_password_required' from auth.users where id='${userId}'`), 'true');
    checks.push('user metadata clearing and direct app_metadata update cannot clear trusted pending state');
    const same = await call(auth, '/user', a.body.access_token, { password: temporary }, 'PUT');
    assert.equal(same.status, 422);
    const weak = await call(auth, '/user', a.body.access_token, { password: 'short' }, 'PUT');
    assert.equal(weak.status, 422);
    assert.equal(sql(`select raw_app_meta_data->>'initial_password_required' from auth.users where id='${userId}'`), 'true');
    checks.push('same and weak passwords do not clear trusted state');
    sql(`create function password_lab.fail_session_delete() returns trigger language plpgsql security definer set search_path='' as $$
      begin raise exception 'LAB_SESSION_ROLLBACK'; end $$;
      create trigger lab_fail_session_delete after delete on auth.sessions for each row execute function password_lab.fail_session_delete();`);
    const failed = await call(auth, '/user', a.body.access_token, { password: personal }, 'PUT');
    assert.equal(failed.status, 500, 'Session-delete fault did not abort rotation');
    assert.equal(sql(`select raw_app_meta_data->>'initial_password_required' from auth.users where id='${userId}'`), 'true');
    assert.equal(sql(`select count(*) from auth.sessions where user_id='${userId}'`), '2');
    sql('drop trigger lab_fail_session_delete on auth.sessions;drop function password_lab.fail_session_delete();');
    assert.equal((await login(personal)).status, 400, 'Failed rotation changed the password');
    checks.push('fault after other-session deletion rolls back password, pending flag and sessions together');
    const rotated = await call(auth, '/user', a.body.access_token, { password: personal }, 'PUT');
    assert.equal(rotated.status, 200, 'Native password rotation failed');
    assert.equal(sql(`select raw_app_meta_data->>'initial_password_required' from auth.users where id='${userId}'`), 'false');
    assert.equal(await count('lab_owner_only', b), 1);
    assert.equal(await count('lab_guarded', a), 0);
    assert.equal(await count('lab_guarded', b), 0);
    checks.push('after native password update old signed JWT still reads owner-only RLS; both pre-rotation JWTs fail prototype guard');
    const refreshedA = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: a.body.refresh_token });
    assert.equal(refreshedA.status, 200);
    assert.equal(await count('lab_guarded', refreshedA), 1);
    const refreshedB = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: b.body.refresh_token });
    assert.ok(refreshedB.status >= 400, 'Other session refresh survived password rotation');
    checks.push('only current refreshed session acquires a usable signed clear-state claim; other session refresh is revoked');
    const relogin = await login(personal);
    assert.equal(relogin.status, 200); assert.equal(await count('lab_guarded', relogin), 1);
    const oldPassword = await login(temporary);
    assert.ok(oldPassword.status >= 400);
    checks.push('new password login remains recoverable; initial password cannot sign in');
    // Pause a login AFTER the Auth password check but BEFORE session issuance.
    // This is a real HTTP request and an observed PostgreSQL advisory wait.
    const raceEmail = 'login-race@example.invalid';
    const raceTemporary = randomBytes(18).toString('hex'), racePersonal = randomBytes(18).toString('hex');
    syntheticSecrets.push(raceTemporary, racePersonal);
    const raceUser = await call(auth, '/admin/users', adminJwt, { email: raceEmail, password: raceTemporary, email_confirm: true,
      app_metadata: { initial_password_required: true } });
    assert.equal(raceUser.status, 200);
    const raceId = raceUser.body.id;
    assert.match(raceId, /^[0-9a-f-]{36}$/);
    const raceA = await call(auth, '/token?grant_type=password', adminJwt, { email: raceEmail, password: raceTemporary });
    assert.equal(raceA.status, 200);
    sql(`insert into public.lab_guarded values('${raceId}','Synthetic concurrent row');
      create function password_lab.pause_login() returns trigger language plpgsql security definer set search_path='' as $$ begin
      if new.payload->>'action'='login' and new.payload->>'actor_id'='${raceId}' then perform pg_advisory_xact_lock(736314);end if;return new;end $$;
      create trigger lab_pause_login before insert on auth.audit_log_entries for each row execute function password_lab.pause_login();`);
    const holder = spawn('docker', dockerArgs(['exec', '-i', names.db, 'psql', '-U', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1']), { env: dockerEnvironment, windowsHide: true });
    observeChild(holder); holder.stderr.resume();
    let held = false, holderOutput = '';
    holder.stdout.on('data', data => { holderOutput = (holderOutput + data).slice(-100); held = holderOutput.includes('LAB_HELD'); });
    holder.stdin.write("select pg_advisory_lock(736314);select 'LAB_HELD';\n");
    for (let attempt = 0; attempt < 30 && !held; attempt++) await pause();
    assert.ok(held, 'Login race barrier not held');
    const inFlight = asyncHttp({ url: auth + '/token?grant_type=password', method: 'POST', timeout: 18000,
      headers: { Authorization: 'Bearer ' + adminJwt, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: raceEmail, password: raceTemporary }) });
    let observed = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=736314 and not granted)") === 't') { observed = true; break; }
      await pause();
    }
    assert.ok(observed, 'Native Auth login did not reach the observed post-password barrier');
    assert.equal((await call(auth, '/user', raceA.body.access_token, { password: racePersonal }, 'PUT')).status, 200);
    sql(`create table password_lab.cutoff(user_id uuid primary key,rotated_at timestamptz not null);
      insert into password_lab.cutoff values('${raceId}',clock_timestamp());
      create function password_lab.session_after_rotation() returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from auth.sessions s join password_lab.cutoff c on c.user_id=s.user_id
       where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and s.created_at>=c.rotated_at) $$;
      revoke all on function password_lab.session_after_rotation() from public,anon;
      grant execute on function password_lab.session_after_rotation() to authenticated;
      create table public.lab_after_epoch(user_id uuid primary key,payload text);
      insert into public.lab_after_epoch values('${raceId}','Synthetic epoch row');
      alter table public.lab_after_epoch enable row level security;grant select on public.lab_after_epoch to authenticated;
      create policy epoch_read on public.lab_after_epoch for select to authenticated
       using(user_id=auth.uid() and password_lab.session_ready() and password_lab.session_after_rotation());
      notify pgrst,'reload schema';`);
    let schemaReady = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const probeRead = await read('lab_after_epoch', raceA);
      if (probeRead.status === 200) { assert.equal(probeRead.body.length, 0); schemaReady = true; break; }
      assert.equal(probeRead.status, 404, 'Unexpected Data API schema probe response');
      await pause();
    }
    assert.ok(schemaReady, 'Data API did not reload the epoch fixture schema');
    holder.stdin.end('select pg_advisory_unlock(736314);\n');
    const raceB = await inFlight;
    assert.equal(raceB.status, 200);
    const raceBRefresh = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: raceB.body.refresh_token });
    assert.equal(raceBRefresh.status, 200);
    assert.equal(await count('lab_guarded', raceBRefresh), 1, 'Post-rotation login race not reproduced');
    assert.equal(await count('lab_after_epoch', raceBRefresh), 1, 'Expected session-created-at counterexample not reproduced');
    sql('drop trigger lab_pause_login on auth.audit_log_entries;drop function password_lab.pause_login();');
    checks.push('REJECTED epoch-only extension: a temporary-password login paused after password verification creates its session after rotation; refresh passes live-state, claim, session and created_at cutoff guards');
    // Counterexample: native login may re-encrypt the existing password hash.
    // The candidate trigger must be REJECTED if this clears pending state.
    const pendingEmail = 'reencryption-lab@example.invalid';
    const pendingPassword = randomBytes(18).toString('hex');
    syntheticSecrets.push(pendingPassword);
    const pending = await call(auth, '/admin/users', adminJwt, { email: pendingEmail, password: pendingPassword, email_confirm: true,
      app_metadata: { initial_password_required: true } });
    assert.equal(pending.status, 200);
    const pendingId = pending.body.id;
    assert.match(pendingId, /^[0-9a-f-]{36}$/);
    sql(`insert into public.lab_guarded values('${pendingId}','Synthetic pending row');`);
    const encryptionKey = randomBytes(32).toString('base64url');
    syntheticSecrets.push(encryptionKey);
    required(docker(['rm', '--force', names.auth]), 'owned Auth restart');
    const encryptedEnv = { ...authEnv, GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPT: 'true',
      GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPTION_KEY_ID: 'labkey', GOTRUE_SECURITY_DB_ENCRYPTION_ENCRYPTION_KEY: encryptionKey,
      GOTRUE_SECURITY_DB_ENCRYPTION_DECRYPTION_KEYS: 'labkey:' + encryptionKey };
    start(names.auth, 'public.ecr.aws/supabase/gotrue:' + version,
      Object.keys(encryptedEnv).flatMap(key => ['--env', key]), [], encryptedEnv);
    await ready(auth + '/health', 'Auth encryption restart');
    const initialLogin = await call(auth, '/token?grant_type=password', adminJwt, { email: pendingEmail, password: pendingPassword });
    assert.equal(initialLogin.status, 200);
    assert.equal(sql(`select encrypted_password not like '$2%' from auth.users where id='${pendingId}'`), 't', 'Native login did not re-encrypt the hash');
    assert.equal(sql(`select raw_app_meta_data->>'initial_password_required' from auth.users where id='${pendingId}'`), 'false', 'Candidate bypass was not reproduced');
    assert.equal(sql(`select count(*) from auth.audit_log_entries where payload->>'actor_id'='${pendingId}' and payload->>'action'='user_updated_password'`), '0');
    const bypassRefresh = await call(auth, '/token?grant_type=refresh_token', adminJwt, { refresh_token: initialLogin.body.refresh_token });
    assert.equal(bypassRefresh.status, 200);
    assert.equal(await count('lab_guarded', bypassRefresh), 1, 'Expected candidate counterexample was not reproduced');
    const sameInitialLogin = await call(auth, '/token?grant_type=password', adminJwt, { email: pendingEmail, password: pendingPassword });
    assert.equal(sameInitialLogin.status, 200);
    assert.equal(await count('lab_guarded', sameInitialLogin), 1);
    checks.push('REJECTED candidate: native hash re-encryption at login clears pending state without changing the initial password; refresh and another initial-password login can read the guarded row');
    report = { syntheticOnly: true, labOnly: true, authVersion: version, postgresImage, restImage, checks,
      oldJwtStillWithinExpiry: true, prototypeIsProductionFix: false, candidateRejected: true,
      notCovered: ['application RPC/RLS/storage/Edge integration', 'existing accounts/backfill', 'MFA and recovery protocol', 'two concurrent password updates', 'password response lost after commit', 'privileged Auth admin password reset', 'hosted Auth version/configuration'] };
    }
  } catch (error) {
    failure = error;
  } finally {
    for (const { child } of children) { child.stdin.destroy(); child.kill(); }
    for (const { done } of children) {
      let timer;
      await Promise.race([done, new Promise(resolveWait => { timer = setTimeout(resolveWait, 1000); })]);
      clearTimeout(timer);
    }
    const cleanupErrors = [];
    const removeOwned = (kind, name) => {
      const template = kind === 'container' ? '{{index .Config.Labels "cortex.test.run"}}' : '{{index .Labels "cortex.test.run"}}';
      const inspected = docker([kind, 'inspect', name, '--format', template]);
      if (inspected.status !== 0 && /no such (object|container|network)/i.test(inspected.stderr)) return;
      if (inspected.status !== 0 || inspected.stdout.trim() !== prefix) { cleanupErrors.push('ownership not verified'); return; }
      if (docker(kind === 'container' ? ['rm', '--force', '--volumes', name] : ['network', 'rm', name]).status !== 0) cleanupErrors.push('owned resource');
    };
    for (const name of [...plannedContainers].reverse()) removeOwned('container', name);
    if (networkPlanned) removeOwned('network', names.network);
    if (cleanupErrors.length) {
      console.error('Disposable lab cleanup failures: ' + cleanupErrors.length);
      if (!failure || failure === expectedFault) failure = new Error('Disposable lab cleanup did not complete');
    }
  }
  if (failure === expectedFault) { process.stdout.write(JSON.stringify({ syntheticOnly: true, diagnostic: fault, cleanupVerified: true }) + '\n'); continue; }
  if (failure) throw failure;
  report.cleanupVerified = true;
  report.localDockerEndpoint = dockerEndpoint.startsWith('npipe:') ? 'verified local named pipe' : 'verified local Unix socket';
  report.network = 'owned internal network, no published ports or external route';
  const artifacts = resolve('docs/reviews/2026-11-04/' + (bindingMode ? 'credential-session-binding' : 'initial-password-auth'));
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(resolve(artifacts, version + '.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
