-- Fourth document type: solicitação de exames (CFM Res. 2.299/2021 art. 1º
-- explicitly lists "Solicitação de exames" among TDIC-issuable documents).
-- Exams live in the existing content JSONB: { exams: string[], indication? }.
ALTER TABLE public.prescriptions
  DROP CONSTRAINT IF EXISTS prescriptions_doc_type_check;
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_doc_type_check
  CHECK (doc_type IN ('receita_simples', 'receita_antimicrobiano', 'atestado', 'solicitacao_exames'));
