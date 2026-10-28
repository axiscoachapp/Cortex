import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export type Specialty =
  | 'geral' | 'psiquiatria' | 'cardiologia' | 'pediatria'
  | 'ginecologia' | 'prenatal' | 'urologia' | 'dermatologia' | 'neurologia' | 'ortopedia' | 'endocrinologia';

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  geral:          'Clínica Geral / Medicina de Família',
  psiquiatria:    'Psiquiatria',
  cardiologia:    'Cardiologia',
  pediatria:      'Pediatria',
  ginecologia:    'Ginecologia',
  prenatal:      'Obstetrícia / Pré-natal',
  urologia:      'Urologia',
  dermatologia:   'Dermatologia',
  neurologia:     'Neurologia',
  ortopedia:      'Ortopedia',
  endocrinologia: 'Endocrinologia',
};

interface UserSettings {
  specialty: Specialty;
  daily_credit_limit: number;
  live_copilot_enabled: boolean;
  doctor_name: string;
  crm_number: string;
  crm_uf: string;
  professional_address: string;
  active_template_id: string | null;
}

const DEFAULTS: UserSettings = {
  specialty: 'geral',
  daily_credit_limit: 1500,
  live_copilot_enabled: true,
  doctor_name: '',
  crm_number: '',
  crm_uf: '',
  professional_address: '',
  active_template_id: null,
};

export function useUserSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const key = ['user-settings', user?.id];

  const { data, isLoading } = useQuery<UserSettings>({
    queryKey: key,
    queryFn: async () => {
      if (!user?.id) return DEFAULTS;
      const { data, error } = await supabase
        .from('user_settings')
        .select('specialty, daily_credit_limit, live_copilot_enabled, doctor_name, crm_number, crm_uf, professional_address, active_template_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return {
        specialty:            (data?.specialty as Specialty) ?? DEFAULTS.specialty,
        daily_credit_limit:   data?.daily_credit_limit       ?? DEFAULTS.daily_credit_limit,
        live_copilot_enabled: data?.live_copilot_enabled     ?? DEFAULTS.live_copilot_enabled,
        doctor_name:          data?.doctor_name              ?? '',
        crm_number:           data?.crm_number               ?? '',
        crm_uf:               data?.crm_uf                   ?? '',
        professional_address: data?.professional_address     ?? '',
        active_template_id:   data?.active_template_id        ?? null,
      };
    },
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (patch: Partial<Omit<UserSettings, 'daily_credit_limit'>>) => {
      if (!user?.id) throw new Error('Entre novamente para salvar.');
      const { error } = await supabase.rpc('update_user_settings', { p_patch: patch });
      if (error) throw error;
    },
    // Optimistic: a toggle should flip instantly; roll back if the write fails.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<UserSettings>(key);
      queryClient.setQueryData<UserSettings>(key, { ...(previous ?? DEFAULTS), ...patch });
      return { previous };
    },
    onError: (_err, _patch, ctx) => {
      queryClient.setQueryData(key, ctx?.previous ?? DEFAULTS);
      toast({ title: 'Configuração não salva', description: 'Tente novamente. A configuração anterior foi mantida.', variant: 'destructive' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    specialty:            data?.specialty            ?? DEFAULTS.specialty,
    liveCopilotEnabled:   data?.live_copilot_enabled ?? DEFAULTS.live_copilot_enabled,
    activeTemplateId:     data?.active_template_id   ?? null,
    setActiveTemplateId:  (active_template_id: string | null) => mutation.mutate({ active_template_id }),
    prescriber: {
      doctorName:          data?.doctor_name          ?? '',
      crmNumber:           data?.crm_number           ?? '',
      crmUf:               data?.crm_uf               ?? '',
      professionalAddress: data?.professional_address ?? '',
    },
    /** True when the CFM-mandatory prescription fields are filled. */
    prescriberComplete: !!(data?.doctor_name?.trim() && data?.crm_number?.trim() && data?.crm_uf?.trim() && data?.professional_address?.trim()),
    isLoading,
    setSpecialty:         (specialty: Specialty) => mutation.mutate({ specialty }),
    setLiveCopilotEnabled: (live_copilot_enabled: boolean) => mutation.mutate({ live_copilot_enabled }),
    updateSettings:       (patch: Partial<Omit<UserSettings, 'daily_credit_limit'>>) => mutation.mutate(patch),
    updateSettingsAsync: mutation.mutateAsync,
    isSaving:             mutation.isPending,
  };
}
