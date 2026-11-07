import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import ReceptionQueue from './ReceptionQueue';
import { ClinicAccessContext } from './accessContext';
const mocks = vi.hoisted(() => ({ queue: vi.fn(), detail: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { queue: mocks.queue, case: mocks.detail } }));
vi.mock('./WhatsAppInbox', () => ({ default: () => <p>Caixa sintética montada</p> }));
vi.mock('./CaseWorkspace', () => ({ CaseWorkspace: () => <p>Caso sintético montado</p> }));
vi.mock('./NewCaseDialog', () => ({ NewCaseDialog: () => null }));
vi.mock('@/hooks/use-mobile', () => ({ isBelowMobileBreakpoint: () => false }));
function Location() { return <output aria-label="Parâmetros atuais">{useLocation().search}</output>; }
it('mounts only the chosen workspace and preserves case and queue filters across tabs', async () => {
  const actor = '11111111-1111-4111-8111-111111111111', clinic = '22222222-2222-4222-8222-222222222222', caseId = '33333333-3333-4333-8333-333333333333';
  mocks.queue.mockResolvedValue({ items: [], nextCursor: null }); mocks.detail.mockResolvedValue({ id: caseId });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/recepcao?view=conversations&case=${caseId}&status=waiting_patient&mine=1&doctor=${actor}`]}><ClinicAccessContext.Provider value={{ actorId: actor, kind: 'reception', active: true, admin: false, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [], staff: [] }}><ReceptionQueue /><Location /></ClinicAccessContext.Provider></MemoryRouter></QueryClientProvider>);
  expect(screen.getByText('Caixa sintética montada')).toBeVisible(); expect(mocks.queue).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Atendimentos' })); await screen.findByText('Caso sintético montado');
  expect(mocks.queue).toHaveBeenCalledWith(clinic, 'waiting_patient', true, actor, null); expect(mocks.detail).toHaveBeenCalledWith(caseId);
  const expected = { case: caseId, status: 'waiting_patient', mine: '1', doctor: actor };
  expect(Object.fromEntries(new URLSearchParams(screen.getByLabelText('Parâmetros atuais').textContent!))).toEqual(expected);
  fireEvent.click(screen.getByRole('button', { name: 'Conversas' }));
  await waitFor(() => expect(screen.queryByText('Caso sintético montado')).not.toBeInTheDocument());
  expect(screen.getByText('Caixa sintética montada')).toBeVisible();
  expect(Object.fromEntries(new URLSearchParams(screen.getByLabelText('Parâmetros atuais').textContent!))).toEqual({ ...expected, view: 'conversations' });
});
