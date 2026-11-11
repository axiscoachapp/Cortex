import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import { AppSidebar, MobileBottomBar } from './AppNavigation';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { app_metadata: {} }, signOut }) }));
afterEach(() => { cleanup(); signOut.mockReset(); });

const doctor: ClinicAccess = { kind: 'clinical', active: true, admin: false, actorId: '11111111-1111-4111-8111-111111111111', clinic: { id: '22222222-2222-4222-8222-222222222222', name: 'Clínica sintética' }, doctors: [], staff: [] };
const admin: ClinicAccess = { ...doctor, admin: true };
const reception: ClinicAccess = { ...doctor, kind: 'reception' };
function Location() { return <output aria-label="Destino">{useLocation().pathname}</output>; }
function mount(access: ClinicAccess | null, path: string, ui: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}><ClinicAccessContext.Provider value={access}>{ui}<Location /></ClinicAccessContext.Provider></MemoryRouter>);
}
// Brand link and area switcher are named by aria-label; navigation entries by their text.
const entries = (root: HTMLElement) => [...root.querySelectorAll('nav a, nav button')].map(element => element.textContent?.trim()).filter(Boolean);
const sidebar = () => screen.getByRole('complementary', { name: 'Navegação do ambiente' });

describe('one sidebar for home and every subpage', () => {
  it.each([['doctor', doctor], ['clinic admin', admin]] as const)('%s: home and a subpage list the same items in the same order', (_role, access) => {
    const home = mount(access, '/', <AppSidebar onHome={vi.fn()} homeActive />);
    const fromHome = entries(sidebar());
    home.unmount();
    mount(access, '/agenda', <AppSidebar />);
    expect(entries(sidebar())).toEqual(fromHome);
    for (const label of ['Financeiro', 'Pré-consultas', 'Configurações', 'Segurança da conta', 'Sair']) expect(fromHome).toContain(label);
    expect(fromHome.includes('Recepção')).toBe(access.admin);
  });

  it('reception keeps its own items and never a clinical destination', () => {
    mount(reception, '/recepcao', <AppSidebar />);
    const hrefs = within(sidebar()).getAllByRole('link').map(link => link.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/recepcao', '/recepcao/financeiro', '/configuracoes', '/seguranca']));
    for (const clinical of ['/', '/agenda', '/gerenciar-pacientes', '/financeiro']) expect(hrefs).not.toContain(clinical);
  });

  it('on home, Início returns to the dashboard without leaving the route', async () => {
    const onHome = vi.fn();
    mount(doctor, '/', <AppSidebar onHome={onHome} homeActive={false} />);
    await userEvent.click(within(sidebar()).getByRole('button', { name: 'Início' }));
    expect(onHome).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Destino')).toHaveTextContent('/');
  });

  it('with unknown access offers only the way home and account pages', () => {
    mount(null, '/seguranca', <AppSidebar />);
    expect(within(sidebar()).getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
    expect(within(sidebar()).queryByRole('link', { name: 'Financeiro' })).toBeNull();
    expect(within(sidebar()).getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });
});

describe('one phone bar on every route', () => {
  const barLabels = () => entries(screen.getByRole('navigation', { name: 'Navegação principal' }));
  it('home and subpages show Início · Agenda · Pacientes · Mais', () => {
    const home = mount(doctor, '/', <MobileBottomBar placement="inline" onHome={vi.fn()} homeActive />);
    expect(barLabels()).toEqual(['Início', 'Agenda', 'Pacientes', 'Mais']);
    home.unmount();
    mount(doctor, '/agenda', <MobileBottomBar />);
    expect(barLabels()).toEqual(['Início', 'Agenda', 'Pacientes', 'Mais']);
  });

  it('"Mais" holds the area switcher, the other pages, the account and "Sair"', async () => {
    mount(admin, '/agenda', <MobileBottomBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Mais páginas' }));
    const more = await screen.findByRole('dialog', { name: 'Mais' });
    const areas = within(more).getByRole('region', { name: 'Área de trabalho' });
    expect(within(areas).getAllByRole('button').map(button => button.textContent)).toEqual(['Consultório', 'Recepção', 'Financeiro']);
    for (const label of ['Assistente', 'Modelos', 'Conhecimento', 'Pré-consultas', 'Financeiro', 'Recepção', 'Configurações', 'Segurança da conta']) expect(within(more).getByRole('link', { name: label })).toBeInTheDocument();
    await userEvent.click(within(areas).getByRole('button', { name: 'Recepção' }));
    await waitFor(() => expect(screen.getByLabelText('Destino')).toHaveTextContent('/recepcao'));
  });

  it('"Sair" in "Mais" opens "Sair da conta?" and nothing happens on Cancelar', async () => {
    mount(doctor, '/agenda', <MobileBottomBar />);
    await userEvent.click(screen.getByRole('button', { name: 'Mais páginas' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Mais' })).getByRole('button', { name: 'Sair' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Sair da conta?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancelar' }));
    expect(signOut).not.toHaveBeenCalled();
  });

  it('with unknown access shows only Início and Mais', () => {
    mount(null, '/seguranca', <MobileBottomBar />);
    expect(barLabels()).toEqual(['Início', 'Mais']);
  });
});
