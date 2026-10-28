# Cortex audit remediation

Repair all 40 findings in docs/reviews/2026-10-27/APP_REVIEW.md. Work locally on codex/app-audit-remediation; retain the existing review and user files. Production deployment is a separate action.

## Ordered increments

1. Storage and relationship authorization (S1–S5): canonical keys, server-owned document lifecycle, tenant-consistent relationships, OAuth state and PKCE. Verify rejected traversal and foreign-user actions with unit tests and disposable PostgreSQL policy tests.
2. Clinical work ownership and recovery (C1–C8, C11): patient-bound drafts/results, navigation guards, server consultation drafts, retained audio, strict provider outputs, medication reconciliation and versioned writes. Verify delayed operations, switching, errors and concurrency before expanding.
3. Documents and privacy (S6, S11, C9–C10): measured pagination, explicit limits, checked paginated exports, idempotent complete storage cleanup. Verify boundaries, failed pages/removals and orphan prefixes.
4. Accounting and functions (S7–S10, F1–F6): atomic quota reservations, full usage accounting, restricted settings, auth lifecycle, dates, cache invalidation and reminder semantics. Verify RPC authorization/concurrency and component error states.
5. UI and access (U1–U8): responsive controls, named/labeled fields, reachable dialogs, errors versus empty data, chart/home navigation, dirty editors and mobile integration access. Verify keyboard behavior and real browser viewports.
6. Engineering gates (E1–E4): migration-backed generated types, clean lint/type checking, dependable tests/CI, dependency triage, bounded network requests, pagination, lazy workspace and error boundaries. Run full tests, database policy suite, build and local browser smoke tests. Record remaining deployment checks without treating mocks as production evidence.

## Contracts

- OAuth start POST {redirectUri} returns {authorizationUrl}; callback POST {code,state,redirectUri}. Server stores and consumes the single-use transaction.
- Settings RPC update_user_settings(p_patch jsonb) allowlists user-editable fields; quota remains server-owned.
- Prescription revoke RPC revoke_prescription(p_id uuid); client cannot modify path, signature or validity.
- Patient deletion POST delete-patient {patientId}; verified storage cleanup precedes metadata deletion.
- Clinical jobs/drafts persist on the server under user and patient ownership, never in browser localStorage. Async completions retain their original identity.
- Shared fetchAllRows(page) uses ordered inclusive ranges; SQL calendar dates use formatDateOnly and clinicDate rather than UTC parsing.

Independent workstreams own separate files; schema contracts are agreed before integration. Meaningful behavior tests start red, then run after each repair. Preserve tests and implementation as focused commits once verified; do not commit unrelated user files.
