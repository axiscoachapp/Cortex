# Production database and functions update

2026-11-06, about 15:40 (America/Sao_Paulo). The user authorized it and supplied a fresh management token for this operation. The work was on project `conhcwuwtrkerpbblzgu` (Cortex, us-west-2). The token is not in the repository, environment files or messages.

## Why
The frontend on `origin/main` was already live on Vercel (`cortex-ebon-tau.vercel.app`), but the database stopped at `20261101000000`. The app's access check calls `public.clinic_access()`, which did not exist yet (`PGRST202`, HTTP 404). Every user saw "Não foi possível verificar seu acesso à clínica" after signing in. A local synthetic run reproduced that screen.

## What was done
1. **History check.**
   - 40 migrations were applied remotely, with nothing remote-only and nothing out of order.
   - 37 were pending, from `20261103000100` to `20261105270000`.
   - `pg_cron` was already installed, and the pending files schedule no jobs.
2. **Encrypted backup.**
   - Scope: all 30 public tables, plus migration history, 227 function definitions, 55 policies, triggers, grants, columns and Storage metadata.
   - Encryption: AES-256-GCM, with the key wrapped by Windows DPAPI (CurrentUser).
   - Location, outside the repository: `%LOCALAPPDATA%\CortexBackups\2026-11-06-pre-migration`.
   - The backup was decrypted and its SHA-256 compared before continuing.
3. **Rehearsal.** All 37 files ran in one transaction and were rolled back.
   - Top-level `begin;`/`commit;` lines were removed so that each file runs inside the outer transaction.
   - A second rehearsal confirmed, inside the transaction, that `clinic_access`, `clinic_staff_members` and 77 history rows were present.
   - A negative control failed as expected.
   - The remote still had 37 pending after both rehearsals.
4. **Apply.** The same bundle ran with `commit` (2.0 s). History entries were written to `supabase_migrations.schema_migrations`, with 77 in total.
5. **Preservation.**
   - All 30 pre-existing tables were compared with a row count and an ordered MD5 over the original columns, before and after. Every table matched.
   - Counts of the main tables: 21 patients, 35 consultations, 1 appointment, 12,254 catalog medications.
6. **Functions.** All 29 Edge Functions were deployed with `supabase functions deploy --use-api`. Four were new: `create-clinic-receptionist`, `refresh-reference-catalogs`, `sign-document` and `signature-session`.
   - All 29 are `ACTIVE`.
   - CORS preflight from the app origin returns 200.
   - `signature-session/state` returns 401 without a session.

## Verification of the signed-in path
For each of the two existing accounts, the check ran inside a rolled-back transaction. It used `set local role authenticated` with that account's `sub` and `aal1`, which is what a real sign-in gives, because neither account has a verified TOTP factor.

| Account | `clinic_access()` | Patients visible | Directory |
| --- | --- | --- | --- |
| 1 | `clinical`, active, admin | 15 | 15 total |
| 2 | `clinical`, not active (no clinic membership) | 6 | 6 total |

Both accounts pass `ClinicAccessGate` into the medical environment. Account 2 is only kept out of `/recepcao`, which is by design.

Anonymous probes now return 401/42501 for `clinic_access` and the new tables, instead of 404.

## Not changed / known limits
- **Secrets.** No secrets were added or changed. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Google Calendar) and `RESEND_API_KEY` (appointment reminder e-mail) remain unset, as before.
- **Reference catalogs.** `exam_catalog`, `cid10_catalog`, `medication_presentations` and `dcb_catalog` are empty. They are filled by `refresh-reference-catalogs` (service role, public ANS/DATASUS/Anvisa files), which was not run. Exam and CID search return nothing until it is.
- **Signature.** Digital signing reports "não configurada", because no PSC and no signing secrets are configured.
- **AI.** Settings were not touched.
- **No data operations.** No patient rows were inserted, edited or deleted, and no PersonalMed data was loaded.
- **Token.** The token was pasted in chat, so it should be revoked after this operation.
