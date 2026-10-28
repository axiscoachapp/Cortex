import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SpecialtySettingsSheet } from './SpecialtySettingsSheet';

const mocks = vi.hoisted(() => ({
  prescriber: { doctorName: 'Nome original', crmNumber: '123', crmUf: 'SP', professionalAddress: 'Endereço original' },
  save: vi.fn().mockRejectedValue(new Error('offline')),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/useUserSettings', () => ({ SPECIALTY_LABELS: { geral: 'Clínica Geral' }, useUserSettings: () => ({ specialty: 'geral', setSpecialty: vi.fn(), liveCopilotEnabled: false, setLiveCopilotEnabled: vi.fn(), prescriber: mocks.prescriber, updateSettingsAsync: mocks.save, activeTemplateId: null, setActiveTemplateId: vi.fn(), isSaving: false, isLoading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => { const query = { select: () => query, order: () => query, range: async () => ({ data: [], error: null }) }; return query; } } }));

describe('Prescriber identity draft', () => {
  it('preserves typing across background refresh and failed explicit save', async () => {
    const client = new QueryClient();
    const tree = () => <QueryClientProvider client={client}><MemoryRouter><SpecialtySettingsSheet /></MemoryRouter></QueryClientProvider>;
    const view = render(tree());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.type(screen.getByLabelText('Nome completo do médico'), ' revisado');
    mocks.prescriber = { ...mocks.prescriber, doctorName: 'Versão recebida em segundo plano' };
    view.rerender(tree());
    expect(screen.getByLabelText('Nome completo do médico')).toHaveValue('Nome original revisado');
    await user.click(screen.getByRole('button', { name: 'Salvar dados do prescritor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/dados foram mantidos/i);
    expect(screen.getByLabelText('Nome completo do médico')).toHaveValue('Nome original revisado');
  });
});
