# Reservas concorrentes do provisionamento

Incremento M2 exclusivamente de laboratório. [Contrato e fontes PostgreSQL 16](../../../product/clinic-crm/PROVISIONING_RESERVATION_KEYS_CONTRACT.md). Nenhuma migration de produção, endpoint, concessão ou prontuário foi alterado.

## Problema e solução

`begin_intent` conferia os prazos antes de inserir no ledger. Duas clínicas independentes podiam passar nas verificações e disputar o mesmo UUID alvo; a segunda esperava no índice único depois do relógio final. O RED usa dois administradores distintos com TOTP/AAL2 e clínicas criadas pelas APIs reais locais. A espera pelo titular é observada via `pg_blocking_pids`; após o commit dele, o concorrente recebe23505 e não cria outra reserva. [RED](RED-v2.197.0.json).

O overlay `provisioning-reservation-keys.sql` adquire chaves de transação independentes por operação e alvo com TRY, antes do relógio final. Triggers ALWAYS nas duas tabelas participam tanto em INSERT quanto UPDATE, inclusive no-op e fase/XID do nascimento nativo. As guardas anteriores de imutabilidade, produtor de nascimento e histórico continuam ativas. Nenhuma permissão nova é exposta aos clientes; o instalador só aceita ledgers vazios/quiescentes em READ COMMITTED com lock de tabela NOWAIT.

Em contenção, a transação recebe40001 e precisa terminar antes da nova tentativa. Chaves distintas continuam progredindo. Colisões de hash64 causam recusa conservadora, não adoção de identidade; não há singleton global.

## Provas

Cada GREEN preserva os 27 grupos anteriores de composição/birth/ledger e acrescenta cinco grupos:

1. Dois contextos nativos independentes disputam alvo ou operação; ambos recebem40001 sem esperar. Uma reserva de chaves distintas conclui enquanto o titular original continua aberto. Após commit, replay exato conserva todos os vínculos e o prazo; outro ator não adota a operação.
2. Rollback libera as chaves. O segundo administrador reserva o alvo, obtém receipt de nascimento Auth real, confirma com seu próprio contexto e mantém o prazo no replay.
3. INSERT direto de serviço com grants transacionais é recusado40001 nas duas tabelas, também em replica e quando o pai ainda está invisível. O serviço não recebe SELECT de Auth.
4. UPDATE no-op de linha persistida também segura a chave, impedindo que um INSERT duplicado espere no xmax do updater.
5. Desativar somente cada novo trigger, uma tabela por vez, restaura a espera real no índice; restaurar ALWAYS recupera a recusa. Chaves nulas e EXECUTE para clientes permanecem negados.

Os relatórios [v2.197.0.json](v2.197.0.json) e [v2.189.0.json](v2.189.0.json), resumidos em [verification.json](verification.json), registram **32 grupos por versão (64 ao todo)**, GREEN e cleanup aprovados. São 27 regressões e cinco grupos novos por instalação. Migrations congeladas no Git em `851b64c8a00e3917138ac5a44ad49c717cc70dfe`; overlays próprios capturados e conferidos por hash, iguais nas duas versões. A projeção tipada Native e ACL/owners/enums/RLS dos objetos Auth conservam os controles anteriores. O teste final verifica que os alvos não ganharam membros de equipe, pacientes, consultas ou delegações.

## Revisão

A revisão adversarial do desenho encontrou duas lacunas, ambas corrigidas antes do GREEN: o trigger deve preceder `intent_binding` para tentar a chave antes de consultar um pai invisível; e proteger só INSERT deixa UPDATEs permitidos provocarem espera no índice único. Por isso os triggers se chamam `aa_reservation_keys`, UPDATE usa a identidade OLD e `check_intent` também antecipa sua aquisição antes do relógio. A segunda revisão do código/provas não encontrou outro defeito concreto. Revisão externa dispensada pelo usuário.

O RED foi executado antes da implementação e repetido com as fontes finais. Um GREEN inicial de uma versão antecede a matriz final; não somar essa repetição aos grupos únicos da matriz.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --reservation-red --source=851b64c8a00e3917138ac5a44ad49c717cc70dfe
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --all --source=851b64c8a00e3917138ac5a44ad49c717cc70dfe
```

## Limites

Não autentica todos os escritores de INSERT/confirmar, não fecha a disputa externa pelo namespace de identidades Auth e não entrega custódia, retenção, instalação/upgrade com histórico, credencial inicial/recuperação, filiação/pedidos, corte/reconciliação ou gate/API/UI. M2 continua aberta. Sem dados reais, carregador PersonalMed, serviço hospedado, mensagens externas, chamadas pagas, publicação ou push.

Esta rodada não repete suítes SQL gerais da raiz, testes globais do aplicativo, frontend/build ou assinatura D17; são instalações das 69 migrations e provas Native dirigidas. As novas disputas usam o isolamento padrão READ COMMITTED do laboratório; casos RC/RR anteriores foram repetidos nas 27 regressões, sem alegar nova matriz de reservas RR ou teste de instalação com histórico. Docker local verificado, imagens existentes sem pull, rede interna sem portas publicadas, recursos com labels próprios e remoção conferida nos relatórios. Nenhum arquivo Claude/SaaS alterado.
