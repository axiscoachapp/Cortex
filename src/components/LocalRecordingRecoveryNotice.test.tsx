import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRecordingRecoveryNotice } from './LocalRecordingRecoveryNotice';

const f=vi.hoisted(()=>({metadata:vi.fn(),read:vi.fn(),requests:[] as {select?:string;owner?:string;ids?:string[];signal?:AbortSignal;limit?:number;deletion?:null}[]}));
vi.mock('@/lib/recordingRescue',()=>({listRescuedRecordingMetadata:f.metadata}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
  if(table!=='patients')throw new Error('Unexpected reader');
  const request:typeof f.requests[number]={};
  const q={select:(s:string)=>{request.select=s;return q;},eq:(key:string,value:string)=>{if(key!=='user_id')throw new Error('Unexpected filter');request.owner=value;return q;},
    in:(key:string,ids:string[])=>{if(key!=='id')throw new Error('Unexpected filter');request.ids=ids;return q;},limit:(n:number)=>{request.limit=n;return q;},
    is:(key:string,value:null)=>{if(key!=='deletion_requested_at')throw new Error('Unexpected null filter');request.deletion=value;return q;},
    abortSignal:(signal:AbortSignal)=>{request.signal=signal;return q;},then:(done:(v:unknown)=>void)=>{f.requests.push(request);return f.read().then(done);}};return q;
}}}));
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const row={id,patientId:id,createdAt:'2026-11-06T18:30:00Z'};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),resume=vi.fn();
  const tree=(userId='doctor-A')=><QueryClientProvider client={client}><LocalRecordingRecoveryNotice userId={userId} onResume={resume}/></QueryClientProvider>;
  return {...render(tree()),tree,resume};}
beforeEach(()=>{vi.resetAllMocks();f.requests=[];f.metadata.mockResolvedValue([row]);f.read.mockResolvedValue({data:[{id,name:'Paciente sintético atual'}],error:null});});
describe('local recording metadata discovery on Home',()=>{
  it('verifies current private ownership and opens only the selected patient without audio processing',async()=>{
    const {resume}=mount();fireEvent.click(await screen.findByRole('button',{name:'Abrir áudios locais de Paciente sintético atual'}));
    expect(resume).toHaveBeenCalledExactlyOnceWith(id);expect(f.requests).toEqual([{select:'id,name',owner:'doctor-A',ids:[id],limit:51,signal:expect.any(AbortSignal),deletion:null}]);
    expect(f.metadata).toHaveBeenCalledWith('doctor-A',expect.any(AbortSignal));
  });
  it('preserves unavailable recordings without displaying stale names or offering an unowned patient',async()=>{
    f.metadata.mockResolvedValue([row,{...row,id:other,patientId:other}]);f.read.mockResolvedValue({data:[],error:null});
    mount();expect(await screen.findByText(/2 gravações locais sem paciente disponível/)).toBeVisible();
    expect(screen.queryByRole('button',{name:/Abrir áudios locais de/})).not.toBeInTheDocument();
  });
  it('hides old names while rechecking and permits recovery after a local storage failure',async()=>{
    mount();await screen.findByRole('button',{name:/Abrir áudios locais de/});
    let reject!:(e:Error)=>void;f.metadata.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
    fireEvent.click(screen.getByRole('button',{name:'Atualizar áudios locais'}));await screen.findByText('Verificando áudios locais…');
    expect(screen.queryByText('Paciente sintético atual')).not.toBeInTheDocument();await act(async()=>reject(new Error('PRIVATE LOCAL ERROR')));
    await screen.findByRole('alert');expect(screen.queryByText('PRIVATE LOCAL ERROR')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Tentar verificar áudios locais'}));expect(await screen.findByRole('button',{name:/Abrir áudios locais de/})).toBeVisible();
  });
  it('treats an ownership read failure as an error, without falling back to old metadata',async()=>{
    f.read.mockResolvedValue({data:null,error:new Error('PRIVATE OWNER ERROR')});mount();await screen.findByRole('alert');
    expect(screen.queryByText('PRIVATE OWNER ERROR')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Abrir áudios locais de/})).not.toBeInTheDocument();
  });
  it('cancels the previous actor and ignores its late local result before ownership reads',async()=>{
    let resolve!:(v:unknown)=>void;f.metadata.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const v=mount();await waitFor(()=>expect(f.metadata).toHaveBeenCalledTimes(1));const signal=f.metadata.mock.calls[0][1] as AbortSignal;
    f.metadata.mockResolvedValue([]);v.rerender(v.tree('doctor-B'));await waitFor(()=>expect(f.metadata).toHaveBeenCalledTimes(2));expect(signal.aborted).toBe(true);
    await act(async()=>resolve([row]));expect(f.read).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/Abrir áudios locais de/})).not.toBeInTheDocument();
  });
  it('rechecks on remount and never displays a cached name during that read',async()=>{
    const v=mount();await screen.findByRole('button',{name:/Abrir áudios locais de/});v.rerender(<div/>);
    f.metadata.mockRejectedValue(new Error('Storage unavailable'));v.rerender(v.tree());
    expect(screen.queryByText('Paciente sintético atual')).not.toBeInTheDocument();await screen.findByRole('alert');
  });
  it('groups recordings by verified patient and declares the bounded result',async()=>{
    f.metadata.mockResolvedValue(Array.from({length:51},(_,index)=>({...row,id:String(index)})));mount();
    await screen.findByRole('button',{name:/Abrir áudios locais de/});expect(screen.getByText('50 gravações neste navegador')).toBeVisible();
    expect(screen.getByText(/50 gravações locais mais recentes/)).toBeVisible();expect(f.requests[0].ids).toEqual([id]);
  });
  it('does not read patients for an empty local result or local storage without an actor',async()=>{
    f.metadata.mockResolvedValue([]);const v=mount();await waitFor(()=>expect(f.metadata).toHaveBeenCalledTimes(1));
    expect(f.read).not.toHaveBeenCalled();v.rerender(v.tree(''));expect(f.metadata).toHaveBeenCalledTimes(1);
  });
  it('rejects unexpected patient identities without exposing their names',async()=>{
    f.read.mockResolvedValue({data:[{id:other,name:'PRIVATE UNREQUESTED NAME'}],error:null});mount();await screen.findByRole('alert');
    expect(screen.queryByText('PRIVATE UNREQUESTED NAME')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Abrir áudios locais de/})).not.toBeInTheDocument();
  });
  it('keeps a pending-deletion patient anonymous and preserves its local recording',async()=>{
    f.read.mockImplementation(()=>Promise.resolve({data:f.requests.at(-1)?.deletion===null?[]:[{id,name:'PRIVATE PATIENT PENDING DELETION'}],error:null}));
    mount();expect(await screen.findByText(/1 gravação local sem paciente disponível/)).toBeVisible();
    expect(screen.queryByText('PRIVATE PATIENT PENDING DELETION')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Abrir áudios locais de/})).not.toBeInTheDocument();
  });
  it('cancels a pending ownership check after an actor change and ignores its late name',async()=>{
    let resolve!:(v:unknown)=>void;f.read.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
    const v=mount();await waitFor(()=>expect(f.requests).toHaveLength(1));const signal=f.requests[0].signal!;
    f.metadata.mockResolvedValue([]);v.rerender(v.tree('doctor-B'));await waitFor(()=>expect(f.metadata).toHaveBeenCalledTimes(2));expect(signal.aborted).toBe(true);
    await act(async()=>resolve({data:[{id,name:'PRIVATE PREVIOUS ACTOR NAME'}],error:null}));expect(screen.queryByText('PRIVATE PREVIOUS ACTOR NAME')).not.toBeInTheDocument();
  });
});
