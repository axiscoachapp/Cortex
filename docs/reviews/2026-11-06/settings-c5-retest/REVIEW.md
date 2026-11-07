# K6/5c1 — Configurações: modal aprovado no recorte, dois resíduos de estado

Snapshot da aplicação: `c8d9c9edd309a30a8a7215a2f518c7a7633ab106`; C5 continua com a implementação de `f837c57`. Nenhum arquivo do produtor foi alterado. [Validação](VALIDATION.json), [Vitest RED](UNIT_FINAL_RED.json), [fontes dos testes](UNIT_SOURCES.json), [navegador](../../2026-11-05/reception-app-audit/settings-c5-f837c57-retest/AUDIT.json).

## Modal e gate: GREEN

Os mesmos 20 estados do ensaio anterior passam em Edge isolado, em375/1280/1920px a135%, sem overlay. O antigo problema de91px do AutomationEditor está encerrado neste recorte: overflow horizontal zero nas três larguras, ações alcançáveis após rolagem interna e controles nomeados. Capturas do celular, rodapé e desktop inspecionadas. Nenhuma asserção visual foi relaxada.

Recepção sem seções clínicas/administrativas, Segurança fora do gate, entrada por Configurações, inatividade, aliases, retirada de portal/rascunho e recuperação no mesmo documento continuam passando. Equipe/Permissões reais permanecem incorporadas com um main/h1. Três503/console correspondentes são os erros deliberados de `clinic_access`; demais erros/requisições bloqueadas/falhas zero. Nenhuma gravação de configuração, envio ou leitura clínica ocorreu.

O executor passou a congelar também `supabase/functions/_shared/whatsappFlow.ts`, importado pelo novo editor fora de `src`, e exige sua carga junto com FlowEditor. A fixture aceita apenas a nova leitura `flow`, exclusiva do administrador, sem permitir `saveFlow`, IDs de autoridade ou outros comandos. O fluxo sintético fica desligado. Esse conteúdo saudável permite exercitar a página atual; não é um teste do simulador inteiro nem do bot servidor.

## P2 — primeira falha do fluxo fica presa em Carregando

Em `src/features/settings/FlowEditor.tsx`, `if (flow.isLoading || !draft)` vem antes de `flow.isError`. Na primeira falha não há draft: a consulta termina em `error`, mas a tela continua em “Carregando o fluxo…”, sem erro nem botão de retry.

O teste controla a primeira promessa, verifica o loading, rejeita a leitura e confirma o estado real `error` da query antes de exigir o alerta. A falha final é ausência do alerta, não timeout. O trecho posterior já exige clicar em Tentar novamente, chamar somente `flow` outra vez com o mesmo contexto e renderizar o editor ao receber a segunda resposta; **esse trecho ainda não é alcançado no produtor atual**. Corrigir a ordem dos estados e retestar a recuperação inteira.

## P2 — remontagem mostra controles do cache antes da nova verificação

Em `src/features/settings/WhatsAppSettings.tsx`, `staleTime:0`/`refetchOnMount:'always'` disparam uma leitura, mas o retorno considera só `isLoading`. Uma consulta com dados antigos entra em fetch mantendo o sucesso anterior, então a seção mostra Nova automação e demais controles baseados em `canManage` antigo enquanto a resposta nova está pendente.

O teste primeiro monta o componente real, recebe estado administrativo e vê Nova automação. Depois desmonta/remonta com o mesmo QueryClient e mantém a nova resposta pendente; a chamada `state` ocorre, mas o botão antigo continua presente. Pedida reconferência visual antes de expor esses controles/dados na nova montagem. É um resíduo de freshness da interface, **não uma prova de bypass da autorização do servidor**.

Controles positivos passam: primeira leitura sem cache não mostra administração; falha inicial do estado oferece retry; ao trocar de admin para membro há consulta de estado distinta/em fetch, enquanto a consulta administrativa original permanece intacta e o conteúdo antigo não aparece. Ator/clínica/papel não foram removidos das chaves. Não foi ensaiado cancelamento HTTP/AbortSignal nem revogação real de identidade.

## Evidência e limites

- 9Vitest em dois arquivos:7passam/2RED esperados, incluindo os quatro testes C5 existentes. Cinco fontes do produtor conferidas contra o snapshot e seis hashes (incluindo o teste próprio) iguais antes/depois. Vitest importa o working tree conferido; somente o navegador usa o carregador congelado.
- 3Node da fixture, tipos globais, lint de cinco arquivos, sintaxe de quatro scripts e três opções de CLI recusadas.19hashes do executor do navegador estáveis e cleanup positivo. APIs só em loopback, sem sessões pessoais ou serviços externos.
- Revisão adversarial em três ciclos: provas de cache agora usam montagem real; isolamento exige consultas distintas; retry só aceita duas leituras `flow` com contexto exato. Último ciclo sem achado substantivo. Cross-model skipped: non-interactive context.
- Preparação excluída: primeiro Vitest não tinha mock do SDK e recusou ambiente; uso indevido de `exact` foi corrigido no teste, e o timeout genérico foi substituído pela confirmação do estado `error`. `UNIT_RED.json` é preliminar; o artefato final é `UNIT_FINAL_RED.json`. São ajustes do ensaio, sem edição C5.

Claude corrige os dois resíduos de interface; Codex retesta por SHA. K6/C5 inteiro continua aberto. Próximo trabalho independente do Codex pode ser K1 de leitura de `botSession.path`/fila, conforme contrato1.2. Correções do bot registradas2316 continuam com Claude, sem nova confirmação repetida.

Sem migrations, banco hospedado, Meta, push/deploy ou mudança em SaaS/PersonalMed. Main/axiscoachapp, commits apenas dos caminhos próprios.
