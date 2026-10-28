# Local implementation and deployment rehearsals

No production deployment or legacy-data migration has been performed. Keep AI disabled until the provider discussion and exact intended-use evaluation are complete.

## Configuration and release

1. Use an isolated staging Supabase project and explicit frontend URL/public key. Confirm allowed origin and Auth/OAuth redirects. Run all committed migrations in order, generate types, run tests/build/Edge/SQL checks and inspect the resulting grants.
2. Create two named synthetic doctor accounts plus an outsider. Register/verify TOTP using native Auth. Verify an enrolled password-only token fails direct table, Storage and Edge/RPC operations; verify `aal2` succeeds.
3. Confirm a new doctor sees no other doctor's patients. Share one synthetic patient with read permission, then contribute permission. Revoke during chart loading, file streaming and contribution. Confirm delayed results do not restore access. A saved/downloaded copy cannot be recalled.
4. Exercise manual draft autosave, failed save, recovery, exact-text confirmation, appointment binding and concurrent edits. Close/Back/reload must preserve or explicitly discard unsaved work. Record each doctor's completion evidence for the clinic workflow.
5. Keep `AI_ENABLED=false`. When a provider is separately approved, evaluate synthetic Portuguese cases, model/schema versions, source fidelity, timeouts, refusal, quota and cleanup before enabling. Vendor/model changes require reevaluation; never silently switch processors.

## Failure diagnosis

- Provider events use random operation IDs, static operation/model, elapsed time and outcome. Do not add names, patient/user IDs, bodies, transcript fragments, keys or full URLs to logs. Aggregate error count/latency from these events in the deployment's logging service; alert on sustained errors and stalled cleanup obligations.
- Quota is distinct from admission rate: the current logical limits are 30 AI operations and 20 communications per actor per UTC minute. These are fixed-window controls. Each new logical AI attempt receives fresh admission and reservation; provider HTTP attempts have independent operation IDs. Unknown paid usage remains reserved, and settlement is idempotent per reservation.
- Google sync stores stable event identity and durable pending/failed states with a lease. Retry a failed item from the agenda. A provider success followed by lost response must reconcile the same event. Never delete/recreate events just to clear an error.
- Failed audio discard retains a marked patient-linked draft and rejects late writes/uploads. Retry server discard; never manually delete its metadata first.
- Review `ORPHAN_AUDIO_AUDIT.sql` for historical objects whose relationship metadata was already lost. Preserve the inventory/backup and reconcile under account custody; do not infer a patient or delete an unknown recording automatically. The new discard contract prevents this loss of linkage for future operations.
- Provider-file cleanup obligations identify exact remote objects. Unknown upload outcomes retain a lease and require exact operator reconciliation. Do not infer expiry from elapsed time. Keep exclusion receipts explicit about unresolved provider state, logs and backups.
- A concurrent export change produces conflict, not a falsely complete archive. Restart from a fresh manifest. Streaming commits the destination only after final verification; browsers without File System Access retain the documented aggregate limit.

## Retention and custody

Expired export snapshots need daily service-role cleanup (`DELETE FROM public.data_export_snapshots WHERE expires_at < now()`) in addition to on-demand pruning. Monitor the count and age of provider cleanup obligations and unresolved upload leases. Do not clear obligations merely to allow an account deletion to report success.

Ordinary account/patient deletion is deliberately blocked where shared clinical custody must be preserved. Offboard through membership controls; retained authorship and audit history stay intact. Any governed custody transfer/deletion requires a separate operator procedure and clinic decision.

## Restore rehearsal

Before a real launch, restore a database backup and the matching private Storage objects into an isolated project. Verify row/object counts and hashes; exercise patient/file relationships, original issuance manifests, revisions, grants, revoked grants, shared authorship, pending drafts and cleanup obligations. Restore Auth identities/factors and integration configuration only through the supported service procedure; never copy live credentials into test logs.

Run a two-doctor/outsider access suite against the restored project. Record backup timestamps, object manifests, restore duration, discrepancies and operator signoff. A fresh migration test does not prove backup restoration. Keep PersonalMed originals untouched and establish later migration/cutover evidence separately.

## Rollback

Disable AI and external sends immediately when needed; retain manual documentation. Prefer a previous compatible application build plus corrective migrations. Do not drop clinical/sharing/revision tables to roll back code. Preserve new data and custody; rehearse any restore from a known consistent database/object snapshot before applying it to production.

## Brand provenance

Logo and favicon are the official assets linked by [Haddad Nicola](https://haddadnicola.com.br/). Website typography and gold/charcoal colors inform the theme. Text controls use a darker ochre than the ornamental logo gold. Montserrat and Source Serif 4 are bundled locally with their OFL notices under `public/brand/`; app pages do not fetch fonts from third-party servers.
