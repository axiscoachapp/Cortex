import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WhatsAppInbox from './WhatsAppInbox';
import { ClinicAccessContext } from './accessContext';
import type { ClinicAccess } from './contracts';
import type { WhatsAppConversation } from './whatsappApi';
const mocks=vi.hoisted(()=>({state:vi.fn(),conversations:vi.fn(),messages:vi.fn(),botSession:vi.fn(),invoke:vi.fn(),markRead:vi.fn(),send:vi.fn(),templates:vi.fn(),actor:'11111111-1111-4111-8111-111111111111'}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:mocks.actor}})}));
// mark_read is a deliberate write of the owner opening a conversation, and the composer reads templates;
// both are mocked so `invoke` keeps proving that no paused read triggers anything else.
vi.mock('./whatsappSend',async original=>({...await original<typeof import('./whatsappSend')>(),markWhatsAppConversationRead:mocks.markRead,sendWhatsAppMessage:mocks.send}));
vi.mock('./whatsappTemplates',async original=>({...await original<typeof import('./whatsappTemplates')>(),readWhatsAppTemplates:mocks.templates}));
vi.mock('./whatsappApi',()=>({whatsappApi:{state:mocks.state,conversations:mocks.conversations,messages:mocks.messages,botSession:mocks.botSession}}));
const clinic='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333',at='2026-11-06T18:30:00.123456+00:00';
const access:ClinicAccess={actorId:mocks.actor,active:true,admin:false,kind:'reception',clinic:{id:clinic,name:'Clínica sintética'},doctors:[],staff:[]};
const state={serverReady:true,connected:true,canUseInbox:true};
const conversation:WhatsAppConversation={id,profileName:'Contato sintético',waId:'5511900000000',contactId:null,caseId:null,queue:'agenda',status:'open',assignedTo:access.actorId,assignedAt:at,openedAt:at,firstResponseAt:null,closedAt:null,lastInboundAt:at,windowOpenUntil:at,lastMessageAt:at,lastMessagePreview:'Prévia sintética',unreadCount:2,optedOut:false,consented:true,revision:1};
const detail={conversation,messages:[{id:'44444444-4444-4444-8444-444444444444',direction:'in',kind:'text',body:'Mensagem sintética',media:null,template:null,status:'received',error:null,sentBy:null,at}],nextBefore:null};
const keys={state:['state'],conversations:['conversations'],messages:['messages'],bot:['bot-session']} as const;
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=(value=access)=><QueryClientProvider client={client}><ClinicAccessContext.Provider value={value}><WhatsAppInbox/></ClinicAccessContext.Provider></QueryClientProvider>;return {...render(tree()),client,tree};}
async function open(){fireEvent.click(await screen.findByRole('button',{name:'Abrir conversa com Contato sintético'}));await screen.findByText('Mensagem sintética');await screen.findByText('Percurso sintético');}
function prefix(kind:keyof typeof keys){return ['reception',access.actorId,clinic,'whatsapp',...keys[kind]];}
async function paused(client:QueryClient,kind:keyof typeof keys){await waitFor(()=>expect(client.getQueryCache().findAll({queryKey:prefix(kind)}).some(q=>q.state.fetchStatus==='paused')).toBe(true));}
beforeEach(()=>{vi.resetAllMocks();mocks.actor=access.actorId;mocks.state.mockResolvedValue(state);mocks.conversations.mockResolvedValue({conversations:[conversation],nextBefore:null});mocks.messages.mockResolvedValue(detail);mocks.botSession.mockResolvedValue({session:{status:'handed_off',path:['Percurso sintético'],outcome:null,startedAt:at,updatedAt:at}});mocks.invoke.mockRejectedValue(new Error('UNEXPECTED SYNTHETIC WRITE'));mocks.markRead.mockResolvedValue(true);mocks.templates.mockResolvedValue({templates:[]});});
describe('paused reads cannot retain authoritative WhatsApp UI',()=>{
 it.each(['state','conversations','messages','bot'] as const)('withholds cached %s while a replacement read is paused',async kind=>{
  const view=mount();await open();const before=[mocks.state,mocks.conversations,mocks.messages,mocks.botSession].map(fn=>fn.mock.calls.length);onlineManager.setOnline(false);let pending:Promise<void>|undefined;
  try{pending=view.client.invalidateQueries({queryKey:prefix(kind)});await paused(view.client,kind);
   if(kind==='conversations')expect(screen.getByText('Mensagem sintética')).toBeVisible();
   else await waitFor(()=>expect(screen.queryByText(kind==='bot'?'Percurso sintético':'Mensagem sintética')).not.toBeInTheDocument(),{timeout:1500});
   if(kind==='state')expect(screen.queryByRole('button',{name:'Consultar modelos'})).not.toBeInTheDocument();
   if(kind==='conversations')expect(screen.queryByRole('button',{name:'Abrir conversa com Contato sintético'})).not.toBeInTheDocument();
   if(kind==='messages')expect(screen.queryByRole('button',{name:'Encerrar conversa'})).not.toBeInTheDocument();
   if(kind==='bot')expect(screen.getByRole('button',{name:'Encerrar conversa'})).toBeEnabled();
   expect([mocks.state,mocks.conversations,mocks.messages,mocks.botSession].map(fn=>fn.mock.calls.length)).toEqual(before);expect(mocks.invoke).not.toHaveBeenCalled();
  }finally{await act(async()=>{onlineManager.setOnline(true);await pending;});}
  if(kind==='state')await open();else await screen.findByText('Mensagem sintética');expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it.each(['state','messages'] as const)('discards a confirmation during paused %s verification and never restores it',async kind=>{
  const view=mount();await open();fireEvent.click(screen.getByRole('button',{name:'Encerrar conversa'}));await screen.findByRole('alertdialog');onlineManager.setOnline(false);let pending:Promise<void>|undefined;
  try{pending=view.client.invalidateQueries({queryKey:prefix(kind)});await paused(view.client,kind);await waitFor(()=>expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),{timeout:1500});expect(mocks.invoke).not.toHaveBeenCalled();}
  finally{await act(async()=>{onlineManager.setOnline(true);await pending;});}
  if(kind==='state')await open();
  await screen.findByRole('button',{name:'Encerrar conversa'});expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('hides messages and disables repeated updates after a user refresh pauses',async()=>{
  const view=mount();await open();onlineManager.setOnline(false);
  try{fireEvent.click(screen.getByRole('button',{name:'Atualizar mensagens'}));await paused(view.client,'messages');await waitFor(()=>expect(screen.queryByText('Mensagem sintética')).not.toBeInTheDocument(),{timeout:1500});expect(screen.getByRole('button',{name:'Atualizar mensagens'})).toBeDisabled();expect(screen.getByText('Aguardando conexão de rede para carregar as mensagens…')).toBeVisible();}
  finally{await act(async()=>{onlineManager.setOnline(true);});}
  await screen.findByText('Mensagem sintética');expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('hides list rows and disables repeated updates after a user refresh pauses',async()=>{
  const view=mount();await open();onlineManager.setOnline(false);
  try{fireEvent.click(screen.getByRole('button',{name:'Atualizar conversas'}));await paused(view.client,'conversations');await waitFor(()=>expect(screen.queryByRole('button',{name:'Abrir conversa com Contato sintético'})).not.toBeInTheDocument(),{timeout:1500});expect(screen.getByRole('button',{name:'Atualizar conversas'})).toBeDisabled();expect(screen.getByText('Aguardando conexão de rede para carregar as conversas…')).toBeVisible();}
  finally{await act(async()=>{onlineManager.setOnline(true);});}
  await screen.findByRole('button',{name:'Abrir conversa com Contato sintético'});expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('removes an inactive scope during pause and never resumes its old read',async()=>{
  const view=mount();await open();const before=mocks.messages.mock.calls.length;onlineManager.setOnline(false);let pending:Promise<void>|undefined;
  try{pending=view.client.invalidateQueries({queryKey:prefix('messages')});await paused(view.client,'messages');view.rerender(view.tree({...access,active:false}));await screen.findByRole('alert');expect(screen.queryByRole('region',{name:'Conversa selecionada'})).not.toBeInTheDocument();}
  finally{await act(async()=>{onlineManager.setOnline(true);await pending;});}
  expect(mocks.messages).toHaveBeenCalledTimes(before);expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('labels the initial channel pause without starting reads or claiming server failure',async()=>{
  onlineManager.setOnline(false);try{mount();expect(await screen.findByText('Aguardando conexão de rede para verificar o WhatsApp…',{}, {timeout:1500})).toBeVisible();expect(mocks.state).not.toHaveBeenCalled();expect(mocks.conversations).not.toHaveBeenCalled();expect(screen.queryByRole('alert')).not.toBeInTheDocument();}finally{await act(async()=>{onlineManager.setOnline(true);});}
 });
});
