import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import SettingsPage from '@/pages/Settings';
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('./ProfessionalSettingsForm', () => ({ ProfessionalSettingsForm: () => <p>Preferência pessoal sintética</p> }));
vi.mock('./ClinicSetupSummary', () => ({ ClinicSetupSummary: () => <p>Consulta de implantação sintética</p> }));
vi.mock('./WhatsAppSettings', () => ({ WhatsAppSettings: () => <p>Canal sintético</p> }));
vi.mock('./ConnectionsSettings', () => ({ ConnectionsSettings: () => <p>Conexões pessoais sintéticas</p> }));
vi.mock('@/features/intake/IntakeFormEditor', () => ({ IntakeFormEditor: () => <p>Formulário sintético</p> }));
vi.mock('@/features/reception/TeamSettings', () => ({ default: () => <p>Equipe sintética</p> }));
vi.mock('@/features/reception/DelegationPermissions', () => ({ default: () => <p>Delegação sintética</p> }));
const access: ClinicAccess = { kind: 'clinical', active: true, admin: true, actorId: 'synthetic', clinic: { id: 'synthetic', name: 'Clínica sintética' }, doctors: [], staff: [] };
function Location() { return <output aria-label="URL atual">{useLocation().search}</output>; }
function mount(value = access, path = '/configuracoes') { render(<MemoryRouter initialEntries={[path]}><ClinicAccessContext.Provider value={value}><SettingsPage /><Location /></ClinicAccessContext.Provider></MemoryRouter>); }
describe('settings grouped by responsibility and account', () => {
  it('starts at an overview instead of asking a doctor to configure specialty', () => {
    mount();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Visão geral' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
    expect(screen.getByText(/Especialidade, dados do prescritor e conexões técnicas são preparados/)).toBeVisible();
    expect(screen.queryByLabelText('Especialidade')).toBeNull();
  });
  it('preserves unrelated query parameters when changing sections', async () => {
    mount(access, '/configuracoes?secao=perfil&clinica=synthetic&origin=calendar');
    expect(screen.getByText('Preferência pessoal sintética')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Acessar seção'), 'implantacao');
    expect(screen.getByText('Consulta de implantação sintética')).toBeVisible();
    const params = new URLSearchParams(screen.getByLabelText('URL atual').textContent!);
    expect(params.get('clinica')).toBe('synthetic'); expect(params.get('origin')).toBe('calendar'); expect(params.get('secao')).toBe('implantacao');
  });
  it.each(['equipe', 'pre-consulta'])('does not mount admin section %s for a doctor via a direct URL', section => {
    mount({ ...access, admin: false }, '/configuracoes?secao=' + section);
    expect(screen.getByRole('region', { name: 'Visão geral' })).toBeVisible();
    expect(screen.queryByText('Equipe sintética')).toBeNull(); expect(screen.queryByText('Formulário sintético')).toBeNull();
  });
  it.each([false, true])('does not offer clinical readers to reception with admin=%s', admin => {
    mount({ ...access, kind: 'reception', admin }, '/configuracoes?secao=perfil');
    const choices = screen.getAllByRole('option').map(item => item.textContent);
    expect(choices).not.toContain('Preferências de atendimento'); expect(choices).not.toContain('Agenda e assinatura'); expect(choices).not.toContain('Delegações da recepção');
    expect(screen.queryByText('Preferência pessoal sintética')).toBeNull();
    expect(choices).toContain('Segurança e privacidade'); expect(choices).toContain('Dados da implantação');
  });
  it('does not advertise clinic administration when membership is inactive', () => {
    mount({ ...access, active: false });
    const choices = screen.getAllByRole('option').map(item => item.textContent);
    expect(choices).not.toContain('Equipe e acessos'); expect(choices).not.toContain('WhatsApp e lembretes');
  });
});
