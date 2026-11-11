import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import { ClinicSetupSummary } from './ClinicSetupSummary';
const mocks = vi.hoisted(() => ({ read: vi.fn(), retry: vi.fn(), error: false, loading: false, address: 'Endereço sintético' }));
vi.mock('@/hooks/useUserSettings', () => ({ SPECIALTY_LABELS: { cardiologia: 'Cardiologia' }, useUserSettings: () => {
  mocks.read();
  return { specialty: 'cardiologia', prescriber: { doctorName: 'Médico sintético', crmNumber: '00000', crmUf: 'PR', professionalAddress: mocks.address, professionalPhone: '', rqe: '', prescriberCpf: '11144477735' }, prescriberComplete: true, isError: mocks.error, isLoading: mocks.loading, retrySettings: mocks.retry };
} }));
const access: ClinicAccess = { kind: 'clinical', active: true, admin: true, actorId: 'synthetic', clinic: { id: 'synthetic', name: 'Clínica sintética' }, doctors: [], staff: [] };
function mount(kind: ClinicAccess['kind'] = 'clinical') { return render(<ClinicAccessContext.Provider value={{ ...access, kind }}><ClinicSetupSummary /></ClinicAccessContext.Provider>); }
describe('managed setup is readable without a second editor', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.error = false; mocks.loading = false; mocks.address = 'Endereço sintético'; });
  it('shows the current professional details without inputs or full CPF', () => {
    mount();
    expect(screen.getByText('Cardiologia')).toBeVisible();
    expect(screen.getByText('Médico sintético')).toBeVisible();
    // Nobody in the clinic can act on the live copilot: the card is gone.
    expect(screen.queryByText(/Copiloto/)).toBeNull();
    expect(screen.getByText('Estes dados aparecem nas suas receitas, atestados e pedidos de exame.')).toBeVisible();
    expect(screen.getAllByRole('button', { name: /Copiar pedido/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/implantação/i)).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByText('11144477735')).toBeNull();
    expect(screen.queryByText(/implantação concluída/i)).toBeNull();
  });
  it('does not mount the professional reader for reception, even reception admin', () => {
    mount('reception');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(screen.queryByText('Médico sintético')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Clínica' })).toBeVisible();
    expect(screen.queryByText(/Copiloto/)).toBeNull();
  });
  it('does not present cached professional data as verified after a read error', () => {
    mocks.error = true; mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível consultar');
    expect(screen.queryByText('Médico sintético')).toBeNull();
  });
  it('names what is missing instead of a vague incomplete chip', () => {
    mocks.address = ''; mount();
    expect(screen.getByText('Falta: Endereço profissional')).toBeVisible();
  });
  it('distinguishes loading from an incomplete setup', () => {
    mocks.loading = true; mount();
    expect(screen.getByText(/Carregando seu cadastro profissional/)).toBeVisible();
    expect(screen.queryByText(/Falta:/)).toBeNull();
  });
});
