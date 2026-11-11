# Relatório do revisor: IA e integração OpenAI (servidor)

Revisor independente, sem o contexto da conversa principal, só para leitura. Texto original do revisor (em inglês), de 11/11/2026. Os caminhos em `E:\Work\cortex-audit-tmp\` são arquivos de trabalho fora do repositório.

---

**AI pipeline review (server side and client contract)**

The adapter itself fails closed and I found no cross-user access path. The real problems are in what the model is given and in long recordings. Longitudinal context is thin and cut silently: SOAP generation sees no past consultations, the pre-briefing sees 800 characters of the last one, and the chat keeps the oldest doctor notes instead of the newest. A recording over 25 MB cannot be processed by any path in the app. One function writes model output to the patient row with no review step.

Verification was by code reading plus two scratch repro files (28 cases, fake fetch and fake DB) and a re-run of 92 existing tests, all green. Nothing was run against a database or the provider, so anything depending on SQL behaviour or the live API is marked SUSPECTED. The repository was not modified.

## A. How longitudinal context is built

| Function | Data sources | Ordering | Limits / truncation | Dropped or never sent |
|---|---|---|---|---|
| `transcribe-consultation` (SOAP draft) | `patients`: name, age, diagnoses (code + description), medications (name + dosage), allergies. Transcript of this recording, chief complaint, doctor's in-consult comments, specialty prompt or custom template. | none | Text + system over 128 KiB chars returns 413 (no silent cut). Template cut at 6,000 chars silently. Output cap 6,000 tokens. | All past consultations, medical history, social anamnesis, clinical notes, documents, medication instructions and start date. |
| `finalize-consultation`, regenerate | Same patient summary, transcript (from client body), chief complaint, doctor-edited SOAP, doctor comments. | none | Edited SOAP cut at 20,000 chars silently. Output cap 3,000 tokens. | Same as above. |
| `finalize-consultation`, profile extraction | The saved SOAP only. | none | Output cap 512 tokens. | The current chart, so it cannot see what is already recorded or what was stopped. Adds only. |
| `finalize-consultation`, first-visit history | SOAP + transcript, only when the patient has no prior consultation and the field is empty. | none | 30 items per list. Output cap 700 tokens. | — |
| `process-comment` | `patients`: name, allergies, medications (name + dosage), diagnoses; a yes/no "consultation today" flag; the comment (max 32,000 chars). | none | none | Clinical notes, history, all consultation text. |
| `process-clinical-notes` | New notes (max 32,000 chars) plus the entire `clinical_notes` blob. | oldest first | 413 once the total passes 128 KiB chars. | Everything else. |
| `generate-prebriefing` | Last consultation only: chief complaint and a slice of the SOAP. `patients`: name, age, diagnoses, medications, allergies. Last 6 entries of `clinical_notes`. | `created_at desc limit 1`; notes newest 6 | SOAP slice is 800 chars from the first `**A` header, or the last 800 chars if the header is not found. Output cap 1,024 tokens. | All earlier consultations, S and O of the last one, the plan beyond 800 chars, medical history, social anamnesis, documents. |
| `suggest-questions` | Client-supplied only (no DB): name, age, diagnoses, medications, allergies, medical history, social anamnesis, chief complaint. | none | History and social cut at 1,500 chars each, complaint at 500, all silent. | Consultations, notes, documents. |
| `chat-assistant` | `patients`: name, age, diagnoses, medications, allergies, social anamnesis, medical history, clinical notes. Consultations and documents via the `retrieve_patient_context` RPC. Last 10 chat messages from the client. | RPC: text-search score desc, then `created_at desc` | Social and medical history: first 400 chars each. Clinical notes: first 600 chars, which is the oldest. Up to 12 consultations, each reduced to a search excerpt (max 5,000 chars). Up to 12 documents (accepted review note or pending AI summary, max 2,000 chars; rejected omitted). Chat messages 2,000 chars each. Output cap 600 tokens. | Transcripts, AI insights, prescriptions, consultations beyond 12, knowledge base (disabled, static notice). |
| `generate-document` | Client-supplied SOAP and patient context (name, age, diagnoses, medications, allergies), complaint, target specialty. | none | 128 KiB chars. Output cap 1,000 tokens. | No DB read. |
| `analyze-document` | File bytes (PDF or image, max 15 MB) and file name. | none | Output cap 800 tokens; fields then cut to 80 / 1,200 / 6×300 / 300 chars. | No chart context. |
| `create-template-ai`, `ingest-knowledge`, `live-copilot` | No patient data; indexing is refused under OpenAI; copilot always returns 503. | — | — | — |

Your three questions, for a patient with 10–30 consultations:

- **Is the newest and most relevant information kept?** Only the chat sees more than one past consultation, and it keeps the oldest notes, not the newest.
- **Are allergies, medications and diagnoses always included?** Yes, in full, from the `patients` row, in every function that takes patient context. The exception is the post-save extraction.
- **Can a stopped medication appear as current?** Yes (finding 8).

## B. Findings

**1. [P1] [CONFIRMED] `process-clinical-notes` writes model output to the patient row with no review.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\process-clinical-notes\index.ts:97-117`; shown at `E:\Work\Cortex\cortex\src\components\PatientProfileDrawer.tsx:548-615`.
- Scenario: the doctor types a note; the model's symptoms, risk factors, family history and summary overwrite `patients.ai_insights` in the same update as the note. An inferred "family history" item sits in the chart and nobody accepted it.
- Evidence: the update at line 112; the existing test `openAiTextHandlers.test.ts:116` asserts this write.
- Mitigation: the panel is headed "Insights da IA" and no other prompt reads the field, so this is the mildest P1 by your definition.
- Fix: return the insights as a proposal and persist only on accept, as `process-comment` does, or stop persisting them.
- Effort: M.

**2. [P1] [CONFIRMED dead end; SUSPECTED threshold] A recording over 25 MB can never be processed.**
- Where: `E:\Work\Cortex\cortex\src\hooks\useRecording.ts:341`; `E:\Work\Cortex\cortex\supabase\functions\transcribe-consultation\index.ts:144-145`; `E:\Work\Cortex\cortex\src\components\ChatPanel.tsx:1097-1118`.
- Scenario: the recorder sets no bitrate, and the client has no size or duration check or warning. The bucket accepts 200 MB, so the upload succeeds. The function then returns 413 "Divida a gravação", and the app has no way to split.
- Consequence: "Recuperar consulta" retries the same file forever. The record button stays disabled for that patient until the draft, and its audio, is discarded.
- Threshold (estimate, not measured): about 33 minutes for the teleconsultation mix (stereo), about 60 minutes for a mono microphone, less on Safari.
- Fix: set `audioBitsPerSecond` to about 24–32 kbps mono, warn before the cap, and chunk long audio server-side.
- Effort: M.

**3. [P2] [SUSPECTED] Chat retrieval likely sends only the first 100 words of each SOAP for ordinary questions.**
- Where: `E:\Work\Cortex\cortex\supabase\migrations\20261029000200_clinical_integrity.sql:112-120`.
- Scenario: the question becomes an AND query of all its words. By PostgreSQL's documented `ts_headline` behaviour, when no match is found it returns the first `MinWords` (100) words. "Qual foi a conduta na última consulta?" would then get the opening of S and no assessment or plan.
- The `truncated` flag is `length > 5000`, so no "[trecho truncado]" marker appears.
- Evidence: reading only. The existing SQL test uses the one-word query "PSA". The local Postgres install is incomplete, so I could not execute it.
- Check: run `ts_headline` with a multi-word question against a 300-word note.
- Fix: send the full SOAP for the N most recent, use excerpts only for older matches, and set `truncated` whenever the excerpt is shorter than the note.
- Related waste: `chat-assistant\index.ts:143-170` runs two queries whose results are then discarded.
- Effort: M.

**4. [P2] [CONFIRMED] The chat block is labelled "mais recente primeiro" but is ordered by search score.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\chat-assistant\index.ts:231`; SQL line 120.
- Scenario: when an old consultation matches the question, it is listed first under a header saying most recent first. "What did we decide last time?" can be answered from a 2024 visit.
- Evidence: repro printed `01 de março de 2024 -> 05 de novembro de 2026` under that header.
- Fix: sort by date in the edge function before building the block, or drop the claim and mark the most recent explicitly.
- Effort: S.

**5. [P2] [CONFIRMED] The chat keeps the oldest doctor notes and drops the newest; history is cut at 400 chars.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\chat-assistant\index.ts:58-64, 219-224`.
- Scenario: `condense` takes the first N chars and `clinical_notes` is appended chronologically.
- Evidence: in the repro, a 2024 note was sent and the 2026 note "suspendeu anticoncepcional por trombose" was not, while the prompt still said "Medicações em uso: Anticoncepcional X". A 531-char medical history lost its last line ("mãe com câncer de mama aos 45").
- Fix: take the tail of the notes (as the pre-briefing does) and raise the caps; the prompt budget is 128 KiB.
- Effort: S.

**6. [P2] [CONFIRMED] The pre-briefing cuts Assessment + Plan at 800 chars with no notice, and misses the header in two shipped formats.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\generate-prebriefing\index.ts:122, 199-205`.
- Scenario: the regex `/\*\*A[\s—(]/` does not match `**A:**` (the PRENATAL and UROLOGIA prompts) or `#` headings (custom templates). Those fall back to the last 800 chars and lose the assessment.
- Evidence: three repro cases. A pending biopsy at the end of a 1,121-char note was not sent. The prenatal and custom-template assessments were not sent. No truncation notice in any.
- Consequence: the "pending" field of the briefing can be empty when something is pending.
- Fix: send the whole SOAP, or A+P up to several thousand chars, and tell the model when it is cut.
- Effort: S.

**7. [P2] [CONFIRMED] The pre-briefing prompt has no grounding rule and must fill "evolution" and "alert" from one visit.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\generate-prebriefing\index.ts:21-46`.
- Scenario: the system prompt is two sentences asking to "destacar pendências, alertas e a evolução". Strict schema makes every field required, and only one consultation is supplied.
- Evidence: the repro confirmed the prompt contains no "do not invent" wording. How often the model invents needs the live evaluation.
- Fix: add the same rules the SOAP prompts carry, and allow an explicit empty value for `evolution`.
- Effort: S.

**8. [P2] [CONFIRMED] A medication stopped during a consultation stays in "Medicações em uso".**
- Where: `E:\Work\Cortex\cortex\supabase\functions\finalize-consultation\index.ts:26-32`; `E:\Work\Cortex\cortex\src\components\ProfileUpdateCard.tsx:8, 105-107`.
- Scenario: the post-save extraction proposes only additions, and the card merges as a union. Every later prompt reads `patients.medications` as current.
- Removal exists only through `process-comment` or the manual reconciliation flow.
- Fix: give the extraction the current list and a `medications_stopped` output, shown in the same review card.
- Effort: M.

**9. [P2] [CONFIRMED mechanism; SUSPECTED frequency] Tight output caps turn longer answers into hard failures, some silent.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\finalize-consultation\index.ts:260, 337, 347-349, 382, 398-400`; `E:\Work\Cortex\cortex\supabase\functions\chat-assistant\index.ts:298`.
- Scenario: a truncated response is rejected with 502 (correct), but the caps are small.
  - Chat: 600 tokens for "200 words" plus UUID citations; a failure also marks the turn failed.
  - First-visit history: 700 tokens for up to 60 items, and the catch swallows the failure, so a rich first visit yields no proposals and no message.
  - Profile extraction: 512 tokens, same silent drop.
  - Regeneration: 3,000 tokens, while the draft it must rewrite was allowed 6,000.
- Fix: raise the caps (cost is bounded by the reservation) and surface a notice when extraction is skipped.
- Effort: S.

**10. [P2] [CONFIRMED arithmetic; production limit unknown] The default daily quota is too small at OpenAI prices.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\quota.ts:20, 56`; `E:\Work\Cortex\cortex\supabase\functions\transcribe-consultation\index.ts:153`.
- Scenario: transcription costs 4.5 credits per minute and reserves 400 up front against a default of 1,500. A 20-minute consultation costs about 115–125 credits in total.
- Consequence: the next transcription is refused once about 1,100 are used, around the 9th or 10th patient of the day.
- The day resets at 00:00 UTC (21:00 in São Paulo), not "em 24h" as the message says.
- Check: `user_settings.daily_credit_limit` for the pilot doctors.
- Fix: raise the default, and reserve from blob size instead of a flat 400.
- Effort: S.

**11. [P2] [SUSPECTED] The 90-second deadline and two sequential calls may not fit long audio or the platform's response timeout.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\clinicalAi.ts:125`; `transcribe-consultation\index.ts:160-273`; `finalize-consultation\index.ts:335-384`.
- Scenario: the only live evidence is a 23-second clip. A 30–60-minute file must upload and transcribe within 90 s, then the SOAP gets another 90 s. Worst case is about 185 s before any byte is returned.
- From memory, Supabase cuts an idle request at about 150 s. Confirm that limit.
- What survives: the transcript checkpoint does, because it is saved before the SOAP call.
- Check: synthetic 10, 30 and 60-minute audio, and whether the model has its own duration limit.
- Fix: size-scaled deadline for transcription, and return after the transcript with SOAP as a second request.
- Effort: M.

**12. [P2] [CONFIRMED] Every provider error except 429 becomes 503 "Tente novamente", and the provider's error code is discarded.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\clinicalAi.ts:126-129`.
- Scenario: 400 (audio too long, bad schema, context too large), 401 or 403 (key revoked), 404 (model unavailable) and 413 all tell the doctor to retry something that cannot succeed. The log holds only `http_status`.
- Evidence: repro for 400, 401, 403, 404, 413 and 422.
- Fix: map 4xx to a non-retryable message, and log the provider's `error.code` and `type` (not `message`).
- Effort: S.

**13. [P3] [CONFIRMED] A finalize retry after a timeout returns empty profile proposals.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\finalize-consultation\index.ts:184-209`.
- Scenario: if the first call saved the consultation but the response was lost, the retry takes the already-saved path and returns `profileUpdates` empty.
- Consequence: the doctor never sees the proposed diagnoses, medications and allergies. History proposals survive because they are stored.
- Fix: store the profile proposal on the consultation like `history_proposals`.
- Effort: S.

**14. [P3] [CONFIRMED] The medication-question router blocks unrelated questions and lets dose questions through.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\clinicalQuestionSafety.ts:4-19`.
- Blocked with the canned reply:
  - "E qual foi a queixa da última consulta?" after any earlier message mentioning a medication.
  - "Pode resumir a última consulta e manter o foco no plano?"
  - "Ela pode iniciar o pré-natal aqui?"
- Sent to the model:
  - "Qual a dose máxima de metformina na gestação?"
  - "Qual antibiótico para ITU em gestante de 20 semanas e em que dose?"
  - "Ibuprofeno é permitido no terceiro trimestre?"
- The system prompt still forbids dose advice; whether the model obeys belongs in the live evaluation.
- Fix: narrow the follow-up rule to messages that themselves mention a drug or dose, and add dose and pregnancy-safety patterns.
- Effort: S.

**15. [P3] [CONFIRMED] Failure paths never settle the reservation; release depends on a cron job that is only created if `pg_cron` exists.**
- Where: `E:\Work\Cortex\cortex\supabase\migrations\20261101000000_review_hardening.sql:384-399`.
- Scenario: with the job, three failed transcriptions (3 × 400) lock the doctor out for 10–15 minutes. Without it, until 21:00.
- Check: `cron.job` in production.
- Fix: settle at zero in a `finally` when the provider returned non-2xx or was never reached.
- Effort: S.

**16. [P3] [CONFIRMED] A completed, paid response is discarded if the provider reports the model under another suffix.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\clinicalAi.ts:92-95, 149`.
- Scenario: only `gpt-6.1-terra` or `gpt-6.1-terra-YYYY-MM-DD` is accepted.
- Evidence: the repro rejected `-20261110`, `-latest` and `-2026-11-10-preview` with 502. A naming change would fail every text call at once.
- Fix: accept any id starting with the requested name plus `-`, and record a null effective model when it is unrecognised instead of throwing.
- Effort: S.

**17. [P3] [CONFIRMED] Guard order is inconsistent when AI is off or the key is missing.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\process-clinical-notes\index.ts:58-59`.
- Same pattern in: `generate-prebriefing`, `suggest-questions`, `generate-document`, `analyze-document`, `create-template-ai`, and the regenerate path of `finalize-consultation`.
- Scenario: a missing key returns 500 with the text "OPENAI_API_KEY não configurada", which the client shows verbatim.
- Related: `process-clinical-notes` does not save the doctor's note when AI is off, whereas `process-comment` saves it verbatim.
- Fix: call `assertOpenAiEnabled()` first everywhere, return the standard 503, and save the note regardless.
- Effort: S.

**18. [P3] [CONFIRMED] The client replaces specific server messages with "Tente novamente" for finalize and chat.**
- Where: `E:\Work\Cortex\cortex\src\components\ChatPanel.tsx:1254-1257, 1380-1383`.
- Scenario: the 409 "já foi registrada com outro conteúdo", the 503 "A evolução foi salva, mas…", the chat's "já está em processamento" and the rate-limit response are all hidden.
- Related, server side: a quota refusal at the SOAP stage is swallowed into a generic `draftFailed` (`transcribe-consultation\index.ts:268, 312-314`).
- Fix: use `functionErrorMessage` in both handlers, and return a `quotaExceeded` hint in the recovery response.
- Effort: S.

**19. [P3] [CONFIRMED] The patient's name is in every prompt, and the uploaded file name goes to the provider.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\gemini.ts:294`; `analyze-document\index.ts:134`. Also `process-comment`, `generate-prebriefing`, `suggest-questions`, `chat-assistant`.
- Scenario: only the referral document needs the name. File names often contain it.
- Fix: send "Paciente" plus age except for referrals, and drop the file name.
- Effort: S.

**20. [P3] [CONFIRMED] The Gemini path is blocked only while `AI_PROVIDER` is exactly `openai`.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\http.ts:36-37`; `ingest-knowledge\index.ts:39-42`.
- Scenario: rolling back by unsetting the provider flag, with `AI_ENABLED=true` and the Gemini key still present, lets knowledge indexing send text to Gemini again.
- Fix: require an explicit `AI_PROVIDER=gemini` for legacy operations.
- Effort: S.

**21. [P3] [CONFIRMED] `process-clinical-notes` resends the whole notes blob each time and stops working for that patient past 128 KiB chars.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\process-clinical-notes\index.ts:81-86`.
- Fix: send the last N entries.
- Effort: S.

**22. [P3] [CONFIRMED] Custom templates are cut at 6,000 chars, and the doctor-edited SOAP at 20,000, with no notice.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\specialty_prompts.ts:289`; `finalize-consultation\index.ts:234`.
- Scenario: a long template loses its last sections and the generated note silently lacks them.
- Fix: reject with a message instead of slicing.
- Effort: S.

**23. [P3] [SUSPECTED] Document analysis has never been exercised against the real API.**
- Where: `E:\Work\Cortex\cortex\supabase\functions\_shared\clinicalAi.ts:69-90`.
- Scenario: a 15 MB PDF becomes about 20 MB of inline base64 inside the same 90 s deadline. The smoke test covered only text and audio.
- Check: one synthetic PDF and one image, small and near the limit.
- Effort: S.

## C. Checked and OK / Not covered

**Checked and OK (by reading; tests where noted)**
- **Authorization:** all 15 functions derive identity from the verified JWT, block reception accounts, and enforce the second factor when enrolled. Every service-role query I read filters by `user_id`. Audio and file paths are asserted to the caller's prefix. I found no cross-user path.
- **Adapter:** `store:false` on the single Responses call site, no tools, no streaming, no retries (so no idempotency exposure), redirect refused, response body bounded at 2 MB, deadline covers the body.
- **Fail-closed parsing:** refusal, incomplete, empty, schema-invalid and tool-call outputs all return 502 (their tests and mine).
- **Logs:** metadata only; no patient text or provider body.
- **Draft handling:** the transcript is checkpointed before settlement and before the SOAP call, with compare-and-swap on `updated_at`.
- **Human review:** generated SOAP is always previewed and saving requires `reviewed:true`. History, profile, comment and document outputs are proposals.
- **Rejected document analyses** are excluded from chat retrieval in SQL.
- **Identifiers:** CPF, phone and address are not sent by any model-calling function.
- **Disabled paths:** the copilot is off server-side; Gemini file cleanup still works with AI off.
- **Request shape:** their smoke evidence shows the real adapters accepted once (23 s clip, duration usage, strict schema). I did not re-verify it.

**Not covered**
- **Live model behaviour:** audio duration limits, usage shape on long audio, pt-BR accuracy, refusals, and whether `languages[]` and `reasoning.effort:"none"` remain valid.
- **SQL execution:** the `ts_headline` claim, compare-and-swap under real concurrency, whether `pg_cron` and the release job exist, quota values, and deployed versions versus the repository.
- **Browser bitrates:** computed, not measured.
- **Supabase platform timeouts:** quoted from memory.
- **Only skimmed:** `generate-prescription` and `validate-prescription` (no model call; auth checks only). `ConsultationReviewModal.tsx`, `DocumentComposerModal.tsx` and most of `Index.tsx` beyond the call sites. Template sharing between doctors. `docs/ai`.
- **Coordination messages:** not answered, because this review was read-only.

Repro files are in `E:\Work\cortex-audit-tmp\review\ai\`: `adapter.test.ts`, `context.test.ts`, `vitest.config.mjs`. Run from the repo root with `npx vitest run --config E:/Work/cortex-audit-tmp/review/ai/vitest.config.mjs --silent=false`.
