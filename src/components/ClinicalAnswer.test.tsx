import {render,screen,act,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {ClinicalAnswer} from './ClinicalAnswer';
import type {ChatMessage} from '@/types/patient';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/sharing',()=>({sharingRpc:mock.rpc}));
const message:ChatMessage={id:'reply',type:'assistant',title:'Resposta',content:'Texto derivado do protocolo',timestamp:new Date(),sources:[{id:'source',type:'knowledge',label:'Protocolo revisado',date:'2026-10-28',excerpt:'Trecho',authorizationRevision:2,sourceReviewRevision:3,sourceVersion:'v1',reviewedBy:'Médico revisor',sourceReference:'Referência bibliográfica'}]};
beforeEach(()=>{mock.rpc.mockReset().mockResolvedValue({authorization_revision:2,source_review_revision:3});});
function setup(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><ClinicalAnswer message={message} userId="doctor"/></QueryClientProvider>);return client;}
describe('cached protocol-derived answers',()=>{
 it('checks a protocol once when several cited excerpts use the same authorization',async()=>{const client=new QueryClient();render(<QueryClientProvider client={client}><ClinicalAnswer message={{...message,sources:[...message.sources!,...message.sources!]}} userId="doctor"/></QueryClientProvider>);await screen.findByText(message.content);expect(mock.rpc).toHaveBeenCalledTimes(1);});
 it('checks access before rendering and hides the reply after permission changes',async()=>{const client=setup();expect(screen.queryByText(message.content)).not.toBeInTheDocument();await screen.findByText(message.content);mock.rpc.mockResolvedValue({authorization_revision:4,source_review_revision:3});await act(()=>client.invalidateQueries({queryKey:['protocol-source-access']}));await waitFor(()=>expect(screen.queryByText(message.content)).not.toBeInTheDocument());expect(screen.getByRole('status')).toHaveTextContent('resposta foi ocultada');});
 it('does not revive a reply after the source is retired and reapproved',async()=>{mock.rpc.mockResolvedValue({authorization_revision:2,source_review_revision:5});setup();expect(await screen.findByText(/resposta foi ocultada/)).toBeInTheDocument();expect(screen.queryByText(message.content)).not.toBeInTheDocument();});
 it('fails closed on authorization service failure',async()=>{mock.rpc.mockRejectedValue(new Error('offline'));setup();expect(await screen.findByText(/resposta foi ocultada/)).toBeInTheDocument();expect(screen.queryByText(message.content)).not.toBeInTheDocument();});
});
