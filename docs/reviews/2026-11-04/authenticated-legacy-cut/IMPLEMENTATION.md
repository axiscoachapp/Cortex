# T28 — cortar a criação de acessos pela lista autenticada antiga

Incremento local de 04/11/2026, reservado em ESTADO às 15:10 antes da migration. **M2 continua aberta.** O provisionamento de serviço ainda cria escopos legados; os já existentes continuam eficazes até a reconciliação explícita e o corte dos leitores. Nenhuma aplicação hospedada, revogação real ou nova interface de aprovação foi executada.

## Comportamento

`20261105000000_reception_authenticated_scope_cut.sql` acrescenta um AFTER INSERT privado a `staff_doctor_scopes`. Uma inserção efetiva sem `delegation_request_id` no contexto autenticado falha com `42501`, inclusive quando alcançada pelo setter interno. O trigger roda depois das guardas anteriores de identidade, elegibilidade, custódia e par já revisado. Não usa um predicado dependente de snapshot para autorizar novas concessões.

O AFTER é deliberado: os setters antigos usam `ON CONFLICT DO NOTHING` para manter uma linha já existente. Um BEFORE rejeitaria também esse no-op. Remoção de legado, desativação e preservação de uma aprovação médica vinculada ao UUID exato continuam disponíveis. O caminho privado de decisão do médico insere o grant vinculado, sem ser confundido com a concessão antiga.

A API traduz somente o nome do RPC, SQLSTATE e mensagem exatos para o aviso de aprovação médica. Outros erros continuam genéricos. A tela preserva escolhas/rascunho após a recusa, sem repetir automaticamente. Não há nova assinatura pública ou tipo gerado.

## Provas e isolamento

`RED.json` registra o setter autenticado real criando um escopo sem pedido no predecessor: a asserção dedicada produz `P0001`. O primeiro teste da API também falhou antes da tradução (`UNIT_RED.json`). A correção não se baseia apenas no mock da interface: a nova suíte SQL chama o RPC real sob o papel autenticado e exige a recusa exata, rollback da alteração/auditoria e controles positivos de no-op, remoção, aprovação médica e desativação. O controle de serviço registra expressamente o limite ainda aberto.

O runner `scripts/test-reception-authenticated-cut.mjs` aceita somente laboratório próprio, sem alvo externo. Verifica/fixa o endpoint Docker local, usa imagem em cache, rede interna e nenhuma porta publicada. Migrations, bootstrap, suítes e 12 helpers são congelados em HEAD mais overlays explícitos, com hashes. Não importa módulos vivos em paralelo do Claude. Verifica propriedade antes da limpeza e remove individualmente os arquivos temporários próprios.

O ensaio de instalação aquece o setter e o cache dos triggers antigos no mesmo backend, abre snapshots RC/RR, instala a guarda mantendo o lock e observa `pg_blocking_pids` antes do commit. O cliente antigo deve recusar a criação após a instalação, preservando o acesso anterior. Há controles de instalação ocupada (`55P03`), snapshot RR estabelecido (`25001`, nenhum objeto parcial) e default RR instalado em transação READ COMMITTED.

As fixtures históricas que antes criavam grants autenticados agora preparam legado por contexto de serviço explícito, ou usam a decisão privada real do médico. Isso não simula anuência. Os testes mantêm as remoções públicas, revogações, autorização de rascunho, saída/reingresso e inativação concorrentes. Nos helpers de lifecycle, os ramos de serviço continuam inserindo linhas; os ramos RPC agora salvam linhas existentes e declaram `rpcMode: save-existing-server-fixture`.

Revisão adversarial local com contexto novo, somente leitura, não encontrou defeito comportamental no recorte. Pediu esclarecer os rótulos dos controles de grants: corrigidos antes da execução completa. Não houve revisão externa, dispensada pelo usuário.

Falhas intermediárias do laboratório: a primeira rodada dirigida encontrou duas inserções de setup autenticadas na suíte histórica de decisões; o setup foi identificado como legado de serviço, preservando as negativas. A segunda encontrou escopos residuais das duas fixtures novas de instalação, que conflitavam com uma asserção histórica de tabela vazia. Corrigida a limpeza somente desses escopos próprios depois das asserções, sem relaxar a suíte histórica. A terceira mostrou que usar aprovação nova como fixture de uma suíte de offboarding legado mudava o caminho de auditoria: o encerramento do pedido remove a linha antes do contador legado. Essa fixture voltou ao legado explícito de serviço, mantendo o contador original de dois eventos e a cobertura de aprovação nos testes próprios. As três rodadas encerraram o laboratório pelo finally; não geraram relatório GREEN.

## Comandos

- `node scripts/test-reception-authenticated-cut.mjs --red`: predecessor, RED esperado, cleanup.
- `node scripts/test-reception-authenticated-cut.mjs`: instalação e todas as suítes SQL, regressões concorrentes, pedidos/decisões/listas antigas e snapshot da assinatura D17.
- `npm run test:db:custody -- --migration-overlay=20261105000000_reception_authenticated_scope_cut.sql`: upgrade real com a nova migration na ordem correta.
- `npm exec vitest run -- src/features/reception/teamApi.test.ts src/features/reception/TeamSettings.test.tsx --reporter=json --outputFile=docs/reviews/2026-11-04/authenticated-legacy-cut/UNIT_GREEN.json`: 17 testes/2 arquivos aprovados.
- `node scripts/authenticated-team-cut-browser.mjs`: três verificações, uma tentativa de save, nenhum pageerror; aviso, estado preservado, desativação habilitada e sem overflow a 390/1280 px. Capturas conferidas. Usa transporte simulado, não comprova autorização SQL ou clique de desativação. A escala vigente de 135% foi preservada.
- `npm run build` com URL/chave publicável sintéticas somente no processo: tipos e build aprovados. `npm run lint`: zero erros e oito avisos anteriores.

`verification.json`: rodada completa sobre `39d84f5c440712a3abcdcee6eeb33d4fd5c52330`, com **66 migrations/44 suítes SQL**, duas novas ordens de instalação, 12 helpers congelados, sete injeções de falha nas fronteiras, regressões da fila, dez ordens de agenda, 20 cenários de lifecycle médico/20 de recepção, modelos, oito exclusões, 16 pedidos/14 decisões/nove listas antigas e a suíte D17 daquela revisão aprovados. Nenhuma família omitida nessa rodada; cleanup confirmado. `../custody-upgrade/TARGETED.json`: 38 grupos e 66 migrations, com a nova migration como overlay explícito, mesma baseline e limpeza confirmada.

`focused.json`: reteste posterior sobre `4185dd32feef0774d11cbdfdd287a02b9b2a36fb`, contendo D17 `9cad953`: **66 migrations/44 SQL**, duas ordens de instalação, 16 pedidos/14 decisões/nove arrays e suíte de assinatura atualizados aprovados, cleanup confirmado. A assinatura reproduz os controles de espera no 123 com/sem expiração e a recusa do paciente indireto em RC, operação já preparada, snapshot RR e intenção em andamento. Esse modo omite as sete famílias descritas no JSON; a rodada completa anterior não é reapresentada como execução delas nessa versão nova. O ciclo tupla/123 identificado na revisão permanece fora da suíte atual.

## Limites e continuidade

O recorte cobre INSERT autenticado legado. Não corta provisionamento service_role, UPDATE privilegiado de identidade legada, escopos preexistentes ou consumidores operacionais por si só. Não chama legado de aprovação, não executa backfill e não encerra M2/T31. Próximo passo: provisionamento como pedido pendente, protocolo durável e reconciliação/corte operacional, antes das APIs/UI de decisão e do piloto.

A suíte D17 congelada é uma regressão adicional, sem aprovar a integração da assinatura. Os dois contraexemplos de prazo/paciente indireto enviados às 15:26 foram corrigidos pelo Claude em `9cad953`. A revisão seguinte identificou uma inversão 123/tupla contra UPDATE clínico normal, enviada às 15:59 com fonte primária do PostgreSQL; é achado estático de concorrência, sem bypass de assinatura demonstrado. Tipos D17 seguem pendentes até fechar essa revisão. Nenhum arquivo de assinatura, os três helpers temporariamente delegados, PersonalMed ou SaaS foi alterado neste incremento. Prontuários privados e agendamento humano preservados.
