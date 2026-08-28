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
    mutationFn: async (patch: Partial<UserSettings>) => {
      if (!user?.id) return;
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' });
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
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
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
    prescriberComplete: !!(data?.doctor_name?.trim() && data?.crm_number?.trim() && data?.crm_uf?.trim()),
    isLoading,
    setSpecialty:         (specialty: Specialty) => mutation.mutate({ specialty }),
    setLiveCopilotEnabled: (live_copilot_enabled: boolean) => mutation.mutate({ live_copilot_enabled }),
    updateSettings:       (patch: Partial<UserSettings>) => mutation.mutate(patch),
    isSaving:             mutation.isPending,
  };
}
