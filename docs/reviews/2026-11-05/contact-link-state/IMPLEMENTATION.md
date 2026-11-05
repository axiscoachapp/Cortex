# Estado auditado do vínculo: banco e API

05/11/2026, T05b/4a. A base permite à administração suspender/reativar um vínculo por revisão, preservando sua identidade, confirmação original, prontuários privados e agenda histórica. A interface dessas ações será a próxima fatia.

## Comportamento entregue

- `active` materializa o estado ativo implícito anterior, com default verdadeiro. A chave contato/paciente, clínica, médico, FKs e autoria/data da confirmação continuam imutáveis; não há exclusão/fusão de identidade.
- `reception_set_link_active` exige admin clínico humano ativo, assurance e conta disponível, cerca a identidade Auth e usa CAS. Suspender admite paciente arquivado/médico inativo; reativar exige ambos disponíveis. No-op atual preserva revisão; mudança efetiva avança uma vez e audita somente ator/IDs/revisão/estados. Intenção antiga não vence após reativação.
- Confirmação antiga e edição de relação não reativam vínculo suspenso. Confirmação e editor de relação agora também recusam upgrades de lock com `40001`, preservando suas assinaturas/ACLs anteriores.
- Guarda ALWAYS no appointment CRM exige vínculo ativo, sob lock compartilhado sem espera, para inserir, mudar intervalo ou reabrir cancelado. Protege também os identificadores históricos sob `session_replication_role=replica`. Cancelar, confirmar, registrar/desfazer chegada e manutenção histórica seguem as regras anteriores. Reserva anterior pode ser retornada pelo retry idempotente sem criar/remarcar/reabrir outra.
- DTOs operacionais de contato/caso filtram vínculos ativos. O órfão continua considerando também vínculos suspensos; não é promovido a todas as filas. Um caso autorizado mantém seu acesso independente. O helper privado de leitura cerca a linha e recusa snapshot RR anterior à suspensão.
- Leitores administrativos mantêm o mesmo schema e mostram o `active` persistido. Identificação/disponibilidade mínima permanece separada do acesso clínico.

Migration `20261105240000` reservada às14:22 antes do arquivo. Novos guard points usam substituições exatas e recusam uma definição inesperada; não copiam ou removem as guardas anteriores. Os três helpers T33 da migration de assinatura, os arquivos Claude e o PersonalMed não foram alterados. Tipos gerados: 12 linhas (três da coluna e nove da assinatura RPC). O adaptador novo exige resposta de revisão positiva e conserva erros sem retry automático.

Os RPCs operacionais `reception_contacts`, `reception_contact`, `reception_case` e o predicado interno agora são VOLATILE. O app continua usando os mesmos POSTs/argumentos/DTOs; os locks exigem READ WRITE. PostgREST despacha STABLE em READ ONLY mesmo no POST, conforme a [documentação oficial](https://docs.postgrest.org/en/v12/references/transactions.html). Não se oferece GET para esses leitores cercados. O controle SQL registra `25006` em READ ONLY e sucesso em READ WRITE; não é uma prova HTTP/PostgREST real.

## Evidências

| Execução | Resultado |
|---|---|
| `node scripts/test-reception-delegation-api.mjs --link-state --red` | **73 migrations**, função de estado ainda ausente/`42883`, [RED e limpeza](RED.json). |
| `node scripts/test-reception-delegation-api.mjs --link-state --types` | **74 migrations, 19 suítes SQL e 14 cenários/controles** aprovados. [95 fontes congeladas, tipos e limpeza](SQL.json). |
| SQL funcional | Admin/secretária/médico comum/admin externo, MFA, CAS/no-op/auditoria, identidade original, estados em leitores, órfão/caso, paciente arquivado/médico inativo, criação/remarcação/reabertura, confirmação/chegada/cancelamento históricos e DML de réplica. Mais regressões de fila/agenda/delegação/custódia selecionadas no relatório. |
| Concorrência | RC/RR com holders isolados no vínculo, disputa por identidade Auth, reserva antes/depois da suspensão, confirmação/edição de relação, reativação e replay antigo, leitor com snapshot RR antigo. Dois controles retiram apenas NOWAIT do helper e do comando; esperam e geram `57014`, com definições restauradas/conferidas em `finally`. Controle de leitura RO/RW e volatilidade dos RPCs. |
| Vitest | **28 testes/quatro arquivos**, sete novos em `linkStateApi`; `linkApi`, `contactLinksApi` e `contracts` preservados. RED inicial: método ainda inexistente. |
| Qualidade | Lint de quatro caminhos, sintaxe, typecheck app/Node, build sintético e hashes aprovados. Revisão independente do contrato/implementação; espera no editor de relação identificada e corrigida, leitura final sem achado material. Revisão externa já dispensada pelo usuário. |

As duas esperas legadas foram reproduzidas sob holder SHARE, sem os efeitos de auditoria/custódia que poderiam mascarar a causa: [observações RED](LOCK_RED.json). A confirmação foi corrigida primeiro; a revisão encontrou o mesmo ponto no editor de relação, também reproduzido e convertido. Na suíte ampliada, uma preparação tentou chamar um predicado privado diretamente e recebeu a recusa correta de EXECUTE; a prova passou a usar os leitores públicos, sem conceder o helper à recepção. Contagens intermediárias não são somadas às finais.

Somente sintéticos em PostgreSQL descartável com endpoint Docker local fixado, rede interna, imagens em cache e recursos próprios rotulados; holders encerrados e ausência após cleanup conferida. O runner não executa o mutante antigo da página neste modo, pois restauraria o leitor anterior a `active`; modos históricos mantêm seus catálogos compatíveis. Não foram repetidos Native Auth, D17/DER, SQL geral ou navegador: a entrega não adiciona interface. Nenhum banco hospedado, envio externo, chamada paga, carga, deploy ou push.

Próxima fatia: interface de suspensão/reativação, conferência humana e recuperação de resultado ambíguo por revisão, aviso de preservação do histórico e bloqueio de reativação indisponível. T05b inteira, M2/corte/piloto permanecem abertos. O commit paralelo `4ff89be` só encerrou a mensagem D7 já atendida; não gerou nova resposta.
