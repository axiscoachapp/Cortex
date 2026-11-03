# Clinic review repairs — 2026-11-03

User-authorized scope: repair the issues in the supplied review image in the current clinic repository. Preserve Haddad Nicola branding, existing patient data, other local work, and the separate SaaS plans. Baseline: `521b238`.

## Ordered slices

- [x] Clinical-answer safety: shared medication-verification boundary, no unsupported reassurance, no model cost for deterministic limitations, preserve authorization/rate controls, visible evidence status.
- [x] Chart opening: read-only selection, explicit start, explicit AI summary generation, stable cache, accurate patient status.
- [x] Conversation recovery: persist owner/patient-bound questions and answers, authorization-aware sources, include new data in export/deletion lifecycle.
- [x] Readable clinical text: safe Markdown rendering for responses, timeline and sources; no raw HTML or remote content execution.
- [x] Registration: shared meaningful validation, preserve valid newborn/unknown ages, editable contact and optional administrative fields, server checks.
- [x] Discoverability/navigation: visible document actions, working profile, persistent mobile subpage navigation, template previews, calendar view controls, correct counts/onboarding copy.
- [x] Knowledge intake: preview/import text PDFs without enabling AI or silently approving/indexing new sources.
- [x] Verification: focused regression checks per slice, SQL/types/Edge/build/lint, synthetic browser scenarios, independent local review and final report.

## Integration boundaries

No patient/provider calls, external messages, live model activation, or production deployment are needed for local fixes/tests. Preserve the existing honest distinction between preparing WhatsApp, manual sending and confirmed delivery. Automated WhatsApp/SMS requires a selected/contracted messaging integration; document that dependency rather than inventing delivery.

Medication verification is a containment control pending a validated pharmacological data source. It is not a claim of exhaustive language detection or a certified interaction checker. Both assistant surfaces must follow the same contract.

## Evidence

Record actual checks and limits in `IMPLEMENTATION.md` at completion. Do not reuse historical pass counts. External cross-model review remains skipped per the user's existing preference.
