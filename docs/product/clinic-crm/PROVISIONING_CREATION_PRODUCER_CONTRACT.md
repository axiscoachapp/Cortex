# Produtor privado das reservas/intents — laboratório M2

Recorte local após os produtores de nascimento e confirmação. Não é migration, API, carregador ou corte de produção.

Somente `begin_intent`, após revalidar contexto/geração e conferir o prazo final, produz INSERT prepared em operations e intents. Um escritor direto, inclusive proprietário/serviço com grants transacionais, não pode fabricar esses registros. Defaults, vínculo operação/alvo, chaves concorrentes, receipt, fases e histórico continuam protegidos pelos guards anteriores.

Proposta: papel NOLOGIN/NOINHERIT `provision_create_writer_lab`, sem membros/privilégios administrativos/BYPASSRLS, dono somente de begin_intent. Ele recebe INSERT das duas colunas fornecidas de operations; SELECT de intents e INSERT das oito colunas fornecidas de intents. UPDATE(phase) em intents é necessário ao SELECT FOR UPDATE de replay, mas não autoriza confirmar: o guard do produtor de confirmação deve continuar recusando esse papel com P4107. Sem UPDATE de operations, DELETE/TRUNCATE ou acesso às tabelas Auth.

O único acesso Auth direto de begin_intent (`exists users`) passa a um leitor SECURITY DEFINER do instalador que retorna somente booleano. O corpo mantém todos os demais passos e usa esse leitor no mesmo lugar. Os helpers de contexto/geração/receipt/prazo/chaves conservam donos anteriores. EXECUTE nos três schemas deve corresponder exatamente a begin_intent, esses cinco helpers e o novo leitor. Clientes não recebem acesso ao leitor ou ao papel.

Guards INSERT/ALWAYS, INVOKER, identificam current_user e recusam outros produtores com P4109. Rodam depois dos guards de forma/vínculo (P4103/P4104) e das chaves TRY, preservando essas recusas e evitando espera no índice. Nenhuma aquisição nova ocorre depois do relógio no caminho autorizado.

A instalação só aceita os ledgers vazios/quiescentes em READ COMMITTED com locks de tabela NOWAIT. DDL/SET ROLE por DBA estão fora da ameaça. Fixtures antigas de corrupção que exigem reservar para uma identidade já existente ou competir no índice usam impersonação explícita do instalador somente para preparar os testes; não apresentar isso como autorização de serviço ou como caminho do produto. O serviço real não é membro do produtor.

## Provas requeridas

- RED com contexto Native real: begin_intent recusa sessão inexistente, mas proprietário/serviço inserem os dois registros prepared vinculados a essa sessão. Rollback conserva o estado.
- GREEN recusa INSERT direto nas duas tabelas, incluindo replica e GUC falso, e conserva erros de forma/vínculo. Nascimento/check/replay genuínos continuam funcionando, sem vínculo clínico/escopo para alvos.
- Exata allowlist de funções e privilégios por coluna; controle de grant indevido e rollback; papel criador não consegue confirmar apesar de UPDATE(phase) para lock.
- Remover só cada novo guard permite o respectivo INSERT; restauração volta a negar. Provas anteriores de chaves/índice mantêm controles causais com fixtures privilegiadas explícitas, sem fingir que um serviço possa SET ROLE.
- Duas Auth locais, fontes congeladas/overlays com hashes, cleanup, sem dados reais.

## Limites

Não fecha interface autorizativa do servidor, custódia/retenção/instalação com histórico, credencial/MFA/recuperação histórica, namespace externo do Auth, filiação/pedidos, reconciliação/corte/gate/API/UI. M2 permanece aberta. Sem dados reais, campos legais, PersonalMed, hosted, envio, provedor pago, deploy ou push.
