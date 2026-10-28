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
    expect(screen.getByText('Conectando Google Calendar...')).toBeInTheDocument();
    expect(screen.queryByText('Usuário não autenticado.')).not.toBeInTheDocument();
    expect(state.invoke).not.toHaveBeenCalled();
  });
  it('sends the received state with the code after authentication is ready',async()=>{
    state.loading=false;state.user={id:'doctor'};
    render(view());
    await waitFor(()=>expect(state.invoke).toHaveBeenCalledWith('google-oauth-callback',{body:{code:'synthetic-code',state:'synthetic-state',redirectUri:`${window.location.origin}/google-oauth-callback`}}));
    expect(await screen.findByText('Google Calendar conectado!')).toBeInTheDocument();
  });
});
