import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {ClinicalWorkEditor} from './ClinicalWorkEditor';
const fixture=vi.hoisted(()=>({saved:null as Record<string,unknown>|null,rpc:vi.fn(),fail:false,pending:false}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:fixture.rpc,from:(table:string)=>{
  const result=()=>table==='patients'?{data:{revision:7,medications:[{name:'Medicamento B',dosage:'Dose preservada',instructions:'Manter'}]},error:null}:{data:fixture.fail?null:fixture.saved,error:fixture.fail?new Error('offline'):null};
  const q={insert:(value:Record<string,unknown>)=>{fixture.saved={...value,id:'draft-id',revision:0};return q;},update:(value:Record<string,unknown>)=>{fixture.saved={...value,id:'medication-source',revision:1};return q;},eq:()=>q,select:()=>q,single:async()=>fixture.pending?new Promise(()=>{}):result(),maybeSingle:async()=>result()};return q;
}}}));
beforeEach(()=>{fixture.saved=null;fixture.fail=false;fixture.pending=false;fixture.rpc.mockReset().mockResolvedValue({data:'encounter-id',error:null});vi.spyOn(window,'confirm').mockReturnValue(true);});
describe('manual encounter approval',()=>{
  it('stores a patient waitlist preference without sending or booking',async()=>{
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Tipo de registro'),{target:{value:'task'}});
    fireEvent.change(screen.getByLabelText('Fluxo de acompanhamento'),{target:{value:'waitlist'}});
    fireEvent.change(screen.getByLabelText('Disponibilidade para lista de espera'),{target:{value:'Terças pela manhã'}});
    fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(fixture.saved).toMatchObject({kind:'task',patient_id:'patient-A',details:expect.objectContaining({workflow:'waitlist',availability:'Terças pela manhã'})}));
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
  it('requires an explicit reconciliation decision binding the saved medication and current patient revisions', async()=>{
    fixture.rpc.mockResolvedValue({data:true,error:null});
    const item={patient_id:'patient-A',user_id:'doctor-A',created_at:'2026-10-28T12:00:00Z',updated_at:'2026-10-28T12:00:00Z',due_date:null,id:'medication-source',kind:'medication',title:'Medicamento A',content:'Instrução revisada',details:{state:'changed',date:'2026-10-28',dosage:'Dose antiga'},status:'open',revision:0} as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(<ClinicalWorkEditor item={item} patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText(/Medicamento B/);
    fireEvent.change(screen.getByLabelText('Dose revisada'),{target:{value:'Dose exata revisada'}});
    expect(fixture.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Aprovar reconciliação'}));
    await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledWith('approve_medication_reconciliation',{p_item_id:'medication-source',p_item_revision:1,p_patient_revision:7}));
    expect(fixture.saved?.details).toMatchObject({dosage:'Dose exata revisada'});
  });
  it('preserves the medication draft and dose when patient revision acceptance fails', async()=>{
    fixture.rpc.mockResolvedValue({data:null,error:{code:'40001'}});
    const item={patient_id:'patient-A',user_id:'doctor-A',created_at:'2026-10-28T12:00:00Z',updated_at:'2026-10-28T12:00:00Z',due_date:null,id:'medication-source',kind:'medication',title:'Medicamento A',content:'Instrução revisada',details:{state:'changed',date:'2026-10-28',dosage:'Dose antiga'},status:'open',revision:0} as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(<ClinicalWorkEditor item={item} patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText(/Medicamento B/);
    fireEvent.change(screen.getByLabelText('Dose revisada'),{target:{value:'Dose mantida para comparar'}});
    fireEvent.click(screen.getByRole('button',{name:'Aprovar reconciliação'}));
    expect(await screen.findByRole('alert')).toHaveTextContent(/reconciliação não foi confirmada/i);
    expect(screen.getByLabelText('Dose revisada')).toHaveValue('Dose mantida para comparar');
  });
  it('creates a linked new instruction version while retaining the approved original', async()=>{
    const original={patient_id:'patient-A',user_id:'doctor-A',created_at:'2026-10-28T12:00:00Z',updated_at:'2026-10-28T12:00:00Z',id:'approved-version',kind:'instruction',title:'Orientações',content:'Texto aprovado original',details:{},due_date:null,status:'approved',revision:2} as NonNullable<Parameters<typeof ClinicalWorkEditor>[0]['item']>;
    render(<ClinicalWorkEditor item={original} patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByLabelText('Conteúdo do registro')).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Criar nova versão'}));
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Texto da versão seguinte'}});
    fireEvent.click(screen.getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(fixture.saved).not.toBeNull());
    expect(fixture.saved).toMatchObject({content:'Texto da versão seguinte',status:'draft',details:{previousVersionId:'approved-version',versionNumber:'2'}});
    expect(original.content).toBe('Texto aprovado original');
  });
  it('exposes an exit guard that preserves a dirty internal editor when discard is declined', async()=>{
    const guardChanged=vi.fn();vi.mocked(window.confirm).mockReturnValue(false);
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()} onExitGuardChange={guardChanged}/>);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Rascunho ainda não salvo'}});
    const guard=guardChanged.mock.lastCall![0] as ()=>boolean;
    expect(guard()).toBe(false);
    expect(screen.getByLabelText('Conteúdo do registro')).toHaveValue('Rascunho ainda não salvo');
  });
  it('locks template replacement and close while the exact reviewed text is being saved', async()=>{
    fixture.pending=true;const close=vi.fn();
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={close}/>);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Texto em salvamento'}});
    fireEvent.click(screen.getByRole('button',{name:'Salvar rascunho'}));
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('Salvando'));
    expect(screen.getByLabelText('Estrutura da consulta')).toBeDisabled();
    expect(screen.getByRole('button',{name:'Fechar'})).toBeDisabled();
  });
  it('persists exactly the edited text and confirms through the atomic manual RPC',async()=>{
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Evolução escrita e revisada pelo médico.'}});
    fireEvent.click(screen.getByRole('button',{name:/Revisei: confirmar consulta/}));
    await waitFor(()=>expect(fixture.rpc).toHaveBeenCalledWith('finalize_manual_encounter',{p_item_id:'draft-id',p_revision:0}));
    expect(fixture.saved).toMatchObject({patient_id:'patient-A',user_id:'doctor-A',content:'Evolução escrita e revisada pelo médico.'});
    expect(await screen.findByRole('status')).toHaveTextContent('Consulta revisada registrada');
  });
  it('retains text on failed save and never finalizes an unsaved draft',async()=>{
    fixture.fail=true;
    render(<ClinicalWorkEditor patientId="patient-A" userId="doctor-A" onSaved={vi.fn()} onClose={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Conteúdo do registro'),{target:{value:'Texto preservado na falha.'}});
    fireEvent.click(screen.getByRole('button',{name:/Revisei: confirmar consulta/}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar');
    expect(screen.getByLabelText('Conteúdo do registro')).toHaveValue('Texto preservado na falha.');
    expect(fixture.rpc).not.toHaveBeenCalled();
  });
});
