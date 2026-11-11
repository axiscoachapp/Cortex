# Production rollout (Supabase)

`main` goes to Vercel on its own, but the database and the Edge Functions only reach a Supabase project when someone applies them. That gap broke production on 2026-11-06 and again on 2026-11-07. These scripts are the procedure used both times. The records are in [2026-11-06](../../docs/reviews/2026-11-06/production-migration/DEPLOYMENT.md) and [2026-11-07](../../docs/reviews/2026-11-07/production-rollout/DEPLOYMENT.md).

- **Access:** the scripts use the Supabase CLI's own token from Windows Credential Manager (`supabase login`), or `SUPABASE_ACCESS_TOKEN`. The token is never printed or written.
- **Backups:** they hold patient data. They stay in `%LOCALAPPDATA%\CortexBackups\<ref>-<label>`, outside the repository.
- **Authorization:** applying anything to production needs the user's authorization in chat. `check.mjs` is the only script that never changes anything.

## 1. See what is behind (read-only)

```bash
node scripts/supabase-rollout/check.mjs --project conhcwuwtrkerpbblzgu
```

It lists:
- migrations that are pending, remote-only or out of order;
- functions not deployed, or with commits after their deploy (in the function or in `_shared`);
- secrets the functions read but the project lacks.

It exits with 1 when migrations or functions are behind. Run it before saying production is ready, and after every push to `main`.

## 1b. Run SQL tests without a local database

```bash
node scripts/supabase-rollout/sqltest.mjs --project <ref> --with-pending supabase/tests/clinical-integrity.test.sql
```

Each file runs inside one outer transaction that is always rolled back; the file's own `begin`/`commit`/`rollback` become savepoints. `--with-pending` first runs, in the same transaction, the migrations the project does not have yet, so a new migration and its tests are proven together before anything is applied. Use it only on a project whose data is test data.

## 2. Backup and fingerprint

```bash
node scripts/supabase-rollout/backup.mjs --project <ref> --label <yyyy-mm-dd>-pre-rollout
```

- **Contents:** every row of `public` and `cortex_private`, migration history, function definitions, policies, triggers, grants, columns, Storage metadata and cron jobs.
- **Format:** AES-256-GCM, with the key wrapped by DPAPI.
- **Check:** the backup is decrypted and compared by SHA-256 before the script ends. It then writes `fingerprint-before.json`: row count and ordered MD5 per table.

## 3. Rehearsal, negative control, apply

```bash
node scripts/supabase-rollout/migrate.mjs --project <ref> --label <same label> --mode dryrun
node scripts/supabase-rollout/migrate.mjs --project <ref> --label <same label> --mode negative
node scripts/supabase-rollout/migrate.mjs --project <ref> --label <same label> --mode apply
```

Each pending file runs followed by its history row, all in one transaction:

| Mode | What happens | Expected result |
|---|---|---|
| `dryrun` | Ends in a check that always raises, so nothing is kept | `DRYRUN_OK`, with the history count and the main tables' counts seen inside the transaction |
| `negative` | Must report `CHECK_FAILED` | Proves that a failed check is not swallowed |
| `apply` | Commits | History reaches the expected count |

The script refuses to run when the project has versions the repository lacks, or when a pending file is older than the remote head.

## 4. Compare

```bash
node scripts/supabase-rollout/backup.mjs --project <ref> --label <same label> --fingerprint after
node scripts/supabase-rollout/backup.mjs --project <ref> --label <same label> --compare
```

Every pre-existing table must be identical. A migration that adds a column shows up as "columns n -> m". Check it against the migration before going on.

## 5. Functions, secrets, cron

**Functions:** deploy from a clean `supabase/` tree, with the same command as the CLI:

```bash
supabase functions deploy --use-api --project-ref <ref>
```

**Secrets:** create the missing ones that `check.mjs` marks as generatable. The format is in each contract:

| Feature | Secrets | Contract |
|---|---|---|
| Pre-consultation | `INTAKE_LINK_SECRET`, `INTAKE_APP_URL` | [pre-consulta](../../docs/product/pre-consulta/CONTRATO.md) |
| WhatsApp | `WHATSAPP_TOKEN_KEYS`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_CRON_SECRET` | [whatsapp](../../docs/product/whatsapp/CONTRATO.md) |
| Signature | `SIGNATURE_*` | [assinatura](../../docs/prescriptions/IMPLANTACAO_ASSINATURA.md) |

- **How to create them:** generate the values locally and pass them through a temporary `--env-file` that is deleted right after `supabase secrets set`. Never paste them into chat, files or commits.
- **Cron secrets:** a secret that pg_cron sends also goes into Vault with the same value.
- **Outside accounts:** `WHATSAPP_APP_SECRET` (Meta), `SIGNATURE_PSC_*` (PSC), `GOOGLE_*` and `RESEND_API_KEY` stay missing until those accounts exist.

**Cron:** schedule each job with the SQL from its contract. Before scheduling, call the function once through `pg_net`; it must answer 200.

## 6. Verify

- **Without a session:** new tables answer 401 instead of 404, the preflight from the app origin answers 204, and the functions answer 401.
- **Signed-in path:** inside transactions that end in an exception, with the `aal1` claims of each real account, run `clinic_access()` and the main RPCs of the new features.
- **Record:** write `docs/reviews/<date>/.../DEPLOYMENT.md` and run `check.mjs` again.
