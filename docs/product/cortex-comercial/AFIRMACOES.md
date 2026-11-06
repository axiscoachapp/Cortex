# O que o site e os materiais de venda podem afirmar

Atualizado em 6 de novembro de 2026. Antes de publicar uma frase nova, confira esta lista; quando o produto mudar, atualize a linha.

**Legenda:**
- **Sim:** pode afirmar.
- **Com ressalva:** só com a qualificação indicada.
- **Ainda não:** não afirmar.

| Tema | Afirmação | Situação | Base |
|---|---|---|---|
| Prontuário | Histórico longitudinal por paciente: consultas, evoluções, alergias, medicações em uso, arquivos e linha do tempo | Sim | App atual |
| Consulta | Grava a consulta e a IA prepara a transcrição e um rascunho da evolução no formato do médico. O médico revisa antes de salvar. | Com ressalva: "rascunho para revisão"; nunca "escreve por você" | `transcribe-consultation`, `finalize-consultation` |
| Consulta | Resumo pré-consulta do histórico e sugestões de perguntas | Com ressalva: "gerado por IA, para conferência" | `generate-prebriefing`, `suggest-questions` |
| Assistente | Perguntas sobre o prontuário com indicação da fonte | Sim | `chat-assistant` |
| Documentos | Receita simples, receita de controle especial (listas C1 e C5), pedidos de exame, atestados e orientações, com modelos do próprio médico | Sim | App atual. As listas A e B continuam no talão numerado. |
| Documentos | Busca de exames pela TUSS, de diagnósticos pela CID-10 e de medicamentos pela DCB/CMED | Sim | Catálogos carregados em 06/11 |
| Assinatura | Assinatura digital ICP-Brasil com certificado em nuvem | **Com ressalva:** "em implantação". Só vira "Sim" depois de configurada com a Valid (VIDaaS) e testada por um médico. | Código pronto, sem credencial do PSC |
| Agenda | Agenda por médico e da clínica, com conflito de horário tratado | Sim | App atual |
| Agenda | Sincronização com Google Agenda | Com ressalva: "opcional" | Código pronto; precisa de credencial Google por implantação |
| Recepção | Fila de atendimentos, contatos, agenda da clínica e equipe da recepção | Sim | `/recepcao` |
| Recepção | A recepção não vê o conteúdo clínico; o médico autoriza o que ela pode fazer na agenda dele | Sim | Delegação com pedido e decisão do médico |
| WhatsApp | Caixa de conversas da recepção, lembretes e confirmações pelo WhatsApp oficial | **Ainda não.** Pode aparecer como "em breve". | Em desenvolvimento (C4, K1–K3) |
| Pendências | Lista de tarefas clínicas por paciente | Sim | `/trabalho` |
| Conhecimento | Base de protocolos da clínica consultada pela IA | Sim | `/conhecimento` |
| Compartilhamento | Compartilhar um prontuário com outro médico de forma explícita e revogável | Sim | `/compartilhamento` |
| Segurança | Segundo fator de autenticação (aplicativo autenticador), acesso por papel, registro de acessos ao prontuário | Sim | MFA TOTP, RLS, `chart_access_audit` |
| Privacidade | Exportação dos dados e pedido de exclusão com recibo | Sim | `/privacidade` |
| Hospedagem | "Dados hospedados no Brasil" | **Ainda não** para o ambiente atual (us-west-2). Novas implantações em São Paulo (D11) só depois de criadas e conferidas. | Supabase |
| IA | "A IA não usa seus dados para treinar modelos" | **Ainda não.** Depende do contrato do provedor (D13, integração A0). | Termos do provedor atual não cobrem uso clínico |
| IA | A IA só roda quando o médico aciona; o que ela gera fica como rascunho | Sim | App atual |
| Migração | Migramos o histórico do sistema anterior, com ensaio completo e conferência antes da virada | Com ressalva: não citar número de prontuários nem o nome da clínica. Pode citar o PersonalMed como sistema de origem. | Ensaio completo em staging |
| Dispositivos | Funciona no navegador do computador, do tablet e do celular, sem instalar nada | Sim | App responsivo |
| Rascunhos | Rascunho da consulta não se perde se a página fechar | Sim | Rascunhos locais recuperáveis |
| Conformidade | "Certificado", "homologado", "100% LGPD", "aprovado pelo CFM" | **Ainda não** | Sem certificação |
| Clientes | Nome, logotipo ou depoimento da Haddad Nicola ou dos médicos | **Ainda não.** Exige autorização por escrito. | — |
| Tempo | "Economize X horas por dia" | **Ainda não.** Sem medição. | — |
