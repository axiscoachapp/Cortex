import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { WorkspaceShell } from './WorkspaceShell';
import { PageHeading } from './PageHeading';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import { UnsavedChangesRouteGuard, useUnsavedChanges } from '@/hooks/useUnsavedChanges';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ signOut }) }));
const clinical: ClinicAccess = { kind: 'clinical', active: true, admin: true, actorId: 'synthetic', clinic: { id: 'synthetic', name: 'Clínica sintética' }, doctors: [], staff: [] };
function Draft({ dirty, blocking }: { dirty: boolean; blocking: boolean }) {
  useUnsavedChanges(dirty, 'Rascunho sintético', { blocking });
  return null;
}
function mount(access: ClinicAccess | null = clinical, dirty = false, blocking = false) {
  const router = createMemoryRouter([{ path: '*', element: <ClinicAccessContext.Provider value={access}><UnsavedChangesRouteGuard /><Draft dirty={dirty} blocking={blocking} /><WorkspaceShell section="Configurações"><PageHeading title="Configurações" description="Preferências da clínica" /><p>Conteúdo sintético</p></WorkspaceShell></ClinicAccessContext.Provider> }], { initialEntries: ['/configuracoes'] });
  render(<RouterProvider router={router} />);
  return router;
}
afterEach(() => { vi.restoreAllMocks(); signOut.mockReset(); });

describe('workspace shell without private readers', () => {
  it('keeps one main region and the clinic navigation around settings', () => {
    mount();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(screen.getByRole('navigation', { name: 'Consultório' })).getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', '/agenda');
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('aria-current', 'page');
  });
  it.each([false, true])('reception admin=%s has no clinical destination or reader', admin => {
    mount({ ...clinical, kind: 'reception', admin });
    const links = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(links).not.toContain('/'); expect(links).not.toContain('/agenda'); expect(links).not.toContain('/gerenciar-pacientes');
    expect(links).toContain('/recepcao/agenda'); expect(links).toContain('/recepcao/financeiro');
    expect(links.includes('/recepcao/equipe')).toBe(admin);
  });
  it('renders account recovery without granting a workspace when access is unknown', () => {
    mount(null);
    expect(screen.queryByRole('button', { name: 'Alternar área de trabalho' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Pacientes' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Segurança da conta' })).toHaveAttribute('href', '/seguranca');
    // M 19: the way back is always there, through the clinic gates.
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/');
  });
  it('does not advertise reception operations to an inactive member', () => {
    mount({ ...clinical, kind: 'reception', active: false });
    expect(screen.queryByRole('link', { name: 'Atendimentos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Alternar área de trabalho' })).toBeNull();
  });
  it('keeps registered drafts when navigation is declined, in the app dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const router = mount(clinical, true);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Consultório' })).getByRole('link', { name: 'Agenda' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Descartar alterações?' });
    expect(ask).toHaveTextContent('Rascunho sintético');
    await userEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/configuracoes');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Consultório' })).getByRole('link', { name: 'Agenda' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Descartar alterações' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/agenda'));
    expect(confirm).not.toHaveBeenCalled();
  });
  it('always asks "Sair da conta?" and signs out only from the dialog', async () => {
    mount();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Conta e preferências' })).getByRole('button', { name: 'Sair' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Sair da conta?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancelar' }));
    expect(signOut).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Conta e preferências' })).getByRole('button', { name: 'Sair' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });
  it('keeps "Sair" disabled while an operation must finish, and says why', async () => {
    mount(clinical, true, true);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Conta e preferências' })).getByRole('button', { name: 'Sair' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Sair da conta?' });
    expect(ask).toHaveTextContent('Rascunho sintético');
    expect(within(ask).getByRole('button', { name: 'Sair' })).toBeDisabled();
    expect(signOut).not.toHaveBeenCalled();
  });
  it('names unsaved edits before signing out discards them', async () => {
    mount(clinical, true);
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Conta e preferências' })).getByRole('button', { name: 'Sair' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Sair da conta?' });
    expect(ask).toHaveTextContent('Há alterações não salvas nesta tela. Se sair agora, elas serão descartadas.');
    await userEvent.click(within(ask).getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });
  it('has no bare sign-out icon in the page header', () => {
    mount();
    expect(within(document.querySelector('header')!).queryByRole('button', { name: /Sair/ })).toBeNull();
  });
  it('marks the effective reception workspace on account pages', async () => {
    mount({ ...clinical, kind: 'reception' });
    await userEvent.click(screen.getAllByRole('button', { name: 'Alternar área de trabalho' })[0]);
    expect(within(screen.getByRole('menuitem', { name: /Recepção/ })).getByLabelText('Área atual')).toBeInTheDocument();
  });
  it('supports a labelled section heading without introducing another h1', () => {
    render(<section aria-labelledby="nested-title"><PageHeading id="nested-title" headingLevel={2} title="Equipe" actions={<button>Adicionar</button>} /></section>);
    expect(screen.getByRole('region', { name: 'Equipe' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Equipe' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});
