import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type Specialty =
  | 'geral' | 'psiquiatria' | 'cardiologia' | 'pediatria'
  | 'ginecologia' | 'dermatologia' | 'neurologia' | 'ortopedia' | 'endocrinologia';

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  geral:          'Clínica Geral / Medicina de Família',
  psiquiatria:    'Psiquiatria',
  cardiologia:    'Cardiologia',
  pediatria:      'Pediatria',
  ginecologia:    'Ginecologia / Obstetrícia',
  dermatologia:   'Dermatologia',
  neurologia:     'Neurologia',
  ortopedia:      'Ortopedia',
  endocrinologia: 'Endocrinologia',
};

interface UserSettings {
  specialty: Specialty;
  daily_credit_limit: number;
}

export function useUserSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<UserSettings>({
    queryKey: ['user-settings', user?.id],
    queryFn: async () => {
      if (!user?.id) return { specialty: 'geral', daily_credit_limit: 1500 };
      const { data, error } = await supabase
        .from('user_settings')
        .select('specialty, daily_credit_limit')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return {
        specialty:          (data?.specialty           as Specialty) ?? 'geral',
        daily_credit_limit: data?.daily_credit_limit                 ?? 1500,
      };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (specialty: Specialty) => {
      if (!user?.id) return;
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, specialty }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: (_, specialty) => {
      queryClient.setQueryData(['user-settings', user?.id], (old: UserSettings | undefined) => ({
        ...(old ?? { daily_credit_limit: 1500 }),
        specialty,
      }));
    },
  });

  return {
    specialty:    data?.specialty ?? 'geral' as Specialty,
    isLoading,
    setSpecialty: mutation.mutate,
    isSaving:     mutation.isPending,
  };
}
