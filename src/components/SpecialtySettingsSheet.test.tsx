import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { SpecialtySettingsSheet } from './SpecialtySettingsSheet';

const mocks = vi.hoisted(() => ({
  prescriber: {
    doctorName: 'Nome original',
    crmNumber: '123',
    crmUf: 'SP',
    professionalAddress: 'Endereço original',
    professionalPhone: '',
    rqe: '',
    prescriberCpf: '',
  },
  save: vi.fn().mockRejectedValue(new Error('offline')),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'doctor' } }) }));
vi.mock('@/hooks/useUserSettings', () => ({
  SPECIALTY_LABELS: { geral: 'Clínica Geral' },
  useUserSettings: () => ({
    specialty: 'geral',
    setSpecialty: vi.fn(),
    liveCopilotEnabled: false,
    setLiveCopilotEnabled: vi.fn(),
    prescriber: mocks.prescriber,
    updateSettingsAsync: mocks.save,
    activeTemplateId: null,
    setActiveTemplateId: vi.fn(),
    isSaving: false,
    isLoading: false,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      const query = { select: () => query, order: () => query, range: async () => ({ data: [], error: null }) };
      return query;
    },
  },
}));

const client = new QueryClient();
const tree = () => (
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <SpecialtySettingsSheet />
    </MemoryRouter>
  </QueryClientProvider>
);

describe('Prescriber identity draft', () => {
  it('saves phone and RQE with the other prescriber fields', async () => {
    mocks.save.mockReset().mockResolvedValue(undefined);
    render(tree());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.type(screen.getByLabelText('Telefone profissional'), ' (41) 3000-0000 ');
    await user.type(screen.getByLabelText('RQE (opcional)'), '4567');
    await user.click(screen.getByRole('button', { name: 'Salvar dados do prescritor' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dados do prescritor salvos.');
    expect(mocks.save).toHaveBeenCalledWith({
      doctor_name: 'Nome original',
      crm_number: '123',
      crm_uf: 'SP',
      professional_address: 'Endereço original',
      professional_phone: '(41) 3000-0000',
      rqe: '4567',
      prescriber_cpf: '',
    });
  });

  it('asks for the area code before saving a phone without DDD', async () => {
    mocks.save.mockReset();
    render(tree());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.type(screen.getByLabelText('Telefone profissional'), '3000-0000');
    await user.click(screen.getByRole('button', { name: 'Salvar dados do prescritor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/com DDD/);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Telefone profissional')).toHaveValue('3000-0000');
  });

  it('saves the prescriber CPF as digits, for anabolic (C5) prescriptions', async () => {
    mocks.save.mockReset().mockResolvedValue(undefined);
    render(tree());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.type(screen.getByLabelText('CPF do médico (só para anabolizantes)'), '111.444.777-35');
    await user.click(screen.getByRole('button', { name: 'Salvar dados do prescritor' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dados do prescritor salvos.');
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ prescriber_cpf: '11144477735' }));
  });

  it('refuses an invalid prescriber CPF before saving', async () => {
    mocks.save.mockReset();
    render(tree());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Configurações' }));
    await user.type(screen.getByLabelText('CPF do médico (só para anabolizantes)'), '111.444.777-00');
    await user.click(screen.getByRole('button', { name: 'Salvar dados do prescritor' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('CPF do prescritor inválido');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('preserves typing across background refresh and failed explicit save', async () => {
    mocks.save.mockReset().mockRejectedValue(new Error('offline'));
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
