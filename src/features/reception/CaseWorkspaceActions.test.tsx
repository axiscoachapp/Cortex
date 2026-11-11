import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicAccessContext } from './accessContext';
import { CaseWorkspace } from './CaseWorkspace';
import type { ClinicAccess, ReceptionCase } from './contracts';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('./api', () => ({ receptionApi: { updateCase: mocks.update } }));
vi.mock('./useCaseDraft', () => ({ useCaseDraft: () => ({ body: '', setBody: vi.fn(), flush: vi.fn(), dirty: false, saving: false, acceptSaved: vi.fn() }) }));
vi.mock('./BookingDialog', () => ({ BookingDialog: () => <p>Agendamento sintético aberto</p> }));

const actor = '11111111-1111-4111-8111-111111111111', clinic = '66666666-6666-4666-8666-666666666666', doctor = '88888888-8888-4888-8888-888888888888';
const access: ClinicAccess = { actorId: actor, kind: 'reception', active: true, admin: false, clinic: { id: clinic, name: 'Clínica sintética' }, doctors: [{ id: doctor, name: 'Médico sintético', specialty: null }], staff: [] };
const base: ReceptionCase = {
  id: '99999999-9999-4999-8999-999999999999', clinicId: clinic, contactId: '77777777-7777-4777-8777-777777777777', contactName: 'Contato sintético', phone: '+5541999990001',
  doctorId: null, subject: 'Pedido sintético', kind: 'return', status: 'assigned', assignedTo: actor, revision: 3, createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  beneficiaries: [], eligibleAssignees: [], notes: [], noteCount: 0, draft: { body: '', revision: 0 },
};
function mount(data: ReceptionCase = base) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><ClinicAccessContext.Provider value={access}><CaseWorkspace data={data} /></ClinicAccessContext.Provider></QueryClientProvider></MemoryRouter>);
}

describe('next step in the case workspace', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.update.mockResolvedValue(4); });

  it('makes "Agendar consulta" the primary action after claiming and shows the waiting time', () => {
    mount();
    const schedule = screen.getByRole('button', { name: 'Agendar consulta' });
    const finish = screen.getByRole('button', { name: 'Concluir atendimento' });
    expect(schedule.className).toContain('bg-primary');
    expect(finish.className).not.toContain('bg-primary');
    expect(screen.getByText('Aberto há 20 min')).toBeVisible();
    expect(screen.getByText('(41) 99999-0001')).toBeVisible();
  });

  it('keeps "Assumir atendimento" as the primary action on an unassigned case', () => {
    mount({ ...base, assignedTo: null, status: 'new' });
    expect(screen.getByRole('button', { name: 'Assumir atendimento' }).className).toContain('bg-primary');
    expect(screen.queryByRole('button', { name: 'Agendar consulta' })).not.toBeInTheDocument();
  });

  it('shows the status as a labelled segmented control with the current one filled', async () => {
    mount({ ...base, status: 'waiting_patient' });
    const group = screen.getByRole('group', { name: 'Situação' });
    expect(within(group).getByRole('button', { name: 'Aguardando paciente' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'Em atendimento' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(within(group).getByRole('button', { name: 'Aguardando equipe' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(base.id, 3, 'status', { status: 'waiting_internal' }));
  });

  it.each([
    ['Concluir atendimento', 'Cancelar', 'resolved'],
    ['Cancelar atendimento', 'Manter atendimento', 'cancelled'],
  ])('asks before "%s" and changes nothing when dismissed', async (trigger, dismiss, status) => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: trigger }));
    let dialog = await screen.findByRole('alertdialog', { name: trigger });
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: dismiss }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: trigger }));
    dialog = await screen.findByRole('alertdialog', { name: trigger });
    fireEvent.click(within(dialog).getByRole('button', { name: trigger }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(base.id, 3, 'status', { status }));
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('keeps routing and transfer under "Mais ações"', () => {
    mount();
    expect(screen.queryByLabelText('Encaminhar para médico')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Transferir para atendente')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Mais ações' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Encaminhar para médico')).toBeVisible();
    expect(screen.getByLabelText('Transferir para atendente')).toBeVisible();
    expect(screen.getByText('Escolha o médico para encaminhar.')).toBeVisible();
  });

  it('hides the doctor suggestion when the case already has that doctor', () => {
    mount({ ...base, doctorId: doctor });
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(screen.queryByText('Sugestão de médico')).not.toBeInTheDocument();
  });

  it('never says "demanda" to the user', () => {
    const view = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(view.container.textContent).not.toMatch(/demanda/i);
  });
});
