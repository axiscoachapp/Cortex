# Cortex para a operação da clínica

Data da pesquisa: 03/11/2026, America/Sao_Paulo. Base do código inspecionada: `9b2adaf`, em `main`.

Proposta: ampliar o Cortex da Haddad Nicola para acompanhar a jornada administrativa completa — primeiro contato, atendimento da recepção, agendamento humano, chegada, cobrança e nota fiscal — conectada ao prontuário privado de cada médico.

## Decisões confirmadas

- Produto desta pasta: clínica Haddad Nicola; o produto Cortex SaaS permanece um projeto separado.
- Todos os médicos têm sua lista de pacientes e compartilhamento clínico explícito.
- Secretárias passam a ter um ambiente próprio de atendimento e fila.
- No primeiro lançamento deste módulo, uma pessoa cria, altera ou cancela o agendamento. Automação pode organizar a demanda, sugerir opções e registrar a resposta de confirmação do paciente.
- O módulo fiscal atende serviços faturados pelo CNPJ da clínica, em Curitiba.
- Claude está trabalhando na migração do PersonalMed. Esta proposta não executa nem modifica essa migração.

## Direção recomendada

Uma área de recepção dentro do app existente, com uma caixa de entrada compartilhada e agenda dos profissionais autorizados. Telefone localiza um contato candidato; a secretária confirma para quem está falando e quem será atendido. O sistema sugere o médico com base em vínculo administrativo, pedido explícito, tipo de serviço e regras da clínica. Não se trata de diagnóstico ou triagem clínica automatizada.

Um cadastro administrativo da clínica liga o contato aos prontuários privados existentes, sem transformar todos os prontuários em um cadastro clínico compartilhado. Registrar um contato novo não precisa criar imediatamente um prontuário médico.

Para notas fiscais, a recomendação inicial é homologar um integrador fiscal com suporte ao Emissor Nacional, mantendo a alternativa de integração direta documentada. O sistema precisa controlar serviços, recebimentos e documentos como objetos diferentes; emitir um PDF ou marcar um pagamento como recebido não equivale a obter autorização fiscal.

## Documentos para execução

| Documento | Conteúdo |
|---|---|
| [Pesquisa de mercado](MARKET_RESEARCH.md) | Comparáveis, padrões úteis, fornecedores e custos que precisam de cotação |
| [Viabilidade fiscal](FISCAL_FEASIBILITY.md) | Curitiba, atualização tributária, alternativas e estimativas |
| [Especificação do produto](PRODUCT_SPEC.md) | Telas, fluxos, permissões, regras, estados e modelo proposto |
| [Handoff para o Claude](DATABASE_HANDOFF.md) | Perguntas, contrato de migração e mensagem pronta para repassar |
| [Plano de implementação](../../../tasks/clinic-crm/plan.md) | Dependências, entregas e estimativa consolidada |
| [Backlog verificável](../../../tasks/clinic-crm/todo.md) | Tarefas pequenas com critérios de aceite e verificação |

## Estado da implementação — 03/11/2026

Fundação local implementada: contas dedicadas, delegação de agendas, contatos, fila manual, rascunhos por secretária e agenda com confirmação humana. Prontuários permanecem privados. Veja o [relatório do incremento](../../reviews/2026-11-03/reception-foundation/IMPLEMENTATION.md) para evidências, decisões e limites.

Incremento seguinte: [correção auditada de nome/telefone de contato pela administração](../../reviews/2026-11-03/contact-corrections/IMPLEMENTATION.md), com confirmação, revisão concorrente e preservação do legado bruto. Retificação de vínculos continua no backlog.

A [retificação de vínculos administrativos](CONTACT_LINK_CORRECTIONS.md) tem contrato especificado/revisado, ainda sem implementação. Separadamente, o [alerta verificado sobre provedor/modelo de IA](../../reviews/2026-11-03/ai-provider-alert/VERIFICATION.md) foi registrado em D13 para decisão antes da ativação clínica e do redirecionamento anunciado para 01/12/2026.

Sua primeira proteção histórica foi implementada: [reservas CRM mantêm o beneficiário original](../../reviews/2026-11-03/appointment-identity/IMPLEMENTATION.md), tanto no banco quanto no modal médico. O ciclo de revogação/reativação de vínculos e seu editor continuam pendentes.

Também foi protegida a [confirmação de vínculos durante o agendamento](../../reviews/2026-11-03/link-confirmation/IMPLEMENTATION.md): novas reservas preservam a relação e a autoria anteriores, sem usar a confirmação como edição do vínculo.

As três migrations foram ensaiadas apenas em banco descartável; nenhuma alteração foi aplicada ao Supabase hospedado. WhatsApp oficial, financeiro, fiscal, métricas e piloto seguem no backlog. Não houve mensagens, emissão de notas ou importação PersonalMed.

As decisões sobre quantidade de números, divisão da equipe, horários, SLAs e regras de cobrança ficam registradas como perguntas de refinamento. Elas não impedem construir primeiro a fundação com dados sintéticos.
