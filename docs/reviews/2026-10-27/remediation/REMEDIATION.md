# Cortex audit remediation

Branch: `codex/app-audit-remediation`. The changes address the 40 findings in the original `APP_REVIEW.md`, plus integration defects found while testing the repairs. This is a local implementation and validation record. Production has not been changed.

## Finding disposition

| Finding | Repair | Evidence |
|---|---|---|
| S1 — privileged prescription reads | Client lifecycle writes revoked; canonical server-derived RX paths; public validation gates before storage access | Actual-handler traversal, expiry, issuance and signature regressions; PostgreSQL grants/RLS |
| S2 — audio/document path aliases | Reject encoded, dot, slash and bucket aliases; authorize metadata and exact persisted recording path independently | Storage boundary and actual-handler tests |
| S3 — cross-owner relationships | Composite owner FKs reject new inconsistent relationships; historic rows preserved; deletion preflight prevents foreign cascades | Five SQL suites, including legacy cross-owner fixtures |
| S4 — OAuth state | Authenticated server start, hashed single-use expiring state, user/redirect binding, PKCE, consumed transaction | Replay, cross-user and callback lifecycle regressions |
| S5 — forged signature/validity | Server-owned signature and issuance attestations; legacy rows require reissuance; unsigned documents labeled explicitly | Validator handler and prescription-list tests |
| S6 — incomplete deletion | Paginated orphan-prefix cleanup, checked failures, resumable deletion intent, parent/Storage guards and live-parent requirements | Concurrent-delete, late-upload, orphan and failure tests; SQL policies |
| S7 — quota races/fail-open | Atomic service-only reserve/settle RPCs; validation before paid reservations; failures block model access | SQL accounting checks and quota/handler regressions |
| S8 — missing accounting | Shared provider usage settlement, thinking tokens, separate extraction/embedding accounting; unknown cost retains reservation | Quota and handler tests |
| S9 — clinical logs | Remove provider payloads, transcript/response text and dynamic clinical exception logs | Source review; failure-path tests |
| S10 — email HTML | Escape dynamic reminder content and independently authorize the joined patient | Reminder safety and actual-handler tests |
| S11 — incomplete export | Full ordered table paging, all three private buckets, actual file bytes, sizes and SHA-256; any failure aborts completion | Multi-page/low-cap manifest, binary export and frontend assembly tests |
| C1 — stale new-consult briefing | One activation path; patient/revision/day-bound caches; backend also checks consultation revision; error is distinct from first visit | Index and actual prebriefing-handler tests |
| C2 — wrong-patient notes | User/patient-bound note drafts and captured submission identity | Delayed A-success/B-edit component regressions |
| C3 — late results/documents | Origin-bound async completions and immutable document patient names | Chat component regressions and source review |
| C4 — lost active work | Server consultation drafts; dirty/route guards; stop/persist required before leaving with captured audio; cancel delayed microphone grants | Recording, draft, ChatPanel and Index regressions |
| C5 — early audio deletion | Keep source audio through model errors and review; remove only after successful clinical save | Actual transcription/finalization handlers and component tests |
| C6 — malformed AI auto-save | Require complete STOP/nonempty/schema-valid output; explicit physician review; regenerated note requires another confirmation | Clinical safety and handler tests |
| C7 — stale medication dose | Accepted same-name medications replace dosage/instructions; clinician review remains explicit | Medication merge and profile acceptance tests |
| C8 — lost physician comments | Original recording comments persist in drafts and reviewed finalization | Recording and clinical handler regressions |
| C9 — PDF clipping | Real-font measured wrapping, continuation pages and reserved QR/signature footer area | Actual production-handler PDF fixture, text counts and rendered four-page inspection |
| C10 — silent truncation | Full ordered clinical lists, visible UI paging, explicit document/input limits instead of silently omitted content | Pagination, boundary and PDF tests |
| C11 — concurrent overwrites/history | Revision CAS, immutable snapshots and atomic clinical comment/addendum RPC; second-tab draft cannot replace an existing draft | SQL revision/concurrency tests and component conflict recovery |
| F1 — settings policy conflict | Narrow allowlisted settings RPC; explicit Save, awaited errors and rollback | SQL RPC checks and settings component tests |
| F2 — auth/hooks/OAuth loading | Unconditional hooks; protected routes wait for auth; callback waits and avoids duplicate exchange | Auth/callback/directory tests and source review |
| F3 — stale caches | User-scoped keys, cache clearing on identity changes, complete mutation invalidations and source-bound briefings | Component/handler tests and source review |
| F4 — date shifts | Strict SQL DATE display, São Paulo clinic day and calendar-day differences | Midnight and invalid-date tests; browser displays today correctly |
| F5 — reminder semantics | Normalize E.164; WhatsApp stays pending with persistent link and no delivery claim; only confirmed email success marks sent | Reminder, dashboard and appointment regressions |
| F6 — signup/recovery | Confirmation notice, resend action, password-reset request and recovery update screen; retain safe deep links after login | Auth component and safe redirect tests |
| U1 — tablet overflow | Responsive calendar header and one usable calendar toolbar | Browser at 820×900: document width 805, header actions within viewport |
| U2 — short-screen dialogs | Bounded dialogs with internal scrolling and reachable action controls | Browser at 390×480: appointment/new-patient dialogs within y=24..456 |
| U3 — inaccessible forms | Associated labels, names, descriptions, keyboard file actions and live status semantics | Component tests and browser accessibility trees |
| U4 — password/assistant access | Keyboard-reachable named visibility action; assistant labels/log/retry | Auth tests and source review |
| U5 — errors shown as empty | Explicit query/model errors and retry controls; failed history never means first visit | Query, handler and real-browser error-state checks |
| U6 — home/chart navigation | Working desktop Home; directory chart links and deep-link activation | Index/directory tests and browser checks |
| U7 — destructive/dirty actions | Confirm deletion, preserve metadata when Storage fails, await Google deletion and guard dirty edits | File, appointment, profile and Index regressions |
| U8 — mobile Google access | Named mobile Calendar connect control using server OAuth start | Browser accessibility check; OAuth boundary tests |
| E1 — types/build | Types regenerated from migrated PostgreSQL; app/node and actual Edge Function type checks; build includes checking | Type checks and production build |
| E2 — tests/CI | Behavioral regressions, actual transpiled handlers, disposable PostgreSQL tests, app-wide coverage and CI | `npm run test:coverage`, `npm run test:db`, CI workflow |
| E3 — dependencies | Patched dependency tree, pinned Edge SDK imports, npm lockfile and Node floor | npm audit reports zero known vulnerabilities |
| E4 — bounded operations | Body/prompt/file limits, provider deadlines, complete list pagination, lazy workspace and recoverable route/render boundaries | Boundary tests, type checks, build and browser smoke checks |

## Validation and interpretation

Final local results: **169 tests passed in 32 files**, all **26 migrations and five SQL suites passed**, all **22 Edge Functions passed Deno checks**, and application/node TypeScript plus the production build passed. ESLint reports **zero errors** and npm audit reports **zero known vulnerabilities**. Application-wide line coverage is **37.86%**; remaining coverage gaps are visible rather than excluded.

Regression tests were written/run against the failing behavior before the corresponding fixes where practical. They exercise delayed responses, malformed model output, cross-owner inputs, failed Storage/provider calls, repeated quota settlement, source audio recovery and concurrent clinical edits. Edge-handler tests execute production handler code with synthetic database/network boundaries; they do not call Gemini, Google or email providers.

The database runner creates a uniquely named disposable `pgvector/pgvector:pg16` container, applies the bootstrap plus all 26 migrations, runs five SQL suites and removes only its own container. It does not reset a linked Supabase project. The bootstrap models Supabase roles, RLS and auth/Storage schemas; it does not implement the production Storage HTTP service.

Coverage includes all application source files rather than only imported modules. Its percentage is a remaining test-coverage measure, not a claim of complete behavioral coverage. Expected error-path test logs use synthetic data. Eight existing Fast Refresh organization warnings remain; ESLint has zero errors.

The immutable synthetic prescription fixture is `prescription-verified-f43bf77cf77e.pdf` (SHA-256 `f43bf77cf77e76b225b6d8242d87d9774cf98afe6feba7aadf3244084ae2f67f`). Its four PNGs were inspected. All 15 medications, 120 instruction markers, four QR codes and consistent validation footers are preserved. `scripts/verify-prescription-pdf.mjs` reproduces the production handler using real PDF/QR libraries supplied as module-directory arguments.

Browser checks use only a loopback synthetic backend and Audit Patient A/B. Responsive controls, scrolling, calendar navigation and explicit briefing errors were verified. The patient-switch confirmation appeared as expected, but automation could not control the native dialog to finish that browser flow; patient isolation and capture-exit cases passed component tests. No real clinical data, actual OAuth grant, reminder delivery, account deletion or paid model request was performed. See the saved tablet/mobile/error-state screenshots and `validation.json` for final counts and results.

## Deployment sequence and data compatibility

1. Back up production database and private Storage; rehearse this entire change on an isolated staging project. Use a maintenance window or coordinated release: old frontend writes to prescriptions, settings and patient deletion are intentionally rejected by the new permissions.
2. Apply migrations `20261028000000` through `20261028000800` in order. They preserve historic clinical rows. New composite constraints are initially `NOT VALID` so an old inconsistent row cannot cause destructive migration repair. New writes must obey the constraints immediately.
3. Run `public.validate_security_boundaries()` using an operator/service connection and investigate any nonzero counts. Investigate historic mismatched ownership before validating the new FKs. Do not reassign or delete medical records automatically. Parent deletion returns a conflict while a foreign-owned child would be affected.
4. Deploy all changed Edge Functions together, including new `google-oauth-start`, `delete-patient` and `export-user-data`; retain `verify_jwt=false` only for the secret-gated public prescription validator. Deploy the frontend from the same revision. New upload flows require draft/RX metadata before uploading.
5. Configure `ALLOWED_ORIGIN` to the exact HTTPS app origin and `GOOGLE_OAUTH_REDIRECT_URIS` to an explicit comma-separated allowlist of callback URLs. Register matching Google redirect URLs. Existing Google client credentials and provider secrets remain server-side. Calendar maintenance accepts the exact Vault service-role secret and fails closed if it is absent.
6. Configure Supabase Auth confirmation/recovery redirects for the app origin and `/auth?mode=recovery`. Check email confirmation, resend, recovery and expired-session callback flows on staging with designated test accounts.
7. Reissue legacy prescriptions when needed. Existing files remain available for owner export, but null `issuance_verified_at` documents cannot be publicly validated. Never backfill issuance/signature attestations merely from historic client-writable dates or status. Only a trusted signature-verification integration may attest a cryptographic signature; ordinary generated PDFs remain unsigned.
8. Verify native Storage HTTP behavior under stale JWTs, upload/delete races and failed cleanup, then retry interrupted deletions. Confirm Google refresh/sync/reminders and real provider usage with designated staging data. Check the production CSP if using a custom Supabase hostname: add only that exact API/WebSocket origin to `connect-src`.

The default browser export has an explicit **100 MB raw-file limit** to avoid memory exhaustion. It aborts with an actionable support-export message and never labels a partial archive complete. Larger archives need an operator export before deletion. Unknown/interrupted provider cost retains its reservation until the UTC daily rollover; it is not silently refunded. Quota reservations bound admission but actual provider overrun is charged in full.

This branch has not been deployed or pushed. Local verification does not establish production authorization, provider delivery, cryptographic signature validity, legal compliance or production performance metrics.

## Sources used for compatibility work

- [Vite 8 migration](https://vite.dev/guide/migration)
- [Vitest migration](https://vitest.dev/guide/migration/)
- [GitHub setup-node](https://github.com/actions/setup-node)
- [Supabase password recovery](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)

