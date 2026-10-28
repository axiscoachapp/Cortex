import {useQueries} from '@tanstack/react-query';
import {sharingRpc} from '@/lib/sharing';
import {useSessionHidden} from '@/contexts/SessionVisibility';
import type {ChatMessage} from '@/types/patient';

/** Protocol-derived replies remain authorization-sensitive after delivery.
 * Per-source query keys deduplicate checks across replies; failed or pending
 * checks hide the derived text, including when returning to a patient. */
export function ClinicalAnswer({message,userId}:{message:ChatMessage;userId:string}){
  const hidden=useSessionHidden();
  const protocols=[...new Map((message.sources??[])
    .filter(source=>source.type==='knowledge'||source.type==='protocol')
    .map(source=>[`${source.id}/${source.authorizationRevision}/${source.sourceReviewRevision}`,source])).values()];
  const checks=useQueries({queries:protocols.map(source=>({
    queryKey:['protocol-source-access',userId,source.id,source.authorizationRevision,source.sourceReviewRevision],
    enabled:!hidden,
    queryFn:async()=>{
      if(!Number.isInteger(source.authorizationRevision)||!Number.isInteger(source.sourceReviewRevision))return false;
      try{
        const result=await sharingRpc<{authorization_revision:number;source_review_revision:number}>('check_shared_protocol_access',{p_document_id:source.id});
        return result.authorization_revision===source.authorizationRevision&&result.source_review_revision===source.sourceReviewRevision;
      }catch{return false;}
    },
    retry:false,staleTime:0,gcTime:0,refetchInterval:5000,refetchOnWindowFocus:true,
  }))});
  if(protocols.length&&(hidden||checks.some(check=>check.isPending||check.isFetching)))return <p role="status" className="text-xs text-muted-foreground">Verificando acesso às fontes desta resposta…</p>;
  if(checks.some(check=>check.isError||check.data!==true))return <p role="status" className="text-sm text-muted-foreground">Esta resposta foi ocultada porque as fontes mudaram ou o acesso não pôde ser confirmado. Faça uma nova pergunta para consultar fontes autorizadas.</p>;
  return <>
    <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{message.content}</p>
    {message.coverage&&<p className="text-xs text-muted-foreground mt-3 border-t pt-2">Contexto recuperado: {message.coverage.consultationsRetrieved??0} de {message.coverage.consultationsTotal??'?'} consultas e {message.coverage.documentsRetrieved??0} de {message.coverage.documentsTotal??'?'} documentos. A busca usa trechos selecionados; ausência neste contexto não comprova ausência no prontuário.</p>}
    {!!message.sources?.length&&<details className="mt-3 text-xs"><summary className="cursor-pointer font-medium">Fontes e trechos consultados ({message.sources.length})</summary><ul className="space-y-3 mt-3">{message.sources.map((source,i)=><li key={source.id+'-'+i} className="border-l-2 pl-3 break-words"><p className="font-medium">{source.label} · {source.date}</p>{source.sourceVersion&&<p>Versão: {source.sourceVersion}</p>}{source.reviewedBy&&<p>Revisado / compartilhado por: {source.reviewedBy}</p>}{source.sourceReference&&<p>Referência: {source.sourceReference}</p>}{source.reviewStatus==='pending'&&<p className="text-amber-800">Análise de documento ainda não revisada pelo médico.</p>}<p className="text-muted-foreground">Referência interna: {source.id}</p><p className="whitespace-pre-wrap mt-1">{source.excerpt}{source.truncated?' […]':''}</p></li>)}</ul></details>}
  </>;
}
