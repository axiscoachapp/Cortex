# Production rollout: WhatsApp, pre-consultation, finance, signature executor, dashboard

2026-11-07, 15:20–16:00 (America/Sao_Paulo). Authorized by the user in chat ("Yes, all of it"). Project `conhcwuwtrkerpbblzgu` (Cortex, us-west-2). Same procedure as [2026-11-06](../../2026-11-06/production-migration/DEPLOYMENT.md). Access used the Supabase CLI's own token (Windows Credential Manager); no token was pasted, printed or written.

## Why
`main` was pushed at 12:08 with the screens for WhatsApp, pre-consultation, finance and the reception dashboard, while production stayed at the 11-06 version. Read-only probes showed:
- 77 migrations applied;
- the new tables returning `PGRST205` (404);
- none of the 7 new functions deployed.

Those screens showed errors. The reception queue and the doctor's screens were not affected.

## What was done
1. **History check.** 77 applied, nothing remote-only, nothing out of order. 6 pending: `20261106100000_whatsapp_channel`, `20261106110000_whatsapp_flows`, `20261107100000_signature_pending_work_attempt`, `20261107110000_intake`, `20261107120000_billing`, `20261107130000_whatsapp_dashboard`. `pg_cron`, `pg_net` and `supabase_vault` were already installed. No file in the bundle schedules jobs or creates extensions.
2. **Encrypted backup.**
   - Rows: all rows of the 57 tables in `public` and `cortex_private`.
   - Schema: migration history, 357 function definitions, 81 policies, triggers, grants, columns, Storage buckets and object metadata (2 objects), and the cron jobs.
   - Format: AES-256-GCM, key wrapped by DPAPI (CurrentUser). 23.2 MB, at `%LOCALAPPDATA%\CortexBackups\2026-11-07-pre-rollout`.
   - Check: decrypted and compared by SHA-256 before continuing.
3. **Rehearsal.** The 6 files ran with their history rows in one transaction, which ended in an exception (rolled back).
   - Inside the transaction: 83 history rows, the new tables and functions present, and 21 patients, 35 consultations, 1 appointment and 1 clinic.
   - A negative control (expecting 84) failed as expected.
   - The remote still had 77 afterwards.
4. **Apply.** The same bundle ran with `commit` in 1.7 s (bundle SHA-256 `c0c7263d…ca15ac`). History: 83, last `20261107130000`.
5. **Preservation.**
   - All 57 pre-existing tables were compared with a row count and an ordered MD5 over their columns, before and after. 57 of 57 are identical, and no column changed.
   - 21 new tables.
6. **Functions.** All 36 functions were deployed with `supabase functions deploy --use-api` from `main` at `96ebf0c`, with a clean `supabase/` tree. New: `whatsapp-api`, `whatsapp-webhook`, `whatsapp-automations`, `intake-api`, `intake-public`, `billing-api` and `signature-maintenance`.
7. **Secrets** (generated locally, never printed; the temporary env file was removed after `secrets set`):
   - `INTAKE_LINK_SECRET`, and `INTAKE_APP_URL` = `https://cortex-ebon-tau.vercel.app`;
   - `WHATSAPP_TOKEN_KEYS` (`k1`), `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_CRON_SECRET`, with the same cron value in Vault as `whatsapp_cron_secret`.
8. **Cron.** `whatsapp-automations` every 10 minutes, using the `pg_net` call from the WhatsApp contract. A manual run before scheduling returned 200 `{candidates:0, sent:0}`.
9. **Frontend: not pushed.** `git push` stopped at the "Connect to GitHub" window (the saved credential no longer authorizes push), and no one can sign in on the user's behalf. The live site stays at `d5d6ae0` (12:08), which works with this backend but lacks the menus and the self-review fixes. The 8 commits (`59e396b` … `96ebf0c`) go out when the user runs `git push origin main` and signs in.

## Verification
**Anonymous probes:**
- The new tables return 401 instead of 404.
- `intake-api`, `billing-api` and `whatsapp-api` answer the preflight from the app origin (204/200) and return 401 without a session.
- `intake-public` with an invalid token returns 404 "Link inválido ou vencido".
- `whatsapp-webhook` returns 503 because `WHATSAPP_APP_SECRET` is missing (see below).

**Signed-in path**, in transactions ended by an exception, with `aal1` claims like a real sign-in:

| Account | `clinic_access()` | `billing_role` | `whatsapp_dashboard` (7 days) |
|---|---|---|---|
| 1 | clinical, active, admin | admin | returns `cohort`, `openNow` |
| 2 | clinical, not active | not checked (no clinic) | not checked |

## Still off, waiting for the user
- **WhatsApp:** `WHATSAPP_APP_SECRET` comes from the clinic's Meta app (D24). Until then, Settings shows that the server is not ready, the webhook answers 503 and nothing is sent. The cron runs and finds no connected number.
- **Digital signature:** needs the PSC contract (`SIGNATURE_PSC_*`, `SIGNATURE_TOKEN_KEYS`). The `signature-maintenance` cron was not scheduled; schedule it together with the PSC setup, following [IMPLANTACAO_ASSINATURA.md](../../../prescriptions/IMPLANTACAO_ASSINATURA.md).
- **Pre-consultation and finance** work now. The clinic admin turns the form on in Settings and fills in the plans and prices in Finance → Cadastros.
- **No data operations:** no patient or clinic rows were inserted, edited or deleted.
