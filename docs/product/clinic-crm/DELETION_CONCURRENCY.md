# T27/2 — Exclusão e criação concorrente de custódia

Estado: implementado e verificado localmente em 04/11/2026 pela migration `20261104002000`. Complementa T27/1 (`3190f3b`); evidências em [IMPLEMENTATION.md](../../reviews/2026-11-04/deletion-barrier/IMPLEMENTATION.md). H2 concluída no código, sem publicação.

## Contrato

Antes de persistir uma intenção que permite limpar Storage/provedor, o banco deve garantir que nenhuma referência impeditiva de custódia foi omitida. Depois da intenção, novos vínculos/referências não podem ser confirmados. Isso vale para ator e médico, RPC pública e escritor service-role, com snapshot atual ou antigo. Confirmação de agendamento continua humana; o mecanismo não concede leitura de prontuários.

Uma transação concorrente pode ser recusada com erro transitório; não pode confirmar referência que faça a exclusão falhar somente depois da limpeza externa. Retries preservam identificadores de idempotência. Conta solo com agenda própria ainda deve completar sua cascata. Limpeza legítima de filhos por cascata/SET NULL exige teste próprio; não usar profundidade de trigger como autorização.

## Barreira implementada

Uma linha de versão em schema privado, sem acesso dos clientes, compartilhada entre intenção e mutações capazes de introduzir custódia. A linha sempre existe. O acesso obtém `FOR UPDATE NOWAIT` e incrementa realmente a versão na mesma transação; nenhuma espera é introduzida nesse lock. Contenção aborta antes de efeitos externos. Não segurar transação durante chamadas de rede.

O marcador de conta e a intenção de exclusão de paciente entram nessa barreira **antes do pré-check autoritativo**. As mutações cobertas entram antes de concluir a gravação e validam os marcadores de seus atores, médicos e pacientes depois da barreira, com funções VOLATILE. Uma snapshot antiga que perdeu uma mutação deve abortar ao encontrar a versão modificada, em vez de aproveitar um lock de linha sem alteração.

Na conta, manter o advisory existente antes da entrada não bloqueante na barreira; o pré-check executado depois dela não deve adquirir locks de outros usuários. Não começar por um novo lock bloqueante global para depois esperar pelo advisory. O desenho final precisa registrar a ordem real dos triggers, inclusive caminhos de upsert.

`NOWAIT` é necessário: RPCs existentes já podem ter advisory locks, locks de associação ou de agendamento. Esperar pela nova linha nesses pontos reintroduziria inversão. Erros transitórios precisam chegar ao chamador com recusa explícita; nunca considerar timeout como autorização.

A linha é global para o banco da clínica neste desenho inicial. Isso sacrifica paralelismo de escrita em favor de uma prova menor. Não declarar capacidade de produção sem medir contenção. Uma divisão por clínica/usuário exigiria outra prova para autores, referências indiretas e transações entre escopos.

## Cobertura que a implementação precisa demonstrar

- Fontes diretas: equipe/delegações, contatos, vínculos, casos, notas, rascunhos, auditoria, pedidos de reserva, bloqueios e autoria de agenda. Usar os valores finais, depois dos triggers que carimbam autores.
- Fontes indiretas: pedido de reserva → agendamento → médico/paciente; auditoria polimórfica → agendamento. A ordem “auditoria antes de existir o agendamento” também precisa ser segura.
- Custódia clínica já existente: clínicas e compartilhamentos não podem ganhar caminho de bypass. Inventariar as FKs restritivas e as guardas atuais antes de afirmar cobertura completa.
- A revisão encontrou uma omissão concreta: `shared_chart_entries.actor_user_id` tem FK restritiva independente de autor/proprietário. A implementação deve cobri-la no pré-check e na guarda e testar ator diferente de ambos. A barreira não corrige sozinha um pré-check incompleto.
- Escrita direta privilegiada continua sujeita a triggers; superusuário que desabilita triggers não é um cliente suportado.
- Intenção é monotônica enquanto a conta existe. Hoje service-role pode remover o marcador ou trocar `user_id`. Bloquear remoção/retarget, permitindo a cascata real de `auth.users`; provar também idempotência/retomada. Na exclusão de paciente, não permitir limpar ou transferir a intenção enquanto a limpeza pode continuar.
- DELETE que apenas remove referência não introduz custódia; cascatas legítimas não podem ser bloqueadas por uma guarda indiscriminada de UPDATE.
- Não mudar privilégios, RLS, formato de DTOs ou propriedade dos prontuários para contornar o problema.

## Provas em banco descartável

1. Intenção confirmada → novo contato com autor em exclusão, por service-role: deve recusar.
2. Caso novo não confirmado segurado na conexão A → intenção na conexão B: somente uma ordem segura pode confirmar; não pode persistir o par intenção + caso.
3. Intenção com snapshot REPEATABLE READ anterior ao caso já confirmado: deve recusar/abortar, sem persistir marcador inseguro.
4. RPC de criação de caso com snapshot REPEATABLE READ anterior à intenção confirmada: deve recusar/abortar, sem persistir o caso.
5. Repetir a intenção/retomar limpeza; testar paciente, autores de correção, reserva indireta, auditoria antes/depois da agenda e cascata solo com paciente/agendamento.
6. Provar ausência de acesso direto à barreira e manter os testes de permissões, custódia e agenda existentes.
7. Tentar remover/retargetar intenção de conta ativa, limpar intenção do paciente e introduzir somente o ator do histórico compartilhado. Recusar sem apagar dados; cascatas reais e retomada devem continuar funcionando.

O ensaio padrão foi ampliado para oito ordens e integra `npm run test:db`; a suíte SQL prova marcadores, cascatas, carimbos e ordem/upsert. Nenhum arquivo ou chamada externa é apagado para reproduzir a falha. O protótipo limitado de T27/2a permanece separado das migrations.

Fontes primárias: [locks explícitos](https://www.postgresql.org/docs/16/explicit-locking.html), [isolamento](https://www.postgresql.org/docs/16/transaction-iso.html). A propriedade de isolamento deve ser confirmada pelo ensaio local, não só pela leitura da documentação.
