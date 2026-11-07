# K1/4m — adaptador de retirada de autorização

Base `884c449ccbe04aa4159955e8c24fcf28b87386fc`, main; [contrato](../../../product/clinic-crm/WHATSAPP_REVOKE_CONSENT_COMMAND.md). Incremento só do adaptador, sem UI/SQL/produtor/C4/C5. Snapshot estrito open/próprio/consented literalmente true e revisão incrementável. Corpo exato act/revoke_opt_in/conversationId/revision, sem telefone/clínica/ator/status/dono/flag de consentimento como autoridade no transporte.

Recibo estrito open/revisão+1/dono preservado não informa flags. Retorno sempre {receipt,needsRefresh:true}, sem inferir consented:false ou optedOut:true. Leitura de conferência obrigatória inclusive com recibo válido; erros após início/abort tardio também inconclusivos. Preflight/pré-abort não enviam; snapshot imutável durante await, sem retry automático ou promessa de rollback.

## Evidências

- UNIT_RED.json:55 testes falham/zero passam contra scaffold exportado sem implementação; não representa defeito anterior no produto.
- UNIT_GREEN.json:395 testes passam/zero falhas em oito arquivos (55novos,65fila,52transferência,51reabertura,47encerramento,36devolução,34assumir,55leitura). Casos incluem wire exato, contexto/consentimento inválidos, limites da revisão, normalização de UUID, snapshot mutável, flags extras no recibo, erro seguro/perda de resposta e cancelamento.
- SDK.json: SDK instalado2.86.0 com fetch inteiramente em memória; onze grupos/dez POST sintéticos, nenhum recurso inesperado/rede real/retry. Sucesso permanece dependente de leitura,409/403,dono/estado/flags inesperados,extra,JSON truncado,resposta perdida,preflight/cancelamentos. Três fontes com hashes iguais antes/depois.
- TypeScript global aprovado, ESLint em três arquivos novos e node --check no script aprovados. Revisão adversarial registrada em VALIDATION.json.
- Cross-model skipped: non-interactive context.

Comandos: `npx vitest run src/features/reception/whatsappRevokeConsent.test.ts src/features/reception/whatsappQueue.test.ts src/features/reception/whatsappTransfer.test.ts src/features/reception/whatsappReopen.test.ts src/features/reception/whatsappClose.test.ts src/features/reception/whatsappRelease.test.ts src/features/reception/whatsappClaim.test.ts src/features/reception/whatsappApi.test.ts --pool=forks --maxWorkers=1 --reporter=json --outputFile=node_modules/.cache/whatsapp-revoke-consent-green.json`; `node scripts/reviews/whatsapp-revoke-consent-sdk.mjs`; `npx tsc --noEmit`; `npx eslint src/features/reception/whatsappRevokeConsent.ts src/features/reception/whatsappRevokeConsent.test.ts scripts/reviews/whatsapp-revoke-consent-sdk.mjs`; `node --check scripts/reviews/whatsapp-revoke-consent-sdk.mjs`.

## Escopo do consentimento e próximo recorte

Por inspeção do handler act e da migration20261106100000, o writer revoga opt-ins ativos por telefone/variantes na clínica e marca opted_out_at da conversa. Não é autorização por prontuário/paciente e pode afetar outras conversas do mesmo número. Nenhuma fusão de identidade/contato/campo legal/PersonalMed, concessão ou registro de opt-in. A operação de mudança de número incrementa revisão por leitura do SQL; não foi executada neste recorte.

UI4n deverá explicar efeito por telefone, exigir confirmação humana/contexto/detalhe frescos e vincular a confirmação a id/revisão/readVersion/owner/waId/consented/optedOut/contexto. Não prometer cancelar mensagens já reservadas/enviadas nem impedir toda resposta humana. Reutilizar exclusão/conferência/gerações e mostrar flags somente após releitura; nenhum efeito ao montar/selecionar.

## Limites

Sem navegador/banco/servidor/Meta/mark_read/send/hosted/carga/push. Mocks não provam retirada real, autorização do servidor, SQL/CAS/RLS/concorrência ou resultado das automações futuras. Política ampla do produtor intacta. Catálogo4j continua separado, assim como C4/bot/C5; os dois RED C5 não pertencem à suíte dirigida e não há afirmação de Vitest global verde. Claude/SaaS/PersonalMed e dirt em tasks/plan.md/tasks/todo.md preservados.
