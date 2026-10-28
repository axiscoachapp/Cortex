# AI API options for Haddad Nicola

Decision support, 2026-10-28. No vendor account, contract, API key or paid request was created. These are candidates to evaluate, not a certification that a provider or Cortex is approved for every clinical use.

## Recommendation

Benchmark **OpenAI API for transcription and physician-reviewed documentation**, with **Azure OpenAI plus Azure Speech** as the alternative when Azure deployment and access controls justify the additional operations. Include **Anthropic's commercial API** as a second text-generation candidate for source-grounded summaries and document drafting. Choose on Portuguese clinical documentation quality, recoverability, permitted use and data handling before optimizing token prices.

For launch, scope AI to transcription, organizing information actually supplied by clinicians, source-linked chart retrieval and draft formatting. Keep direct diagnosis/treatment recommendations, inferred differential diagnoses, medication-interaction judgments and autonomous patient advice out of the initial release unless separately evaluated and contractually supported. Some of those higher-risk behaviors already exist in Cortex's transcription/live-copilot outputs; replacing an endpoint does not validate them.

Use a speech stage followed by a structured draft stage. Preserve the transcript and source references; let the physician edit and approve the exact final text. Do not silently use another vendor when a request fails: a second processor needs an approved policy and equivalent data controls.

## Provider shortlist

| Candidate | Proposed role | What the official sources establish | Selection conditions |
|---|---|---|---|
| **OpenAI API** | First benchmark for transcription, structured note drafts, source-linked summaries and document formatting | API inputs are not used for training by default. Default abuse-monitoring retention can reach 30 days; storage and retention vary by endpoint. Eligible customers may request additional controls. The applicable usage policy requires professional involvement for licensed advice and human review of high-stakes decisions. | Confirm the precise medical-documentation use and account terms. Medical service terms say the services are not intended for diagnosis/treatment. Request the required retention configuration; `store:false` alone is not a blanket zero-retention setting. Test Portuguese terminology, speaker attribution and exact medication/dose transcription. |
| **Azure OpenAI / Microsoft Foundry + Azure Speech** | Alternative for a clinic product that benefits from Azure identity, deployment governance and separate speech services | Microsoft says prompts are not made available to model providers or used to train foundation models without permission. Processing location depends on deployment type; Global and DataZone are materially different from geography-constrained deployments. Azure Speech lists Brazilian Portuguese. | Check the exact model, region, deployment type, abuse-monitoring policy, applicable product terms and allowed intended use. A resource named Brazil does not prove every request stays in Brazil. Assess the additional configuration and operating cost. |
| **Anthropic commercial API** | Text alternative for long-chart synthesis, source comparison and draft documents; pair with an approved transcription service | Anthropic publicly offers healthcare-oriented commercial capabilities. Standard API retention is generally up to 30 days with exceptions; negotiated retention and Files API behavior differ. Covered Models have additional retention requirements. | Obtain the applicable effective policy and healthcare/data-processing terms for the exact service/model. Evaluate text quality separately from transcription. Do not assume all models support zero retention or that US healthcare marketing establishes Brazilian compliance. |

Sources supporting these rows: [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data), [OpenAI policy effective October 29, 2025](https://openai.com/policies/usage-policies/revisions/2025-10-29/), [OpenAI medical service terms](https://openai.com/policies/service-terms/), [Azure model data privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy), [Azure Speech languages](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support), [Anthropic healthcare announcement](https://www.anthropic.com/news/healthcare-life-sciences), [Anthropic commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [Anthropic Covered Models retention](https://privacy.claude.com/en/articles/15425996-data-retention-practices-for-covered-models).

This is a shortlist, not an endorsement of clinical accuracy. No comparative model evaluation was performed in this review. Exact model versions and account availability should be recorded at the benchmark rather than selected from a brand-level comparison.

## Why the current Gemini integration needs a decision first

`supabase/functions/_shared/gemini.ts:7` targets `generativelanguage.googleapis.com` and the Gemini Developer API. Its terms, effective March 23, 2026, prohibit clinical-practice use. Unpaid services also prohibit submission of sensitive/confidential/personal information. Paying changes aspects of data handling but does not remove the general use restriction. [Gemini API terms](https://ai.google.dev/gemini-api/terms)

Moving to Vertex/Google Cloud is **not an automatic workaround**. Google's standard service-specific generative-AI terms also restrict clinical purposes, while distinguishing administrative activities. Obtain written confirmation under the actual product/agreement before proposing a Google clinical deployment. [Google Cloud service-specific terms, Healthcare Restrictions](https://cloud.google.com/terms/service-terms)

## Important date and capability cautions

The OpenAI live policy page retrieved during this review was labeled effective **November 20, 2026**, after this review date. The analysis therefore uses the published **October 29, 2025** version for the current decision. Recheck the applicable policy at contracting and launch. The OpenAI medical service terms retrieved were updated October 16, 2026.

The Anthropic live usage-policy page was labeled effective **November 12, 2026**. It was not treated as already effective on October 28. The healthcare announcement and retention sources above support candidacy; the effective account policy remains a procurement check. This is particularly relevant if the launch crosses either future effective date.

The current [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text) documents `gpt-transcribe` for file transcription, but marks `gpt-4o-transcribe-diarize` deprecated. Do not start a new long-lived dependency on a deprecated model for speaker labels. Confirm the supported diarization path in the selected provider and test doctor/patient/companion attribution; ordinary transcription support does not establish reliable speaker attribution.

## Evaluation plan before selecting a provider

1. **Contract and data gate.** Record intended tasks, exact service/model, effective terms, data-processing agreement, subprocessors, retention exceptions, file cleanup, processing locations and transfer arrangements. Clinic/provider counsel should resolve contractual and Brazilian health-data obligations. A HIPAA label is not a substitute for that decision.
2. **Synthetic Portuguese evaluation set.** Have Haddad Nicola clinicians approve representative gynecology, prenatal and urology scenarios. Include accents, overlapping speakers, long pauses, negation, allergies, medication names/doses, dates, corrections, low-quality audio and information absent from the source. Use synthetic data first; any later real recordings need an approved processing basis and handling plan.
3. **Blind clinical documentation review.** Compare transcript fidelity, unsupported additions, omitted facts, source attribution, review time and edit burden. Separately assess schema validity, refusal handling, incomplete responses and poor-audio warnings. Correct JSON is not clinical correctness.
4. **Reliability and privacy tests.** Cover timeout before/after headers, interrupted upload, duplicate retries, quota exhaustion, record sharing revoked during an operation, cleanup failure and provider outage. No raw chart text in telemetry. Preserve drafts and permit manual completion.
5. **Economic comparison.** Measure total cost per approved encounter and per clinician/day: audio minutes + text input/output + embeddings + repeat prebriefings + retries + storage/egress. Measure median and p95 latency from clinic-network tests. No cost or accuracy winner is asserted without these measurements.
6. **Versioned rollout.** Approve one provider/model configuration, pin the model where supported, retain prompt/schema versions and a kill switch, and rerun the evaluation when a model or policy changes. Keep a manually usable documentation path.

Proposed pilot acceptance: zero cross-patient access in the authorization suite; every final record explicitly accepted by a physician; no known critical source-fidelity defect left unresolved in the evaluation set; all recovery scenarios return to an actionable state. The clinic sets and signs off acceptable quality/latency/cost thresholds after a baseline. A small evaluation cannot prove zero clinical risk.

## Integration shape

Keep a small server-side boundary for `transcribe`, `draftNote`, `extractProposals`, `answerWithSources` and `embed`. Normalize usage, finish reasons, source IDs and timeout errors. Keep ownership/grants, patient identity, quota admission and physician acceptance outside provider-specific prompts.

The current shared Gemini helper is a useful starting point, but endpoint swapping alone is insufficient: audio upload, JSON schema features, token accounting, embeddings, refusal behavior and external-file deletion have different contracts. Changing embedding models requires versioned reindexing; do not compare vectors from incompatible models. Record the provider/model used by each operation and avoid silently mixing outputs across an encounter.

No API migration or deployment has been performed as part of this review.
