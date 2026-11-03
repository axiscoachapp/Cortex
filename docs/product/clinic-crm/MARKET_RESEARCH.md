# Pesquisa de mercado: recepção, WhatsApp, agenda e faturamento

Pesquisa em 03/11/2026. Foram consultadas páginas oficiais de produto e documentação. “Documentado” significa anunciado ou descrito pelo fornecedor, não funcionalidade testada por nós. Não houve demonstração comercial, contratação nem validação da cobertura específica do CNPJ da clínica.

## Sistemas comparáveis

| Referência | Evidência pública | Aplicação ao Cortex | Limite da comparação |
|---|---|---|---|
| iClinic | Área de recepção com agenda, cadastro, confirmações, sala de espera e caixa diário. [Produto para recepção](https://iclinic.com.br/recepcionista/) | Uma tela inicial operacional, com próximos compromissos e pendências | Não comprova uma caixa de WhatsApp bidirecional com filas equivalente à proposta |
| Feegow Clinic | Agenda múltipla, financeiro e NFS-e no VIP, condicionada à viabilidade da cidade. [Planos oficiais](https://feegowclinic.com.br/precos-e-planos) | Integrar visão por profissional, atendimento e faturamento | Emissão/cancelamento em Curitiba precisam ser demonstrados no cenário da clínica |
| Amplimed | Complementos de comunicação por WhatsApp e organização de agenda. [Recursos](https://www.amplimed.com.br/planos-e-recursos/) | Configurar comunicações operacionais sem depender de IA clínica | Complementos e disponibilidade devem ser cotados; a página não demonstra toda a fila de atendimento humano |
| Amplimed — fiscal | Emissão a partir da conta a receber, cadastro de emissor/serviço, tomador editável, status, PDF/XML. [Manual fiscal](https://conhecimento.amplimed.com.br/como-criar-uma-nota-fiscal) | Fluxo de revisão fiscal ligado à cobrança, com rejeições e acompanhamento | Usar o cadastro do paciente como sugestão não resolve todos os casos de responsável financeiro/beneficiário |
| Blip Desk | Filas, atendentes e transferências; modos de distribuição e monitoramento. [Visão geral](https://help.blip.ai/hc/pt-br/articles/4474416681495-Vis%C3%A3o-geral-do-Blip-Desk), [monitoramento](https://help.blip.ai/hc/pt-br/articles/14932635417879-Monitoramento-de-atendimento) | Responsável por conversa, transferência, fila e tempos de resposta | Plataforma de comunicação; não substitui agenda, prontuário nem financeiro médico |

Esses produtos comprovam a existência das categorias de solução, não que todos resolvam integralmente o fluxo desejado. A recomendação de produto é nossa: unir atendimento administrativo e contexto operacional da clínica com menos troca de telas, preservando o acesso clínico separado.

## Preço e comparação econômica

Na consulta, o Feegow publicava Starter a R$ 129, Plus a R$ 199 e VIP a R$ 249 por profissional/mês. NFS-e aparece no VIP, com ressalva de viabilidade municipal. São valores exibidos no site, sujeitos a condições comerciais; não equivalem a uma proposta para a Haddad Nicola. [Fonte](https://feegowclinic.com.br/precos-e-planos).

Não foi confirmada uma tarifa pública comparável que inclua todas as secretárias, números, WhatsApp bidirecional, notas, armazenamento, suporte e implantação nos demais fornecedores. Solicitar cotação com o mesmo cenário a todos.

Modelo de custo operacional a levantar, sem inventar uma mensalidade:

`custo mensal = infraestrutura/backup + suporte + BSP/assentos/números + mensagens tarifadas + integrador fiscal/notas/CNPJs + monitoramento`

A Meta atualmente descreve cobrança por mensagem entregue, conforme categoria e mercado; mensagens de serviço na janela de atendimento de 24 horas são gratuitas na camada Meta. Isso não elimina mensalidade ou tarifa do intermediário. [Preços oficiais do WhatsApp](https://whatsappbusiness.com/products/platform-pricing/).

Para a cotação, solicitar: número de médicos e secretárias simultâneos, números de WhatsApp, contatos recebidos/dia, mensagens-modelo entregues/mês, notas/mês, anexos, retenção e horários de suporte. Evitar comparar “mensagem” com “conversa” ou assinatura do software com custo total da operação.

## Opções para o WhatsApp

| Caminho | Vantagem para o projeto | Responsabilidade que permanece |
|---|---|---|
| Cloud API oficial da Meta e inbox própria | Controle do fluxo e da experiência dentro do Cortex | Onboarding, endpoint público, webhooks, filas, suporte e acompanhamento de mudanças |
| Parceiro oficial/BSP, com API e Cortex como interface | Pode reduzir trabalho de implantação e suporte | Contrato, portabilidade do número, limites, dados tratados e integração dos eventos |
| Central externa como Blip Desk integrada à agenda | Pode colocar atendimento humano em operação mais cedo | Experiência em dois sistemas e sincronização de responsáveis/status |

Recomendação para estruturar o produto: inbox e fila pertencem ao Cortex; transporte pertence a um adaptador oficial. A escolha entre acesso direto e BSP deve ocorrer após uma prova com número de teste. Coexistência com o aplicativo atual, importação do histórico antigo e disponibilidade de identificação por telefone devem ser verificadas; não são promessas desta proposta. A documentação técnica da Meta retornou HTTP 429 nesta pesquisa; não consideramos seus detalhes de onboarding validados.

A política atual exige opt-in para contatos posteriores, modelos aprovados fora da janela de 24 horas e meios claros de atendimento humano. O produto terá relógio da janela, bloqueio de envio inadequado e opt-out. Preferência por WhatsApp não substitui a análise da base legal de tratamento de dados. [Política oficial, atualizada em 23/09/2026](https://whatsappbusiness.com/policy/).

## O que diferenciar na operação da clínica

Estas são propostas de melhoria, não afirmações sobre ausência nos concorrentes:

1. Ao receber contato, mostrar candidatos, responsável familiar e médico já vinculado administrativamente; pedir confirmação quando houver ambiguidade.
2. Separar primeiro contato, primeira consulta com aquele médico e retorno; não inferir “paciente novo” apenas porque trocou de telefone.
3. Uma secretária assume a conversa e as demais veem quem está atendendo. Transferências preservam contexto e tarefas.
4. A agenda pode ser aberta ao lado da conversa, sem interromper a fila; o horário só é gravado após confirmação da equipe e checagem transacional de conflito.
5. Pendências do cadastro, confirmação, pagamento e nota aparecem no mesmo atendimento, sem revelar evolução médica.
6. Cancelamento abre uma oportunidade para a lista de espera; a equipe escolhe quem chamar e qual horário oferecer.
7. A gestão acompanha primeira resposta, abandono, conversão em agendamento, comparecimento e notas pendentes com definições explícitas.

## Demonstração a pedir aos fornecedores

Usar o mesmo roteiro: duas secretárias recebem simultaneamente; telefone de mãe com dois filhos; paciente de dois médicos; remarcação com disputa de horário; mensagem fora da janela; WhatsApp fora do ar; serviço pago em parcelas; nota autorizada cujo retorno se perde; cancelamento fiscal e exportação para contador. Pedir evidência dos limites e preço de cada um desses fluxos.
