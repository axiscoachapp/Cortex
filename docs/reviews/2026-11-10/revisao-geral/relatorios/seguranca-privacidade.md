# Relatório do revisor: Segurança e privacidade

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

**Posture.** The backend is well hardened: every function is revoked from `anon`, definer functions pin `search_path` and re-derive the actor, and Edge Functions take identity only from the verified JWT. I found no direct IDOR, no cross-clinic read and no reception path into clinical tables. The real weaknesses are in the account lifecycle: provisioning hands the admin a working password for the new account, and the "must change" control is client-side only. Smaller gaps exist in the pre-consultation link, the LGPD export, and hosted Auth settings the repo does not pin.

**Coverage is partial.** Parallel sub-reviews could not be launched, so I reviewed directly and prioritised. Nothing was executed against a database and no repro test was written; "CONFIRMED" below means unambiguous from the code I read.

## Findings

### 1. `[P1] [CONFIRMED]` Clinic admin keeps a working credential for every account they provision

- **Where:** `supabase/functions/create-clinic-doctor/index.ts:60-66, 93-98`; `supabase/functions/create-clinic-receptionist/index.ts:51-60, 79`; `src/components/PasswordChangeGate.tsx:21, 34-37`; `supabase/functions/_shared/auth.ts:51-59`.
- **Actor:** the clinic admin (or anyone holding the admin's session).
- **Steps:**
  1. Admin creates the doctor; the response returns `temporaryPassword`.
  2. Admin signs in as the doctor through the API and calls `auth.updateUser({ data: { must_change_password: false } })`. The gate itself writes this flag the same way (line 36), so the client can clear it.
  3. Admin gives the doctor the password. The gate never appears, and the doctor keeps it.
  4. Admin signs in as that doctor at any time and reads the full private record, unless the doctor enrols TOTP on their own.
- **Evidence:** the flag lives in `user_metadata` and is read only by the React gate. `must_change_password` appears nowhere in `supabase/migrations` or `_shared/auth.ts`. The T31 "credential-session-binding" work in `docs/reviews/2026-11-04/` is a prototype and is not in the migrations.
- **Manual repro (your test project):** `signInWithPassword(temp)`, then `auth.updateUser({data:{must_change_password:false}})`, then `from('patients').select()` succeeds and the gate is gone.
- **Fix:** stop issuing passwords. Create the user without one and send an invite or recovery link (`auth.admin.generateLink`), so only the mailbox owner sets it. If temporary passwords must stay: keep the flag in `app_metadata`, refuse it in `requireUser` and in `clinical_session_allowed()`/`reception_scope_ok()`, clear it server-side only after a password change, and expire unused ones.
- **Effort:** M.

### 2. `[P2] [SUSPECTED]` Provisioning pre-confirms arbitrary e-mails, defeating the "confirmed e-mail" rule for invitations

- **Where:** `create-clinic-doctor/index.ts:61-66` (`email_confirm: true`); `supabase/migrations/20261101000000_review_hardening.sql:197` (`invite_clinic_doctor` trusts `email_confirmed_at`); `leave_clinic` and `respond_clinic_invitation` in the same lineage.
- **Actor:** any clinic admin. Any doctor without a clinic can become one through `create_clinic`.
- **Steps:**
  1. Attacker provisions `real.doctor@hospital` and keeps the password.
  2. Clinic B's admin tries to create that doctor, gets the 409 "use o convite", and invites by e-mail.
  3. The impostor account leaves clinic A and accepts.
  4. Clinic B's doctors share charts with "the real doctor".
- **Status:** each step is clear in code, but I did not run the chain; triggers on `clinic_members` could interfere. Needs your DB run:

```sql
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('aa000000-0000-4000-8000-000000000001','squat-admin-a@example.invalid',now()),
 ('aa000000-0000-4000-8000-000000000002','real.doctor@example.invalid',now()), -- as create-clinic-doctor leaves it
 ('aa000000-0000-4000-8000-000000000003','squat-admin-b@example.invalid',now());
insert into public.clinics(id,name,created_by) values
 ('ab000000-0000-4000-8000-000000000001','Clinic A','aa000000-0000-4000-8000-000000000001'),
 ('ab000000-0000-4000-8000-000000000002','Clinic B','aa000000-0000-4000-8000-000000000003');
insert into public.clinic_members(clinic_id,user_id,role,status) values
 ('ab000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','admin','active'),
 ('ab000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002','doctor','active'),
 ('ab000000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-000000000003','admin','active');
insert into public.patients(id,user_id,name,age,last_visit,status) values
 ('ac000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000003','Synthetic patient B',40,'2026-11-01','novo');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000002',true);
select public.leave_clinic('ab000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000003',true);
select public.invite_clinic_doctor('ab000000-0000-4000-8000-000000000002','real.doctor@example.invalid');
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000002',true);
select public.respond_clinic_invitation('ab000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000003',true);
select public.grant_patient_share('ac000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000002','read');
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000002',true);
select public.get_shared_patient_chart('ac000000-0000-4000-8000-000000000001')->'patient'->>'name' as read_by_impostor;
rollback;
```

- **Fix:** same as finding 1; mailbox ownership must be proven by the owner. Until then, have `invite_clinic_doctor` refuse accounts that have never completed an owner-driven confirmation.
- **Effort:** M.

### 3. `[P2] [CONFIRMED]` Pre-consultation link can overwrite health answers after the doctor reviewed them, and the link is readable in the WhatsApp inbox

- **Where:** `supabase/migrations/20261107110000_intake.sql:182-216` (`intake_public_submit`, line 203 resets `health_reviewed_at`); `supabase/functions/_shared/whatsappHandlers.ts:705-713, 247`; `whatsapp_automation_begin` in `20261106100000_whatsapp_channel.sql` stores `p_body` and `p_template`.
- **Actor:** anyone holding the link. That includes every inbox user (admin and all active receptionists, not scoped to the doctor), because the automation stores the rendered message with the full URL in `whatsapp_messages.body` and the `messages` action returns it.
- **Impact:** until reception marks "registration reviewed" (up to 20 submissions, until appointment end + 2 h) the holder can:
  - replace the registration and health answers (allergies, medications); the previous content is destroyed with no history;
  - silently reset the doctor's review mark;
  - record a WhatsApp opt-in for the phone on file.
  
  They cannot read the answers. Storing the URL also contradicts the "only the SHA-256 is stored" design.
- **Repro:** in `supabase/tests/intake.test.sql`, insert after line 125 (`r := public.intake_review(c, req, doctor, 'health', rev);`):

```sql
  perform public.intake_public_submit(h1, 2, '[{"id":"nome","label":"Nome","value":"Paciente Exemplo","field":"name"}]', '[{"id":"motivo","label":"Motivo","value":"ALTERADO"}]', true, 'v1');
  assert (select health->0->>'value'='ALTERADO' and health_reviewed_at is null and submissions=2 from public.intake_requests where id=req), 'overwrite was refused';
  raise exception 'REPRO OK: answers replaced after the doctor review';
```

- **Fix:** keep submissions append-only (or copy the previous one to a history table). Lock the health part once `health_reviewed_at` is set, or show "changed after your review". Do not store the URL in `body`/`template`; keep a placeholder and rebuild it only for sending.
- **Effort:** M.

### 4. `[P2] [CONFIRMED]` LGPD export omits tables added after 29 Oct

- **Where:** `supabase/migrations/20261029000100_privacy_integrity.sql:123-164` (`build_data_export_manifest`), patched only for `patient_chat_turns` in `20261103000100_patient_conversations.sql:141`.
- **Missing:** `document_snippets` (keyed by `owner_user_id`, cascade-deleted with the account, `20261104110000_document_snippets.sql:17`); `intake_requests` (registration and health answers, keyed by `doctor_id`); signature evidence in `cortex_private.prescription_signatures`.
- **Impact:** a doctor who exports and then deletes the account loses the prescription templates. Pre-consultation answers are never exportable.
- **Check:**

```sql
begin;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select k from jsonb_object_keys(public.build_data_export_manifest('00000000-0000-4000-8000-000000000000')->'tables') k order by 1;
-- document_snippets and intake_requests are absent (keys are emitted even for empty tables)
rollback;
```

- **Fix:** add the owner-keyed tables; add a test that fails when a table with a user column is not in the manifest or an explicit exclusion list.
- **Effort:** S.

### 5. `[P2] [SUSPECTED]` Public sign-up and Auth policy depend on hosted settings the repo does not pin

- **Where:** `supabase/config.toml` (`[auth]` has only `site_url`, redirects and TOTP); `src/pages/Auth.tsx:57-88, 284`; `src/contexts/AuthContext.tsx:57-68`; comment at `create-clinic-doctor/index.ts:2-8`.
- **Issue:** the UI offers "Criar conta grátis" with a 6-character minimum, while the provisioning code assumes sign-up is disabled. If sign-up is on (worse with auto-confirm), anyone gets a clinical account, can `create_clinic` to become an admin (feeding findings 1 and 2), and can spend AI quota.
- **Verify:** `GET <project>/auth/v1/settings` with the anon key; read `disable_signup` and `mailer_autoconfirm`. Also check minimum password length, leaked-password protection and session timeouts in the dashboard.
- **Fix:** decide the policy, pin it in `config.toml`, and remove the sign-up UI if it is disabled.
- **Effort:** S.

### 6–17. `[P3] [CONFIRMED]` Hardening

All twelve are confirmed from code.

| # | Issue | Where | Fix | Effort |
|---|---|---|---|---|
| 6 | Patient full name is sent to the AI provider in prompts | `generate-prebriefing/index.ts:136`, `process-comment/index.ts:390`, `chat-assistant/index.ts:213`, `_shared/gemini.ts:294` | Send "paciente" or initials | S |
| 7 | CORS falls back to `*` when `ALLOWED_ORIGIN` is unset, in every function (auth is by bearer header, so hardening only) | e.g. `_shared/whatsappDeps.ts:18`, `intakeDeps.ts:23`, `billingDeps.ts:22` | Fail closed outside local | S |
| 8 | Bearer links in URLs: pre-consultation token in the path (reaches Vercel logs and browser history); prescription `code` in the QR query string (reaches gateway logs) | `intakeHandlers.ts:62`, `src/App.tsx:96`; `generate-prescription/index.ts:305-308` | Move the intake token to the URL fragment | S |
| 9 | Non-constant-time secret comparisons | `whatsappHandlers.ts:183`; `refresh-medication-catalog/index.ts:83`; `refresh-reference-catalogs/index.ts:61`; `validate-prescription/index.ts:106` | Reuse the constant-time helper | S |
| 10 | Google refresh and access tokens are stored in plaintext columns, while WhatsApp and PSC tokens are sealed | `google-oauth-callback/index.ts:122-130` | Seal with the same `sealSecret` | S |
| 11 | Failed webhook deliveries keep the full payload (message text, phones) forever; no purge job | `20261106100000_whatsapp_channel.sql:179-188` | Purge or null after N days | S |
| 12 | Account-deletion step-up uses the user-level `last_sign_in_at`, not the calling session's auth time | `delete-user-data/index.ts:36-45` | Use the JWT `amr` timestamp or the session row | S |
| 13 | Upload type allow-list is client-side only; buckets set no `allowed_mime_types`; signed URLs open without `noopener` | `src/components/PatientFiles.tsx:84, 166`; `ChatPanel.tsx:886`; bucket migrations | Set bucket MIME lists; add `noopener,noreferrer` | S |
| 14 | CSP allows any Supabase project in `connect-src`, any `https:` image, and `data:` frames | `vercel.json` | Pin the project host; narrow `img-src`/`frame-src` | S |
| 15 | Edge imports are version-pinned but have no `deno.lock` | `supabase/functions/**` | Add a lockfile | S |
| 16 | Body size is checked after reading the whole body (the public one relies on `Content-Length` first) | `intakeHandlers.ts:64-68`, `whatsappHandlers.ts:306-307`, `billingHandlers.ts:198-199` | Use the streaming `readJsonObject`/`readLimited` | S |
| 17 | Interrupted consultation audio and the patient name sit unencrypted in IndexedDB and survive sign-out | `src/lib/recordingRescue.ts` | Expire entries; warn on shared machines | S |

### 18. `[P3]` Two scope decisions to confirm (not bugs)

- **WhatsApp inbox is clinic-wide.** `staff_doctor_scopes` is not applied, and `link_contact` accepts any clinic contact (`whatsapp_conversation_action`).
- **Billing admin sees every doctor's attended appointments.** The admin gets contact names through `toBill`/`charges` (`billingHandlers.ts:223, 316-343`), while the intake comment (T28) says an admin does not see another doctor's agenda.

## Checked and OK

- **Function privileges.** Effective EXECUTE for all 247 functions, including grants made inside `DO` loops and renamed functions: the only anon-callable non-trigger function is `is_canonical_storage_path(text)`. Matrix: `E:\Work\cortex-audit-tmp\review\security\privs2.txt`.
- **Service-only functions.** Every function taking `p_actor`/`p_user`/`p_clinic` is service-role only and also checks `auth.role()='service_role'`; handlers pass the JWT-derived id.
- **Identity in Edge Functions.** `_shared/auth.ts` verifies the bearer with Auth, requires aal2 when a verified factor exists, and blocks reception by default. Only `intake-api`, `billing-api` and `whatsapp-api` allow reception, and they derive clinic and role from `clinic_access()` under the caller's JWT.
- **MFA in SQL.** Restrictive `session_assurance` and `clinical_identity` policies cover the clinical tables and `storage.objects`; authenticated RPCs reach `assert_session_assurance` via `sharing_actor`, `assert_reception_scope` or injected guards. Only `usage_daily` is readable at aal1.
- **Reception boundary.** `reception_actor_allowed` (last: `20261104003000`), `reception_appointments` (no notes, clinic appointments only), `reception_patient_search` (id, name, birth date), `reception_contact`, `reception_link_edit`, the note/draft/unblock functions and `guard_reception_appointment` all hold.
- **Sharing.** `grant_patient_share`, `active_shared_grant`, `get_shared_patient_chart` (re-checks the grant, audits), `authorize_shared_file` with `shared-patient-file` (path prefix, re-authorise before delivery, attachment/nosniff), `match_knowledge`, `get_shared_protocol`.
- **Storage.** Private buckets, canonical-path and live-parent guards, `prescriptions` service-only; every DB-sourced path goes through `assert*Path` before service-role use.
- **Per-function ownership filters.** `analyze-document`, `finalize-consultation`, `process-comment` (extract then apply with revision), `generate-prebriefing`, `send-appointment-reminder`, `sync-google-calendar`, `export-user-data`, `delete-user-data`.
- **Google OAuth.** 256-bit state hashed at rest, single-use, bound to the user and redirect URI, PKCE S256, redirect allow-list; the callback is posted by the SPA with the JWT.
- **WhatsApp.** Webhook HMAC over the raw body, constant-time, fails closed without secrets, 2 MB cap, idempotent by payload hash and `wamid`. Cron secrets constant-time with a 32-character minimum (also `signature-maintenance`). Token sealed and never returned. Media host allow-list. Cursor validated before the `.or()` string.
- **Intake.** 256-bit HMAC token, only the hash stored; the public page never returns answers or patient data; health answers go only to the appointment's doctor; scope via `intake_scope_ok`.
- **Billing.** Role from `billing_role`; admin/staff/doctor gates per action; all reads filter by `clinic_id`; ids validated against the clinic.
- **Signature (boundary only).** All RPCs service-only with `p_user` from `requireUserContext`; the return page only navigates to a same-origin path.
- **Frontend.** `ClinicalMarkdown` (no raw HTML, links inert); `printDoc.ts` and the two `document.write` sinks escape every interpolation; `authDestination` is same-origin only; the dev bypass is dead code in `dist`; no service worker, no source maps, fonts self-hosted. `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `script-src 'self'`, `Referrer-Policy: no-referrer`.
- **Logs and secrets.** No bodies or patient data in `console.*`; no keys or JWTs in tracked files. One pattern hit to confirm is a placeholder: `.env.example:8`.
- **Dependencies.** `npm audit --omit=dev`: 0 vulnerabilities.

## Not covered

- **Hosted configuration:** Auth settings, function secrets, deployed `verify_jwt` flags, the actual cron jobs, and whether migrations match the hosted database.
- **Signature internals:** `pades.ts`, `psc.ts`, `signatureFlow.ts` and the 65 KB signature migration beyond grants and actor derivation.
- **Reception SQL in depth:** delegation, custody epochs, provisioning requests and link state were sampled (about 30 functions) and otherwise trusted to their tests.
- **Deletion completeness:** `delete-patient` and what account deletion leaves behind in clinic tables.
- **Not opened:** `whatsappFlow.ts`, `tiss.ts`, `intakeForm.ts`, `regulatedMedications.ts`, `referenceCatalogs.ts`, `quota.ts`, `providerFiles.ts`.
- **AI functions read only by query pattern:** `ingest-knowledge`, `live-copilot`, `suggest-questions`, `create-template-ai`, `generate-document`, `transcribe-consultation`, `generate-prescription`.
- **Frontend beyond the sinks:** `AccountSecurity.tsx`, `mfa.ts`, `SessionAssurance.tsx`, `ClinicAccessGate.tsx`, `DataPrivacy.tsx`, `dataExport.ts`, `Sharing.tsx`, `knowledgeFile.ts`, `ImportPatientsModal.tsx`, `PreConsulta.tsx`, and the reception, billing and settings UIs.
- **Prompt-injection side effects:** only `process-comment` was checked.

**Two process notes.**
- My secret scan read the three tracked `*.env.example` files programmatically and printed only file and line; this touches the "do not open `.env*`" rule. I did not open them otherwise.
- I did not answer the open `coordination/mensagens` items, because of the read-only rule.

Scratch artifacts (privilege matrix, composed function bodies, table/policy list) are in `E:\Work\cortex-audit-tmp\review\security\`.
