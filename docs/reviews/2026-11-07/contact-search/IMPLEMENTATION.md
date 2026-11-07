# T43 — busca fresca de contatos administrativos

Novo atendimento agora reutiliza ContactSearch, também usado na agenda. O componente só consulta com recepção/admin ativo, ator da sessão correspondente e clínica atual. A busca fica isolada por ator, clínica e texto; mudança de contexto desmonta o leitor e limpa o rascunho de busca. [Contrato](../../../product/clinic-crm/CONTACT_SEARCH_FRESHNESS.md).

Botões, vazio e cursor só aparecem após resposta fresca, com consulta idle. Leitura, erro e pausa ocultam dados anteriores. A seleção confere o estado atual e a identidade do snapshot no cache, protegendo também o intervalo antes da notificação do React. Erros têm texto local e retry explícito do tipo button, preservando campo e assunto sem submeter o formulário.

receptionApi.contacts aceita AbortSignal opcional após o cursor, combinado com o prazo existente de20s. Pré-abort não invoca RPC; retorno ou erro após cancelamento não entrega dados antigos. O SDK instalado demonstrou propagação até o sinal do Request, inclusive com transporte em andamento. Corpo RPC e chamadas sem sinal mantêm compatibilidade. Não muda criação, identidade ou confirmação humana de reserva.

## Evidências

Base `b37e7d5befa684b4957fc9c998776e2b8742342d`, main. [Validação completa](VALIDATION.json).

- [UNIT_RED](UNIT_RED.json)/[RED_CONTROL](RED_CONTROL.json):19falhas e três controles que já passavam, nos mesmos22testes refinados contra as três fontes originais; sem timeout genérico e restauração exata por hash antes dos demais ensaios. Primeiras expectativas de whitespace e esperas de sinal foram corrigidas; uma troca JSX incompleta e a manutenção do observer quando active=false também foram corrigidas. Só a rodada final conta como GREEN.
- [UNIT_GREEN](UNIT_GREEN.json):118testes/doze arquivos,22novos (16UI/seisAPI) e96regressões de acesso/equipe/agendamento/vínculos/correção de contato. Incluem cache pendente/erro/paused, clique antes da notificação, troca de snapshot, texto/contexto/inatividade, abort/retorno tardio, deadline e compatibilidade dos RPCs sem sinal. Sem alegação de Vitest global verde.
- [SDK](SDK.json):cliente2.86.0 e PostgREST reais, oito grupos/sete POST, três fontes estáveis e fetch exclusivamente em memória. Corpo exato e projeção estrita, erros sem dados brutos, pré-abort sem chamada, late abort e abort em voo observados. O prazo de20s foi conferido por sinal controlado nos unitários, sem esperar20s reais. Nenhum banco ou rede externa.
- [Browser final](../../2026-11-05/reception-app-audit/contact-search-reviewed-final/AUDIT.json):35estados/66PNGs320,375,1280,1920px a135%;349fontes congeladas/35hashes runtime/três overlays estáveis, cleanup positivo.33requests; quatro403 de reception_contacts interceptados localmente/quatro console403 esperados, zero demais falhas de rede, JS, clínico ou externo. Nenhum contato, atendimento ou reserva criado. Novo atendimento nas quatro larguras e agenda375 usam o picker real, com seleção visível, troca de modo reiniciando só busca, assunto preservado e retry explícito.
- Capturas320resultado/ações e1920erro inspecionadas. O modal usa rolagem interna para cabeçalho/ações no celular. Todas as ações medidas foram alcançáveis pelo hit-test;44px foram medidos nas linhas de resultado iniciais, sem alegar medição de todos os controles.
- Tipos reais da aplicação, lint de oito arquivos, sintaxe de três scripts e [quatro combinações CLI inválidas](CLI.json) passam. Revisão adversarial estática em três rodadas; P2 do gate de ações inacessíveis corrigido, reconciliação sem achados adicionais. Cross-model skipped: non-interactive context.

Comando browser: `node scripts/reception-app-audit-browser.mjs --baseline=b37e7d5befa684b4957fc9c998776e2b8742342d --only=contact-search --overlay=src/features/reception/ContactSearch.tsx --overlay=src/features/reception/NewCaseDialog.tsx --overlay=src/features/reception/api.ts --run=contact-search-reviewed-final`.

O primeiro browser parou após34estados porque a seleção da agenda inclui o prefixo Contato:, ausente no teste. Corrigido sem alterar o produto; esse preliminar foi preservado e excluído. Nenhuma fonte mudou durante o browser final. Sucesso usa a fixture HTTP loopback existente; recusas são interceptadas apenas no endpoint local conhecido. Sem Chrome DevTools MCP disponível, usado Edge e perfil temporário do runner existente.

## Limites e continuidade

Browser não prova cache pendente/paused, mudança de contexto, cancelamento físico ou ID submetido. Esses aspectos ficam nos unitários/SDK; não houve submissão real ou sintética neste recorte. Não é prova de autorização/RLS/SQL reais. Contato previamente selecionado, contexto posterior do rascunho e política de submissão não foram redesenhados; os outros campos permanecem no formulário. Nenhum paciente é confirmado por nome/telefone nem há fusão de identidades.

K1/T41 restante,4j/catálogo0506 e retestes C4/C5 após novos SHAs continuam separados. Nenhum incoming Claude novo/2152 já atendida, sem nova confirmação ao outro agente por ajuste interno compatível. Sem produtor/C5/schema/prontuário/PersonalMed/SaaS, Meta/hosted/carga/push.
