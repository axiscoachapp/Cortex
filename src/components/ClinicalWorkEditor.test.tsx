import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { ClinicalWorkEditor } from './ClinicalWorkEditor';
const fixture = vi.hoisted(() => ({
  saved: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  fail: false,
  pending: false,
  release: null as null | (() => void),
  inserts: 0,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: fixture.rpc,
    from: (table: string) => {
      const result = () =>
        table === 'patients'
          ? {
              data: {
                revision: 7,
                medications: [{ name: 'Medicamento B', dosage: 'Dose preservada', instructions: 'Manter' }],
              },
              error: null,
            }
          : { data: fixture.fail ? null : fixture.saved, error: fixture.fail ? new Error('offline') : null };
      const q = {
        insert: (value: Record<string, unknown>) => {
          fixture.inserts++;
          fixture.saved = { ...value, id: 'draft-id', revision: 0 };
          return q;
        },
        update: (value: Record<string, unknown>) => {
          fixture.saved = { ...value, id: 'medication-source', revision: 1 };
          return q;
        },
        eq: () => q,
        select: () => q,
        single: async () =>
          fixture.pending
            ? new Promise((resolve) => {
                fixture.release = () => resolve(result());
              })
            : result(),
        maybeSingle: async () => result(),
      };
      return q;
    },
  },
}));
beforeEach(() => {
  fixture.saved = null;
  fixture.fail = false;
  fixture.pending = false;
  fixture.release = null;
  fixture.inserts = 0;
  fixture.rpc.mockReset().mockResolvedValue({ data: 'encounter-id', error: null });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
describe('manual encounter approval', () => {
  it('keeps a post-consultation entry explicit after changing its type to a manual draft',async()=>{
    render(<ClinicalWorkEditor entry="instruction" patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Tipo de registro'),{target:{value:'draft'}});
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Texto sintético após troca de tipo'}});
    await new Promise(resolve=>setTimeout(resolve,1400));expect(fixture.saved).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));await waitFor(()=>expect(fixture.saved).toMatchObject({kind:'draft',content:'Texto sintético após troca de tipo'}));
  });
  it('keeps an existing record and revision intact when an initial entry is also supplied',()=>{
    const item={id:'existing',user_id:'doctor-A',patient_id:'patient-A',kind:'instruction',title:'Título já salvo',content:'Texto já salvo',details:{state:'active',date:'2026-11-06'},status:'approved',revision:9,created_at:'2026-11-06T12:00:00Z',updated_at:'2026-11-06T12:00:00Z',due_date:null} as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(<ClinicalWorkEditor entry="followup" item={item} patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByLabelText('Tipo de registro')).toHaveValue('instruction');expect(screen.getByLabelText('Título do registro')).toHaveValue('Título já salvo');expect(screen.getByLabelText('Conteúdo do registro')).toHaveValue('Texto já salvo');expect(fixture.saved).toBeNull();expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('does not treat an untouched direct entry as unsaved work',async()=>{
    let guard=()=>false;
    render(<ClinicalWorkEditor entry="instruction" patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} onExitGuardChange={next=>{guard=next;}}/>);
    await waitFor(()=>expect(guard()).toBe(true));expect(window.confirm).not.toHaveBeenCalled();expect(fixture.saved).toBeNull();
  });
  it('starts post-consultation instructions without inheriting the encounter title or appointment and saves only explicitly',async()=>{
    render(<ClinicalWorkEditor entry="instruction" initialTitle="Queixa anterior" appointmentId="appointment-A" patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByLabelText('Tipo de registro')).toHaveValue('instruction');expect(screen.getByLabelText('Título do registro')).toHaveValue('Orientações da consulta');expect(fixture.saved).toBeNull();
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Orientação sintética revisada'}});expect(fixture.saved).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(fixture.saved).toMatchObject({kind:'instruction',title:'Orientações da consulta',content:'Orientação sintética revisada',status:'draft',patient_id:'patient-A',user_id:'doctor-A'}));
    expect(fixture.saved?.details).not.toHaveProperty('appointmentId');expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('starts an open follow-up task with no date or appointment inferred',async()=>{
    render(<ClinicalWorkEditor entry="followup" appointmentId="appointment-A" patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByLabelText('Tipo de registro')).toHaveValue('task');expect(screen.getByLabelText('Fluxo de acompanhamento')).toHaveValue('followup');expect(screen.getByLabelText('Prazo da tarefa')).toHaveValue('');expect(fixture.saved).toBeNull();
    fireEvent.change(screen.getByLabelText('Prazo da tarefa'),{target:{value:'2026-11-20'}});fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(fixture.saved).toMatchObject({kind:'task',status:'open',due_date:'2026-11-20',details:expect.objectContaining({workflow:'followup',stage:'requested'})}));
    expect(fixture.saved?.details).not.toHaveProperty('appointmentId');expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('stores a patient waitlist preference without sending or booking', async () => {
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Tipo de registro'), { target: { value: 'task' } });
    fireEvent.change(screen.getByLabelText('Fluxo de acompanhamento'), { target: { value: 'waitlist' } });
    fireEvent.change(screen.getByLabelText('Disponibilidade para lista de espera'), {
      target: { value: 'Terças pela manhã' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(fixture.saved).toMatchObject({
        kind: 'task',
        patient_id: 'patient-A',
        details: expect.objectContaining({ workflow: 'waitlist', availability: 'Terças pela manhã' }),
      }),
    );
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('requires an explicit reconciliation decision binding the saved medication and current patient revisions', async () => {
    fixture.rpc.mockResolvedValue({ data: true, error: null });
    const item = {
      patient_id: 'patient-A',
      user_id: 'doctor-A',
      created_at: '2026-10-28T12:00:00Z',
      updated_at: '2026-10-28T12:00:00Z',
      due_date: null,
      id: 'medication-source',
      kind: 'medication',
      title: 'Medicamento A',
      content: 'Instrução revisada',
      details: { state: 'changed', date: '2026-10-28', dosage: 'Dose antiga' },
      status: 'open',
      revision: 0,
    } as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(
      <ClinicalWorkEditor item={item} patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByText(/Medicamento B/);
    fireEvent.change(screen.getByLabelText('Dose revisada'), { target: { value: 'Dose exata revisada' } });
    expect(fixture.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar reconciliação' }));
    await waitFor(() =>
      expect(fixture.rpc).toHaveBeenCalledWith('approve_medication_reconciliation', {
        p_item_id: 'medication-source',
        p_item_revision: 1,
        p_patient_revision: 7,
      }),
    );
    expect(fixture.saved?.details).toMatchObject({ dosage: 'Dose exata revisada' });
  });
  it('preserves the medication draft and dose when patient revision acceptance fails', async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { code: '40001' } });
    const item = {
      patient_id: 'patient-A',
      user_id: 'doctor-A',
      created_at: '2026-10-28T12:00:00Z',
      updated_at: '2026-10-28T12:00:00Z',
      due_date: null,
      id: 'medication-source',
      kind: 'medication',
      title: 'Medicamento A',
      content: 'Instrução revisada',
      details: { state: 'changed', date: '2026-10-28', dosage: 'Dose antiga' },
      status: 'open',
      revision: 0,
    } as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(
      <ClinicalWorkEditor item={item} patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} />,
    );
    await screen.findByText(/Medicamento B/);
    fireEvent.change(screen.getByLabelText('Dose revisada'), { target: { value: 'Dose mantida para comparar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar reconciliação' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reconciliação não foi confirmada/i);
    expect(screen.getByLabelText('Dose revisada')).toHaveValue('Dose mantida para comparar');
  });
  it('creates a linked new instruction version while retaining the approved original', async () => {
    const original = {
      patient_id: 'patient-A',
      user_id: 'doctor-A',
      created_at: '2026-10-28T12:00:00Z',
      updated_at: '2026-10-28T12:00:00Z',
      id: 'approved-version',
      kind: 'instruction',
      title: 'Orientações',
      content: 'Texto aprovado original',
      details: {},
      due_date: null,
      status: 'approved',
      revision: 2,
    } as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(
      <ClinicalWorkEditor
        item={original}
        patientId="patient-A"
        userId="doctor-A"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Conteúdo do registro')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Criar nova versão' }));
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'), { target: { value: 'Texto da versão seguinte' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(fixture.saved).not.toBeNull());
    expect(fixture.saved).toMatchObject({
      content: 'Texto da versão seguinte',
      status: 'draft',
      details: { previousVersionId: 'approved-version', versionNumber: '2' },
    });
    expect(original.content).toBe('Texto aprovado original');
  });
  it('exposes an exit guard that preserves a dirty internal editor when discard is declined', async () => {
    const guardChanged = vi.fn();
    vi.mocked(window.confirm).mockReturnValue(false);
    render(
      <ClinicalWorkEditor
        patientId="patient-A"
        userId="doctor-A"
        onSaved={vi.fn()}
        onClose={vi.fn()}
        onExitGuardChange={guardChanged}
      />,
    );
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'), { target: { value: 'Rascunho ainda não salvo' } });
    const guard = guardChanged.mock.lastCall![0] as () => boolean;
    expect(guard()).toBe(false);
    expect(screen.getByLabelText('Conteúdo do registro')).toHaveValue('Rascunho ainda não salvo');
  });
  it('locks template replacement and close while the exact reviewed text is being saved', async () => {
    fixture.pending = true;
    const guardChanged = vi.fn();
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onExitGuardChange={guardChanged} />);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'), { target: { value: 'Texto em salvamento' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Salvando'));
    expect(screen.getByLabelText('Estrutura da consulta')).toBeDisabled();
    // The dialog's own close asks this guard; it refuses while saving.
    expect((guardChanged.mock.lastCall![0] as () => boolean)()).toBe(false);
  });
  it('has no heading or close of its own: the dialog around it names it and closes it (M 13)', () => {
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: 'Documentar e acompanhar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument();
  });
  it('persists exactly the edited text and confirms through the atomic manual RPC', async () => {
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'), {
      target: { value: 'Evolução escrita e revisada pelo médico.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Revisei: confirmar consulta/ }));
    await waitFor(() =>
      expect(fixture.rpc).toHaveBeenCalledWith('finalize_manual_encounter', { p_item_id: 'draft-id', p_revision: 0 }),
    );
    expect(fixture.saved).toMatchObject({
      patient_id: 'patient-A',
      user_id: 'doctor-A',
      content: 'Evolução escrita e revisada pelo médico.',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Consulta revisada registrada');
  });
  it('retains text on failed save and never finalizes an unsaved draft', async () => {
    fixture.fail = true;
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'), {
      target: { value: 'Texto preservado na falha.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Revisei: confirmar consulta/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar');
    expect(screen.getByLabelText('Conteúdo do registro')).toHaveValue('Texto preservado na falha.');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('keeps the textarea editable and focused while an automatic save is in flight', async () => {
    fixture.pending = true;
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} />);
    const text = screen.getByLabelText('Conteúdo do registro') as HTMLTextAreaElement;
    text.focus();
    fireEvent.change(text, { target: { value: 'S — paciente refere dor pélvica' } });
    await waitFor(() => expect(fixture.inserts).toBe(1), { timeout: 3000 });
    expect(screen.getByRole('status')).toHaveTextContent('Salvando…');
    expect(text).not.toBeDisabled();
    expect(document.activeElement).toBe(text);
    // Typing during the request is kept and stays dirty after the save returns.
    fireEvent.change(text, { target: { value: 'S — paciente refere dor pélvica há 3 dias' } });
    expect(text).toHaveValue('S — paciente refere dor pélvica há 3 dias');
    expect(screen.getByRole('button', { name: /Revisei: confirmar consulta/ })).toBeDisabled();
    await act(async () => {
      fixture.release?.();
    });
    expect(text).toHaveValue('S — paciente refere dor pélvica há 3 dias');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Alterações ainda não salvas'));
  });
  it('does not count an untouched manual consultation opened with a chief complaint as unsaved', async () => {
    let guard: () => boolean = () => false;
    render(
      <ClinicalWorkEditor
        initialTitle="Dor pélvica"
        patientId="patient-A"
        userId="doctor-A"
        onSaved={vi.fn()}
        onClose={vi.fn()}
        onExitGuardChange={(next) => {
          guard = next;
        }}
      />,
    );
    expect(screen.getByLabelText('Título do registro')).toHaveValue('Dor pélvica');
    expect(screen.queryByText('Alterações ainda não salvas')).not.toBeInTheDocument();
    await waitFor(() => expect(guard()).toBe(true));
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Título do registro'), { target: { value: 'Dor pélvica crônica' } });
    expect(screen.getByRole('status')).toHaveTextContent('Alterações ainda não salvas');
  });
  it('reports a confirmed manual consultation so the agenda and history refresh', async () => {
    const finalized = vi.fn();
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onFinalized={finalized} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'), { target: { value: 'Evolução revisada.' } });
    fireEvent.click(screen.getByRole('button', { name: /Revisei: confirmar consulta/ }));
    await waitFor(() => expect(finalized).toHaveBeenCalledTimes(1));
  });
});
