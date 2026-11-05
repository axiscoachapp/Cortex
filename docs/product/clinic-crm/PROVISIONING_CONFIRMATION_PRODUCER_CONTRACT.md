# Produtor privado da confirmação — laboratório M2

Recorte local sobre a composição Native e as chaves de reserva. Não é migration, API ou autorização de carga/provisionamento de produção.

A fase `intents.prepared → confirmed` só pode ser produzida por `check_intent`, após as verificações atuais de ator, sessão, fator, filiação/geração, receipt vivo e prazos. Um escritor direto de tabela, inclusive proprietário/serviço com grants temporários, não pode substituir essas verificações por UPDATE de fase. No-op continua permitido, vínculos/prazos/histórico continuam protegidos e confirmed não volta a prepared.

Proposta: papel privado `provision_confirm_writer_lab`, NOLOGIN/NOINHERIT, sem membros, privilégios administrativos, BYPASSRLS ou acesso às tabelas Auth. Ele passa a possuir somente a função SECURITY DEFINER `check_intent` existente, sem mudar seu corpo. Recebe SELECT e UPDATE(phase) em intents, USAGE dos três schemas de laboratório e EXECUTE somente dos helpers de contexto/geração/receipt/prazo/chaves usados pela função. Não recebe INSERT/DELETE/TRUNCATE nem propriedade de tabela/schema.

Um trigger BEFORE UPDATE/ALWAYS, SECURITY INVOKER, identifica o produtor por `current_user`, nunca por JWT/GUC. Mudança de fase por outro papel recebe P4107; o produtor só pode fazer prepared→confirmed (P4108 nas demais mudanças). No-op não exige o produtor, mas passa pelas guardas de imutabilidade existentes. A função principal já adquiriu as chaves de reserva antes do relógio final; o novo guard não adquire outro lock.

A instalação exige ledgers vazios/quiescentes em READ COMMITTED, com locks de tabela NOWAIT. Nenhum USAGE/EXECUTE novo é concedido aos clientes. DDL/impersonação de papéis por DBA está fora da ameaça, como no produtor de nascimento; não alegar que um proprietário de função seja incapaz de alterá-la. O serviço não tem filiação ao papel privado.

## Provas

- RED com ator Native AAL2/clínica reais: intenção prepared sem identidade alvo/receipt; UPDATE direto de proprietário e serviço consegue confirmed, enquanto o procedimento autorizado recusa por ausência de receipt. Rollback conserva a fixture.
- GREEN recusa ambos com P4107, inclusive replica e GUC falso de papel; não cria identidade, filiação ou prontuário. No-op permanece válido.
- Nascimento Native legítimo seguido de `check_intent` confirma, conserva o prazo no replay e mantém o corpo original das verificações. Controles anteriores de logout/ABA/alvo removido/prazos e reservas concorrentes são repetidos.
- Papel privado/ACL/owner mínimo conferidos, regresso de fase recusado mesmo sob SET ROLE feito apenas pelo instalador de teste. Remover só o novo guard deve expor o UPDATE indevido; rollback restaura a recusa.
- Duas versões locais do Auth, migrations congeladas, sintéticos, hashes e cleanup.

## Limites

INSERT de reservas/intents ainda não é autenticado por este recorte. Tampouco resolve custódia/retenção/instalação com histórico, credencial/MFA/recuperação histórica, namespace externo do Auth, filiação/pedidos, corte/reconciliação/gate ou API/UI. O contexto continua sendo entrada confiável apenas após validação real do bearer no servidor; não expor a função diretamente ao cliente. M2 permanece aberta, sem dados reais, PersonalMed, hosted, envio, provedor pago, deploy ou push.

## Fontes PostgreSQL16 conferidas

[CREATE FUNCTION](https://www.postgresql.org/docs/16/sql-createfunction.html) distingue o contexto INVOKER do DEFINER e recomenda restringir EXECUTE das funções privilegiadas. [current_user](https://www.postgresql.org/docs/16/functions-info.html) identifica o contexto de execução, que muda durante SECURITY DEFINER. A guarda deve ser INVOKER para observar o produtor, enquanto os leitores privilegiados mantêm seus donos anteriores. A prova compara a lista efetiva de EXECUTE/UPDATE às permissões esperadas, com grants indevidos transacionais como controles.
