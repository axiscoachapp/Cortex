# T39/2i — reteste independente da entrega médica

Atualização posterior: o corte do Histórico em 375 px foi corrigido em [T39/2j](PROFILE_HISTORY_LAYOUT.md), com 30 cenários aprovados. O relatório e a validação originais abaixo preservam a falha encontrada na entrega anterior ao ajuste.

Reteste da entrega `f2eb1894f416a99d9e0394f86f6e22636b9f70bd`, recebida pela resposta de 18:58. Os cinco arquivos médicos continuam idênticos à entrega; o navegador usa o snapshot atual `f1ca046a825cc2e74bda66297f5e4f58393836dc`, sem overlays. O runner compara as fontes com a entrega e exige que os cinco módulos tenham sido servidos.

O resultado mantém a aceitação visual pendente: o Histórico do perfil apresenta overflow horizontal de 7 px em 375 px, com o selo Última cortado. O [relatório completo](medical-delivery-final/AUDIT.json) registra 30 capturas, 29 casos aprovados e essa falha. O processo termina com código 1 após conferir dados, hashes e módulos servidos. Os demais cenários foram executados mesmo após esse achado.

## Cobertura

Dez cenários em 375, 1280 e 1920 px, com raiz em 21,6 px (135%) e relógio em 05/11/2026, 12h de São Paulo:

| Arquivo | Cenários e verificações |
| --- | --- |
| `PatientProfileDrawer.tsx` | Geral, Histórico e Documentos; nome completo, ações Perguntar à IA/Dossiê, abas sem sobreposição, mês/ano singulares, área de arquivos. O Histórico em 375 px contém o achado de 7 px. |
| `PatientManagement.tsx` | Título curto no celular e título completo nas telas maiores, campo Buscar pacientes, placeholder curto e link acessível do prontuário. |
| `Templates.tsx` | Modelos do Cortex e particular, nomes, títulos responsivos, botões Editar/Duplicar/Excluir com nome do modelo e prévia do texto sintético. |
| `KnowledgeBase.tsx` | Lista e fonte original, referência e texto preservados, data de revisão sem segundos (`04/11/2026, 16:21`). |
| `Assistant.tsx` | Campo inicial e campo após resposta, mesmo nome acessível e placeholder curto; uma pergunta sintética enviada para o mock por largura. |

As medições de texto consideram viewport, ancestrais que realmente recortam conteúdo e limite de linhas. O texto Documentos pode ultrapassar a própria coluna sem ficar escondido; isso é registrado sem produzir um falso corte. As abas também são comparadas entre si para detectar sobreposição. Os placeholders usam a fonte e o espaçamento reais.

Oito testes existentes em três arquivos aprovados (`PatientProfileDrawer`, `PatientManagement`, `KnowledgeBase`), além de tipos e lint dos cinco arquivos médicos. Sintaxe/lint dos scripts e três combinações inválidas de flags conferidos. Não foram criados testes unitários que apenas repetem os textos da entrega. A revisão local dos scripts corrigiu seletores de painel/título/link e conferiu o acúmulo de falhas; leitura final sem achado acionável no contrato delimitado. Revisão externa já dispensada pelo usuário.

Capturas inspecionadas em 375 px: [Histórico com o corte](medical-delivery-final/medical---patient-22222222-2222-4222-8222-222222222222-profile-history-375.png), [Pacientes](medical-delivery-final/medical--gerenciar-pacientes-patients-375.png), [Modelos](medical-delivery-final/medical--modelos-templates-375.png), [fonte original](medical-delivery-final/medical--conhecimento-knowledge-source-375.png) e [Assistente](medical-delivery-final/medical--assistente-assistant-initial-375.png).

## Isolamento e limites

API sintética em loopback, Edge isolado, fontes e classes congeladas, cache temporário exclusivo e descartado. A fixture opta por dados médicos de demonstração: duas consultas, dois modelos e uma fonte revisada. O estado de assinatura responde não configurado apenas no GET sintético; não se inicia assinatura nem se muda seu código.

Os dados da fixture são comparados antes/depois. Somente três chamadas explícitas ao Assistente sintético são permitidas; os demais contadores de IA e todas as escritas permanecem em zero. Não se confirma edição, aprovação, exclusão, indexação, importação, impressão, gravação ou envio externo. Os nomes completos de botões destrutivos são verificados sem acioná-los.

O [modo padrão](medical-delivery-final-default-verified/AUDIT.json) é retestado em nove estados do Início, com seus seis contadores originais e navegação por teclado. Isso verifica que a opção nova da fixture não muda seu contrato padrão.

As observações de rede são preservadas integralmente: `HEAD /rest/v1/patients` e, neste reteste, `HEAD /rest/v1/knowledge_documents`, ambas com HTTP 200 e `net::ERR_ABORTED`. A segunda tupla foi observada nas aberturas da fonte. Não se infere a causa desses eventos nem se aprova transporte com base neles; a validação separa essas observações de outros erros de rede, HTTP, console ou execução.

[Validação consolidada](MEDICAL_DELIVERY_VALIDATION.json) distingue evidência conferida de aceitação visual pendente. O ensaio não aprova todo o aplicativo, RLS, recuperação, integração real ou piloto. Nenhum arquivo de aplicação, Claude/SaaS, SQL ou Auth foi alterado; sem build global, banco hospedado, chamada paga, carga, deploy ou push.

## Continuação

T39/2j: corrigir o cabeçalho do Histórico do perfil em 375 px e repetir o cenário, preservando fonte histórica, tabs, datas, identificação e ações. T39/2 permanece aberta até esse retorno. T39/3, decisão de navegação, M2 e piloto seguem separados.

## Reexecutar

Use nomes de execução novos. O processo deve retornar falha enquanto houver um caso pendente:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=f1ca046a825cc2e74bda66297f5e4f58393836dc --run=medical-recheck --only=medical-delivery
```
