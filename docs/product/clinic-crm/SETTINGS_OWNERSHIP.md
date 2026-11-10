# Configurações da clínica com implantação assistida

Pedido do usuário em10/11/2026: especialidade e cadastro do prescritor são configurados pela equipe Cortex, copiloto ao vivo desativado e configurações reorganizadas. Este pedido autoriza o recorte de UI e comportamento local; não autoriza operação hospedada, emissões, envios ou um novo papel de operador no servidor.

## Responsabilidades

| Área | Implantação Cortex | Clínica e usuários |
|---|---|---|
| Especialidade e prescritor | Cadastrar por médico e conferir com o responsável; corrigir mediante solicitação. | Consultar os próprios dados e informar correções. |
| Modelos de evolução | Preparar a estrutura inicial acordada. | Médico pode escolher seu modelo de trabalho existente. |
| Copiloto ao vivo | Manter desativado nesta entrega, inclusive se uma preferência antiga estiver ativa. | Não há botão para ativar. Gravação e evolução final continuam independentes. |
| WhatsApp | Credenciais Meta, conexão técnica, webhook e manutenção do número. | Consultar estado e, com permissão existente, administrar regras operacionais e modelos aprovados. |
| Agenda e assinatura | Preparar aplicativo/provedor e validar a integração. | Cada médico autoriza sua própria conta/sessão; senha, MFA e certificado permanecem sob seu controle. |
| Pré-consulta | Preparar formulário inicial com a clínica. | Administração autorizada pode manter perguntas; equipe acompanha respostas na operação. |
| Contas, equipe e agenda | Preparar usuários e escopos iniciais, treinar o administrador. | Administração mantém equipe; médico aprova/revoga sua delegação. Setup não equivale a autorização para abrir prontuários. |
| Financeiro | Preparar cadastros, contratos, tabelas e validar com o responsável da clínica. | Clínica registra cobranças/pagamentos e confere resultados conforme os papéis existentes. |
| Segurança e privacidade | Preparar ambiente, recuperação, suporte e tratamento das solicitações autorizadas. | Usuário mantém senha/MFA e decide sobre os fluxos pessoais disponíveis. |

## Experiência

Configurações abre num resumo organizado por responsabilidade. Navegação lateral no desktop e seleção agrupada no celular; sem longa faixa horizontal. Preferências do médico, rotina da clínica, implantação/conexões e conta são grupos distintos. Links antigos por secao continuam funcionando e parâmetros de delegação são preservados.

Especialidade e prescritor aparecem em consulta, com estado de carregamento/erro e informação de quem corrige; sem campos editáveis ou CPF integral. Nenhum status global declara a implantação pronta só porque nome/CRM/endereço existem. O seletor de modelo continua sendo preferência pessoal. Retirar os avisos que mandavam o médico preencher cadastro técnico. Onboarding passa a orientar o primeiro uso, sem apresentar importação ou credenciais como tarefa obrigatória do médico.

WhatsApp mantém estado/erros/atualização de modelos e regras operacionais já permitidas; retirar formulário de IDs/token/PIN/webhook e desconexão técnica da interface da clínica. Não criar painel interno usando o papel admin da clínica como se fosse operador Cortex. Readonly na UI não altera a ACL dos endpoints existentes: gestão do operador requer contrato/backend próprio antes de uma implementação correspondente.

## Entrega e aceite

- UI sem seleção de especialidade, editor do prescritor ou ativação do copiloto em página, atalho ou onboarding.
- Copiloto efetivamente false mesmo com live_copilot_enabled legado true; nenhuma escrita automática ou mudança no produtor.
- Preferências continuam salvando somente active_template_id pelo RPC existente; leitura falha não permite escolher como se estivesse carregada.
- WhatsApp não solicita credenciais nem desconexão técnica; operação existente segue por capacidade do servidor.
- Papéis clínico/secretaria/admin preservados, sem email especial, acesso de operador inferido ou compartilhamento automático.
- Arquivo separado Plano de implementação.md cobre implantação do zero, dependências, donos, validação, pendências e entrada em operação.
- Testes de comportamento, regressão de documentos/assinatura, tipos/lint/build e navegador isolado sintético. Sem chamadas pagas, dados reais, banco hospedado, push ou deploy.

Implementar nos componentes de configurações, hook de preferências e avisos consumidores. APIs/SQL/fiscal/PersonalMed continuam com Claude. Comandos: node node_modules/vitest/vitest.mjs run nos testes afetados --maxWorkers=2; npm run typecheck; lint dos caminhos alterados; build com domínio .invalid. Rever com contexto independente antes do commit local main/axiscoachapp, somente paths próprios.

## Ampliação de revisão integral

Usuário autorizou frentes paralelas para revisar e corrigir o app inteiro: clínico/pacientes/perfil, recepção e financeiro. Migração de pacientes é assistida, mantendo importadores existentes fora da rotina do médico. Cadastros financeiros técnicos ficam em consulta; operações de cobrança/recebimento/lotes conservam seus papéis e passam a proteger rascunhos. Avisos locais e recusas de dados profissionais orientam a implantação; a geração e as regras continuam autoritativas no servidor, que pode enriquecer a classificação pelo catálogo. Não bloquear localmente toda classificação inconclusiva. Não emitir ou enviar nada real durante a revisão.
