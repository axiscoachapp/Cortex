# T28/2b/2a — inativação da recepção encerra delegações

04/11/2026. Migration `20261104220000_reception_staff_scope_lifecycle.sql`, reservada antes da criação. Correção local de ciclo de acesso; **não implementa ainda anuência médica** nem aplica schema em banco hospedado.

## Falha e comportamento

A operação pública de desativação já removia as agendas delegadas, mas uma atualização privilegiada direta de `clinic_staff_members.active=false` mantinha as linhas de escopo. Alterar depois apenas a flag para `true` podia recuperar essas permissões antigas. O ensaio RED exige a asserção específica `Inactive staff retained delegation`; não aceita qualquer erro como reprodução.

A nova trigger remove delegações daquela conta/clínica ao inativar por qualquer escritor. Uma guarda AFTER, ordenada depois de `custody_reference`, rejeita INSERT/UPDATE de escopo para recepção inativa, inclusive por service role. A barreira de versão da conta é tocada antes da remoção. Reativação só da flag não recria escopos; uma concessão nova e explícita pelas capacidades atuais continua possível.

Prontuários, vínculos, identidade/autoria de compromissos e casos encerrados permanecem preservados. A liberação existente retira a responsabilidade do trabalho aberto uma única vez. Auditoria da revogação registra ID da atendente e quantidade, sem nomes ou conteúdo pessoal. Instalação remove somente escopos de contas atualmente inativas; não infere proveniência/consentimento para contas ativas.

## Instalação e revisão

A migration é transacional e fixa/valida READ COMMITTED antes de consultar dados. Uma transação RR com snapshot já estabelecido é recusada com `25001`, sem funções, triggers ou cleanup parcial. Uma aplicação fresca com default RR seleciona RC e remove os escopos de contas inativadas depois do snapshot recusado. Locks de instalação têm prazo de dois segundos; instalação ocupada deve ser repetida integralmente, sem inferir sucesso parcial.

Revisão local em três leituras encontrou e corrigiu o snapshot RR herdado e a captura parcial de SQL pelo harness. Leitura final sem achado concreto remanescente, sem aprovação de produção; o revisor não executou o banco. Revisão externa dispensada pelo usuário.

## Ensaio executável

Comando: `node scripts/test-reception-clinic-boundary.mjs --staff-lifecycle`. Resultado final agregado em `verification.json`, emitido somente depois da limpeza dos recursos próprios.

O harness captura bootstrap, migrations e suítes SQL de um único commit imutável, com quatro overlays explícitos de recepção. O relatório registra o commit e hashes. A suíte congelada de fronteira também é passada ao injetor de falhas; outros runners mantêm seu default. Isso evita combinar um teste novo do trabalho paralelo com schema enumerado antes de sua criação. Nenhum arquivo do Claude é alterado ou removido. Helpers de concorrência executam no mesmo banco próprio.

Dados somente sintéticos; Docker local verificado/pinado, imagem em cache, container/rede interna identificados por propriedade e sem portas publicadas. Limpeza confere labels antes de remover recursos. Não há leitura de env, staging, banco existente ou exportação real.

O ensaio cobre recusa de escopo inativo por INSERT e UPDATE, reativação sem acesso, nova concessão explícita positiva, preservação de história/beneficiário e cleanup de instalação com conta ativa preservada. As corridas incluem concessão direta/RPC contra inativação nas duas ordens e RC/RR, além de espera efetivamente observada entre gravação autorizada de rascunho e inativação. A suíte SQL e as corridas novas também entram no runner do CI.

Uma execução pegou um teste D8 criado pelo trabalho paralelo após a enumeração das migrations; isso motivou a captura imutável de fontes. Outra falha foi localizada na fixture existente que insere 2.500 contatos: ela atingia o orçamento genérico de dez segundos no epoch. A mesma fixture é medida no predecessor e depois da migration, com orçamento de 45 segundos e driver de 60 somente nesse caso de carga sintética. Os limites de locks e das corridas/RPCs não foram ampliados. Não é uma correção ou aprovação de desempenho de produção; as durações ficam no relatório para T25.

Verificação final: **61 migrations/39 suítes SQL**, sete falhas de fronteira com rollback, regressões de fila/agenda/vínculo/contato, dez corridas de agenda/conclusão, 20 interleavings anteriores de médico e **20 novos de recepção**, duas corridas de modelos e limpeza confirmada. A fixture de 2.500 contatos levou 15,2 s antes e 18,4 s depois nesta execução; ambas ultrapassam o limite antigo de dez segundos. As medidas são de preparação sintética, sem atribuir causalidade ou aprovar desempenho de produção. Sintaxe e eslint dos quatro scripts aprovados. Nenhum componente/tipo/RPC público da recepção alterado; frontend/build não foram reexecutados por esta correção SQL.

## Próximo incremento

T28/2b/2b precisa do contrato e backend de anuência por médico/delegação, com identidade/revisão da solicitação, aprovação/revogação, concorrência e UI posterior. Escopo ativo preexistente não prova consentimento. T34/cadastro único, T31/credencial inicial e publicação permanecem separados. Nenhuma carga, envio, mudança de campo legal ou compartilhamento clínico por este incremento.
