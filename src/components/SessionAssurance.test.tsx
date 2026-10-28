import {render,screen,act,waitFor} from '@testing-library/react';
import {useEffect} from 'react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,describe,it,expect,vi} from 'vitest';
import {SessionAssurance} from './SessionAssurance';
const mock=vi.hoisted(()=>({level:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{mfa:{getAuthenticatorAssuranceLevel:mock.level}}}}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:{id:'doctor'},session:{access_token:'never-put-token-in-query-key',expires_at:100},signOut:vi.fn()})}));
beforeEach(()=>{mock.level.mockReset();});
const setup=()=>{const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><MemoryRouter><SessionAssurance><p>Private clinical chart</p></SessionAssurance></MemoryRouter></QueryClientProvider>);return client;};
describe('session assurance',()=>{
 it('preserves an existing capture tree behind the lock when a recheck fails',async()=>{
   const unmount=vi.fn();function Capture(){useEffect(()=>()=>unmount(),[]);return <p>Capture in progress</p>;}
   mock.level.mockResolvedValue({data:{currentLevel:'aal2',nextLevel:'aal2'},error:null});
   const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
   render(<QueryClientProvider client={client}><MemoryRouter><SessionAssurance><Capture/></SessionAssurance></MemoryRouter></QueryClientProvider>);
   await screen.findByText('Capture in progress');mock.level.mockResolvedValue({data:null,error:new Error('offline')});
   await act(()=>client.invalidateQueries({queryKey:['session-assurance']}));
   await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('segurança da sessão'));
   expect(unmount).not.toHaveBeenCalled();expect(screen.getByText('Capture in progress')).not.toBeVisible();
 });
 it('hides clinical UI until an enrolled factor is verified',async()=>{mock.level.mockResolvedValue({data:{currentLevel:'aal1',nextLevel:'aal2'},error:null});const client=setup();expect(await screen.findByRole('heading',{name:'Verifique seu acesso'})).toBeInTheDocument();expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();expect(JSON.stringify(client.getQueryCache().getAll().map(q=>q.queryKey))).not.toContain('never-put-token');});
 it('allows verified sessions',async()=>{mock.level.mockResolvedValue({data:{currentLevel:'aal2',nextLevel:'aal2'},error:null});setup();expect(await screen.findByText('Private clinical chart')).toBeInTheDocument();});
 it('fails closed when assurance cannot be checked',async()=>{mock.level.mockResolvedValue({data:null,error:new Error('offline')});setup();expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar');expect(screen.queryByText('Private clinical chart')).not.toBeInTheDocument();});
});
