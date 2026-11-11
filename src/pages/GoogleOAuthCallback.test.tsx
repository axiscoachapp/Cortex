import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GoogleOAuthCallback from './GoogleOAuthCallback';
const state = vi.hoisted(() => ({ user: null as {id:string}|null, loading:true, invoke:vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => state }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke:state.invoke } } }));
beforeEach(() => {
  state.loading=true; state.user=null; state.invoke.mockReset();
  state.invoke.mockResolvedValue({data:{success:true},error:null});
  window.history.replaceState({},'', '/google-oauth-callback?code=synthetic-code&state=synthetic-state');
});
const view=()=><MemoryRouter initialEntries={['/google-oauth-callback?code=synthetic-code&state=synthetic-state']}><GoogleOAuthCallback/></MemoryRouter>;
describe('Google callback transaction',()=>{
  it('waits for session initialization without reporting an authentication failure',()=>{
    render(view());
    expect(screen.getByText('Conectando a agenda do Google…')).toBeInTheDocument();
    expect(screen.queryByText('Entre no Cortex e toque em Conectar Google de novo, na agenda.')).not.toBeInTheDocument();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it('sends the received state with the code after authentication is ready',async()=>{
    state.loading=false;state.user={id:'doctor'};
    render(view());
    await waitFor(()=>expect(state.invoke).toHaveBeenCalledWith('google-oauth-callback',{body:{code:'synthetic-code',state:'synthetic-state',redirectUri:`${window.location.origin}/google-oauth-callback`}}));
    expect(await screen.findByText('Agenda do Google conectada.')).toBeInTheDocument();
  });
  it('says plainly what to do when the connection did not finish',async()=>{
    state.loading=false;state.user={id:'doctor'};
    state.invoke.mockResolvedValue({data:null,error:new Error('non-2xx')});
    render(view());
    expect(await screen.findByText('A conexão não foi concluída. Volte à agenda e toque em Conectar Google de novo.')).toBeInTheDocument();
    expect(screen.queryByText(/Código de autorização|provedor/)).not.toBeInTheDocument();
  });
});
