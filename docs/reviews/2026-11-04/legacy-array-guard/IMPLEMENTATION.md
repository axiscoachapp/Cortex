# T28 — lista antiga não retira aprovação médica

Incremento local de 04/11/2026, migration `20261104250000` reservada às 13:43 antes da criação do arquivo. **M2 continua aberta:** este é um bloqueio transitório no setter antigo, não o corte geral das concessões legadas ou a interface de anuência. Sem publicação, dados reais, carga do PersonalMed ou serviços externos.

## Comportamento

Uma lista ativa de médicos que omita uma delegação já vinculada à aprovação médica falha por inteiro com `40001: Approved delegation requires explicit withdrawal`. Atualização da conta, concessões, pedido/revisão, atribuições da fila e auditoria permanecem como antes da chamada. Uma lista idêntica preserva o UUID e a revisão da aprovação. A desativação humana explícita continua encerrando a aprovação e liberando uma vez os casos abertos; casos encerrados e prontuários privados permanecem preservados.

O setter toca a barreira existente da conta da recepção depois do UPDATE e seus guards, antes de consultar/remover concessões. Esse posicionamento preserva a ordem de aquisição da linha da conta. A tentativa NOWAIT do epoch evita espera inversa com o decisor que começa pelo pedido. Em RR, o snapshot anterior à aprovação aborta ao atualizar o epoch, inclusive quando outro gestor criou o pedido. O DELETE ativo também restringe a remoção a concessões sem pedido vinculado.

A API traduz somente a combinação exata de RPC, código e mensagem. A tela explica que a lista está desatualizada, preserva rascunhos/escolhas e não repete automaticamente a gravação. Outros conflitos continuam com o aviso genérico. Não há novo DTO, RPC pública de anuência ou alteração de tipos.

Concessões legadas nunca decididas e provisionamento ainda usam o caminho transitório. A reativação apenas da flag continua possível nesse caminho, mas não restaura aprovação encerrada. A proteção não é prova de corte de chamadas antigas já em execução durante um rollout hospedado.

## Verificação

- RED real do predecessor: a lista antiga retirava a aprovação; `RED.json` registra a falha esperada `Legacy array removed physician approval`, 63 migrations e cleanup. O teste unitário da mensagem também falhou antes da alteração da API.
- `node scripts/test-reception-legacy-array-guard.mjs`: primeira execução completa aprovada, baseline `62f98b50cc5d2bd207caa917099516e8528a522c`, 64 migrations/42 suítes SQL. Regressões de fronteiras de funções, fila, agenda, lifecycle e modelos, oito cenários de exclusão, 16 ordens de pedidos e 14 de decisões aprovados.
- Nove casos novos de listas em RC/RR: aprovação NULL→vinculada primeiro, lista primeiro e retry da decisão, aprovação contra desativação, espera real de outro gestor pela desativação e snapshot RR antigo. `pg_blocking_pids` comprova a espera da linha; a flag reativada não recupera o pedido encerrado. A suíte SQL verifica atomicidade, fila, identidade/revisão após lista idêntica, delegação real em `clinic_access` e prontuários inacessíveis à recepção.
- Instalação ocupada falha sem mudar a definição anterior; snapshot RR estabelecido é recusado; transação nova com default RR instala em RC. Fontes SQL de HEAD imutável mais overlays próprios com hashes; dez helpers importados de snapshots temporários registrados. Rede Docker interna própria, endpoint local pinado, sem portas publicadas. Cleanup verificado.
- `npm run test:db:custody -- --migration-overlay=20261104250000_reception_legacy_array_guard.sql`: 38 grupos dirigidos de upgrade/recurso e 64 migrations. Zero suítes gerais nesse comando dirigido; as suítes estão no runner anterior. A revisão independente do diff não encontrou defeito concreto, por leitura estática.
- `npm exec vitest run -- src/features/reception/teamApi.test.ts src/features/reception/TeamSettings.test.tsx`: 12 testes/2 arquivos aprovados. `src/lib/psc.test.ts`: 12 casos retestados separadamente para a mensagem de coordenação D17, sem alegação de homologação/revisão criptográfica completa.
- `node scripts/legacy-team-array-browser.mjs`: três verificações em Edge isolado, 390 e 1280 px, sem overflow/pageerror, um único envio observado durante janela de 600 ms. Capturas inspecionadas. Esse ensaio usa transporte simulado e não comprova autorização de PostgreSQL.
- `npm run build`: tipos e build aprovados com URL/chave publicável sintéticas no processo. `npm run lint`: zero erros, oito avisos anteriores. Nenhuma alteração de `.env`.

O primeiro ensaio concorrente dirigido tinha uma expectativa incorreta: um segundo gestor aguarda a linha da conta mantida pela desativação, em vez de recusar no NOWAIT. O teste passou a observar a espera real e exigir os resultados distintos em RC/RR; a implementação não foi afrouxada. Esse ensaio falho não é apresentado como GREEN.

A revisão adversarial local do guard pediu duas provas adicionais: corridas do próprio array contra aprovação e asserções do UUID/revisão depois da lista idêntica. Ambas foram acrescentadas; o segundo ciclo não encontrou defeito concreto no escopo transitório. Foram leituras estáticas de agentes com contexto novo, não execução ou aprovação externa.

## Runner de upgrade

O runner antigo aplicava todas as migrations posteriores antes de instalar T33 sob teste. A nova migration D17 do Claude expôs o erro ao depender do ledger de recursos ainda ausente (`42P01`). O runner agora congela SQL de uma revisão imutável, aceita somente overlays de migration por basename estrito, aplica predecessoras, executa a instalação real de T33 com suas provas e só depois aplica dependentes em ordem. Registra baseline, digest das fontes, hashes dos overlays e as duas listas ordenadas. Helpers JavaScript desse runner continuam sendo imports normais; não se afirma que estejam congelados.

O ensaio de 38 grupos preserva as provas anteriores e acrescenta a ordem real das dependências. Isso corrige o laboratório, sem contornar dependências ou tornar a migration do Claude permissiva. A primeira execução aprovada acima ainda não incluía seu DDL D17; a repetição integrada é registrada no fechamento.

## Próximos passos

Fechar setter/provisionamento antigos, reconciliar concessões sem proveniência e fazer leitores/escritores operacionais dependerem de pedido aprovado mais grant exato. Provar corte/rollback e consumidores de fila/agenda antes das APIs e da interface médica. T31, cadastro único T34 e migração do PersonalMed permanecem separados. Revisão externa dispensada pelo usuário; revisões locais são estáticas e testes são sintéticos.

## Fechamento integrado

Repetição final com baseline `0fba4413d8425232416b2faa31454ab32b32298a` e overlays próprios: **65 migrations/43 suítes SQL, nove casos novos de arrays, 16 de pedidos, 14 de decisões, oito exclusões e todas as regressões anteriores aprovadas**, dez helpers congelados e cleanup confirmado em `verification.json`. O upgrade real também passou novamente: **38 grupos/65 migrations**, incluindo D17 depois de T33, cleanup em `../custody-upgrade/TARGETED.json`. Ambos os processos terminaram com código zero.

Esses resultados incluem a migration D17 `6636629`, sem aprová-la funcionalmente: a revisão estática encontrou quatro lacunas que suas suítes atuais não cobrem (nova permissão de tentativa PSC já em voo, prazo da sessão após espera, intenção de exclusão do paciente e recuperação de segredo em snapshot RR antigo). Contraexemplos e correções/provas solicitadas ao Claude em `coordination/mensagens/2026-11-04-1415_codex-para-claude_d17-revisao-quatro-lacunas.md`; arquivos dele preservados. Reconciliação externa e assinatura real continuam pendentes. Nenhum tipo foi regenerado neste incremento; a guarda não altera colunas/assinaturas, e os tipos D17 seguem a revisão desse domínio.

Commit somente dos caminhos próprios na main com identidade axiscoachapp. Sem push, aplicação hospedada ou publicação.
