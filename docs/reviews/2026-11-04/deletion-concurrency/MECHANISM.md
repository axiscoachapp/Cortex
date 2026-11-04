# T27/2a — Reprodução de corridas e prova limitada do mecanismo

04/11/2026. Banco PostgreSQL 16 recém-criado em cada execução; fixtures sintéticas. Nenhuma mudança de código do aplicativo ou migration de produção. H2 permanece aberta.

## Resultado observado

As migrations atuais permitem confirmar intenção de exclusão junto com uma nova referência impeditiva nos quatro cenários abaixo. O teste de regressão estrito termina com código **1**, esperado até a correção real. Não foi incluído na suíte padrão nem foi alterada a asserção para aceitar a falha.

Um protótipo carregado apenas com `--prototype` obteve código **0**, com recusas e sobreviventes verificados:

| Ordem | Migrations atuais | Protótipo | Sobrevive no protótipo |
|---|---|---|---|
| Intenção → contato service-role com autor em exclusão | Ambas confirmadas | `55000`, exclusão em andamento | Intenção; nenhum contato novo |
| Caso não confirmado → tentativa de intenção → commit do caso | Ambas confirmadas | `40001`, contenção da versão | Caso; nenhuma intenção |
| Snapshot antigo da intenção → caso confirmado → intenção | Ambas confirmadas | `40001`, versão modificada | Caso; nenhuma intenção |
| Snapshot antigo da RPC pública → intenção confirmada → criação de caso | Ambas confirmadas | `40001`, versão modificada | Intenção; nenhum caso novo |

Comandos executados na raiz do repositório:

```powershell
node scripts/test-reception-deletion-concurrency.mjs
node scripts/test-reception-deletion-concurrency.mjs --prototype
node --check scripts/test-reception-deletion-concurrency.mjs
```

As duas primeiras variantes foram repetidas após endurecer o próprio ensaio: códigos/mensagens específicos por cenário e presença da transação sobrevivente são obrigatórios. Erros de permissão ou FK, ausência silenciosa de escrita e timeouts não contam como prova de segurança. Processos Docker e sessões têm limites de tempo. O programa não recebe URL, credencial ou nome de container externo; cria e limpa somente o container cuja criação confirmou.

## O que foi provado

A atualização real de uma linha de versão, obtida por `FOR UPDATE NOWAIT`, funcionou para essas quatro ordens. O trigger da intenção executa depois do advisory existente e antes do pré-check; contatos/casos verificam seus autores e médico depois da barreira, a partir dos valores finais. O protótipo está em `supabase/tests/prototypes/reception-deletion-epoch.sql`, fora da descoberta automática de migrations/suítes SQL.

O contrato completo está em `docs/product/clinic-crm/DELETION_CONCURRENCY.md`. A prova limitada não cobre as outras fontes de referência, exclusão de paciente, cascatas, idempotência/retomada, capacidade sob contenção nem lifecycle do marcador. Não publicar o protótipo como migration.

## Revisão e reconciliação

Revisão adversarial local, sem revisão externa conforme preferência do usuário. Dois requisitos adicionais foram classificados como válidos e incorporados ao contrato: FK restritiva de `shared_chart_entries.actor_user_id` omitida no pré-check e possibilidade de service-role remover/retargetar intenção. Nenhum deles é corrigido por serializar apenas as fontes limitadas do ensaio.

No harness, a revisão encontrou recusas genéricas demais, processos Docker sem limite e uma função exportada que aceitava nome de container como suposta prova de propriedade. Os três achados foram corrigidos: recusas exatas/sobreviventes, timeouts e remoção do ponto exportado. A última leitura não trouxe outro achado substantivo no escopo limitado.

## Próximo incremento

T27/2b, reserva `20261104002000`: cobertura completa de referências e intenção monotônica, seguida por testes de paciente, autoria distinta, recursos indiretos, cascata solo e retomada. Só então integrar o ensaio à suíte padrão e encerrar H2, antes de H1/editor. As suítes SQL/aplicação históricas não foram reapresentadas como nova execução nesta rodada.
