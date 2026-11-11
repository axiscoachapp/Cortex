import { cleanup, render, screen } from '@testing-library/react';
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
  it('names the professional data plainly and points its rows at different places', async () => {
    mount(access, '/configuracoes?secao=usuarios');
    expect(screen.getAllByRole('link', { name: /compartilhamento/i })).toHaveLength(1);
    cleanup();
    mount(access, '/configuracoes?secao=seguranca');
    expect(screen.getByRole('link', { name: /Alterar senha/ })).toHaveAttribute('href', '/seguranca#alterar-senha');
    expect(screen.getAllByRole('option').map(item => item.textContent)).toContain('Seu cadastro profissional');
  });
  it('starts at an overview instead of asking a doctor to configure specialty', () => {
    mount();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Visão geral' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toBeVisible();
    expect(screen.getByText(/mantidos pela equipe Cortex/)).toBeVisible();
    // The cards list every section; no duplicate picker on the overview.
    expect(screen.queryByLabelText('Ir para outra seção')).toBeNull();
    expect(screen.queryByLabelText('Especialidade')).toBeNull();
  });
  it('lets the team section title stand alone instead of a visible "Configurações" above it', () => {
    mount(access, '/configuracoes?secao=equipe');
    expect(screen.getByText('Equipe sintética')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toHaveClass('sr-only');
    expect(screen.getByLabelText('Ir para outra seção')).toBeVisible();
    expect(screen.getAllByRole('option').map(item => item.textContent)).toContain('Equipe da recepção');
    cleanup();
    mount(access, '/configuracoes?secao=implantacao');
    expect(screen.getByRole('heading', { level: 1, name: 'Seu cadastro profissional' })).not.toHaveClass('sr-only');
  });
  it('preserves unrelated query parameters when changing sections', async () => {
    mount(access, '/configuracoes?secao=perfil&clinica=synthetic&origin=calendar');
    expect(screen.getByText('Preferência pessoal sintética')).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText('Ir para outra seção'), 'implantacao');
    expect(screen.getByText('Consulta de implantação sintética')).toBeVisible();
    const params = new URLSearchParams(screen.getByLabelText('URL atual').textContent!);
    expect(params.get('clinica')).toBe('synthetic'); expect(params.get('origin')).toBe('calendar'); expect(params.get('secao')).toBe('implantacao');
  });
  it.each(['equipe', 'pre-consulta'])('does not mount admin section %s for a doctor via a direct URL', section => {
    mount({ ...access, admin: false }, '/configuracoes?secao=' + section);
    expect(screen.getByRole('region', { name: 'Visão geral' })).toBeVisible();
    expect(screen.queryByText('Equipe sintética')).toBeNull(); expect(screen.queryByText('Formulário sintético')).toBeNull();
    expect(screen.getByText('Essa seção não existe ou não está disponível para a sua conta. Escolha uma das seções abaixo.')).toBeVisible();
  });
  it.each([false, true])('does not offer clinical readers to reception with admin=%s', admin => {
    mount({ ...access, kind: 'reception', admin }, '/configuracoes?secao=perfil');
    expect(screen.queryByText('Preferência pessoal sintética')).toBeNull();
    expect(screen.getByText(/não está disponível para a sua conta/)).toBeVisible();
    cleanup();
    mount({ ...access, kind: 'reception', admin }, '/configuracoes?secao=sobre');
    const choices = screen.getAllByRole('option').map(item => item.textContent);
    expect(choices).not.toContain('Preferências de atendimento'); expect(choices).not.toContain('Agenda e assinatura'); expect(choices).not.toContain('Delegações da recepção');
    expect(screen.queryByText('Preferência pessoal sintética')).toBeNull();
    expect(choices).toContain('Segurança e privacidade'); expect(choices).toContain('Dados da clínica');
  });
  it('does not advertise clinic administration when membership is inactive', () => {
    mount({ ...access, active: false }, '/configuracoes?secao=sobre');
    const choices = screen.getAllByRole('option').map(item => item.textContent);
    expect(choices).not.toContain('Equipe e acessos'); expect(choices).not.toContain('WhatsApp e lembretes');
  });
});
