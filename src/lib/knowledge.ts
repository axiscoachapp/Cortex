import { supabase } from '@/integrations/supabase/client';

export interface KnowledgeSourceInput { title: string; text: string; reference: string; version: string; supersedesDocumentId: string | null }

export async function createKnowledgeSource(input: KnowledgeSourceInput): Promise<string> {
  const { data, error } = await supabase.rpc('create_knowledge_source', {
    p_title: input.title, p_text: input.text, p_reference: input.reference,
    p_version: input.version, p_supersedes_document_id: input.supersedesDocumentId,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string') throw new Error('O servidor não confirmou o salvamento do original.');
  return data;
}

export async function reviewKnowledgeSource(documentId: string, approve: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('review_knowledge_source', { p_document_id: documentId, p_approve: approve });
  if (error) throw new Error(error.message);
  if (data !== true) throw new Error('O servidor não confirmou a revisão desta versão.');
}
