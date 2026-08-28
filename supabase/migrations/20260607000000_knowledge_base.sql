-- ─────────────────────────────────────────────────────────────────────────────
-- Base de Conhecimento (RAG): doctor-uploaded documents/protocols the AI
-- assistant retrieves from during chat. Text is chunked and embedded with
-- Gemini text-embedding-004 (768 dimensions); retrieval is cosine similarity.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'file')),
  char_count  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'error')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  embedding   vector(768)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_user ON public.knowledge_documents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_user ON public.knowledge_chunks (user_id);
-- IVFFlat cosine index for fast top-k retrieval.
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own kb documents" ON public.knowledge_documents;
CREATE POLICY "Users manage own kb documents"
  ON public.knowledge_documents FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own kb chunks" ON public.knowledge_chunks;
CREATE POLICY "Users read own kb chunks"
  ON public.knowledge_chunks FOR SELECT
  USING (auth.uid() = user_id);
-- Chunk writes go through the service role in the ingest function only.

-- Retrieval RPC: top-k chunks for a user by cosine similarity. SECURITY INVOKER
-- so RLS on knowledge_chunks still applies (a user only ever matches own rows).
CREATE OR REPLACE FUNCTION public.match_knowledge(
  p_user_id UUID,
  query_embedding vector(768),
  match_count INT DEFAULT 5
)
RETURNS TABLE (content TEXT, similarity FLOAT, document_id UUID)
LANGUAGE sql STABLE
AS $$
  SELECT c.content,
         1 - (c.embedding <=> query_embedding) AS similarity,
         c.document_id
  FROM public.knowledge_chunks c
  WHERE c.user_id = p_user_id AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;
