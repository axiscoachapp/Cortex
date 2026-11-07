# K7/2b — Agenda e retirada da página genérica (D26)

A Agenda médica oferece **Lista de espera e confirmações** no próprio fluxo, por `?queue=scheduling`. Abrir/fechar o painel preserva a visualização e a data escolhidas. O painel lê apenas tarefas abertas/rascunhos desses dois fluxos, da conta atual e ligadas ao seu paciente pelo vínculo composto. Mostra metadados e o link para o paciente; editar, concluir e consultar versões continuam no acompanhamento do paciente.

O painel é somente leitura: não envia mensagens, confirma atendimento, conclui tarefa ou reserva horário. A confirmação exibida é o estado armazenado. A recepção continua usando suas APIs e sua agenda administrativa; o trabalho privado do médico não foi compartilhado com a equipe.

**Pendências/Trabalho pendente saiu dos menus.** A rota antiga tem agora apenas um componente de redirecionamento, sem montar os leitores da página anterior:

| Link antigo | Destino |
|---|---|
| `/trabalho?patient=X` | `/?patient=X` |
| `/trabalho?queue=scheduling`, médico | `/agenda?queue=scheduling` |
| Mesmo link, recepção ativa com agendas | `/recepcao/agenda` |
| `/trabalho`, médico | `/` |
| Link de paciente/genérico, recepção | Área administrativa já definida pelo gate |

Paciente tem precedência quando os dois parâmetros aparecem. O redirecionamento substitui a entrada no histórico; transporta somente o ID do paciente, sem atribuir consulta/agendamento a partir dos parâmetros antigos. URLs permanecem locais e codificadas. Aliases de caixa, barras e percent-encoding seguem o router; prefixo extra não ganha tratamento especial e recepção inativa continua bloqueada. O módulo `ClinicalWorkspace` mantém sua exportação nomeada para o painel do paciente e perdeu a antiga entrada de página.

## Leitura e escopo

Chave por ator, leitura fresca ao abrir/atualizar, cancelamento na desmontagem. Erro, mudança de ator ou leitura em andamento escondem links anteriores. A resposta é validada em runtime, inclusive o ID do paciente associado. A projeção de JSON usa string ampliada para evitar a instanciação excessiva dos tipos do SDK; o schema Zod é a validação da resposta. Mais de50 registros recebe aviso explícito; os demais continuam disponíveis no paciente.

## Verificação

- RED: três testes do gate mostram links legados de agenda da recepção desviados à fila geral. GREEN final:53 testes Vitest em quatro arquivos, incluindo gate/aliases/negativos/inatividade, redirecionamentos locais/prioridade, painel por ator e cinco regressões do acompanhamento do paciente.
- Seis testes Node em três arquivos: dois novos para a fixture de agenda/projeção/escopo/filtros/escrita bloqueada e quatro regressões de recuperação/acompanhamento. Tipos globais app/node, lint dos16 caminhos alterados, sintaxe de quatro scripts e três combinações inválidas de flags aprovados.
- Navegador Edge headless com App/Auth/providers/SDK reais, fontes e Tailwind do snapshot `2db154689375b83c042bb8eb80da4fbd8a5d0254`, oito overlays próprios e APIs HTTP exclusivamente loopback. A fixture exige projeção/filtros/ordem/limite exatos e preserva os dados.
-24 estados em375/768/1280/1920, escala135%: redirecionamento genérico sem leitor de trabalho, paciente correto sem parâmetros clínicos antigos, painel/erro/recuperação/vazio, semana/data preservadas, registros acessíveis no paciente, menus sem Pendências, recepção com aliases e conta inativa. Dados inalterados, nenhuma escrita/IA/externo no navegador e nenhuma leitura clínica pela recepção.
- Zero erro JS/recorte/controle sem nome. Oito503/console esperados na indisponibilidade de metadados. HEAD200/ERR_ABORTED brutos ficam no relatório, sem inferir causa. [VALIDATION.json](VALIDATION.json) e `docs/reviews/2026-11-05/reception-app-audit/scheduling-migration-final/AUDIT.json` guardam métricas, hashes e cleanup.
- A revisão independente não encontrou outra falha material. Uma advertência de Fast Refresh no reexport intermediário foi resolvida removendo a entrada antiga; suíte, tipos/lint e navegador foram repetidos sobre a fonte final. A primeira rodada aprovada não entra na entrega. Cross-model não executado: tarefa agendada não interativa, sem autorização para CLI externo.

O teste geral de navegação por teclado usa agora Pacientes em lugar da entrada retirada. Auditorias históricas de timestamps que dependiam da antiga página exigem seu snapshot anterior; a auditoria nova verifica os destinos atuais. Não houve DDL, alteração de comandos/CAS/permissões, compartilhamento novo, exclusão ou conclusão silenciosa. Não é prova de RLS/Auth reais nem homologação de produção.

K7 segue aberto para pós-consulta e descoberta global de áudio guardado somente no navegador. Próximo candidato é o reteste K6 de contato NOWAIT/robô/C5 do novo SHA; não há aceite antecipado nem nova mensagem Claude a responder.
