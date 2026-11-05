# T05b/4b — Conferência da suspensão e reativação

05/11/2026, Codex. Implementação local sobre a API entregue em `82fcbf1`. Sem nova migration, contrato RPC, grant ou escrita em banco hospedado.

## Resultado

Admin clínico ativo abre Contatos → Consultar vínculos → Suspender/Reativar. Leitura fresca exige os mesmos contato/paciente/médico antes de mostrar nome, nascimento, médico e relação. A ação tem alvo explícito e revisão congelada. Suspender aceita paciente arquivado/médico inativo; reativar exige ambos disponíveis e nova conferência humana. Nenhum dado legal, prontuário ou confirmação original é alterado.

Checkbox humano precede a gravação de IDs/revisão/alvo. Mudança observada bloqueia a conferência antiga; recuperação explícita renova a revisão e exige nova confirmação. Erros preservam o preenchimento, mas bloqueiam nova gravação até recuperar. Se o servidor já estiver no alvo, a tela informa isso sem reenviar ou inverter a ação e sem anunciar uma nova gravação. Saída, recuperação e duplicatas ficam bloqueadas durante write/recovery. Desmontagem ou perda de acesso suprime callbacks tardios.

Sucesso e retorno invalidam as projeções de recepção, incluindo a lista após resposta perdida. Modais alternam. O aviso esclarece histórico/agenda preservados, impedimento de novos agendamentos/remarcação/reabertura e cancelamento separado pela agenda. Nenhum envio externo ou agendamento automático.

## Evidências

- RED inicial: import do módulo ainda ausente recusado pelo Vitest.
- Revisão independente somente leitura, agente `link_state_ui_review`, contexto novo, sem revisão externa. Encontrou bypass pelo Retry superior após read-error durante write: recovery podia remontar o form e perder a trava. Checagem central `recoverCheck` agora protege todas as entradas. [Controle RED](RED_RECOVERY.json): retirando somente essa checagem, o teste falha com três leituras em vez de duas; fonte restaurada em `finally`. Retorno à lista também foi corrigido; adotada invalidação operacional ampla. Última leitura do revisor sem achado material.
- [38 testes / três arquivos aprovados](UNIT.json): 14 estado, 12 lista e 12 editor de relação existente. Revisão congelada/conflito, resposta perdida/revisão inesperada, indisponibilidade, recuperação falha, saídas/sessão, duplicata, médico divergente, callbacks tardios e perda/restauração de autoridade com descarte de leitura pendente.
- [Nove checks de navegador](browser/verification.json): Edge headless isolado, páginas/modais/API reais, HTTP sintético loopback. Ciclo suspender/reativar, payload exato, resultado perdido sem retry automático, conflito/renovação da confirmação, Escape bloqueado em write, indisponibilidade, ausência de entrada administrativa para secretária e layout. Dez fontes congeladas por SHA-256, zero `pageerror`, recursos encerrados antes da prova.
- Layout375/390/768/1280/1920px: título e ação alcançáveis com rolagem, modal dentro do viewport, escala global135% preservada. [Topo](browser/suspend-top-mobile.png) e [ações](browser/suspend-end-mobile.png) inspecionados visualmente.
- ESLint dos quatro TSX e harness, sintaxe Node, typecheck app/Node e build com variáveis sintéticas explícitas aprovados. O teste de refetch passou a aguardar a notificação QueryObserver com `waitFor`; o primeiro ensaio browser esperou texto cru da fixture e foi ajustado à mensagem genérica real do adaptador, sem mudar o app.

DevTools MCP indisponível nesta sessão; usado Playwright isolado existente. Navegador não prova SQL/PostgREST real. Não se repetiram SQL, Native ou D17 nesta fatia visual: base inalterada com [74 migrations, 19 suítes SQL e 14 cenários/controles](../contact-link-state/IMPLEMENTATION.md). Sem carga PersonalMed, arquivos Claude/SaaS, chamadas pagas, push ou deploy.

## Estado

T05b implementada localmente pelas fatias1–4b: identidade histórica imutável, confirmação antiga idempotente, correção por revisão, lista paginada, conferência da reserva e suspensão/reativação protegidas no banco/interface. M2, corte, homologação de fornecedor e piloto continuam abertos. Próximo incremento independente candidato: T38, apresentação da semana no celular, preservando visão escolhida e escala135%. PersonalMed segue com Claude; pm-v2/D6A/D7A não autorizam schema/carregador/carga por inferência.
