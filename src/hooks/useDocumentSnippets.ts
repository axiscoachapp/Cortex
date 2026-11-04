import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAllRows } from '@/lib/pagination';
import { DocumentSnippet, SnippetItem, parseSnippetItems, snippetErrorMessage } from '@/lib/documentSnippets';

interface SnippetRow {
  id: string;
  name: string;
  items: Json;
  revision: number;
  review_status: string;
}

/** The doctor's own prescription templates. Only approved ones can fill a
 *  prescription; imported ones wait for the doctor's review (S3). */
export function useDocumentSnippets(enabled = true) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ['document-snippets', user?.id];

  const query = useQuery<DocumentSnippet[]>({
    queryKey: key,
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await fetchAllRows<SnippetRow>((from, to) =>
        supabase
          .from('document_snippets')
          .select('id, name, items, revision, review_status')
          .eq('review_status', 'approved')
          .order('name')
          .order('id')
          .range(from, to),
      );
      return rows.map((row) => ({ id: row.id, name: row.name, revision: row.revision, items: parseSnippetItems(row.items) }));
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: async (input: { id?: string; revision?: number; name: string; items: SnippetItem[] }) => {
      const { data, error } = await supabase.rpc('save_document_snippet', {
        // The RPC takes null to create; generated types do not express it.
        p_id: (input.id ?? null) as string,
        p_expected_revision: (input.revision ?? null) as number,
        p_name: input.name,
        p_items: input.items as unknown as Json,
      });
      if (error) throw new Error(snippetErrorMessage(error));
      return data as { id: string; revision: number };
    },
    onSettled: invalidate,
  });

  const archive = useMutation({
    mutationFn: async (snippet: Pick<DocumentSnippet, 'id' | 'revision'>) => {
      const { error } = await supabase.rpc('archive_document_snippet', { p_id: snippet.id, p_expected_revision: snippet.revision });
      if (error) throw new Error(snippetErrorMessage(error));
    },
    onSettled: invalidate,
  });

  return {
    snippets: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    retry: query.refetch,
    saveSnippet: save.mutateAsync,
    archiveSnippet: archive.mutateAsync,
    isSaving: save.isPending || archive.isPending,
  };
}
