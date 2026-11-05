# T28/M2 — geração da autoridade na filiação real

04/11/2026. Prova restrita do [contrato](../../../product/clinic-crm/PROVISIONING_MEMBERSHIP_GENERATION_CONTRACT.md), após o vínculo nativo de sessão/fator de `2f0a155`. Snapshot SQL congelado `428d5408be0a04fad0d5da8de32dd437d4c7e0b4`. **Somente laboratório; nenhuma migration, API ou regra de produção foi alterada.**

## Resultado

[RED.json](RED.json): o guard atual, válido como checagem de autoridade presente, aceita novamente o mesmo administrador depois de admin → doctor → admin. Sem vínculo de geração, ele sozinho não distingue uma intenção anterior à perda. O executor exigiu recusa, falhou com a mensagem específica de ABA e limpou os recursos. É refutação do candidato baseado só no estado atual, não declaração de que esse guard isolado já implementava a futura intenção.

[verification.json](verification.json): **17 grupos aprovados**, com 69 migrations reais instaladas e duas suítes SQL dirigidas aprovadas (`reception-provisioning-requests`, `reception-delegation-requests`). Hashes das fontes/protótipo/executores e cleanup confirmados. Bootstrap Auth mínimo, papéis SQL e fixtures sintéticos; **não houve Auth HTTP/MFA real nesta rodada**. Os ensaios nativos anteriores permanecem separados.

O protótipo adiciona um UUID de geração à linha real de `clinic_members`. O trigger deriva o valor no INSERT e quando mudam clínica, usuário, papel ou status, conservando-o no no-op. Um valor fornecido pelo escritor nunca restaura uma geração. DELETE/INSERT cria outra, inclusive se o escritor copiar o UUID antigo. Não cria ledger duplicado: a futura intenção deverá conservar a geração capturada no seu próprio registro.

Os helpers privados passam pelo **guard existente** `reception_provisioning_admin`: conta Auth atual, T33 real e filiação atual cercadas antes de comparar a geração. Ler/checar não muda essa geração, embora a barreira de custódia possa avançar. Nenhuma filiação de recepção, concessão, pedido ou dado clínico é criado por esses helpers.

## Evidências dos 17 grupos

- Instalação ocupada recusa sem esperar e não deixa coluna/schema/helpers; instalação em snapshot RR estabelecido recusa antes do DDL parcial. Membros existentes recebem gerações distintas.
- NULL, clínica/ator divergentes e contexto sem papel de serviço recusados; geração atual aceita.
- Timestamp, UUID fornecido e upsert sem mudança de autoridade preservam a geração. Papel/status ABA, ida e volta na mesma transação e DELETE/recriação recusam o UUID antigo; geração nova só funciona sob autoridade atual.
- UPDATE de serviço usa `RETURNING`, comprovando que atingiu a linha e que o trigger conservou o valor. UPDATE direto autenticado continua recebendo **42501 da ACL da tabela**, sem novo GRANT; não é atribuído ao trigger.
- Mutação real da filiação em outra conexão, ainda aberta, recusa a checagem sem espera. Snapshot RR anterior ao ABA confirmado recebe **40001** pela T33. Mudança de outro administrador/clínica não bloqueia nem invalida este vínculo.
- Na ordem inversa, o escritor foi **observado esperando no backend** enquanto a checagem curta mantinha a filiação cercada; depois do commit da checagem ele concluiu, e o vínculo anterior recusou. Não é corrida inferida por sequência de chamadas.
- Conta sintética com filiação válida e sem custódia impeditiva recebe intenção real de exclusão; o guard existente recusa sua geração. ACL privada, zero scopes e definições originais de T33/guard preservadas.

Os testes de NOWAIT observam `pg_stat_activity` e o PID do holder próprio. Dois controles retiram NOWAIT: da trava de instalação e da seleção da filiação no guard existente. Ambos **esperaram de fato**, foram cancelados pelo executor na base própria e as definições foram restauradas/comparadas. O guard entregue e os três helpers T33 do Claude não mudaram. Não basta obter 55P03/40001 após um `lock_timeout` para chamar a prova de não bloqueante.

## Execução e revisão

```text
node scripts/test-provisioning-membership-generation.mjs --red --source=428d5408be0a04fad0d5da8de32dd437d4c7e0b4
node scripts/test-provisioning-membership-generation.mjs --source=428d5408be0a04fad0d5da8de32dd437d4c7e0b4
node --check scripts/test-provisioning-membership-generation.mjs
node --check scripts/test-provisioning-membership-generation-cases.mjs
./node_modules/.bin/eslint.cmd scripts/test-provisioning-membership-generation.mjs scripts/test-provisioning-membership-generation-cases.mjs
```

O modo RED termina com erro esperado; seu hash identifica o executor antes da ampliação GREEN. O modo atual conserva a reprodução. Rede Docker interna nova, endpoint local verificado, imagem em cache sem pull, nenhuma porta/rota externa, cleanup por label própria e ausência conferida. Helpers próprios são congelados em memória antes de executar; o relatório só aceita hashes inalterados. Nenhum segredo ou dado real foi usado.

Revisões locais em contexto novo: contrato sem achado acionável; implementação revelou a expectativa errada de escrita autenticada e a lacuna de provar NOWAIT só por SQLSTATE. Ambas corrigidas e revistas. Uma fixture preliminar de exclusão foi corretamente recusada com P4091 porque era criadora de clínica; foi substituída por membro sintético sem essa custódia, sem mudar o preflight. A rodada final reexecutou todos os 17 grupos e as duas suítes. Sintaxe/lint aprovados; revisão externa dispensada conforme preferência do usuário.

## Limites e próximo incremento

Geração é vínculo histórico da **filiação**, não autenticação humana, prova de MFA/credencial, autorização clínica ou confirmação de identidade Auth. Ainda falta compor esse valor com o contexto nativo de sessão/fator/prazo e receipt, proteger o ledger/instalação/custódia da intenção e definir retomada/reconciliação. Mudanças históricas de `account_type`, credencial ou MFA não são invalidadas por esse UUID. A coluna pública existe só na base descartável; tipos/API e compatibilidade de produção ainda precisam de desenho/verificação.

Não foram repetidos Auth nativo, 47 SQL globais, concorrência de provisionamento/delegação ou upgrade T33; não é rodada global GREEN nem fechamento de M2/T31. Próxima fatia: composição dos vínculos já provados antes de filiação sem concessão automática e corte do produtor legado. PersonalMed, SaaS e domínio do Claude preservados. Sem carga, envio, certificado, chamada paga, banco hospedado, deploy ou push.
