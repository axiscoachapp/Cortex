# T28 — decisão médica privada e concessão vinculada

04/11/2026. Incremento local reservado em `20261104240000`. Sem publicação, carga, envio externo ou dados reais. **M2 continua aberta:** faltam corte geral dos grants antigos, reconciliação, APIs e interface. A decisão privada implementada aqui ainda não está disponível ao usuário do aplicativo.

## Comportamento

`cortex_private.decide_reception_delegation` exige sessão clínica/MFA e filiação ativa do próprio médico de destino. Gestor decide somente pedidos dirigidos a ele como médico. Aprovar muda pending→approved e cria/vincula `staff_doctor_scopes` ao UUID e à identidade exata do pedido na mesma instrução/transação. Recusar muda para denied e remove inclusive uma concessão antiga daquele par. Aprovação explícita pode vincular um grant legado já existente; criar pedido não o converte em anuência.

`revoke_reception_delegation` permite retirada pelo médico de destino ou gestor ativo. Remove grant e encerra pedido aprovado. DELETE privilegiado do grant também o encerra, com causa `scope_removed` e sem atribuir a ação a uma pessoa presumida. Inativação encerra pendentes/aprovados; reativar não restaura permissões. Estados terminais não reabrem e decisões são imutáveis.

Coluna pública aditiva `delegation_request_id`, FK composta/única para pedido privado e guarda de identidade impedem desassociação ou reapontamento de grant aprovado. Depois de qualquer decisão médica para o par, uma inserção legada sem UUID aprovado é recusada. **Pares nunca decididos ainda aceitam o caminho legado nesta ponte**; não há grandfathering como aprovação e não se deve publicar a ponte como encerramento de M2.

CHECKs de forma exigem campos não nulos explicitamente, além dos valores/estados. Isso evita aceitar expressões desconhecidas por NULL, conforme a [semântica de CHECK no PostgreSQL 16](https://www.postgresql.org/docs/16/ddl-constraints.html).

Revisão/CAS e operação por ator vinculam decisões e retentativas. Perda de resposta repete o mesmo resultado somente enquanto o estado/revisão correspondente ainda vale. Repetir aprovação antiga após revogação não recria acesso. Helpers novos continuam sem EXECUTE para PUBLIC/anon/authenticated/service_role; tabelas privadas mantêm RLS e revogação de CRUD. Nenhuma RPC autenticada nova, credencial ou DTO de pacientes foi criado.

## Ordem de escrita e custódia

Escritores adquirem a linha do pedido e tentam epochs das contas sem espera, revalidando autoridade após a barreira. Filiação que autoriza decisão/retirada recebe FOR SHARE NOWAIT. AFTER de validação mantém pedido/grant juntos e roda após `custody_reference`. DELETE começa com a linha do grant já adquirida: tenta contas NOWAIT antes de tentar o pedido, evitando ciclo com retirada que já possui pedido/contas e precisa do grant. Em conflito a transação inteira falha; nenhum retry silencioso aprova outra revisão.

O decisor é obrigado por CHECK a ser o médico imutável de destino, já incluído no inventário de exclusão de conta. Sua FK também participa da guarda de custódia. Exclusão privada de paciente permanece independente dessa história administrativa. Liberação de atribuições usa os triggers existentes, com caso aberto liberado uma vez e caso encerrado preservado.

Instalação atômica exige READ COMMITTED e locks NOWAIT sobre tabelas alteradas e pais. Recusa instalação ocupada ou com snapshot RR estabelecido, sem função/coluna parcial; sessão com default RR pode instalar em transação nova RC. Não altera o singleton de custódia nem wrappers do domínio do Claude.

## Verificação

Resultados e hashes do comando estão em `RED.json`, `focused.json` e `verification.json`. RED/focused preservam a versão do runner usada em cada execução; a execução completa final registra os hashes atuais. O runner congela migrations/bootstrap/suítes de HEAD e adiciona overlays próprios com SHA-256. Executa também os nove helpers a partir dos snapshots registrados, importados de uma pasta temporária própria; não importa helpers vivos da árvore de trabalho. Banco PostgreSQL 16 novo, imagem em cache, endpoint local pinado, rede interna, nenhuma porta publicada. Geração de tipos também usa container próprio e mesma rede; escreve arquivo somente após cleanup verificado.

RED reproduz ausência da função real no predecessor. A suíte cobre aprovação/negação, adoção explícita de grant legado, gestor versus médico, MFA, CAS, payload divergente, revogação e retry, DELETE/reinserção, setter antigo após decisão, lifecycle, acesso administrativo real em `clinic_access`, prontuário privado, custódia e liberação única de trabalho. Novas provas usam duas conexões e observação de `pg_blocking_pids`, em RC/RR, para inativação nos dois sentidos, duas decisões e inversão grant→pedido versus pedido→grant. Snapshot antigo não permite regrant legado após recusa.

A primeira execução concorrente detectou uma expectativa errada do teste: em RC, depois de aguardar a inativação, a função revalida elegibilidade e retorna a negativa dedicada `42501: Delegation member unavailable` antes de CAS. RR retorna `40001`. O teste foi corrigido para exigir cada resultado no ponto certo; a implementação não foi relaxada. Um erro de sintaxe de CASE em IF também foi corrigido antes das execuções SQL aprovadas.

Revisão adversarial de agente com contexto novo não encontrou defeito concreto no SQL dentro do escopo privado descrito. Revisão separada do laboratório encontrou e corrigiu imports vivos, aceitação genérica de qualquer 40001 e omissões não nomeadas do modo dirigido; segundo ciclo apontou rastreamento de arquivo somente depois da escrita, corrigido para planejar antes. `node scripts/test-reception-delegation-lab-cleanup.mjs` injeta ENOSPC após gravar parcialmente o primeiro helper no runner real: variante negativa deixa o arquivo, versão corrigida remove arquivo/pasta. Resultado `cleanup.json`, sem banco criado. Limpeza usa somente caminhos próprios registrados individualmente, sem deleção recursiva.

Revisões foram leituras estáticas, não execução de banco nem revisão externa. Revisão externa dispensada conforme orientação do usuário. Tipos/build/lint e ensaio de upgrade têm resultados registrados no fechamento abaixo. As novas corridas têm runner próprio; não alegar que foram integradas ao comando padrão do CI. A suíte SQL nova entra na descoberta padrão das suítes. `omittedRegressions` e `notCovered` deixam os limites dos modos dirigido/RED explícitos nos relatórios.

## Próxima integração obrigatória

Substituir setter/provisionamento antigos, fechar leitura operacional sobre pedido+grant, reconciliar concessões sem origem e provar corte/rollback antes de APIs/UI. Preservar desativação humana e agenda própria. T31 de credencial inicial e T34 de cadastro único permanecem separados. PersonalMed, campos legais e carregador não fazem parte desta entrega.

## Fechamento local

- `node scripts/test-reception-delegation-decisions.mjs`: GREEN final sobre baseline `8b5f3b660c268a6837fdbb44c0debd9f517e7eee`, 63 migrations/41 suítes SQL, nove helpers congelados, sete falhas de fronteira de funções, regressões de fila/agenda/lifecycle/modelos, oito exclusões, 16 casos de pedidos e 14 de decisões. Cleanup e geração de tipos verificados em `verification.json`.
- `npm run test:db:custody`: 37 grupos dirigidos de instalação/upgrade e 63 migrations, cleanup; resultado em `../custody-upgrade/TARGETED.json`. Compatibilidade com instalação tardia de T33 preservada.
- `node scripts/test-reception-delegation-lab-cleanup.mjs`: RED/GREEN da gravação parcial real, resultado `cleanup.json`; nenhum banco criado nesse ensaio.
- Tipos regenerados: somente três linhas da coluna nullable em `staff_doctor_scopes`. `npm run build` passou com URL/chave publicável estritamente sintéticas; lint passou sem erros e com oito avisos anteriores. Nenhuma alteração de `.env`.
- Revisão de responsividade do Claude concluída separadamente: 81 testes/12 arquivos de hook/recepção e `node scripts/breakpoint-resize-browser.mjs`, seis larguras, escolha de Mês e fila, sem pageerror. Escala 135% preservada, T35 concluída; lacuna desktop Index/CSS permanece T36. Nenhuma evidência do Claude regravada.

Commit local na main com identidade axiscoachapp, sem push. Suítes/ensaios sintéticos não substituem rollout/aceite da clínica nem homologação de serviços externos.
