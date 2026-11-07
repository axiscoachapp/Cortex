# K1/5a — modelos armazenados para a recepção

O novo leitor consulta apenas `action: templates`, com cancelamento e erros locais seguros. Valida campos, limites e unicidade de nome e idioma; preserva ordem e texto, inclusive status desconhecidos. Não infere parâmetros ou aprovação para envio. [Contrato](../../../product/clinic-crm/WHATSAPP_TEMPLATES_READ.md).

Partida: `6949ca2fcc31c09c7886d22e1fd67b6c10aeb520`. Os 58 testes novos falharam no scaffold antes da implementação; depois passaram. A suíte final tem 176 testes em quatro arquivos: 58 novos, 55 de leitura existente, 27 de fila e 36 de retirada de autorização. [RED](UNIT_RED.json), [GREEN](UNIT_GREEN.json), [validação](VALIDATION.json).

O SDK instalado 2.86.0 passou 11 grupos com dez POST sintéticos, todos com corpo exato da leitura, dois hashes de fonte estáveis e transporte exclusivamente em memória. Inclui vazio, duplicatas, limite, campos extras, resposta truncada, recusa, indisponibilidade e cancelamento. [Registro](SDK.json). Sem acesso à rede ou banco.

A checagem real da aplicação, `npx tsc --noEmit -p tsconfig.app.json --pretty false`, encontrou 15 erros em dois testes anteriores do Codex. Foram removidas opções `exact` não suportadas em buscas por papel e tipados os patches como `Partial<WhatsAppConversation>`. [Diagnósticos anteriores](TYPES_RED.txt). Os dois arquivos foram comparados com HEAD revertendo apenas essas mudanças, sem outra alteração. A checagem completa ficou verde; lint de cinco arquivos e sintaxe do script também passaram. A chamada de tsc na raiz, com `files: []`, não foi considerada prova; probes preparatórios sem declarações de ambiente/setup foram excluídos.

Revisão adversarial com contexto novo conferiu os quatro artefatos do leitor, o produtor/schema C4 e a cadeia de fetch do SDK, sem achados concretos. Foi revisão estática; o revisor não executou banco, rede ou browser. Cross-model skipped: non-interactive context.

A próxima fatia K1/5b é a UI somente de consulta, com acesso/conexão atuais, isolamento por ator e clínica, descarte de respostas antigas, texto literal e estados de erro/vazio separados. Vazio não comprova conexão. Sem cursor ou total no produtor, este leitor não garante catálogo completo. K1/4j continua dependente do catálogo de responsáveis solicitado ao Claude em 0506.

Sem mudança de produtor, C5, schema, PersonalMed ou SaaS. Não houve sincronização, envio, carga real, operação hospedada ou push. Não é validação de autorização real nem da suíte Vitest inteira; os dois RED C5 conhecidos ficaram fora da seleção.
