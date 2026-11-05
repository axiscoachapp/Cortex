# Produtor privado de reservas e intenções

Incremento local M2 após os produtores de nascimento e confirmação. [Contrato](../../../product/clinic-crm/PROVISIONING_CREATION_PRODUCER_CONTRACT.md). Nenhuma migration/API de produção, filiação, escopo, prontuário ou credencial foi alterada.

## Falha e proteção

O [RED](RED-v2.197.0.json) usa administrador Native AAL2 e clínica criada pela Data API. O procedimento recusa uma sessão inexistente, mas o proprietário e o serviço com grants transacionais conseguem inserir operation/intent prepared ligados a essa sessão e com prazo arbitrário de uma hora. As tentativas fazem rollback.

O papel NOLOGIN `provision_create_writer_lab` possui somente begin_intent. Recebe INSERT nas duas colunas fornecidas de operations, SELECT e INSERT nas oito colunas fornecidas de intents, além de UPDATE(phase) necessário ao FOR UPDATE do replay. A guarda do produtor de confirmação continua recusando que esse papel confirme. O acesso exists ao Auth passa a um leitor SECURITY DEFINER booleano; a instalação compara o corpo de begin_intent antes/depois e exige essa única substituição. Os outros cinco helpers mantêm seus donos e posições, incluindo chaves antes do relógio final.

Dois triggers INVOKER/ALWAYS recusam INSERT fora do produtor com P4109. A ordem conserva as chaves TRY e os erros anteriores de forma/vínculo P4103/P4104. Não concede acesso Auth, membros, CREATE de schema, DELETE/TRUNCATE ou privilégios administrativos ao produtor. A instalação aceita somente ledgers vazios e quiescentes em READ COMMITTED, com locks de tabela NOWAIT. Administradores capazes de DDL/SET ROLE ficam fora da ameaça.

## Verificação

Os GREENs [v2.197.0](v2.197.0.json) e [v2.189.0](v2.189.0.json) passaram **38 grupos por Auth, 76 no total**, com fontes finais iguais e cleanup conferido. [Resumo verificável](verification.json). Cada instalação aplica 69 migrations congeladas em `07508fa4fc72b6b2e17564f3b0d2e44fd9dad479`, mais overlays próprios capturados por hash: 27 grupos anteriores, cinco de reservas, três de confirmação e três de criação.

1. INSERT direto de proprietário/serviço é recusado nas duas tabelas; replica e GUC não mudam current_user. Formas/vínculos antigos continuam recusados pelo guard correspondente.
2. begin_intent, nascimento Native, confirmação e replay legítimos passam. O criador recebe P4107 ao tentar confirmar, apesar do UPDATE(phase) necessário ao lock. O leitor booleano distingue alvo presente/ausente.
3. Desabilitar somente cada guarda permite exatamente o INSERT correspondente; prova a linha inserida, faz rollback, comprova ausência e restaura ALWAYS/recusa. Allowlist efetiva exige sete funções, dez colunas INSERT e somente intents.phase para UPDATE. Grants indevidos de INSERT(phase) e EXECUTE(check_intent) invalidam a auditoria, revertida por rollback. Flags de papel, membros, donos, schema e ACL Auth são conferidos.

A revisão adversarial identificou fixtures antigas que a guarda nova mascararia: corrupção de nascimento, pai divergente e controles causais de espera no índice. O instalador agora usa SET ROLE explícito somente na preparação desses casos e nos controles com o trigger de chaves desabilitado. As requisições adversariais de serviço continuam com o papel real. Não apresentar a impersonação do DBA como permissão do serviço. A segunda leitura não encontrou questão concreta pendente; revisão externa dispensada pelo usuário. A revisão própria também substituiu uma contagem vacuamente verdadeira pela presença/ausência da linha exata nos controles.

```powershell
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --creation-red --source=07508fa4fc72b6b2e17564f3b0d2e44fd9dad479
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --session-fixture --birth-producer --reservation-keys --confirmation-producer --creation-producer --all --source=07508fa4fc72b6b2e17564f3b0d2e44fd9dad479
```

Sintaxe/ESLint dos quatro scripts aprovados. Docker local, imagens existentes sem pull, rede interna sem portas publicadas, labels próprios e remoção conferida. Sem nova suíte SQL geral, frontend, build ou navegador neste recorte. Os testes D17 desta rodada são outro incremento e não integram estas 76 provas.

## Próximo passo e limites

M2 permanece aberta: interface autorizativa do servidor, custódia/retenção e instalação/upgrade com histórico, recuperação, namespace externo do Auth, filiação/pedidos, corte/reconciliação/gate e API/UI. Os helpers de laboratório não são expostos ao cliente. A fonte congelada não inclui a entrega D17 paralela `13a39ad`. Somente dados sintéticos; sem PersonalMed/carregador/carga, hosted, envios, chamadas pagas, deploy ou push. Arquivos Claude/SaaS preservados.
