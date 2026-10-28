import {useQuery,keepPreviousData} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from '@/contexts/AuthContext';
import {Button} from '@/components/ui/button';
import {useEffect,useState} from 'react';
import {SessionVisibilityContext} from '@/contexts/SessionVisibility';
import {confirmSessionExit} from '@/hooks/useUnsavedChanges';
export function SessionAssurance({children}:{children:React.ReactNode}){
  const {user,session,signOut}=useAuth();
  const exit=()=>{if(confirmSessionExit())void signOut();};
  const query=useQuery({queryKey:['session-assurance',user?.id,session?.expires_at],enabled:!!user,queryFn:async()=>{const {data,error}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();if(error)throw error;return data;},staleTime:30000,refetchOnWindowFocus:true,placeholderData:keepPreviousData});
  const [previouslyAuthorized,setPreviouslyAuthorized]=useState(false);
  const needsFactor=query.data?.nextLevel==='aal2'&&query.data.currentLevel!=='aal2';
  const allowed=!!query.data&&!query.isError&&!needsFactor;
  useEffect(()=>{if(allowed)setPreviouslyAuthorized(true);},[allowed]);
  const gate=query.isLoading?<p role="status" className="p-6">Verificando sessão…</p>:query.isError?<div role="alert" className="p-6 space-y-3"><p>Não foi possível verificar a segurança da sessão. O trabalho já aberto permanece preservado.</p><Button onClick={()=>query.refetch()}>Tentar novamente</Button><Button variant="outline" onClick={exit}>Sair</Button></div>:<main className="max-w-lg mx-auto p-8 space-y-4"><h1 className="font-serif text-3xl">Verifique seu acesso</h1><p>Confirme o código do aplicativo autenticador para abrir o ambiente clínico.</p><Button asChild><Link to="/seguranca">Verificar código</Link></Button><Button variant="outline" onClick={exit}>Sair</Button></main>;
  return <SessionVisibilityContext.Provider value={!allowed}>{(allowed||previouslyAuthorized)&&<div hidden={!allowed}>{children}</div>}{!allowed&&<div data-session-locked="true" className="fixed inset-0 z-[100] bg-background overflow-y-auto">{gate}</div>}</SessionVisibilityContext.Provider>;
}
