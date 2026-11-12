import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import type { ClinicAccess } from '@/features/reception/contracts';
import { WorkspaceMenu } from './WorkspaceMenu';
import { MobileSubpageNavigation } from './MobileSubpageNavigation';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { app_metadata: {} } }) }));
const access: ClinicAccess = { kind: 'clinical', active: true, admin: true, actorId: '11111111-1111-4111-8111-111111111111', clinic: { id: '22222222-2222-4222-8222-222222222222', name: 'Clínica sintética' }, doctors: [], staff: [] };
function Location() { return <output aria-label="Destino">{useLocation().pathname}</output>; }
function mount(value: ClinicAccess, mobile = false, path = '/') {
  render(<MemoryRouter initialEntries={[path]}><ClinicAccessContext.Provider value={value}>{mobile ? <MobileSubpageNavigation /> : <WorkspaceMenu />}<Location /></ClinicAccessContext.Provider></MemoryRouter>);
}
describe('workspace navigation by verified profile', () => {
  it('allows an administrator to explicitly switch to reception', async () => {
    mount(access);
    await userEvent.click(screen.getByRole('button', { name: 'Alternar área de trabalho' }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('menuitem', { name: /Recepção/ }));
    await waitFor(() => expect(screen.getByLabelText('Destino')).toHaveTextContent('/recepcao'));
  });
  it('keeps a reception administrator away from the clinical workspace', async () => {
    mount({ ...access, kind: 'reception' }, false, '/recepcao');
    await userEvent.click(screen.getByRole('button', { name: 'Alternar área de trabalho' }));
    expect(screen.queryByRole('menuitem', { name: /Consultório/ })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: /Financeiro/ }));
    await waitFor(() => expect(screen.getByLabelText('Destino')).toHaveTextContent('/recepcao/financeiro'));
  });
  it('does not advertise reception to an ordinary doctor', async () => {
    mount({ ...access, admin: false });
    await userEvent.click(screen.getByRole('button', { name: 'Alternar área de trabalho' }));
    expect(screen.queryByRole('menuitem', { name: /Recepção/ })).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });
  it('keeps phone primary navigation to four destinations and management in More', async () => {
    mount({ ...access, kind: 'reception', admin: false }, true, '/recepcao/agenda');
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', '/recepcao/agenda');
    await userEvent.click(screen.getByRole('button', { name: 'Mais páginas' }));
    const more = await screen.findByRole('dialog', { name: 'Mais' });
    // Finance is one of the reception's two areas: listed once, as an area, not again as a page.
    expect(within(within(more).getByRole('region', { name: 'Área de trabalho' })).getByRole('button', { name: 'Financeiro' })).toBeVisible();
    expect(within(more).queryByRole('link', { name: 'Financeiro' })).toBeNull();
    expect(within(more).queryByRole('link', { name: /Equipe|consultório/i })).toBeNull();
    expect(within(more).queryByRole('button', { name: /Consultório/ })).toBeNull();
    expect(within(more).getByRole('link', { name: 'Segurança da conta' })).toBeVisible();
    expect(within(more).getByRole('button', { name: 'Sair' })).toBeVisible();
  });
});
