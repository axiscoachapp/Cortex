import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrescriptionList } from './PrescriptionList';
import { prescribedItems } from '@/lib/prescribedItems';
const auth = vi.hoisted(() => ({ userId: 'owner' as string | null }));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:auth.userId ? {id:auth.userId} : null})}));
vi.mock('@/hooks/use-toast',()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
  const query={select:()=>query,eq:()=>query,order:()=>query,range:async(from:number)=>({error:null,data:from?[]:[
    {id:'legacy',doc_type:'receita_simples',status:'generated',secret_code:'LEGACY',created_at:'2026-01-01',expires_at:'2099-01-01'},
    {id:'forged-signature',doc_type:'atestado',status:'signed',secret_code:'SIGNED',created_at:'2026-01-01',expires_at:'2099-01-01',issuance_verified_at:'2026-01-01',signature_verified_at:null},
    {id:'old-rx',doc_type:'receita_simples',status:'generated',secret_code:'OLDRX',created_at:'2019-10-01',expires_at:'2019-10-31',issuance_verified_at:'2019-10-01',medications:[{name:'Amoxicilina',dosage:'500 mg',instructions:'8/8h'},{name:'Dipirona',dosage:'',instructions:''}]},
    {id:'old-note',doc_type:'atestado',status:'generated',secret_code:'OLDNOTE',created_at:'2019-10-01',expires_at:'2019-12-30',issuance_verified_at:'2019-10-01'},
  ]})};return query;
}}}));
beforeEach(() => { auth.userId = 'owner'; });
describe('prescription trust display',()=>{
  it('does not report an empty list before a doctor is available', () => {
    auth.userId = null;
    render(<QueryClientProvider client={new QueryClient()}><PrescriptionList patientId="patient" /></QueryClientProvider>);
    expect(screen.queryByText('Nenhum documento emitido por você para este paciente.')).not.toBeInTheDocument();
  });

  it('identifies an empty document list as the current doctor’s documents for this patient', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['patient-prescriptions', 'patient', 'owner'], []);
    render(<QueryClientProvider client={client}><PrescriptionList patientId="patient" /></QueryClientProvider>);
    expect(screen.getByRole('heading', { name: /^Documentos emitidos/ })).toBeInTheDocument();
    expect(screen.getByText('Nenhum documento emitido por você para este paciente.')).toBeInTheDocument();
  });

  it('requires reissue for legacy rows and never labels an unattested signature as signed',async()=>{
    render(<QueryClientProvider client={new QueryClient()}><PrescriptionList patientId="patient" /></QueryClientProvider>);
    expect(await screen.findByText('Reemitir documento')).toBeInTheDocument();
    expect(screen.getByText('Assinatura não verificada')).toBeInTheDocument();
    expect(screen.queryByText('Assinada')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button',{name:'Abrir documento'})[0]).toBeDisabled();
  });
});

describe('expiry display',()=>{
  it('expires prescriptions only; an old sick note stays openable, as on the public validator',async()=>{
    render(<QueryClientProvider client={new QueryClient()}><PrescriptionList patientId="patient" /></QueryClientProvider>);
    expect(await screen.findAllByText('Expirada')).toHaveLength(1);
    const open=screen.getAllByRole('button',{name:'Abrir documento'});
    expect(open[2]).toBeDisabled();
    expect(open[3]).toBeEnabled();
  });
});

describe('what was prescribed',()=>{
  it('shows the stored items of an expired prescription, whose public link stays closed',async()=>{
    render(<QueryClientProvider client={new QueryClient()}><PrescriptionList patientId="patient" /></QueryClientProvider>);
    expect(await screen.findByText('Amoxicilina 500 mg · Dipirona')).toBeInTheDocument();
    expect(screen.getByText(/Fora da validade: não abre mais na validação das farmácias/)).toBeInTheDocument();
    expect(screen.getAllByRole('button',{name:'Abrir documento'})[2]).toBeDisabled();
  });
  it('reads controlled items from the issuance copy and ignores malformed data',()=>{
    expect(prescribedItems({medications:[],issuance_snapshot:{controlled:{items:[{name:'Clonazepam',concentration:'2 mg'}]}}})).toEqual(['Clonazepam 2 mg']);
    expect(prescribedItems({medications:'x',issuance_snapshot:null})).toEqual([]);
    expect(prescribedItems({medications:[null,{name:''},{name:7}]})).toEqual([]);
  });
});
