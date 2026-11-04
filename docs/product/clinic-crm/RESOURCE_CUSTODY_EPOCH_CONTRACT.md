# T33/2 — proposta de barreira por recurso e conta

Estado: implementação local na migration `20261104200000_reception_scoped_custody.sql`, com prova de runtime e upgrade. Publicação hospedada pendente. O candidato somente por conta de T33/1 permanece rejeitado e preservado como contraexemplo. Evidências: `docs/reviews/2026-11-04/custody-upgrade/IMPLEMENTATION.md`.

## Mecanismo

Além do epoch da conta, manter uma versão privada por chave `tipo:uuid` de paciente, compromisso, consulta, documento de conhecimento e modelo de documento. Essas chaves incluem recursos ainda ausentes e modelos sem dono. Não guardar conteúdo, nome, contato ou credencial. Sem FK/cascade na versão; manter tombstones mínimos. Retenção/limpeza exigem análise separada.

Cada toque adquire `pg_try_advisory_xact_lock` da chave com namespace próprio, inicializa a versão se necessário, obtém a linha com `FOR UPDATE NOWAIT` e incrementa a revisão. O advisory sem espera deve preceder INSERT/ON CONFLICT, evitando esperar uma criação concorrente da mesma chave. Em snapshot antigo, conflito de inicialização ou versão atualizada deve abortar, nunca ignorar proteção. Chaves distintas não disputam uma linha global; mesma chave ainda pode recusar operações concorrentes, mesmo entre contas distintas que compartilham esse recurso.

Na guarda AFTER ROW, tocar primeiro recursos diretos de NEW/OLD e a identidade dos cinco tipos de pai. Em seguida, resolver pacientes indiretos de compromisso/consulta já protegidos e tocar suas identidades. Só então coletar/tocar contas e manter a revalidação/checagens de intenção do protótipo anterior. Atualizações de pai, incluindo dono NULL→conta, disputam a mesma chave dos filhos. DELETE dos cinco pais também toca o recurso e a conta anterior, sem revalidar referências já removidas em cascata.

Inicializar epochs de conta BEFORE INSERT em auth.users, antes de possíveis gatilhos AFTER que criem configurações. A trigger precede o preenchimento das contas existentes. Preservar wrapper sem argumento estrito em auth.uid para modelos próprios; outros caminhos usam contas explícitas. Nenhuma alteração nos arquivos do Claude ou permissões de clientes.

## Aceite

Reproduzir e recusar os dois contraexemplos T33/1 em ambas as ordens. Provar READ COMMITTED e REPEATABLE READ, chave ausente/linha inicializada depois do snapshot, duas inicializações concorrentes, mudança/retirada de referência OLD e segundo nível paciente. Demonstrar escritores independentes e cascatas reais. Provar ACL privada, falta de conta fechada e nenhuma dependência do singleton. Reexecutar SQL e concorrência de exclusão, agenda, lifecycle e modelos antes de reservar migration. Nenhuma carga real/importação, publicação ou retry silencioso de efeitos externos.

## Instalação implementada após prova do runtime

Migration local `20261104200000`: em uma única transação explicitamente READ COMMITTED, primeiro bloquear com NOWAIT e incrementar a linha do singleton antigo. Uma intenção/escritor que já passou pela barreira antiga impede a instalação até concluir; escritores antigos posteriores devem recusar, sem coexistir com guardas novas. Em seguida, obter SHARE ROW EXCLUSIVE NOWAIT em todas as tabelas com `custody_reference`, `account_deletion_requests`, `clinic_members`, `document_snippets` e `auth.users`, antes de mudar funções/instalar gatilhos. Criar a inicialização BEFORE uma única vez, sem DROP TRIGGER que exigiria AccessExclusive atrás de leitores. Falha em qualquer aquisição aborta também o incremento inicial e permite repetição integral pelo executor; não realizar retry automático.

Manter os locks até COMMIT. Assim também não há espera de DDL atrás de escritor que ainda não chegou à barreira antiga. Provar intent antigo aberto, escritor de modelos sem INSERT ainda, escritor anterior com lock de tabela mas sem toque do singleton, rollback integral e repetição após commit/rollback do holder. Depois da instalação, prender o singleton antigo e demonstrar escrita nova normal sem dependência dele. O singleton retido é somente histórico de instalação; as guardas novas não o consultam.
