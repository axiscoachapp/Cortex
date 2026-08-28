-- ─────────────────────────────────────────────────────────────────────────────
-- Modelos de Documento: doctor-authored templates that replace the default
-- specialty SOAP structure at consultation time. Markdown headings + per-item
-- conditional commands in parentheses + "Formato:" directives.
-- user_id NULL = built-in (visible to everyone, editable by no one).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_templates_user ON public.document_templates (user_id, created_at DESC);

-- Doctor's default template for generated evolutions (NULL = default SOAP).
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS active_template_id UUID REFERENCES public.document_templates(id) ON DELETE SET NULL;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read built-in and own templates" ON public.document_templates;
CREATE POLICY "Read built-in and own templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

DROP POLICY IF EXISTS "Insert own templates" ON public.document_templates;
CREATE POLICY "Insert own templates"
  ON public.document_templates FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Update own templates" ON public.document_templates;
CREATE POLICY "Update own templates"
  ON public.document_templates FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Delete own templates" ON public.document_templates;
CREATE POLICY "Delete own templates"
  ON public.document_templates FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ── Built-in templates ───────────────────────────────────────────────────────
INSERT INTO public.document_templates (user_id, name, description, content)
SELECT NULL, v.name, v.description, v.content
FROM (VALUES
  (
    'Anamnese Completa',
    'Anamnese estruturada com HDA, medicações, história pregressa, exame físico e conduta',
    '## Queixa Principal
Queixa do paciente/motivo da consulta. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

## História da Doença Atual
História da doença atual, com sintomas, duração, fatores de melhora e piora, medicações utilizadas para os sintomas. Incluir estado emocional/psicológico, caso presente. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

## Medicações em uso
Medicações em uso, com nome, dosagem e posologia. Utilize nomes de medicamentos reais e válidos em português. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: lista

## História Pregressa
Histórico pessoal de doenças e comorbidades, diagnósticos e cirurgias passadas, diagnósticos ativos. Incluir alergias, se presentes. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

## Exame Físico
- **PA:** pressão arterial em mmHg (incluir apenas se mencionado explicitamente. Caso contrário, omitir completamente)
- **FC:** frequência cardíaca em bpm (incluir apenas se mencionado explicitamente. Caso contrário, omitir completamente)
- **Temperatura:** em °C (incluir apenas se mencionado explicitamente. Caso contrário, omitir completamente)
- **Demais achados:** achados do exame físico realizado (incluir apenas se mencionado explicitamente. Caso contrário, omitir completamente)
Formato: lista

## Hipóteses Diagnósticas
Hipóteses levantadas pelo médico nesta consulta. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: lista

## Conduta
Plano terapêutico: prescrições, exames solicitados, encaminhamentos, orientações e retorno. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: lista'
  ),
  (
    'Relatório para o INSS',
    'Relatório médico estruturado para fins previdenciários',
    '## RELATÓRIO AO INSS

### Diagnósticos Ativos
Listar os diagnósticos ativos do paciente, incluindo o código CID-10 e a descrição. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

### Tratamento Atual
Descrever o tratamento atual, incluindo medicações em uso com nome, dosagem e posologia, e outros tratamentos em andamento. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

### Plano Terapêutico Proposto
Descrever o plano terapêutico proposto, incluindo novas medicações, ajustes de tratamento e terapias não farmacológicas. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

### Implicações das Patologias sobre a Capacidade Funcional
Descrever as implicações das patologias sobre a capacidade funcional para atividades do dia a dia e do trabalho, incluindo limitações e adaptações necessárias. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido

### Prognóstico
Descrever o prognóstico considerando a evolução esperada e a resposta ao tratamento. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)
Formato: texto corrido'
  ),
  (
    'Carta ao Paciente',
    'Resumo acolhedor da consulta em linguagem acessível, endereçado ao paciente',
    '## Carta ao Paciente
Iniciar com uma saudação personalizada mencionando o nome do paciente e do médico. (manter tom acolhedor e linguagem acessível, sem jargão técnico)

Descrever o estado atual do paciente e informações relevantes sobre a continuidade do tratamento. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)

Revisão dos medicamentos atuais, mencionando ajustes ou adições, com nome e dosagem. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)

Instruções sobre exames futuros ou reavaliações. (incluir apenas se mencionado explicitamente na transcrição ou nas anotações. Caso contrário, omitir completamente)

Encerrar com orientações gerais e disponibilidade para dúvidas. (manter tom acolhedor)
Formato: texto corrido em parágrafos curtos'
  )
) AS v(name, description, content)
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_templates t WHERE t.user_id IS NULL AND t.name = v.name
);
