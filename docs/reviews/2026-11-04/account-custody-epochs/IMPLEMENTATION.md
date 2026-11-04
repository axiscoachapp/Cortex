# T33/1 — colisão global reproduzida e particionamento insuficiente

04/11/2026. Ensaio local exclusivamente sintético em PostgreSQL descartável. Nenhuma migration de produção, permissão do aplicativo, dado hospedado ou arquivo do Claude alterado.

## Resultado e decisão

A barreira atual recusa com `40001` um segundo escritor de rascunho de **outra conta**, enquanto o primeiro mantém sua transação aberta. A referência compartilhada entre eles é somente o singleton global. A reprodução usa duas conexões reais com confirmação explícita de que o primeiro INSERT já terminou e ainda não houve commit.

O protótipo por conta permite as duas escritas independentes e conserva a recusa de sobreposição da mesma conta. Porém, **somente dividir por conta não substitui o singleton com segurança**. Dois novos contraexemplos persistem intenção de exclusão junto com uma referência ainda não visível ao preflight:

1. Uma auditoria de `resource_id` ainda sem compromisso permanece aberta. Outra conexão cria o compromisso privado desse ID e marca seu médico para exclusão; a primeira confirma depois. A auditoria não conhecia a conta futura e segurava somente a versão do próprio autor.
2. Uma configuração que aponta um modelo built-in de dono nulo permanece aberta. Outra conexão atribui o modelo a uma conta e marca essa conta para exclusão; a configuração confirma depois. Não havia conta inicial do modelo para a primeira escrita proteger.

O relatório marca `candidateRejected:true`; o SQL fica em `supabase/tests/prototypes/` como contraexemplo. **A proteção global continua no aplicativo.** Próximo incremento: proteger também a identidade dos recursos ausentes/com dono nulo, com versão real e aquisição sem espera, antes de propor migration. Não remover esses fluxos legítimos para fazer o ensaio passar.

## Prova adicional da revisão

O revisor local encontrou a troca de dono B→C entre a coleta de referências e o toque dos epochs. O ensaio pausa o coletor após o primeiro lookup, observa a espera em `pg_locks`, altera o dono e só então libera o escritor. Sem revalidação, a intenção da conta nova e a configuração persistem. Com nova resolução de NEW+OLD após o toque, a mudança do conjunto aborta com `40001` dedicado. Essa correção está apenas no protótipo e não resolve os dois casos de ausência acima.

Outras verificações dirigidas: destinatário compartilhado, retirada da referência OLD, inicialização de contas novas/preenchimento das antigas, linha de epoch ausente, wrapper sem ator, tombstone após cascade real e duas intenções independentes. `pending`/RLS/credenciais iniciais de T31 não foram alterados.

## Execução e limites

Comando: `node scripts/test-account-custody-epochs.mjs`. Resultado agregado em `RESULT.json`; o arquivo só é emitido depois das regressões e da limpeza. O bootstrap simula as funções mínimas da Supabase; o banco/locks/transações/RLS são reais. Não é o Auth nativo nem ensaio hospedado.

O runner verifica/pina endpoint Docker local, cria container/rede próprios com labels, usa imagem já em cache, rede interna e nenhuma porta ou volume montado. Não aceita banco/argumentos externos. Identidades, contatos e conteúdos são fixtures sintéticas do repositório. Remoção exige ownership por label.

Execução final aprovada como **ensaio de reprodução/rejeição**, com 13 grupos dirigidos, 57 migrations/36 suítes SQL, sete falhas injetadas de fronteira de funções, regressões da recepção, dez ordens de agenda, 20 interleavings de lifecycle, modelos de receita e oito ordens de exclusão. Cleanup confirmado. `npm run test:db` também passou no predecessor atual (57/36 e suas regressões). Sintaxe dos scripts, eslint direcionado e diff sem erro. Nenhum teste de navegador/React necessário neste incremento sem interface.

A sonda da suíte de custódia mede a revisão da conta alvo quando o protótipo existe e mantém o singleton no modo atual. Preserva a checagem da ordem real e os dois caminhos BEFORE INSERT/UPDATE do upsert. O helper de exclusão ganhou export para o runner próprio; o caminho standalone continua criando seu banco. Esperas/consultas do helper de concorrência da recepção receberam deadlines para uma falha não deixar o runner preso antes da limpeza.

Uma execução parou no INSERT de 2.500 contatos ao atingir o teto de 5 s do harness. O ensaio funcional desse volume usa agora orçamento explícito de 25 s; corridas dirigidas mantêm 5 s. O resultado registra tempos de predecessor/protótipo dessa fixture, sob carga local sem controle. A medição serve como sinal para T25; não comprova desempenho do piloto.

Na execução final essa fixture levou 15.254 ms no predecessor e 12.836 ms no protótipo, incluindo transporte do processo Docker. T25 deve medir preparação em lote separadamente de escrita interativa; esse custo permanece uma limitação observada, sem otimização feita nesta rodada.

Três leituras adversariais locais identificaram as corridas, a ausência de SQLSTATE verbose no teste e a espera sem prazo no helper. O candidato foi rejeitado; revisão do ensaio não é aprovação de produção. O revisor não executou testes. Revisão externa dispensada pelo usuário.

Contrato e semântica: `docs/product/clinic-crm/ACCOUNT_CUSTODY_EPOCH_CONTRACT.md`, [locks PostgreSQL 16](https://www.postgresql.org/docs/16/explicit-locking.html) e [isolamento PostgreSQL 16](https://www.postgresql.org/docs/16/transaction-iso.html).
