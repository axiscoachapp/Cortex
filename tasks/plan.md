# Cortex audit remediation

## Authorized implementation — 2026-10-28

Implementation and local verification completed. See `docs/reviews/2026-10-28/remediation/IMPLEMENTATION.md` and `validation.json`. Provider selection, production/staging rollout evidence and legacy migration remain separately identified; no deployment or real patient/provider operation occurred.

Execute APP_REVIEW.md and its functionality map, and adapt the app to Haddad Nicola's website brand. API-provider selection/contracting and PersonalMed migration are explicitly deferred by the user. Existing clinical AI calls must remain controllable; manual work must not depend on provider availability. No production deployment is part of this local implementation.

Ordered, verified slices (preserve historical sections below):
1. Patient/encounter identity and clinical acceptance: authoritative URL, nullable demographics, revision-aware editors, exact appointment link, no hidden AI chart writes, reviewable template generation. Verify regression/component/handler tests.
2. Privacy integrity: server audio discard, complete deadlines, immutable issuance, provider cleanup receipt, consistent exports, explicit environment. Verify failed cleanup, stalled body, concurrent export and snapshot tests.
3. Sharing: private owner paths plus explicit revocable read/contribute boundary, attributed append-only entries, authenticated downloads and custody guards. Verify outsider/revocation/offboarding SQL and UI tests.
4. Usable documentation: direct reviewed-text editing, autosaved manual encounter, pending work queue, source-linked history/timeline and task tracking. Verify recovery and exact approved persistence without AI calls.
5. Specialty/longitudinal functions: gynecology/prenatal/urology templates, observations, medication states, follow-ups, reviewed/versioned knowledge and instructions. Verify ownership, empty/failed/dirty states and provenance.
6. Brand and UX: official clinic logo/palette/type, responsive workspace, persistent recording controls, semantic states, contrast and recoverable copy/print. Verify 390/768/820/1280 widths and keyboard behavior with synthetic browser backend.
7. Operations and documentation: PHI-free operation IDs/diagnostics, kill switch, rate controls, runbooks, current claims/README. Run full tests, build/types, lint, Edge checks, SQL and final adversarial review; record external release rehearsals honestly.

Independent lanes reserve migrations 20261029000100 (privacy), 20261029000200 (clinical), 20261029000300 (sharing); root uses 20261029001000+ for additional clinical workspace features. Root integrates shared types and routes. Each lane writes focused tests; no unrelated files are staged.

## Subsequent review and clinic roadmap — 2026-10-28

The remediation plan below remains the historical record of completed work. A new read-only review of baseline `1ad2116` is complete in `docs/reviews/2026-10-28/APP_REVIEW.md`.

The next proposed work is documented in `docs/reviews/2026-10-28/ROADMAP.md`: resolve AI-provider eligibility, repair newly identified clinical/context/lifecycle defects, then add private doctor workspaces with explicit patient-sharing grants. All doctors at Haddad Nicola are in scope; reception is not an initial requirement. PersonalMed 2005 migration is a later separately validated project. See `AI_PROVIDER_OPTIONS.md` for the requested API alternatives. These proposed implementation slices have not been performed by the review.

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
