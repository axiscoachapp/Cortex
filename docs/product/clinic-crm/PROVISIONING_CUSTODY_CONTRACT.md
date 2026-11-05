# M2: custódia do histórico de provisionamento

Data: 05/11/2026. **Contrato de aceite para o próximo laboratório; não implementado.** Complementa [instalação atômica](PROVISIONING_ATOMIC_INSTALL_CONTRACT.md), [fronteira de confirmação](PROVISIONING_CONFIRMATION_BOUNDARY_CONTRACT.md) e [pedidos privados](PROVISIONING_REQUESTS_CONTRACT.md). Não define política jurídica de retenção nem libera produção.

## Problema e limite

O laboratório conserva operação, conta planejada e intenção humana mesmo quando sessão, fator ou identidade Auth deixam de existir. Isso permite investigar e recusar replay; não transforma a evidência histórica em autorização atual. Antes da integração, esses novos registros precisam participar do preflight de exclusão e da barreira T33, inclusive quando o alvo ainda não existe.

Os nomes `provision_identity_lab` e `provision_intent_lab` abaixo são os atuais do laboratório. Nenhum deles é schema produtivo. O próximo incremento deve provar um overlay pequeno, sem endpoint, concessão, carga real ou novo prazo de retenção. Uma migration produtiva só vem depois da prova e da reserva no ESTADO.

## Inventário e cobertura atual por leitura

| Registro/referência | Significado e tratamento exigido | Cobertura atual |
|---|---|---|
| `operations.operation_id`, `revision`, `phase`, `birth_transaction` | Identidade/resultado técnico imutável; XID não contém credencial e não prova sozinho a existência atual da conta. | Guardas privadas dos produtores; ainda sem integração T33/preflight deste ledger. |
| `operations.planned_user_id` | Reserva de identidade, inclusive antes do INSERT Auth; depois, alvo histórico. A conta pode estar ausente. | Chave de reserva e cerca de recibo atual na confirmação e nos caminhos já confirmados, sem FK Auth propositalmente. Caminhos ainda `prepared` precisam da prova adicional descrita abaixo. |
| `intents.operation_id`, `planned_user_id` | Par exato com a operação; não pode ser reatribuído ou adotado por outra tentativa. | Guardas de vínculo/imutabilidade; sem T33/preflight deste ledger. |
| `intents.actor_id` | Autor humano histórico; para executar novamente, administrador atual e disponível na mesma clínica. | Verificação Auth/filiação/T33 no caminho autorizativo, mas ainda sem preflight que conte a intenção como custódia do ator. |
| `clinic_id`, `membership_generation` | Contexto e geração da autoridade original. Reativar ou recriar filiação não restaura a geração anterior. | Geração e verificação atual da filiação real no laboratório. |
| `session_id`, `factor_id`, `expires_at` | IDs históricos e limite da intenção, não token/TOTP/segredo. Logout, exclusão do fator e expiração devem continuar possíveis. | Cercas atuais e relógio final; sem FK restritiva/cascata para esses IDs. |
| `reception_delegation_requests` e `reception_delegation_operations` | Histórico separado de pedido/decisão médica, com atores, médico e recepção. Um provisionamento confirmado não concede acesso. | Já têm guardas de conta e preflight em `20261104230000`; origem privada em `20261105020000`. Não duplicar/substituir essas verificações. |

IDs e vínculos administrativos também precisam de proteção de acesso. Não são dados anônimos. O ledger não recebe nome, CPF, telefone, texto clínico, senha, bearer, OTP, chave, corpo de requisição ou resposta Auth. `birth_transaction` permanece evidência técnica de laboratório; sua representação final será revisada com o schema produtivo.

## Exclusão e autorização são decisões distintas

1. **Preflight da aplicação, conta inteira:** referências ao administrador (`actor_id`) e ao alvo (`planned_user_id`, em operação e intenção) devem impedir o início de exclusão enquanto houver custódia não resolvida, com `P4092`, preservando as demais verificações e privilégios de `assert_deletion_scope`. Uma operação ainda sem intenção deve continuar contando para o alvo. Consulta pública retorna apenas a recusa segura, sem revelar sessão, fator, outro ator ou clínica.
2. **Exclusão de um prontuário:** esses registros administrativos não contêm paciente nem devem bloquear por si só `assert_deletion_scope(user, patient)`. As guardas clínicas e demais custódias existentes continuam valendo.
3. **Intenção de exclusão já persistida:** novos registros e mudanças de estado que acrescentem ou confirmem referências ao ator/alvo devem falhar. Atualizações neutras não podem criar bypass; o overlay deve preservar o contrato anterior de no-op onde ainda for compatível com a intenção monotônica. Evidência já gravada não é apagada nem reatribuída para liberar a conta.
4. **Logout, fator e filiação:** não bloquear a revogação para conservar evidência. O histórico guarda o vínculo original; nova execução exige sessão/fator vivos, geração original ainda atual, AAL2 e prazo depois da última aquisição. Nenhuma evidência histórica substitui essas verificações.
5. **Auth Admin direto fora do fluxo de exclusão da aplicação:** o preflight da aplicação não intercepta essa chamada. O teste Native de remoção deve continuar funcionando. Depois de um nascimento confirmado no ledger (`operations.phase='auth_created'`), a evidência sobrevive e confirmação/check/replay devem recusar identidade ausente, **inclusive quando a intenção ainda está `prepared`**. Antes do primeiro nascimento, uma reserva válida continua podendo ser consultada/repetida com alvo ainda ausente. Recriação com o mesmo UUID ou metadata não pode recuperar a operação antiga. Não acrescentar FK Auth `RESTRICT` que mascare essa prova, nem `CASCADE`/`SET NULL` que destrua ou reescreva evidência.
6. **Escopo:** nenhuma dessas referências libera prontuários, agendas ou outras clínicas. Pedidos permanecem separados de grants e da decisão médica explícita.

## Barreiras exigidas antes de escolher a implementação

O laboratório deve demonstrar estas propriedades; esta seção não é uma sequência SQL já validada:

- A conta do ator participa da barreira por conta existente. O alvo ausente precisa de uma chave de recurso própria estável, não de uma chamada incondicional a `touch_custody_epoch` que exige epoch de conta já inicializado. Não fabricar conta/epoch Auth para satisfazer o teste.
- Operação e alvo têm identidades protegidas mesmo quando não há linha de intenção ou Auth. Os nomes das novas chaves de recurso serão privados e separados dos recursos clínicos existentes.
- A reserva, o nascimento Auth, alterações de estado e a intenção de exclusão concorrente precisam compartilhar barreiras suficientes para fechar ausência→presença, inclusive sob snapshot RR antigo. A inicialização atual de epoch em `BEFORE INSERT auth.users` não prova sozinha essa composição.
- Todo produtor privilegiado participa: criador, triggers de nascimento, confirmador e wrapper do servidor. Guards de DML e privilégios exatos continuam efetivos, inclusive com serviço, owner e `session_replication_role=replica` nos controles existentes. Não abrir grants para o serviço resolver a composição.
- Referências originais e finais são cercadas e revalidadas; identidade reservada e intenção não podem ser trocadas. Conflito retorna sem espera no protocolo, sem deadlock, retry silencioso ou efeitos externos na transação. O relógio final permanece depois da última aquisição e antes da transição autorizativa.
- Caminhos independentes não disputam um singleton global. Instalação/upgrade com histórico precisam incluir os novos escritores e seus privilégios na ponte atômica, sem apagar tabelas para "reparar" uma falha.
- Extensão preferencial: guardas específicas deste domínio chamando as primitivas T33 existentes. Não alterar os três helpers temporariamente com Claude (`custody_reference_accounts`, `direct_custody_resources`, `indirect_custody_resources`). Se a prova exigir mudança neles, coordenar um patch delimitado antes de implementá-lo.

## Retenção: decisões pendentes, sem purge implícito

Expirar intenção ou token encerra sua capacidade de autorizar; não é autorização para apagar histórico ou reutilizar UUIDs. O laboratório mantém a imutabilidade já provada. Não adicionar TTL, job, DELETE privilegiado, anonimização automática ou endpoint de eliminação neste incremento.

Antes de dados reais, o responsável pela clínica precisa definir finalidade, acesso operacional, prazo e procedimento de atendimento de direitos para essa evidência administrativa, além do tratamento dos backups e das contas bloqueadas por custódia. Isso não foi decidido aqui. Preservar temporariamente registros sintéticos não equivale a aprovar retenção indefinida em produção.

Se uma política futura permitir remover identificadores, é necessário outro contrato: mínimo de evidência/tombstone, não reutilização de chaves, impossibilidade de reautorizar por replay e compatibilidade com pedidos/grants e backups. Não copiar automaticamente uma regra de retenção de prontuários para este ledger. A ferramenta de resolução de custódia também permanece fora desta fatia.

## Prova mínima do próximo incremento

Usar fontes congeladas, banco descartável, duas versões Auth já suportadas e somente identidades sintéticas. Registrar estado antes/depois e controles que removam apenas a guarda investigada; não confundir fixture SQL com autorização de serviço ou chamada Native.

| Grupo | Evidência de aceite |
|---|---|
| Inventário e privilégios | Ator/alvo contam no preflight de conta; ausência de intenção não oculta reserva. Prontuário isolado continua sujeito apenas às suas próprias custódias. Clientes/serviço não leem ou reescrevem os ledgers. |
| Antes do nascimento | Reserva de alvo ausente funciona sem criar epoch Auth artificial. Criação de intenção de exclusão do ator ganha a corrida e impede novo vínculo; ordem inversa faz a exclusão recusar a custódia. |
| Nascimento e alvo | Auth INSERT e intenção de exclusão do alvo, quando ele existe, são ensaiados nas duas ordens; não há commit de referência nova com intenção de exclusão incompatível. Falha Native reverte também recibo/phase/custódia da tentativa. |
| Snapshots e disputa | RC/RR antigos em ambos os lados, recursos ausentes, mudança concorrente e contenção da chave produzem recusa sem espera; operações/contas independentes progridem. Observar bloqueios por PID/relação, excluindo timeout como falso positivo. |
| Antes do primeiro nascimento | Operação `prepared`, sem recibo de nascimento e com intenção/contexto ainda válidos: `check_intent(...,false)` e replay de `begin_intent` continuam permitindo a reserva, sem inventar identidade Auth. Esse positivo impede uma correção que recuse todo alvo ausente indiscriminadamente. |
| Nascido, ainda não confirmado | Operação `auth_created` e intenção `prepared`: controle positivo com alvo vivo; depois Native DELETE real, confirmação, `check_intent(...,false)` e replay de `begin_intent` recusados, preservando ambos os ledgers. Testar RC/RR e deleção em andamento, além da já concluída. |
| Confirmado, depois removido | Intenção `confirmed`: Native DELETE retorna seu resultado real; ledger preservado, confirmação/check/replay recusados. Nova sessão, fator substituído, filiação reativada e tentativa Native de recriar mesmo UUID não revivem autoridade histórica. |
| Regressões | Produtores, guardas INSERT/phase/vínculo, relógio final e fronteira do servidor continuam válidos; sem pedido aprovado ou grant automático. Privacidade clínica preservada. |
| Instalação | Falha tardia/lock ocupado reverte catálogo, privilégios e dados sem DROP de reparo. Upgrade sobre histórico e tratamento da repetição têm evidência própria antes da migration produtiva. |

**Lacuna encontrada por leitura na revisão:** `check_intent(...,false)` em `provisioning-reservation-keys.sql` e replay de `begin_intent` em `provisioning-creation-producer.sql` cercam o recibo quando a intenção já é `confirmed`; o primeiro também o cerca ao confirmar. Isso não cobre automaticamente a linha "Nascido, ainda não confirmado". O teste de remoção em `test-provisioning-clinic-authority.mjs` confirma a intenção antes de remover o alvo. A nova linha exige RED e correção próprios antes de alegar cobertura completa. Não foi reproduzida em Native nesta fatia.

Os testes de instalação de overlays já existentes não substituem essas provas de custódia. Este documento é resultado de leitura e revisão do contrato, não relatório de testes executados.

## Fontes locais e próximos passos

Base de leitura: `b0d4c4b`; arquivos de laboratório `provisioning-auth-identity.sql`, `provisioning-human-intent.sql`, `provisioning-clinic-intent.sql`, `provisioning-membership-generation.sql` e overlays de produtores; migrations `20261104002000`, `20261104200000`, `20261104230000`, `20261105020000`; `delete-user-data` e `delete-patient`.

1. Revisar este contrato e os acoplamentos das guardas de produtor antes de desenhar o overlay.
2. Priorizar RED/controle positivo do nascimento ainda não confirmado e remoção, depois as corridas conta/recurso em laboratório pequeno; compor com Native Auth nas duas versões. Preservar provas anteriores.
3. Integrar instalação/upgrade e política de retenção quando seus contratos estiverem resolvidos. M2 continua aberta; não iniciar API/UI ou corte produtivo com base apenas neste documento.
