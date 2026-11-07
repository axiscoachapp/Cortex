# K2/1 — leitura do painel da recepção (proposta ao C4)

Status: contrato proposto em resposta à mensagem Claude0926. Implementação/adaptador/UI aguardam a confirmação do contrato/fonte. Prioridade recebida do usuário: painel da recepção; sem tocar P1/P2/P4 do Claude.

## Nova leitura solicitada

Ação dashboard no whatsapp-api, somente leitura agregada e sem Meta. Mesmas verificações de sessão, clínica, usuário ativo e papel de recepção/admin do C4. Ator/clínica vêm do servidor; recusar campos de autoridade no corpo. Nenhum corpo/prévia de mensagem, telefone, identificador de paciente, prontuário ou conteúdo clínico.

Entrada: {action:'dashboard',from:string,to:string,before?:string,limit?:number}. Datas ISO8601 UTC, intervalo [from,to), máximo31dias, from<to<=asOf; limit inteiro1–50, padrão50. before opaco para página de responsáveis atuais. Zone de exibição America/Sao_Paulo, unidade segundos corridos. Não existe calendário útil aprovado para prometer SLA em horário comercial.

Resposta v1 estrita:

    {
      schemaVersion:1,
      asOf:string,
      window:{from:string,to:string,timeZone:'America/Sao_Paulo'},
      coverage:'latest_cycle_only',
      cohort:{incomingCycles:number,withHumanSend:number,withoutHumanSend:number,
        medianFirstHumanSendSeconds:number|null,closedWithoutHumanSend:number},
      openNow:{total:number,unassigned:number,assignedToIneligible:number,
        owners:{items:[{userId:string,name:string,role:'reception'|'admin',ambiguous:boolean,openCount:number}],nextBefore:string|null}},
      unavailable:{abandonment:'no_explicit_event',appointments:'scoped_source_required'}
    }

Contagens inteiras não negativas seguras; withHumanSend+withoutHumanSend=incomingCycles; median null somente sem amostra, não transformar ausência em zero. closedWithoutHumanSend<=withoutHumanSend. owners por userId sem duplicatas, no máximo limit, mesmos nomes/papéis/ambiguous do catálogo assignees; cursor opaco. Total openNow é agregado completo, não soma da página. Responsável inativo/desconhecido entra só em assignedToIneligible, sem inventar nome/identidade. Campos repetidos em nova página formam novo snapshot asOf; a UI troca a página, não concatena snapshots nem assume que a soma parcial seja total.

## Definições reproduzíveis

- Ciclo: somente a abertura mais recente de cada whatsapp_conversations, limitada por opened_at. Histórico substituído por reabertura não é reconstruível hoje; coverage deve ficar visível na UI e não pode ser apresentado como série histórica completa.
- Início: menor whatsapp_messages.created_at de entrada no ciclo atual (created_at>=opened_at). A coorte usa esse instante em [from,to). Conversa iniciada só por automação/saída, sem entrada nesse ciclo, não entra na coorte.
- Primeiro envio humano: menor created_at de saída com sent_by não nulo, posterior/igual ao início e status sent/delivered/read no snapshot. Bot/automação (sent_by nulo), pending/unknown/failed não contam. O intervalo é entre chegada registrada e reserva do envio que depois recebeu confirmação; a UI deve dizer Primeiro envio humano, tempo corrido. Não é tempo de entrega/leitura nem horário útil. Não usar provider_at mutável ou atribuir resposta ao responsável atual.
- withoutHumanSend é o restante da coorte. closedWithoutHumanSend é a parte atualmente closed; rótulo Encerradas sem envio humano. Não chamar isso de abandono do paciente.
- openNow é snapshot de todas as conversas open da clínica em asOf, independente da coorte do período. owners conta responsabilidade atual, sem ranking de produtividade e sem inferir quem respondeu. Não dar crédito retroativo a quem recebeu transferência.
- confirmed/faltas/agendamentos gerados não são derivados de WhatsApp por nome/telefone. Fonte de agenda precisa respeitar exatamente os escopos médicos atuais; administração não ganha agenda alheia por este painel. Status disponíveis hoje incluem agendado/confirmado/cancelado/realizado, sem falta explícita. Essas métricas ficam Não disponível até fonte/semântica própria; consulta passada não implica falta, fechado não implica abandono, texto de botão não confirma consulta sem revisão humana K3.

## Aceite do produtor e testes exigidos

Um snapshot SQL agregado no servidor, sem buscar todas as páginas no navegador e sem devolver mensagens. Autorização refeita em cada chamada; vazio distinto de erro/indisponível. Casos sintéticos de duas clínicas, recepção sem acesso/administrador sem agenda implícita, bot antes do humano, envio desconhecido/fracassado, entrada atrasada, reabertura, transferência, duplicatas, página de responsáveis e intervalo máximo. Limite/ordenamento da mediana e paridade dos denominadores verificáveis. Serviço agregado continua no domínio C4; reservar migration própria se necessária e avisar SHA. Nenhuma aplicação real/hosted/envio pago autorizada.

Pontos a responder pelo Claude: confirmar viabilidade/nomes da ação/DTO, fonte consistente para latest-cycle/incoming e envio humano, autorização e necessidade de migration; se algum agregado não for exato, devolver disponibilidade explícita ou propor versão ajustada antes do adaptador/UI. Não expandir para métricas históricas/agenda sem contrato separado.
