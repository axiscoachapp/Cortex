-- ─────────────────────────────────────────────────────────────────────────────
-- Brazilian medication catalog (Anvisa open data) + document types.
--
-- Source: dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv
-- (registered medications; imported filtered to SITUACAO_REGISTRO = 'Ativo',
-- deduplicated by product+ingredient — ~8.7k rows). Re-import periodically.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.medication_catalog (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_name        TEXT NOT NULL,
  active_ingredient   TEXT,
  therapeutic_class   TEXT,
  regulatory_category TEXT,
  company             TEXT,
  anvisa_registration TEXT,
  is_antimicrobial    BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (product_name, active_ingredient)
);

-- Trigram indexes make ILIKE '%termo%' autocomplete fast at this size.
CREATE INDEX IF NOT EXISTS idx_medcat_product_trgm
  ON public.medication_catalog USING gin (product_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_medcat_ingredient_trgm
  ON public.medication_catalog USING gin (active_ingredient gin_trgm_ops);

ALTER TABLE public.medication_catalog ENABLE ROW LEVEL SECURITY;

-- Read-only reference data for any signed-in doctor; writes only via service role.
DROP POLICY IF EXISTS "Authenticated read catalog" ON public.medication_catalog;
CREATE POLICY "Authenticated read catalog"
  ON public.medication_catalog FOR SELECT TO authenticated
  USING (true);

-- ── Document types on prescriptions ─────────────────────────────────────────
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'receita_simples'
    CHECK (doc_type IN ('receita_simples', 'receita_antimicrobiano', 'atestado')),
  ADD COLUMN IF NOT EXISTS content JSONB;
