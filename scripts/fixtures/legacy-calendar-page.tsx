import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ClinicAccessContext } from '@/features/reception/accessContext';
import { receptionApi } from '@/features/reception/api';
import ReceptionCalendar from '@/features/reception/ReceptionCalendar';
import { Button } from '@/components/ui/button';
import '@/index.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
export function Calendar(){
 const {user}=useAuth();
 const access=useQuery({queryKey:['clinic-access',user!.id],queryFn:receptionApi.access});
 if(!access.data)return <p>Carregando acesso sintético…</p>;
 return <ClinicAccessContext.Provider value={access.data}><main className="mx-auto max-w-4xl p-4"><ReceptionCalendar/></main></ClinicAccessContext.Provider>;
}
export function App(){
 const {user,loading,signIn}=useAuth();if(loading)return <p>Verificando ensaio…</p>;
 if(!user)return <Button onClick={()=>void signIn('review@example.invalid','synthetic-password')}>Entrar no ensaio</Button>;
 return <Calendar/>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><App/></AuthProvider></QueryClientProvider>);
