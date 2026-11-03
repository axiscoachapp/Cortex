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

## Estado desta entrega

Pesquisa e planejamento concluídos. As capacidades descritas são propostas; não estão implementadas por estes documentos. Não foram feitas migrações, alterações de permissões, contratações, emissão de notas, envios de WhatsApp ou chamadas a pacientes. A homologação da NFS-e e a implantação de WhatsApp real dependem dos dados e acessos da clínica.

As decisões sobre quantidade de números, divisão da equipe, horários, SLAs e regras de cobrança ficam registradas como perguntas de refinamento. Elas não impedem construir primeiro a fundação com dados sintéticos.
