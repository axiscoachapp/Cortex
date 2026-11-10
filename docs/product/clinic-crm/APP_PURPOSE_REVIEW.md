# Revisão do Cortex por responsabilidade e rotina

O Cortex é um sistema de clínica com implantação assistida pela equipe Cortex. O médico atende e revisa seu prontuário privado; a secretaria organiza contatos, fila e agenda; a gestão acompanha equipe e financeiro. A implantação prepara especialidades, cadastros profissionais/financeiros e conexões técnicas. Ser administrador da clínica não equivale a ser operador técnico nem abre prontuários de outros médicos.

Revisão manual de10/11/2026, ampliada pelo usuário para o app inteiro e distribuída em frentes de configurações, clínico, recepção e financeiro, com revisão independente da integração. [Responsabilidades das configurações](SETTINGS_OWNERSHIP.md) e [Plano de implementação](<Plano de implementação.md>).

## Mapa da experiência

| Área | Trabalho principal | Responsabilidade e resultado da revisão |
|---|---|---|
| Início do médico | Ver o dia e continuar o atendimento correto | Agenda, retomada e recentes; sem transformar o início em painel técnico. Melhorias anteriores preservadas. |
| Pacientes | Encontrar e manter cadastros do próprio escopo | Migração deixa de ser uma tarefa CSV do médico e passa a orientar implantação, escopo, conferência e canal seguro. Parser/importador existente preservado. |
| Perfil e anotações | Conferir o registro e manter trabalho clínico | Distinguir leitura pendente/pausada/falha dos dados atuais; preservar editor, rascunho e revisão concorrente. Sem apresentar fallback clínico como leitura bem sucedida. |
| Consulta e documentos | Registrar, revisar e emitir no escopo permitido | Avisos de dados profissionais encaminham à implantação; regras do produtor e revisão humana mantidas. Classificação local inconclusiva não pode impedir o enriquecimento autoritativo pelo catálogo no servidor. |
| Documentos emitidos | Consultar documentos do médico para o paciente | Ausência explícita só após leitura concluída. Atualização/pausa precisa ser distinguida de lista vazia e conservar comandos já iniciados. |
| Agenda do médico | Organizar a própria agenda | Rotas, contexto e autorizações pessoais preservados; conferir os fluxos de integração sem executar autorização externa real. |
| Recepção e contatos | Assumir demanda e acompanhar o próximo passo | Fila e contato administrativo separados de prontuário. Preservar rascunhos do atendimento durante atualizações; sem redefinir identidades por inferência. |
| Agenda da equipe | Agendar, remarcar, bloquear e registrar chegada | Corrigidos intervalo inválido antes do envio, fim exclusivo de bloqueios e orientação de falha de sincronização. Confirmação humana, revisões e contratos preservados. |
| Indicadores | Ler fontes válidas e limitações | Nenhuma falta, abandono ou autoria inferida por responsável atual. Fixture de auditoria vazia não constitui teste de produtor populado. |
| Financeiro operacional | Faturar, receber, conferir lotes e despesas | Confirmação de descarte, proteção durante envio e contra duplo clique. Metadados reconsultados não podem apagar a cobrança em elaboração. Cálculos e API preservados. |
| Cadastros financeiros | Conferir parâmetros preparados na implantação | Consulta de clínica, profissionais, convênios e preços; solicitar alterações à implantação. Sem painel técnico improvisado pelo papel admin. |
| Configurações | Encontrar responsabilidades e preferências | Visão geral agrupada, menu lateral e seleção móvel, cadastro profissional consultável, copiloto efetivamente desligado inclusive para preferência antiga ativa. |
| WhatsApp e pré-consulta | Acompanhar canal, regras e respostas | Credenciais, conexão e manutenção técnicas com implantação. Regras operacionais continuam conforme permissão; avisos técnicos, inclusive histórico, orientam o responsável correto. |
| Equipe e delegações | Manter contas e autorizar a agenda | Admin mantém a equipe; médico decide sua delegação e seu compartilhamento. Implantação prepara os acessos iniciais sem aprovar pelo titular. |
| Modelos e conhecimento | Personalizar ferramentas do atendimento | Preferências e conteúdo profissional continuam disponíveis. Importar um protocolo/texto não é migração de prontuários. |
| Assistente | Apoiar o trabalho do médico | Disponível como ferramenta clínica; resultados de IA continuam exigindo revisão. Esta revisão não homologa respostas médicas nem faz chamada paga. |
| Segurança e privacidade | Controlar acesso pessoal e seus dados | Senha, MFA, consentimentos e autorizações pessoais não são transferidos ao operador Cortex. Exportação/exclusão não executadas nesta revisão. |
| Retornos e páginas públicas | Concluir ou explicar estados de acesso | Rotas de retorno sem código são auditadas como erro esperado; nenhuma integração real é autorizada pelo teste de UI. |

## Limites que continuam explícitos

- Consulta na UI não substitui ACL de campos/credenciais no servidor. Um papel interno de operador Cortex e seu processo auditado de alteração precisam de contrato próprio.
- Rascunhos financeiros são locais. A nova proteção cobre navegação, fechar/cancelar/trocar seção e operações em andamento; não promete persistência após fechar o navegador, rollback de escrita aceita ou preservação quando a leitura de acesso falha e a área é desmontada.
- A lista de fila mantém cache em refetch/erro; alterar isso sem desenho de retenção pode desmontar o atendimento em elaboração. Não declarar os cartões como leitura nova após falha.
- Banco, produtores de migração/assinatura/faturamento/WhatsApp e autorização real precisam de seus testes e aceites próprios. Revisão de interface, mocks e ausência de erro no navegador não provam esses serviços.

As evidências e versões das verificações estão em docs/reviews/2026-11-10/settings-setup/REVIEW.md. A implantação de uma clínica real segue o plano e suas autorizações; esta entrega é local, sem push, deploy, carga, envio ou emissão.
