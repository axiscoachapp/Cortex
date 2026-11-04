# Independent review: reception (secretary/CRM) feature

Date: 2026-11-03/04. Reviewer: Claude (read only; nothing edited, staged or run against the repo).
Commits reviewed: c19624e (access + scheduling), 9af1b68 (workspace/calendar), 4c94483 (contact corrections), 6209ba9 (booked patient identity).
Uncommitted work in the tree (`20261103003700_reception_link_confirmation.sql`, BookingDialog changes) was only read for context and is not part of the verdict.

## Verdict on the core invariant

**No Critical finding.** I found no path that lets a reception account read or change clinical content (chart columns, consultations, transcriptions, prescriptions, files, chat turns, history):

- The restrictive `clinical_identity` policy covers every clinical table and `storage.objects` (access.sql:57-65). The tables it leaves out (`clinics`, `clinic_members`, `patient_shares`, `shared_chart_entries`, `chart_access_audit`, `protocol_shares`, `account_deletion_requests`, `data_export_snapshots`, quota/lease tables) are already revoked from `authenticated`. The `user_integration_status` view uses `security_invoker`.
- Every SECURITY DEFINER RPC granted to `authenticated` either derives its actor through `sharing_actor()` (now guarded) or is in the regexp-guarded list (access.sql:67-105). Sharing, invitation and clinic creation all go through `sharing_actor()`. `guard_clinical_membership` stops a reception account from being added to `clinic_members` by any writer.
- Every clinical Edge Function calls `requireUser()`, which rejects `app_metadata.account_type='reception'` using a fresh `getUser()`. No function passes `allowReception`. The two functions that skip `requireUser` are the public QR validator (gated by a secret code) and a cron job (gated by the service key).
- The reception RPC projections return only name, date of birth, phone, status, type and times. They never return `notes`, `title` or chart columns, and the tests assert this.
- The frontend reaches data only through `receptionApi` (validated RPCs). It redirects reception users before any clinical reader mounts, clears the React Query cache when the user changes, and uses no browser storage for reception drafts.

The problems found sit at the edges: the admin role, account deletion, availability for doctors, and durability/consent of delegation.

---

## High

### H1. A clinic admin can read and write every member doctor's roster and agenda without delegation (contrary to the spec, and untested)

`supabase/migrations/20261103001000_reception_access.sql:125`. `reception_actor_allowed()` returns true for any active `admin` and any active member `p_doctor`. Because of this one branch, a clinic admin (an ordinary doctor with the admin flag) can do the following without any `staff_doctor_scopes` row:

- list other doctors' patients by name and date of birth with any 2-character query (`reception_patient_search`, workflow.sql:99-109);
- read their whole agenda with patient names, including legacy appointments outside the clinic (`clinic_id is null`) (`reception_appointments`, calendar.sql:130-131);
- create patient records in another doctor's private list (`reception_book_appointment`, calendar.sql:148,165);
- link that doctor's patients to contacts (`reception_link_patient`);
- cancel or reschedule that doctor's private appointments (`reception_change_appointment`, calendar.sql:180-201).

`clinic_access()` exposes all doctors to the admin, so the UI offers this directly.

- **Spec conflict:** `PRODUCT_SPEC.md` §Permissões, "Criar/remarcar compromisso — Gestor operacional: Só se também delegado". Elsewhere the app keeps doctor-to-doctor access explicit (owner RLS plus `patient_shares`). A patient's name joined to the doctor's specialty is health data under LGPD art. 11.
- **Scenario:** Dr. A is admin and Dr. B is a member. A calls `reception_patient_search(clinic, B, 'an')`, `'ma'` and so on, and enumerates B's private patients. A then calls `reception_change_appointment(clinic, <B's legacy appointment>, rev, 'cancel')`.
- **Tests:** `reception-calendar.test.sql` checks only a *non-member* doctor ("foreign"). It never checks a member doctor who has not been delegated.
- **Fix:** split the predicate. Keep the admin bypass only where `p_doctor is null` (directory, intake queue, team settings, clinic blocks). For doctor-scoped operations, require `p_actor = p_doctor` or an explicit delegation row (e.g. let admins hold scopes too, or add a `clinician_doctor_scopes` table). Add negative tests: admin vs. undelegated member for search, appointments, book, change and link. If the clinic really wants "admin = all agendas", update the spec matrix and write that decision down.

### H2. The account-deletion custody preflight blocks too much and too little at once

`supabase/migrations/20261103003000_reception_calendar.sql:44-64`, together with `guard_reception_appointment` (:94,:96) and `supabase/functions/delete-user-data/index.ts:47-75`.

**a. Too much (regression for every doctor).** The trigger stamps `created_by := auth.uid()` on *every* appointment insert and `updated_by := auth.uid()` on every changed update, for every doctor, including solo doctors with no clinic (:94,:96). The preflight then raises P4092 for account deletion whenever `appointments.created_by = p_user_id or updated_by = p_user_id` (:59). Effect: any doctor who creates or edits even one appointment after this migration can never delete their account (LGPD art. 18). They get the misleading message "Há vínculos e histórico administrativo da clínica". Tests miss it because they insert appointments as `postgres` without a `sub`, so `created_by` is null (`security-lifecycle.test.sql:10`).

- Fix: count only rows on someone else's agenda (`created_by = p_user_id and user_id <> p_user_id`, same for `updated_by`).
- Also consider `ON DELETE SET NULL` for `appointments.created_by` and `updated_by`. *Plausible:* a `RESTRICT` FK on rows that the `user_id` cascade also deletes depends on the firing order of the RI triggers.

**b. Too little (destructive partial deletion).** New RESTRICT FKs that point at the doctor are not covered by the preflight:
- `staff_doctor_scopes(clinic_id, doctor_user_id) → clinic_members` (access.sql:16);
- `reception_cases(clinic_id, doctor_user_id)` for resolved or cancelled cases, which the release trigger does not null (workflow.sql:26);
- `reception_schedule_blocks(clinic_id, doctor_user_id)` (calendar.sql:31);
- `patient_contact_links.confirmed_by` (workflow.sql:11).

Scenario: a non-creator member doctor has a receptionist delegated (scope row), or had a case resolved, and asks to delete the account. The preflight passes, `delete-user-data` records the intent and **deletes the storage prefixes** (patient files, audio, prescriptions), and only then `auth.admin.deleteUser` fails: the cascade into `clinic_members` hits the RESTRICT FK. The account ends up half-deleted, with metadata rows still pointing at purged files and `account_deletion_requests` locking every write. The commit's own comment says the goal was "Stop destructive clinical cleanup before storage is touched". This is the opposite.

**c. Race.** `reception_actor_allowed` checks deletion intent only for the *actor*, never for `p_doctor` (access.sql:123-124). While a doctor's deletion is running, a receptionist can still create links, cases, routes and blocks for that doctor. `guard_clinical_write` blocks only patients and appointments. A new `patient_contact_links` row makes the final cascade fail after storage is already purged.

**Fix:**
- Add the missing FKs to the preflight, or delete or null them as part of offboarding.
- Add `not exists(account_deletion_requests where user_id = p_doctor)` to `reception_actor_allowed`.
- Add SQL tests: solo doctor with an authenticated appointment insert can delete; delegated doctor is blocked *before* storage is touched.
- Note: a patient becomes undeletable (patient level, :48-49) as soon as reception confirms any legacy appointment of theirs, and no custody-resolution flow exists yet (T24). Make sure the UI states this, and schedule T24 before the pilot.

---

## Medium

### M1. Every doctor's clinical workspace disappears on any transient `clinic_access` failure

`src/features/reception/ClinicAccessGate.tsx:24,43,78-79`. The gate wraps *every* protected page and polls `clinic_access` every 15 s with `retry:false`. One failed poll (network blip, timeout, cold DB) hides the doctor's chart or live consultation for ≥15 s, until the next refetch succeeds. The test (`ClinicAccessGate.test.tsx:73`) confirms this is intentional. For a clinical account it gives no security benefit: a clinical login cannot turn into reception (`guard_clinical_membership`, and provisioning only ever creates new users). It also makes the whole doctor app depend on the migration being deployed first.

- Fix: conceal only when a *successful* response changes `kind`/`active`, or on 42501. For `kind:'clinical'`, keep the page visible on network errors and show a non-blocking banner. Consider a longer interval or window-focus refetch only for clinical users.

### M2. Delegation exposes a doctor's entire private practice, chosen by the admin alone

`patients` and legacy `appointments` are not scoped to a clinic. A delegated receptionist therefore gets:
- the doctor's *whole* roster: name, date of birth, enumerable with 2-character searches (workflow.sql:104-107);
- every non-clinic appointment with patient names (calendar.sql:130);
- the ability to cancel or reschedule those private appointments (calendar.sql:184 allows `clinic_id is null`).

Delegation is set only by the clinic admin (`update_reception_staff`); the doctor is never asked. Doctors who also work elsewhere expose those patients to this clinic's staff.

- Fix (product and DB): require the doctor's consent or acknowledgement per delegation. Option: limit legacy appointments to "Horário reservado" without names unless the patient is linked to a clinic contact or has a clinic appointment. Raise the minimum search length, or require name plus date of birth.

### M3. Lock-order inversion between a doctor's direct edit and a reception change (deadlock, recoverable)

`calendar.sql:181-182` takes the advisory calendar lock and *then* `FOR UPDATE` on the appointment. A doctor's PostgREST `UPDATE appointments` locks the row first (`GetTupleForTrigger`) and then the same advisory key in `guard_clinical_write`/`zz_` trigger. Running both concurrently on the same appointment produces a 40P01 after `deadlock_timeout`. The data stays consistent, but the user sees a generic error. The comment "Same lock order as existing guard_clinical_write" is not accurate for this path.

- Fix: take `select … for update` on the appointment before `lock_reception_calendar` in `reception_change_appointment`.

---

## Low

- **L1. Link upsert overwrites a confirmed relationship (committed code).** `workflow.sql:131-132`: `on conflict … do update set relationship, confirmed_by` lets any scoped receptionist silently re-attribute a link another person confirmed. The uncommitted `20261103003700_reception_link_confirmation.sql` fixes it; make sure it lands with its test.
- **L2. Temporary password and attribution.** `create-clinic-receptionist` returns the temporary password to the admin. `must_change_password` lives in user-editable `user_metadata` and is enforced only in the client (`PasswordChangeGate`), so `reception_audit` attribution is not reliable until the receptionist changes the password. Same pattern as the existing `create-clinic-doctor`. Prefer an invite/recovery link, or a server-side flag. Also consider requiring MFA for staff, who see names and phones at scale.
- **L3. The regexp guard injection is fragile.** 16 functions were rewritten from `pg_get_functiondef` (access.sql:67-105). Any later `CREATE OR REPLACE` of one of them from source silently drops the reception guard. Tests cover 4 of the 16. Add a catalog test: every SECURITY DEFINER function executable by `authenticated` must be on a reception allowlist or contain `assert_clinical_actor` / `is_reception_account`. Also, `supabase/tests/bootstrap.sql` sets default privileges only for tables and sequences, not for **functions**, so the suite cannot catch "revoked only FROM PUBLIC" mistakes. All new reception functions do revoke `authenticated` explicitly (good). Pre-existing and out of scope: `storage_parent_is_live`, `has_foreign_deletion_children` and `assert_deletion_scope_legacy` are revoked only FROM PUBLIC. On hosted Supabase they are probably callable by anon/authenticated as boolean or exception oracles. Worth a separate fix.
- **L4. Wrong error for a nonexistent appointment.** `reception_change_appointment` with an unknown appointment ID (calendar.sql:179-184): `assert_reception_scope(p_clinic, NULL)` passes for any staff, `lock_reception_calendar(NULL)` hits a NOT NULL violation on `reception_calendar_versions`, and the user gets a 23502 that names an internal table instead of "Agendamento indisponível". Check `a.id is null` first.
- **L5. Scopes survive a doctor leaving the clinic.** `leave_clinic`/offboarding set `status='inactive'`, but `staff_doctor_scopes` rows stay (and must, because of the RESTRICT FK). If the doctor is re-invited and accepts, every old delegation comes back immediately. Delete or flag scopes on `status <> 'active'` (this also helps H2b).
- **L6. Interval guard locks bad legacy rows.** `guard_reception_appointment` validates the interval on *every* update (calendar.sql:85). A legacy row with `end_time <= start_time` can no longer be edited or even cancelled by the doctor. Squeeze-in bookings (encaixe) are now rejected for all doctors; this one is documented, so just keep the doctor-side error message clear.
- **L7. Orphan-contact rule.** A receptionist who links an orphan contact to their doctor hides it from every other staff member, including its creator (workflow.sql:60-65). Acceptable, but it can surprise people.
- **L8. Data minimization.**
  - `reception_booking_requests.payload` keeps the beneficiary's name and date of birth indefinitely.
  - Free-text case notes (up to 4,000 chars) may pick up clinical details outside clinical protections, export and deletion.
  - Plan retention under T24.
- **L9. No LGPD self-service for staff.** Reception users cannot reach export or deletion: `/privacidade` calls Edge Functions that return 403 for reception.
- **L10. Cross-tenant scan in `reception_appointments`.** With `p_doctor = null` it scans every tenant's appointments in the window and evaluates `reception_scope_ok` per row (calendar.sql:130-132). Filter on `user_id = any(<scoped doctors>)` first.

## Looks solid

- Actor is always `auth.uid()` (via `assert_reception_scope`). Clinic and doctor scope are checked and then re-checked after `FOR SHARE` locks on member, staff and scope rows, so a revocation waits for in-flight writes and takes effect on the next request.
- All new SECURITY DEFINER functions use `set search_path=''` and revoke `public, anon` (helpers also revoke `authenticated`).
- RLS is enabled on all 11 new tables, with no client grants and service_role only.
- Booking safety:
  - idempotency through `(clinic, actor, request_id)` with a payload comparison;
  - per-doctor advisory lock plus a version counter that catches stale REPEATABLE READ snapshots;
  - the overlap check runs inside the trigger, so it covers doctor writes too;
  - a booking request is never reused for a different payload.
- `revision` checks on cases, drafts, appointments and contacts.
- Patient and authorship immutability is enforced in triggers for every writer, service_role included.
- Service-role "bot" bookings are refused.
- The audit log stores IDs, revisions and times, never names, phones or notes (asserted in tests).
- Revocation release triggers return open work to intake.
- The frontend validates every RPC response with strict zod schemas.

## Untested paths worth adding

1. Admin vs. an undelegated member doctor (H1).
2. A solo doctor who inserted an appointment through an authenticated session, then deletes the account (H2a).
3. A delegated doctor or one with a resolved case: deletion must be blocked before storage is touched (H2b).
4. Link, case or route while the doctor's deletion is in progress (H2c).
5. A doctor leaves and rejoins: old scopes must not return (L5).
6. Catalog test for guard coverage of SECURITY DEFINER functions (L3).
7. Concurrent doctor UPDATE vs. reception reschedule on the same row (M3).
