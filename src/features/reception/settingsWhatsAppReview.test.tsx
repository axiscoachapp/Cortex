// Codex K6 review of C5. Synthetic read fakes only; production settings files remain Claude-owned.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WhatsAppSettings } from '@/features/settings/WhatsAppSettings';
import { FlowEditor } from '@/features/settings/FlowEditor';

const mocks=vi.hoisted(()=>({call:vi.fn(),access:{kind:'clinical',active:true,admin:true,actorId:'e8100000-0000-4000-8000-000000000001',clinic:{id:'e8200000-0000-4000-8000-000000000001',name:'Clínica sintética'},doctors:[]}}));
vi.mock('@/features/reception/accessContext',()=>({useClinicAccess:()=>mocks.access}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn(()=>{throw new Error('Unexpected real SDK invocation');})}}}));
vi.mock('@/features/settings/whatsappApi',async importOriginal=>({...await importOriginal<typeof import('@/features/settings/whatsappApi')>(),whatsappCall:mocks.call}));

const state={serverReady:true,connected:true,status:'connected',displayPhone:'Número sintético',verifiedName:'Clínica sintética',quality:null,connectedAt:null,canManage:true,canUseInbox:true};
const flow={enabled:false,definition:{start:'inicio',nodes:{inicio:{title:'Início sintético',text:'Olá',options:[{label:'Recepção',goto:'queue:geral'}]}}},hours:{},afterHoursText:'',handoffText:'A recepção continua.',defaultQueue:'geral',revision:1,updatedAt:null,starter:false};
const clients:QueryClient[]=[];
const client=()=>{const value=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(value);return value;};
const read=async(action:string)=>{
  if(action==='state')return state;
  if(action==='templates')return {templates:[]};
  if(action==='automations')return {automations:[],runs:[]};
  if(action==='flow')return flow;
  throw new Error('Unexpected synthetic write: '+action);
};
const deferred=<T=typeof state,>()=>{let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};};
beforeEach(()=>{mocks.access.admin=true;mocks.call.mockReset();mocks.call.mockImplementation(read);});
afterEach(()=>{cleanup();for(const value of clients.splice(0))value.clear();});

describe('K6 C5 fresh reads and initial flow failure',()=>{
  it('shows a loading state without administrative controls before the first response',async()=>{
    const pending=deferred();mocks.call.mockImplementation((action:string)=>action==='state'?pending.promise:read(action));
    render(<QueryClientProvider client={client()}><WhatsAppSettings /></QueryClientProvider>);
    try {
      expect(screen.getByText('Verificando o WhatsApp…')).toBeVisible();
      expect(screen.queryByRole('button',{name:'Nova automação'})).not.toBeInTheDocument();
    } finally {await act(async()=>pending.resolve(state));}
  });

  it('withholds cached administrative controls until remount verification completes',async()=>{
    const cache=client();
    const initial=render(<QueryClientProvider client={cache}><WhatsAppSettings /></QueryClientProvider>);
    expect(await screen.findByRole('button',{name:'Nova automação'})).toBeVisible();
    initial.unmount();mocks.call.mockClear();
    const pending=deferred();mocks.call.mockImplementation((action:string)=>action==='state'?pending.promise:read(action));
    render(<QueryClientProvider client={cache}><WhatsAppSettings /></QueryClientProvider>);
    try {
      await waitFor(()=>expect(mocks.call).toHaveBeenCalledWith('state'));
      expect(screen.queryByRole('button',{name:'Nova automação'})).not.toBeInTheDocument();
      expect(screen.getByText('Verificando o WhatsApp…')).toBeVisible();
    } finally {await act(async()=>pending.resolve({...state,canManage:false}));}
  });

  it('shows the failure and retry action when the initial flow read fails',async()=>{
    const first=deferred<typeof flow>(),retry=deferred<typeof flow>();
    const context={clinicName:mocks.access.clinic.name,doctors:[]};
    const flowOnly=(promise:Promise<typeof flow>)=>(action:string,input:unknown)=>{
      expect(action).toBe('flow');expect(input).toEqual(context);return promise;
    };
    mocks.call.mockImplementationOnce(flowOnly(first.promise)).mockImplementationOnce(flowOnly(retry.promise));
    const cache=client();
    render(<QueryClientProvider client={cache}><FlowEditor /></QueryClientProvider>);
    try {
      expect(screen.getByText('Carregando o fluxo…')).toBeVisible();
      await act(async()=>first.reject(new Error('Falha sintética na leitura do fluxo')));
      await waitFor(()=>expect(cache.getQueryState(['whatsapp-flow',mocks.access.clinic.id,mocks.access.actorId])?.status).toBe('error'));
      expect(screen.getByRole('alert')).toHaveTextContent('Falha sintética na leitura do fluxo');
      expect(screen.queryByText('Carregando o fluxo…')).not.toBeInTheDocument();
      await userEvent.setup().click(screen.getByRole('button',{name:'Tentar novamente'}));
      await waitFor(()=>expect(mocks.call).toHaveBeenCalledTimes(2));
      expect(mocks.call.mock.calls).toEqual([['flow',context],['flow',context]]);
      expect(screen.getByText('Carregando o fluxo…')).toBeVisible();
      await act(async()=>retry.resolve(flow));
      expect(await screen.findByText('Robô de atendimento')).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } finally {await act(async()=>{first.resolve(flow);retry.resolve(flow);});}
  });

  it('shows retry after an initial WhatsApp state failure',async()=>{
    mocks.call.mockRejectedValue(new Error('Falha sintética de estado'));
    render(<QueryClientProvider client={client()}><WhatsAppSettings /></QueryClientProvider>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha sintética de estado');
    expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'Nova automação'})).not.toBeInTheDocument();
  });

  it('isolates the member pending read from a previous admin cache on the same actor and clinic',async()=>{
    const cache=client();
    const initial=render(<QueryClientProvider client={cache}><WhatsAppSettings /></QueryClientProvider>);
    expect(await screen.findByRole('button',{name:'Nova automação'})).toBeVisible();
    const adminQuery=cache.getQueryCache().findAll({queryKey:['whatsapp-state']})[0];
    expect(adminQuery?.state.data).toEqual(state);
    initial.unmount();mocks.call.mockClear();
    mocks.access.admin=false;
    const pending=deferred();mocks.call.mockImplementation((action:string)=>action==='state'?pending.promise:read(action));
    render(<QueryClientProvider client={cache}><WhatsAppSettings key="member" /></QueryClientProvider>);
    try {
      expect(screen.getByText('Verificando o WhatsApp…')).toBeVisible();
      expect(screen.queryByRole('button',{name:'Nova automação'})).not.toBeInTheDocument();
      const stateQueries=cache.getQueryCache().findAll({queryKey:['whatsapp-state']});
      expect(stateQueries).toHaveLength(2);
      const memberQuery=stateQueries.find(query=>query!==adminQuery);
      expect(memberQuery?.queryHash).not.toBe(adminQuery?.queryHash);
      expect(memberQuery?.state.fetchStatus).toBe('fetching');
      expect(adminQuery?.state.fetchStatus).toBe('idle');
      expect(adminQuery?.state.data).toEqual(state);
    } finally {await act(async()=>pending.resolve({...state,canManage:false}));}
  });
});
