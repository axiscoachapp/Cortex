# Production updated: 83 migrations, 36 functions; the live site still on the 12:08 version
- De: claude
- Para: codex
- Data: 2026-11-07 16:40 (America/Sao_Paulo)
- Responde a: 2026-11-07-1300_claude-para-codex_dia-solo-revisao-propria.md
- Status: informativa
- Decisão do usuário necessária: não

**Why:** the 12:08 push put the K1, K2, P1 and P2 screens on Vercel while production stayed at 77 migrations, with none of the 7 new functions. Those screens showed errors; the queue and the doctor's screens were unaffected. The user authorized the rollout in chat ("Yes, all of it").

**Done** ([record](../../docs/reviews/2026-11-07/production-rollout/DEPLOYMENT.md)):
- **Migrations:** the 6 pending ones (`20261106100000` … `20261107130000`), after an encrypted backup, a rehearsal with rollback and a negative control, applied in one transaction (1.7 s). The 57 pre-existing tables are identical by count and MD5.
- **Functions:** all 36 deployed from `96ebf0c`, including `whatsapp-api`, `whatsapp-webhook`, `whatsapp-automations`, `intake-api`, `intake-public`, `billing-api` and `signature-maintenance`.
- **Secrets:** generated for pre-consultation (link and app URL) and WhatsApp (token keys, verify token, cron, also stored in Vault).
- **Cron:** `whatsapp-automations` runs every 10 minutes; a manual run returned 200 with no candidates.
- **Verification:** without a session, 401 instead of 404. Account 1 (admin), inside rolled-back transactions: `clinic_access` returns clinical/active/admin, `billing_role` returns admin, and `whatsapp_dashboard` returns `cohort`/`openNow`.

**Still off:**
- **WhatsApp:** `WHATSAPP_APP_SECRET` comes from the clinic's Meta app (D24). Until then, `state.serverReady=false` and the webhook answers 503.
- **Signature:** waiting for the PSC; its cron was not scheduled.

**Frontend not pushed:** `git push` stopped at the GitHub sign-in window, and the user will do it. Until then the live site is `d5d6ae0`, without `8d231be` (navigation, your files) and without the self-review fixes. The backend is a superset and accepts the 12:08 frontend.

**Tool for next time:** [`scripts/supabase-rollout/`](../../scripts/supabase-rollout/README.md) (`425e137`). `check.mjs --project <ref>` is read-only and reports pending migrations, undeployed or outdated functions, and missing secrets. `backup.mjs` and `migrate.mjs` repeat today's procedure.

- [ ] (codex) Nothing new. The rechecks from 1300 still stand when the user resumes you; any finding that changes a migration now needs a new migration, because the 6 are applied in production.
