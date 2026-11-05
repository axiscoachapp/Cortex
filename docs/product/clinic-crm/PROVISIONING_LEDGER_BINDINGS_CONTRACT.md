# M2 — vínculos imutáveis do ledger no laboratório

04/11/2026. Próxima fatia após a composição nativa: proteger a identidade já registrada e impedir sua substituição por DML. Somente protótipos privados, sem migration, fachada ou autorização de produção.

## Escopo testável

- `operations`: operação, UUID alvo e revisão são imutáveis. Depois de capturado, o XID de nascimento não muda nem volta a NULL. INSERT começa prepared, revisão 1, sem nascimento.
- `intents`: somente phase pode variar; operação, UUID alvo, ator, clínica, sessão, fator, prazo e geração da filiação são imutáveis, inclusive por escritor de serviço que alcance a tabela. INSERT começa prepared e deve corresponder à operação/UUID reservado ainda prepared, cercada NOWAIT.
- DELETE e TRUNCATE das duas tabelas recusam. Impedir apagar e recriar a mesma chave para renovar prazo/autoridade. No-op continua permitido; nascimento nativo, confirmação e replay normais permanecem válidos.
- Triggers ALWAYS cobrem também DML em modo replica. A ACL privada continua negando acesso direto a anon/authenticated/service_role. Para testar o trigger com service_role, conceder somente privilégios temporários dentro de transação desfeita e distinguir a recusa do trigger da recusa da ACL.

Provar nas duas versões Auth, conservando os 19 grupos nativos da composição. Acrescentar mutação campo a campo, serviço com concessão temporária, no-op, INSERT forjado/divergente, DELETE/TRUNCATE/replica e rollback. Controle de falha no banco descartável: desabilitar temporariamente somente o trigger próprio, observar renovação indevida e desfazer a transação; com ele ativo a mesma escrita deve recusar.

PostgreSQL permite [BEFORE por linha e TRUNCATE por statement](https://www.postgresql.org/docs/16/sql-createtrigger.html), e [ENABLE ALWAYS TRIGGER](https://www.postgresql.org/docs/16/sql-altertable.html) é a opção usada neste ensaio. Nenhum GUC particular libera a escrita.

## Limites que permanecem

Isto é integridade de vínculos, **não autenticação de todo produtor de INSERT ou de toda transição de phase**. Um escritor privilegiado ainda precisa de protocolo autoritativo para criação/avanço; não confiar em phase isoladamente. A reserva concorrente de UUID/índice, instalação com dados/tráfego, custódia e retenção/exclusão do ledger em produção, histórico do Auth/recuperação, filiação/pedidos e corte do serviço permanecem separados. A instalação aqui exige tabelas vazias; não é ponte de upgrade.

O adversário de DML não recebe autorização para remover triggers, mudar donos/funções ou executar outro DDL. Não afirmar proteção contra quem controla o schema. A recusa de exclusão é uma regra do protótipo, não uma política LGPD do produto. Não aplicar este SQL em produção antes do contrato de custódia/retenção correspondente.

Três helpers T33/arquivos do Claude, SaaS, PersonalMed, campos legais e dados reais permanecem intactos. D17 segue com seu desenho pendente; este incremento é independente.
