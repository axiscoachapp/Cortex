import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulingFollowups } from './SchedulingFollowups';

const fixture=vi.hoisted(()=>({actor:'doctor-A',staff:false,fail:false,pending:null as Promise<unknown>|null,rows:[] as unknown[],requests:[] as Array<{table:string;select?:string;filters:Record<string,unknown>;signal?:AbortSignal;limit?:number}>}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:fixture.actor}})}));
vi.mock('@/features/reception/accessContext',()=>({useClinicAccess:()=>({kind:fixture.staff?'reception':'clinical'})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:(table:string)=>{
  const request:typeof fixture.requests[number]={table,filters:{}};
  const q={select:(s:string)=>{request.select=s;return q;},eq:(k:string,v:string)=>{request.filters[k]=v;return q;},in:(k:string,v:string[])=>{request.filters[k]=v;return q;},order:()=>q,limit:(n:number)=>{request.limit=n;return q;},abortSignal:(signal:AbortSignal)=>{request.signal=signal;return q;},then:(done:(value:unknown)=>void)=>{fixture.requests.push(request);return(fixture.pending??Promise.resolve({data:fixture.rows,error:fixture.fail?new Error('Unavailable'):null})).then(done);}};return q;
}}}));
const row=(id:string,workflow='waitlist')=>({id:'work-'+id,patient_id:id,title:'Acompanhamento '+id,status:'open',due_date:null,updated_at:'2026-11-06T12:00:00Z',workflow,stage:'requested',availability:'Terças pela manhã',patient:{id,name:'Patient '+id}});
beforeEach(()=>{fixture.actor='doctor-A';fixture.staff=false;fixture.fail=false;fixture.pending=null;fixture.rows=[row('A'),row('B','confirmation')];fixture.requests=[];});
function setup(){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=()=><QueryClientProvider client={client}><MemoryRouter><SchedulingFollowups/></MemoryRouter></QueryClientProvider>;
  return{...render(view()),view};
}
describe('doctor scheduling follow-ups in Calendar',()=>{
  it('reads only own active scheduling task metadata and links to exact patients',async()=>{
    setup();expect(await screen.findByRole('link',{name:'Abrir paciente Patient A'})).toHaveAttribute('href','/?patient=A');
    expect(screen.getByRole('link',{name:'Abrir paciente Patient B'})).toHaveAttribute('href','/?patient=B');
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]).toMatchObject({table:'clinical_work_items',filters:{user_id:'doctor-A',kind:'task',status:['open','draft'],'details->>workflow':['waitlist','confirmation']},limit:51});
    expect(fixture.requests[0].select).not.toMatch(/\bcontent\b|snapshot/);
    expect(fixture.requests[0].select).toContain('clinical_work_items_patient_id_user_id_fkey');
    expect(fixture.requests[0].signal).toBeInstanceOf(AbortSignal);
    expect(screen.queryByRole('button',{name:'Marcar concluído'})).not.toBeInTheDocument();
  });
  it('hides stale links after refusal and permits explicit recovery',async()=>{
    setup();await screen.findByRole('link',{name:'Abrir paciente Patient A'});
    fixture.fail=true;fireEvent.click(screen.getByRole('button',{name:'Atualizar acompanhamentos da agenda'}));
    await screen.findByRole('alert');expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fixture.fail=false;fixture.rows=[row('C')];fireEvent.click(screen.getByRole('button',{name:'Tentar carregar acompanhamentos'}));
    expect(await screen.findByRole('link',{name:'Abrir paciente Patient C'})).toBeVisible();
  });
  it('cancels a former actor request and hides its late result',async()=>{
    let finish:(value:unknown)=>void;fixture.pending=new Promise(resolve=>{finish=resolve;});
    const {rerender,view}=setup();await waitFor(()=>expect(fixture.requests).toHaveLength(1));
    fixture.pending=null;fixture.actor='doctor-B';fixture.rows=[row('B')];rerender(view());
    await screen.findByRole('link',{name:'Abrir paciente Patient B'});
    await act(async()=>finish({data:[row('A')],error:null}));
    expect(screen.queryByRole('link',{name:'Abrir paciente Patient A'})).not.toBeInTheDocument();
    expect(fixture.requests[0].signal.aborted).toBe(true);
  });
  it('checks again after reopening and rejects a mismatched patient projection',async()=>{
    const {rerender,view}=setup();await screen.findByRole('link',{name:'Abrir paciente Patient A'});
    rerender(<div/>);fixture.rows=[{...row('A'),patient:{id:'B',name:'Wrong private patient'}}];rerender(view());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();await screen.findByRole('alert');
    expect(screen.queryByText('Wrong private patient')).not.toBeInTheDocument();
  });
  it('does not query private tasks for reception',()=>{
    fixture.staff=true;setup();expect(fixture.requests).toHaveLength(0);expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('states the bound and keeps all later work accessible from the patient',async()=>{
    fixture.rows=Array.from({length:51},(_,i)=>row(String(i)));setup();
    expect(await screen.findAllByRole('link')).toHaveLength(50);expect(screen.getByText(/50 acompanhamentos mais recentes/)).toBeVisible();
  });
});
