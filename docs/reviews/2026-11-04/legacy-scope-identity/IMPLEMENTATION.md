# T28 — impedir a transferência de uma permissão legada por UPDATE

04/11/2026. Migration `20261105010000`, reservada no ESTADO às 16:08 antes do arquivo. Incremento local, sem aplicação hospedada ou dados reais. **M2 continua aberta:** criação de grants pelo serviço, reconciliação dos escopos existentes e leitores sobre pedido+grant não são resolvidos por esta guarda.

## Problema e comportamento

A guarda de identidade anterior protegia apenas escopos já vinculados a um pedido. Para uma linha legada com `delegation_request_id=NULL`, não comparava clínica/recepção/médico de OLD/NEW. O contraexemplo executado foi um UPDATE de serviço que trocou o médico ativo, mantendo FKs válidas e sem decisão médica: transferia a permissão a outra identidade. A correção cobre também troca de conta de recepção e de toda a combinação de clínica/recepção/médico; essas negativas têm fixtures válidas próprias na suíte GREEN.

A nova guarda AFTER UPDATE compara somente `(clinic_id, staff_user_id, doctor_user_id)` de OLD/NEW e recusa qualquer mudança com `22023: Legacy delegation identity immutable`, independentemente de JWT/papel. Não consulta um snapshot para decidir essa imutabilidade. Executa depois das guardas anteriores de elegibilidade, custódia e pedido, preservando suas recusas específicas e a atomicidade da transação.

A identidade não inclui o ponteiro do pedido: a aprovação privada real pode adotar a mesma linha legada, de NULL para o UUID aprovado, mantendo os três identificadores. A validação anterior continua exigindo pedido aprovado e coerente; pedidos vinculados não podem ser destacados/reapontados. UPDATE sem mudança, no-op da lista antiga, remoção e desativação preservados. Nenhuma alteração de assinatura pública, coluna, RLS ou prontuário.

Transferência legítima requer outro pedido e aprovação para a nova identidade. **Este incremento não torna INSERT privilegiado legado seguro nem chama acesso antigo de anuência.** Não executa backfill, revogação em massa ou reconciliação e não move dados legais/identidades por inferência.

## Verificação

`RED.json` usa a primeira versão da suíte contra 65 migrations anteriores ao novo número e comprova que o UPDATE do serviço consegue mover o escopo a outro médico ativo. A falha dedicada é `P0001: Legacy scope identity moved`, não erro de setup ou função ausente. O laboratório foi limpo. Na versão GREEN, a suíte inclui as três transferências por serviço, escrita de proprietário sem JWT, preservação do registro, no-op, adoção por decisão médica real, ponteiro vinculado imutável, desativação e ACL privada da guarda.

O runner `scripts/test-reception-legacy-scope-identity.mjs` congela HEAD mais overlays próprios com SHA-256. Instala predecessoras → nova migration → dependentes na ordem real, incluindo D17 depois desta guarda. Aceita somente laboratório próprio, verifica/fixa Docker local, usa imagem em cache, rede interna, nenhuma porta publicada, deadlines e limpeza por rótulo de propriedade. Os 12 helpers são snapshots importados de pasta temporária própria; arquivos temporários removidos individualmente. Não importa código vivo do Claude.

Duas ordens de instalação executam um UPDATE sem mudança no mesmo backend antes do corte para aquecer os caches de relação/trigger, liberam os locks, estabelecem snapshot RC/RR e mantêm a instalação aberta. O observador comprova que o UPDATE antigo espera o instalador por `pg_blocking_pids`; depois do commit ele deve falhar com a recusa exata e manter o escopo original. **Não é prova de plano genérico preparado retido.** O comentário do helper foi esclarecido depois do congelamento da rodada completa, de “old UPDATE plan” para caches do backend, sem alterar código executável. Os hashes do relatório identificam a versão efetivamente executada.

Controles adicionais: instalação ocupada retorna `55P03`, snapshot RR já estabelecido retorna `25001`, sem função parcial e com definição anterior do setter preservada; default RR instala em transação READ COMMITTED. A fixture de cada ordem remove somente seu próprio escopo após as asserções, evitando interferência nas suítes seguintes.

Revisão adversarial local com contexto novo, somente leitura, não encontrou defeito concreto no contrato/guarda/provas. Identificou somente o comentário sobre plano preparado, esclarecido como acima. A revisão não executou banco de modo independente. Revisão externa dispensada pelo usuário.

Comandos:

- `node scripts/test-reception-legacy-scope-identity.mjs --red`.
- `node scripts/test-reception-legacy-scope-identity.mjs`: instalação, SQL e regressões concorrentes completas.
- `npm run test:db:custody -- --migration-overlay=20261105010000_reception_legacy_scope_identity.sql`: upgrade de custódia com a nova migration na ordem correta.
- `node --check` e `npm exec eslint --` nos dois novos scripts.

`verification.json`: **67 migrations/45 suítes SQL**, duas ordens novas de instalação RC/RR, 12 helpers congelados, sete injeções de falha nas fronteiras, regressões da fila, dez ordens da agenda, 20 cenários de lifecycle médico/20 de recepção, modelos, oito exclusões, 16 pedidos/14 decisões/nove listas antigas e a suíte D17 congelada aprovados. Nenhuma família omitida. Baseline `62965597396e98494d46db9944ee3b1874c16e18`; hashes conferidos, com a única diferença de comentário explicitada acima, e cleanup verificado.

`../custody-upgrade/TARGETED.json`: **38 grupos/67 migrations** na ordem real, com a nova migration como overlay explícito e a mesma baseline, cleanup verificado. Os dois scripts novos passaram sintaxe/lint. As alterações paralelas que Claude iniciou depois do snapshot em `digital_signature.sql`/`test-signature-concurrency.mjs` ficaram fora destes ensaios e não foram modificadas ou adicionadas ao commit do Codex.

Não houve mudança de app/Edge, geração de tipos, novo ensaio de navegador ou nova execução de testes unitários/build nesta rodada. A cobertura runtime desta alteração de banco é SQL/concorrência. D17 congelado entra somente como regressão adicional: o achado de inversão 123/tupla encaminhado ao Claude às 15:59 não está coberto pela suíte atual e não foi aprovado por este GREEN. Domínio do Claude/três helpers T33, PersonalMed e SaaS preservados.
