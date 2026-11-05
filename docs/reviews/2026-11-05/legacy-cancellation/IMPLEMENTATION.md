# T32/1a — Cancelamento de reserva legada com intervalo inválido

05/11/2026, Codex. Migration `20261105250000`, reservada no ESTADO às15:53 antes do arquivo. Implementação e testes somente locais, base congelada `0a7681490afbaf29114d6c99a0c192b74b637f6a`.

## Falha e correção

`guard_reception_appointment` recusava qualquer UPDATE de reserva com fim igual/anterior ao início ou timestamp não finito. Mesmo o RPC humano de cancelamento, que só muda o status, terminava em22023. A nova guarda permite cancelar esse registro sem inventar datas ou reescrever seu histórico.

A exceção exige UPDATE, intervalo exatamente igual ao anterior, destino `cancelado` e estado anterior `agendado`/`confirmado`/`cancelado`. Todos os demais campos de negócio são comparados; só status e metadados já reconhecidos de revisão/autoria/sincronização/lembrete podem variar. O predicado completo precisa ser verdadeiro: statusNULL não é interpretado como consulta não concluída. INSERT inválido, reabertura, mutação do intervalo, alteração de título/nota junto com cancelamento, finalização e identidade CRM continuam recusados. O restante da função segue executando, sem retorno antecipado pela exceção.

Autorização de clínica/origem/delegação, MFA, CAS, locks, FKs, autoria e auditoria existentes permanecem. Recepção não cancela reserva particular sem origem clínica; o médico proprietário mantém seu caminho próprio. Vínculo suspenso permite cancelamento histórico, mas continua impedindo reabertura. Não há alteração de dados preexistentes na migration, normalização de status, novos RPCs/DTOs/colunas/grants ou acesso a prontuários.

## Evidências

- [RED](RED.json):74migrations,22023 reproduzido no UPDATE de status dentro de `reception_change_appointment`; base anterior congelada, inclusive depois de commit. Fonte da suíte e runner capturados.
- [GREEN](SQL.json):75migrations e nove suítes SQL: nova matriz de intervalos, agenda, alterações da agenda, limite clínica/particular, identidade CRM, estado/permissões de vínculos, limites de funções e ciclo de escopos. Inclui intervalo zero/invertido, início/fim infinito, cancelamento repetido sem duplicar revisão/auditoria, CAS antigo recusado, papéis/origem, vínculo suspenso, alteração simultânea de título/nota recusada, reabertura/intervalo/estadoNULL/completado/beneficiário protegidos, novos cancelados inválidos recusados, dados históricos iguais e sincronização só de metadados sem nova revisão/auditoria.
- [Controle de metadados](METADATA_RED.json): a revisão identificou um erro na cópia de `changed`: eu havia retirado `google_sync_revision` da exclusão original. Restaurado nos dois lados e acrescida asserção que incrementa esse metadado. `--metadata-red` remove somente essas duas exclusões **na definição aplicada ao banco descartável**, sem editar o arquivo, e precisa falhar comP0004 na nova asserção. Hashes da definição original/mutante registrados; versão final passa.
- Revisão independente somente leitura, contexto novo, agente `legacy_cancel_review`. Identificou também o risco de statusNULL (fechado com `IS NOT TRUE`) e baselineHEAD no runner, que quebraria RED/contagem após commit. Baseline fixado no predecessor; guarda/catálogo/testes revisados. Última leitura sem nova falha concreta, condicionada ao GREEN final que passou. Nenhuma revisão externa.
- Uma execução intermediária esperou22023 ao reabrir enquanto o vínculo estava suspenso: a guarda do vínculo recusou corretamente42501 primeiro. A suíte foi separada para provar42501 sob suspensão e, após reativação explícita só da fixture,22023 pela guarda de intervalo. Sem relaxar a regra do produto.
- Runner aceita apenas flags locais, valida pipe/socket Docker local, recusa DOCKER_HOST herdado, usa imagem já disponível `--pull=never`, rede interna, container exclusivo e labels de propriedade. Fonte congelada e overlays verificados; remoção/ausência de container/rede conferidas antes de gravar os relatórios. A corrupção histórica é criada só na fixture descartável, desabilitando temporariamente a guarda específica; todos os comandos de aceite executam com guardas habilitadas. Nenhuma carga real/staging ou alteração de banco hospedado.
- ESLint/sintaxe Node do runner e `git diff --check` aprovados. Sem mudança de assinatura/tipos ou frontend: não foram repetidos build, testes UI/browser, SQL global, Native/D17 ou homologação Google. O ensaio prova o cancelamento local e as regressões SQL listadas, sem nova prova de corrida em duas conexões.

Sem dados reais, chamadas pagas, envio externo, push ou deploy. Arquivos Claude/PersonalMed/SaaS e três helpers de custódia intactos.

## Continuação

T32/1a concluída no banco; T32 inteira permanece aberta para apresentação/recuperação do legado na interface, retenção/privacidade e consulta limitada. Próxima fatia candidata: reproduzir como a recepção apresenta horários inválidos/não finitos e abre o modal, oferecer aviso claro/cancelamento humano sem inferir datas ou liberar remarcação inválida. M2/corte/piloto e importação PersonalMed continuam separados.
