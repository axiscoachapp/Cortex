# K1/4i — transferência para destinatário explícito

Base local: `336f3648eaa9367bfd148822c31f311842661420`, branch main. Recorte só do adaptador; nenhuma tela, endpoint, migration ou arquivo C4/C5 do Claude alterado.

## Comportamento

`whatsappTransfer.ts` exige snapshot estrito de conversa aberta sob o ator esperado e outro targetUserId UUID explícito. A validação gera um snapshot independente do objeto do chamador. Corpo exato: action act, operation assign, conversationId, revision e targetUserId. O alvo é parâmetro da ação no transporte; ator/clínica/status/proprietário locais ficam fora do corpo e não são autoridade.

Só aceita recibo estrito open/revisão+1/assignedTo igual ao alvo validado, com UUID normalizado. Alvo ausente/nulo/igual ao próprio ator é recusado antes do envio; recibo do chamador (fallback de Assumir) ou de outra pessoa é inconclusivo. Sem retry automático. Erros depois do início, recibos inválidos e cancelamento tardio exigem leitura de conferência; cancelamento antes do envio não envia nem promete rollback.

## Evidências

- UNIT_RED.json: stub exportado sem implementação, 52 testes falham/zero passam. RED de scaffold, sem alegar defeito prévio no produto.
- UNIT_GREEN.json: 275 testes passam em seis arquivos: transferência52/reabertura51/encerramento47/devolução36/assumir34/leitura55. Casos cobrem limites da revisão, autoridade injetada, destinatário explícito, mutação do alvo durante await, recibos inválidos, whitelist de erros e cancelamento.
- SDK.json: SDK Supabase instalado2.86.0, fetch inteiramente em memória; onze grupos de verificação/dez POST sintéticos. Sucesso,409,403,fallback do ator, terceiro,estado errado,extra,JSON truncado,resposta perdida,cancelamentos/preflight. Nenhum retry/recurso inesperado ou rede real. Três fontes congeladas e hashes iguais antes/depois.
- TypeScript global aprovado; ESLint aprovado nos três arquivos novos de código/teste/script; node --check aprovado no script. Revisão adversarial somente leitura confrontou contrato, produtor, adaptador,52 testes e SDK, sem achado concreto.
- Cross-model skipped: non-interactive context.

Comandos executados:

`npx vitest run src/features/reception/whatsappTransfer.test.ts src/features/reception/whatsappReopen.test.ts src/features/reception/whatsappClose.test.ts src/features/reception/whatsappRelease.test.ts src/features/reception/whatsappClaim.test.ts src/features/reception/whatsappApi.test.ts --pool=forks --maxWorkers=1 --reporter=json --outputFile=node_modules/.cache/whatsapp-transfer-green.json`

`node scripts/reviews/whatsapp-transfer-sdk.mjs`

`npx tsc --noEmit`

`npx eslint src/features/reception/whatsappTransfer.ts src/features/reception/whatsappTransfer.test.ts scripts/reviews/whatsapp-transfer-sdk.mjs`

`node --check scripts/reviews/whatsapp-transfer-sdk.mjs`

## Catálogo e próximo recorte

Leitura do produtor: migration20261106100000, operação assign; handler whatsappHandlers.ts, ramo act. Recepção ativa ou admin ativo da mesma clínica são os alvos atualmente aceitos. O cliente restringe a aberta/própria/outro alvo, sem alterar a política ampla do writer. clinic_access da migration20261103001000 só devolve staff para admin e essa projeção não inclui todos os admins elegíveis. reception_team_doctors da20261104003000 é afiliação médica, não catálogo da caixa. Não oferecer um desses arrays por inferência.

[Contrato do adaptador](../../../product/clinic-crm/WHATSAPP_TRANSFER_COMMAND.md) e [proposta do catálogo](../../../product/clinic-crm/WHATSAPP_ASSIGNEES_PROPOSAL.md). Solicitação ao dono C4 para alinhar/implementar leitura assignees ou delegar explicitamente esse recorte. UI K1/4j depende dessa fonte fresca/autorizada, rótulos distinguíveis e confirmação alvo/conversa invalidada em troca de alvo/owner/revisão/readVersion/contexto; nunca UUID digitado nem fusão por nome.

## Limites

Não houve navegador, banco, servidor, Meta, carga ou operação externa. SDK com fetch em memória não prova disponibilidade/elegibilidade atual do alvo, autenticação/autorização servidor, RLS, SQL, CAS, concorrência ou idempotência reais. Catálogo é proposta não implementada e não altera writer/lifecycle. Sem validação visual da transferência ou afirmação de UI entregue. Testes dirigidos não são a suíte Vitest global: os dois RED C5 já registrados continuam fora deste recorte. Claude/SaaS/PersonalMed e alterações em tasks/plan.md e tasks/todo.md preservados. Sem push/deploy/hosted.
