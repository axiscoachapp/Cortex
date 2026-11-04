# T28/2b/2b — prova dirigida do protocolo de pedidos

04/11/2026. **Protótipo de laboratório, não correção de produção.** Fonte em `scripts/prototypes/reception-consent-protocol.sql`; não está em `supabase/migrations/` e não muda a autorização do aplicativo. Nenhum número de migration foi consumido. Contrato de destino: [anuência médica](../../../product/clinic-crm/DOCTOR_DELEGATION_CONSENT.md).

## Execução e fronteira

Comando: `node scripts/test-reception-consent-protocol.mjs`. Somente dados sintéticos, base nova descartável em PostgreSQL/pgvector 16, sem conexão ao Supabase hospedado ou exportação do PersonalMed. O runner não aceita alvo/argumento, recusa override de Docker, verifica/pina pipe/socket local, usa imagem em cache, rede interna e nenhuma porta publicada. Confere propriedade por label antes de limpar container/volume/rede. Resultado só é escrito depois do cleanup.

Bootstrap e migrations são capturados de um único commit Git imutável antes da criação do banco. Protótipo SQL e harness têm hashes no relatório. O laboratório aplica o schema completo desse commit e cria um schema separado, com tabelas sem acesso de cliente e funções de teste explícitas. Não altera RPCs de produção, tipos, prontuários, agenda ou dados legais.

O bootstrap usa fixtures SQL de `auth.uid/role` e fatores MFA; as guardas SQL são executadas, mas não há validação de JWT ou login/MFA no serviço Auth nativo nesta prova. Fluxo de credencial/sessão e sua integração continuam na T31.

`verification.json` registra a execução final: **61 migrations aplicadas, 24 verificações dirigidas e cleanup confirmado**. Não executa as suítes SQL gerais (`sqlSuites: 0`); estas contagens não substituem regressões do futuro backend. Sintaxe Node e eslint do runner aprovados. Sem build/typecheck de frontend por esta prova isolada.

Hashes do SQL/harness conferidos contra os arquivos após a execução; 119 links locais em seis documentos sem destino ausente e `git diff --check` aprovado. Nenhuma entrada nova/alterada do Claude ficou sem tratamento na conferência final do checkpoint.

## Evidência obtida

O RED usa a RPC pública `clinic_access` e mostra que o setter atual concede a agenda de outro médico sem uma aprovação médica registrada. O teste exige sua mensagem de asserção específica, não qualquer falha de permissão. Ao final, confirma novamente que o setter antigo continua capaz de conceder e que uma aprovação no modelo **não** cria `staff_doctor_scopes`. M2 permanece aberta.

No modelo, pedido e concessão têm identidades separadas. UUID/revisão não podem ser reapontados; estados terminais não reabrem. Só o médico de destino decide, com sessão/MFA e conta disponível; admin, outro médico e recepção são recusados. Escopo pendente é ineficaz. Payload diferente com mesmo UUID de operação falha, repetição idêntica não duplica o registro e resultado antigo de aprovação não restaura uma revogação.

Inativação e reativação de recepção/médico encerram pedidos pendentes **e** aprovados, não só escopos. Remoção direta da concessão do modelo encerra o pedido aprovado e sua reinserção é recusada. Isso não prova ainda a integração com todos os escritores privilegiados e recursos operacionais.

Oito ordens concorrentes reais cobrem aprovação contra inativação de recepção/médico nos dois sentidos em READ COMMITTED e REPEATABLE READ. A espera na linha é confirmada por `pg_blocking_pids` antes de liberar o detentor. No sentido inverso, o epoch existente recusa sem esperar, com `40001`; a repetição integral após commit revoga pedido/concessão. Não há espera cega nem aceitação de deadlock como sucesso.

## Revisão e correções

Hipótese submetida: no recorte de pedidos/decisões, vincular instância/revisão e usar os epochs existentes permite invalidar pendentes/aprovados no ciclo da conta, sem reaproveitar a concessão. Revisor independente recebeu artefatos/contrato e restrições, sem este raciocínio; revisão externa dispensada pelo usuário.

| Achado válido | Correção e disproof executável |
|---|---|
| Função compartilhada de lifecycle retornava `NULL` também em BEFORE DELETE, suprimindo remoção de filiação sem pedido | `RETURN OLD` em DELETE. Falha injetada reproduz retenção indevida; rollback restaura função/dados. Caso positivo remove recepção e médico sem pedido |
| Médico comum não conseguia repetir sua revogação após perder resposta, pois o estado terminal era negado antes do ledger | Permitir que o próprio médico reconheça a operação registrada em `revoked`, mantendo recusa de nova transição terminal. Falha injetada reproduz `42501` no segundo chamado e rollback integral; versão corrigida devolve o mesmo resultado e um único registro |

Segunda leitura local sem novo achado nesses ajustes. Revisor não executou banco e não aprovou produção. O teste inicial do RED tentou um helper privado e foi corretamente recusado; o harness passou a usar a RPC pública. A montagem inicial da falha injetada também precisou do terminador após `pg_get_functiondef`; nenhuma dessas falhas foi contada como RED de segurança ou execução final aprovada.

## Limites e próxima etapa

`can_operate` é apenas um predicado do snapshot da fixture. **Não copiar como gate de autorização**, especialmente para transações RR já abertas. Não há prova de revogação nos leitores/escritores reais, implantação frente a versões antigas, corte de `set_reception_scopes`/provisionamento, reconciliação, inventário completo de custódia/retenção, liberação de fila ou fluxo de credenciais. Concorrência de criação/retirada/duas decisões, matriz completa entre clínicas e todos os escritores privilegiados ainda precisam da prova correspondente. Não há API/DTO/UI nova no app.

Próximo incremento: implementação do backend conforme o contrato, reservando migration antes; provas de instalação, consumidores antigos/novos e regressões reais antes da UI. Não promover este modelo diretamente a migration. T34 e T31 continuam separados; nenhuma carga, mudança de campo legal, envio, emissão, chamada paga ou publicação.

Referências primárias conferidas: regras de retorno e ordem de triggers em [PostgreSQL 16 — Trigger Behavior](https://www.postgresql.org/docs/16/trigger-definition.html); snapshots de funções em [Function Volatility](https://www.postgresql.org/docs/16/xfunc-volatility.html) e limites dos níveis de isolamento em [Transaction Isolation](https://www.postgresql.org/docs/16/transaction-iso.html). As provas locais acima verificam o comportamento do candidato, não uma garantia derivada só da documentação.
