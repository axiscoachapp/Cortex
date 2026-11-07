# K7/3a — entrada de pós-consulta

Baseline `5d4fb69baaf4a0edc73a877e31b5746ddfd77214`. [Contrato](../../../product/clinic-crm/POST_CONSULTATION_ENTRY.md).

CLAIM sob verificação: só a última evolução com ID persistido oferece a etapa; documentos usam esse ID/texto e acompanhamento usa o paciente selecionado, sem executar ação ao montar ou perder texto não salvo.

RED: dois testes novos falharam/13 anteriores passaram contra a fonte anterior. A implementação organiza o footer existente e acrescenta uma ação para acompanhamento, sem mudança em escritores/rotas/DTOs/DDL/arquivos Claude. Teste adicional confirma o ID do documento com duas evoluções salvas e estado global ainda nulo.

Fixture de finalização é opt-in, só aceita paciente/rascunho/texto revisto e clique de confirmação; simula uma gravação em memória, nunca chama IA, provedor ou banco real. O navegador deve passar pelo diálogo de revisão e pela confirmação antes de mostrar a etapa.

## Verificação final

- 51 Vitest/quatro arquivos (ChatPanel, assinatura, diálogo de acompanhamento, Index), incluindo três testes novos: disponibilidade só no último SOAP persistido, resumo só por clique com texto correto, compositor com ID exato entre duas evoluções e sem assinatura automática.16 Node/três arquivos: opt-in/finalização rejeita paciente/texto/ator indevidos e15 regressões. Tipos globais, lint dos10 caminhos, sintaxe dos5 scripts e quatro recusas de CLI antes de serviços passam. `UNIT_GREEN.json` é a suíte dirigida; não representa Vitest global (RED C5 do Claude fora do recorte).
- Revisão adversarial fresca `/root/post_consultation_review`: nenhum achado acionável na lógica/contrato/fixtures. Cross-model skipped: non-interactive context.
- Primeira execução de navegador esperava “Retomar revisão”, mas o rascunho em revisão já abre seu diálogo ao carregar; corrigida somente essa expectativa da fixture, sem pular a confirmação humana. A segunda execução completou24 estados e expôs20px no cabeçalho da revisão/22px no acompanhamento em320 (`LAYOUT_RED.json`). Foram corrigidas apenas classes nos dois diálogos Codex: header flex-wrap/título quebrável/reserva do fechar; grid de uma coluna e título quebrável no acompanhamento. Nenhum módulo de prescrição/assinatura do Claude foi editado.
- [AUDIT final](../../2026-11-05/reception-app-audit/post-consultation-layout-final/AUDIT.json):24 estados em320/375/1280/1920, escala135%, três overlays explícitos (ChatPanel e dois diálogos),321 fontes congeladas/21 hashes do executor estáveis, cleanup positivo. Revisão, salvar, pós-consulta, acompanhamento, texto não salvo recusado, documentos e volta; quatro finalizações sintéticas somente depois do clique humano. Valores/dados do acompanhamento preservados, mesmo paciente/URL/documento/foco, texto mantido ao recusar saída, compositor aberto sem gerar.20/22px→0px sem reduzir as asserções; capturas320 inspecionadas visualmente. Controles da etapa>=44px/fit/hit-test.
- Ledger de130requests só leitura/login e quatro finalizações mock; zero outro POST, IA, documentos gerados/assinados/enviados, alteração de paciente/agendamento/itens, recurso externo, HTTP ou console inesperado. Quatro HEAD `/rest/v1/patients`/200/`net::ERR_ABORTED` históricos preservados sem inferência de causa; só essa tupla aceita. Não prova finalização/Auth/RLS/SQL reais ou produção.

Só `post-consultation-layout-final` é a evidência integrada aceita; diretórios preliminares excluídos do commit, RED de layout preservado nesta pasta. Nenhuma entrada Claude nova,2152 já atendida2353; sem resposta de confirmação adicional. K7 inteiro continua aberto para persistência/continuidade do pós-consulta em recorte próprio; retestes C4/C5 após novos SHAs. Sem migration/carga/PersonalMed/SaaS/push/hosted/serviço pago.
