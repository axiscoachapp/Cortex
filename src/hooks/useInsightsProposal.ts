import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface AIInsights {
  symptoms?: string[];
  behavioral_observations?: string[];
  risk_factors?: string[];
  family_history?: string[];
  social_factors?: string[];
  clinical_changes?: string[];
  summary?: string;
}

export interface InsightsProposal {
  insights: AIInsights;
  createdAt: string;
}

const proposalKey = (patientId?: string, userId?: string) => ['ai-insights-proposal', patientId, userId] as const;

/**
 * Insights returned by `process-clinical-notes` wait here, in memory only,
 * until the doctor accepts (writes them to the chart) or discards them.
 */
export function useInsightsProposal(patientId?: string, userId?: string) {
  const queryClient = useQueryClient();
  const key = proposalKey(patientId, userId);
  const { data } = useQuery<InsightsProposal | null>({
    queryKey: key,
    queryFn: () => queryClient.getQueryData<InsightsProposal | null>(key) ?? null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const setProposal = useCallback(
    (next: InsightsProposal | null) => queryClient.setQueryData(proposalKey(patientId, userId), next),
    [queryClient, patientId, userId],
  );
  return { proposal: data ?? null, setProposal };
}

export function hasInsights(value: AIInsights | null | undefined): value is AIInsights {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some((entry) => (Array.isArray(entry) ? entry.length > 0 : !!entry?.toString().trim()));
}
