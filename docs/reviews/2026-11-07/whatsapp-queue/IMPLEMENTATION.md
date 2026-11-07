# K1/4k — adaptador de mudança de fila

Base local: `346b8e4def914e1a39af94b7a9f433a33a97d38a`, main. Incremento independente do catálogo de responsáveis4j, ainda solicitado ao Claude; somente adaptador/contrato/provas, sem UI/C4/C5/SQL.

## Comportamento

Entrada estrita aberta/própria com fila atual não vazia<=128 e nova fila diferente, de1a40 caracteres ASCII minúsculos/números/hífen/sublinhado, primeiro alfanumérico. Não normalizar/truncar/inferir destino. Validação separa o primeiro caractere dos caracteres proibidos para rejeitar também terminadores de linha que a âncora JavaScript $ permitiria.

Corpo exato act/set_queue/conversationId/revision/queue. Ator/clínica/status/owner/currentQueue são contexto local, não autoridade enviada. Snapshot validado independente do objeto mutável do chamador; uma tentativa sem retry.

O recibo estrito open/revisão+1/dono preservado não inclui fila. Por isso o retorno local é {receipt,needsRefresh:true}, inclusive em sucesso de transporte. Nunca construir receipt.queue a partir do input. Consumidor futuro deve reler lista/detalhe, exibir somente fila lida e manter resultado inconclusivo se a conferência falhar. Erros após início e abort tardio também exigem leitura; preflight/pré-abort não enviam.

## Testes executados

- UNIT_RED.json: scaffold exportado ainda não implementado,65 testes falham/zero passam; não é reprodução de defeito anterior do produto.
- UNIT_GREEN.json:340 testes passam em sete arquivos:65 novos e275 anteriores (52transferência/51reabertura/47encerramento/36devolução/34assumir/55leitura). Abrange wire exato, ausência de confirmação falsa da fila, mudança do input durante await, grammar/limites/no-op/autoridade injetada, recibos, erros e cancelamentos.
- SDK.json: Supabase JS2.86.0 real instalado com fetch só em memória. Onze grupos/dez POST sintéticos, incluindo sucesso que ainda exige leitura,409/403, dono/estado inesperados, queue-extra/extra, JSON truncado, resposta perdida, preflight e abort. Três hashes de fontes iguais antes/depois, zero rede real ou recurso inesperado.
- TypeScript global aprovado; ESLint nos três arquivos novos e node --check no script aprovados. Revisão adversarial registrada em VALIDATION.json.
- Cross-model skipped: non-interactive context.

`npx vitest run src/features/reception/whatsappQueue.test.ts src/features/reception/whatsappTransfer.test.ts src/features/reception/whatsappReopen.test.ts src/features/reception/whatsappClose.test.ts src/features/reception/whatsappRelease.test.ts src/features/reception/whatsappClaim.test.ts src/features/reception/whatsappApi.test.ts --pool=forks --maxWorkers=1 --reporter=json --outputFile=node_modules/.cache/whatsapp-queue-green.json`

`node scripts/reviews/whatsapp-queue-sdk.mjs`

`npx tsc --noEmit`

`npx eslint src/features/reception/whatsappQueue.ts src/features/reception/whatsappQueue.test.ts scripts/reviews/whatsapp-queue-sdk.mjs`

`node --check scripts/reviews/whatsapp-queue-sdk.mjs`

## Produtor e limites

Leitura de whatsappHandlers.ts, act, e migration20261106100000, whatsapp_conversation_action: set_queue só grava queue/revisão; retorno comum omite queue. Nenhum campo novo solicitado ao dono, nenhum writer/política ampla alterado. [Contrato](../../../product/clinic-crm/WHATSAPP_QUEUE_COMMAND.md). Próximo4l: controle/confirmar fila por pessoa, contexto fresco/exclusão/conferência/readVersion e resultado inconclusivo sem retry.

Sem navegador/banco/servidor/Meta/mark_read/send/carga/hosted/push. SDK falso no transporte não prova fila aplicada, autorização, RLS, SQL, CAS ou concorrência reais. Não declarar suíte Vitest global verde: os dois RED C5 existentes não pertencem a esta suíte dirigida. Catálogo4j continua com dono C4; Claude/SaaS/PersonalMed e dirt em tasks/plan.md/tasks/todo.md preservados.
