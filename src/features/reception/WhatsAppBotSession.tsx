import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { whatsappApi,type WhatsAppBotSession as BotSession } from './whatsappApi';
import { clinicDateLabel,clinicTime } from './dates';

const statusLabels:Record<BotSession['status'],string>={
  active:'Em andamento',handed_off:'Encaminhado à recepção',closed:'Encerrado',human:'Atendimento humano',error:'Interrompido',
};

export function WhatsAppBotSession({actor,clinic,conversationId,generation}:{actor:string;clinic:string;conversationId:string;generation:number}){
  const query=useQuery({
    queryKey:['reception',actor,clinic,'whatsapp','bot-session',conversationId,generation],
    queryFn:({signal})=>whatsappApi.botSession({conversationId},signal),
    retry:false,gcTime:0,staleTime:0,refetchOnMount:'always',refetchOnWindowFocus:false,refetchOnReconnect:false,
  });
  const fresh=query.isSuccess&&query.isFetchedAfterMount&&query.fetchStatus==='idle';
  const session=fresh?query.data.session:null;
  return <section aria-label="Caminho no robô" className="min-w-0 rounded-md border bg-muted/30 p-3 space-y-2">
    <h3 className="text-sm font-semibold">Caminho no robô</h3>
    {query.fetchStatus==='paused'?<p role="status" className="text-sm">Aguardando conexão de rede para carregar o caminho…</p>
      :query.isPending||query.fetchStatus!=='idle'?<p role="status" className="text-sm">Carregando caminho…</p>
      :query.isError?<div role="alert" className="space-y-2 text-sm">
        <p>Não foi possível carregar o caminho no robô. Verifique seu acesso e tente novamente.</p>
        <Button variant="outline" onClick={()=>void query.refetch()}>Tentar carregar caminho</Button>
      </div>:null}
    {fresh&&(session?<>
      <p className="text-sm font-medium">{statusLabels[session.status]}</p>
      {session.path.length?<ol aria-label="Opções escolhidas no robô" className="list-decimal space-y-1 pl-5 text-sm">
        {session.path.map((step,index)=><li key={index} className="[overflow-wrap:anywhere]">{step}</li>)}
      </ol>:<p className="text-sm text-muted-foreground">Nenhuma opção escolhida neste percurso.</p>}
      <p className="text-xs text-muted-foreground">Atualizado em <time dateTime={session.updatedAt}>{clinicDateLabel(session.updatedAt)} · {clinicTime(session.updatedAt)}</time></p>
    </>:<p className="text-sm text-muted-foreground">Nenhum percurso do robô registrado nesta conversa.</p>)}
  </section>;
}
