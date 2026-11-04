# Revisão técnica cruzada do servidor de documentos

04/11/2026. Artefato `3eeff7c`, com contexto `defec30`. Revisão técnica de autorização, entrada e snapshot; não é aprovação clínica/regulatória ou de publicação. Nenhum arquivo de prescrição do Claude foi alterado pelo Codex.

Não identifiquei nova escrita em `patients` ou cadastro: endereço local alimenta o plano do documento, `content` e snapshot. Leitura do paciente/consulta continua vinculada ao usuário autenticado; não foi encontrado novo bypass de dono ou HTML injection na leitura local.

Dois achados P2 confirmados pelo Codex após revisão independente:

| Achado | Evidência sintética | Ação do dono |
|---|---|---|
| Endereço aceito é cortado silenciosamente em 300 caracteres | Entrada de 373 caracteres com cidade/UF no final produz plano válido com 300 e perde o sufixo. `planControlledPrescription` usa `address.slice(0,300)` | Validar limite e recusar excesso explicitamente ou preservar todo valor aceito; testar sufixo e coerência entre PDF/content/snapshot |
| Concentração/dose preenchida não participa da classificação | Item de catálogo com `name: Tramadol` e `dosage: 50 mg` retorna erro pedindo dose; `findingsOf` usa só nome/ingredientes | Definir concentração/apresentação no contrato de entrada e aproveitá-la de forma não ambígua; não usar posologia arbitrária como fato de concentração |

Reproduções somente com funções puras em memória, sem emissão, persistência ou dados reais. 34 testes de três suítes (`clinicalHandlers`, `controlledPrescription`, `prescriptionDocuments`) passaram pelo Codex; 60 testes em quatro suítes foram relato do revisor independente, não a mesma execução. Casos acima ainda precisam entrar na regressão do dono. Tipos `prescriber_cpf` regenerados em banco descartável: três linhas e `npm run typecheck` aprovado.

CAS de cadastro/revisão, endereço local com proveniência e ligação de consulta–agenda são contrato futuro T34, não garantias implementadas neste commit. Pareamento apenas por mesmo médico/pessoa/dia fica candidato de staging, não vínculo clínico aprovado. Correções do servidor e revisão do contrato seguem na mensagem Codex de 10:15.

## Reteste do commit `e32a60c`

Às 10:29, revisão do patch do dono e **36 testes/3 suítes aprovados pelo Codex**: excesso de endereço agora é recusado; campo explícito `concentration` participa do plano, impressão e snapshot. Os exemplos originais estão tratados, sem afirmar integração visual ou aprovação de produção.

Novo P2 reproduzido em função pura: a busca parcial por `mg` aceita `50 mg + 0,15 g`, `50 mg/5 ml`, `-50 mg` e `0 mg` como valor por unidade. Contrato exige valor positivo inequívoco de um componente; validar a expressão inteira ou usar campos estruturados, sem selecionar apenas um fragmento. `50 mg` aceito e `150 mg` recusado são controles positivos/negativos. Pedido de correção enviado ao dono na mensagem 10:29, sem editar seus arquivos. Nenhuma recomendação clínica ou conclusão regulatória é derivada desses exemplos sintéticos.

## Reteste do commit `46aea29`

Recebido na mensagem Claude 10:31 e conferido pelo Codex: `mgPerUnit` exige a expressão inteira, valor positivo e unidade suportada; solução/associação/valor ambíguo não são convertidos automaticamente. As quatro entradas acima passaram a ser recusadas em reprodução independente em memória; `50 mg` aceito e `150 mg` recusado preservados. **49 testes/4 suítes** (`clinicalHandlers`, `controlledPrescription`, `prescriptionDocuments`, `regulatedMedications`) aprovados pelo Codex nesta rodada. O achado específico está atendido. Sem nova emissão/persistência ou revisão regulatória, sem afirmar suporte às apresentações recusadas ou conclusão da UI, que permanece com Claude.
