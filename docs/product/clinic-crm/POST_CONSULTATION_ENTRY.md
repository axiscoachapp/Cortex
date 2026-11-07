# K7/3a — entrada de pós-consulta na evolução salva

A última mensagem SOAP da conversa exibe uma etapa “Pós-consulta” quando possui o ID da consulta persistida. Revisão ainda não salva, mensagem sem ID ou última evolução em edição não exibem essa etapa. Não usa o ID transitório global do painel para decidir a disponibilidade. O conteúdo e o ID usados pelos documentos são os dessa evolução.

Resumo para paciente e encaminhamento mantêm seus comandos explícitos existentes. Receita/atestado abre o compositor existente, vinculado ao ID exato da consulta. “Orientações e retorno” abre o acompanhamento do paciente já selecionado, com sua propriedade fresca, registros/revisões e guardas de texto não salvo; fechar devolve foco à ação. Nada é marcado como concluído ou criado por abrir a etapa.

Não há envio WhatsApp, marcação automática de retorno, assinatura ou geração ao montar. Retorno continua sendo registro clínico sob decisão do médico; agendamento requer confirmação humana no fluxo existente. A automação `after_end` e os módulos de prescrição/assinatura não mudam.

Este é o primeiro recorte de pós-consulta: organiza ações existentes e a entrada no acompanhamento. Não cria checklist persistente de conclusão por consulta ou vinculação automática dos novos registros à consulta; essa extensão fica para K7/3b com contrato próprio. Registros/tarefas já salvos permanecem no paciente. A etapa é contextual à evolução presente na conversa atual, sem promessa de restaurar essa conversa após reload.
