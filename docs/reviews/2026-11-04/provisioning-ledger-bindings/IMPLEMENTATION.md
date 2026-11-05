# M2 — vínculos do ledger protegidos contra substituição por DML

04/11/2026. Incremento de laboratório do [contrato de vínculos](../../../product/clinic-crm/PROVISIONING_LEDGER_BINDINGS_CONTRACT.md), após a composição nativa. Sem migration ou mudança de autorização de produção.

## O que muda

`provisioning-ledger-bindings.sql` acrescenta guards privados em banco vazio. Operação/UUID/revisão e XID já capturado não podem mudar. Na intenção, somente phase varia: ator, clínica, sessão, fator, prazo, geração e identidade permanecem fixos. INSERT começa prepared e precisa corresponder à operação/UUID reservado, cercado NOWAIT. DELETE e TRUNCATE recusam, impedindo apagar e recriar a chave para renovar o vínculo. Triggers ALWAYS também cobrem DML em replica, sem GUC de liberação.

O controle de falha desabilita apenas o trigger do laboratório dentro de transação, observa aumento indevido do prazo e desfaz a mudança. Com o trigger ativo, a mesma escrita recusa. Os testes exigem SQLSTATE dedicado do guard; para service_role, concedem DML/USAGE temporariamente e fazem rollback, distinguindo o guard da ACL. No-op e nascimento/confirmação/replay nativos continuam exercitados.

## Evidências finais

| Execução | Resultado |
|---|---|
| Auth v2.197.0 | 23 grupos aprovados |
| Auth v2.189.0 | 23 grupos aprovados |

Cada rodada instala 69 migrations congeladas em `4a232f38bee721f75361be76c0583276db75065d`, conserva os 19 grupos da composição e adiciona quatro grupos de integridade. Há mutação campo a campo por owner e serviço com concessão temporária, INSERT indevido, no-op, DELETE/TRUNCATE, replica e controle com rollback. TOTP/AAL2, clínica pela Data API, nascimento, exclusão/metadata nativos, snapshots RC/RR, logout e relógios continuam cobertos. Não executar sobre banco existente/externo.

Relatórios: [v2.197.0](v2.197.0.json), [v2.189.0](v2.189.0.json). Ambos têm `ledgerBindingsProofPassed=true`, `compositionProofPassed=true`, hashes e cleanup confirmados: **46 grupos ao todo**. O executor congela bootstrap/migrations, helper e SQL próprio, compara hashes ao final e grava nova pasta; provas históricas anteriores permanecem preservadas.

```text
node scripts/test-initial-password-auth.mjs --provision-clinic --ledger --all --source=4a232f38bee721f75361be76c0583276db75065d
node --check scripts/test-initial-password-auth.mjs
node --check scripts/test-provisioning-clinic-authority.mjs
npx eslint scripts/test-initial-password-auth.mjs scripts/test-provisioning-clinic-authority.mjs
```

Sintaxe/lint aprovados. Leitura adversarial local do contrato/SQL/testes sem achado concreto no escopo delimitado; sem execução pelo revisor. Revisão externa dispensada pelo usuário. Não foram repetidos SQL gerais, upgrade, frontend/build ou unitários D17 nesta rodada.

## Limites restantes

**Não prova a autoridade de todo produtor de INSERT ou de toda transição de phase.** Não interpretar phase isolada como autorização. Reservas concorrentes de UUID/índice, custódia e retenção/exclusão de produção, instalação com dados/tráfego, histórico de credenciais/Auth/recuperação, filiação/pedidos e corte do serviço continuam pendentes. A instalação exige tabelas vazias; não é ponte de upgrade. Quem controla DDL continua podendo remover guards; o modelo deste ensaio limita o escritor a DML.

A recusa de DELETE é só regra experimental; não é política LGPD do produto. Nenhum prontuário, campo legal, loader/PersonalMed, SaaS, arquivo do Claude ou seus três helpers T33 foi alterado. SQL/Auth/PKI são sintéticos, containers próprios em rede interna sem portas/rota externa; sem serviço pago, hosted, emissão, envio, publicação ou push.
