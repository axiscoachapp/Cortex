# K1/4a — comando cliente para assumir conversa

Baseline `cdb429ca686df34efd4c1270d520e4365843656a`. [Contrato do cliente](../../../product/clinic-crm/WHATSAPP_CLAIM_COMMAND.md), derivado de act/assign no contrato WhatsApp v1.2 e do produtor f837c57, inspecionados sem alteração.

CLAIM: o adaptador envia apenas conversationId/revision e act/assign; ator esperado é validação local do recibo. Aceita somente revisão anterior+1/status open/assignedTo esperado, nunca repete automaticamente um comando e sinaliza releitura obrigatória após resultado inconclusivo.

`whatsappClaim.ts` é separado do cliente somente leitura. Entradas/recibos estritos e inteiros PostgreSQL incrementáveis; normaliza UUIDs. Injeção de ator/clínica/alvo/operação rejeitada antes da invocação. Erros locais seguros, sem texto bruto do SDK/servidor; needsRefresh=false só quando não começou o transporte, true nos erros/abort tardio/recibos inválidos. Uma resposta válida depois de cancelamento não é adotada. Nenhum cache/estado otimista/handler de UI ou comando de outro tipo foi adicionado.

32 RED de comportamento sobre scaffold sem implementação (a primeira coleta sem módulo foi descartada).89 Vitest/dois arquivos verdes:34 novos e55 do leitor anterior. `UNIT_RED.json`/`UNIT_GREEN.json` preservam resultados. TypeScript global, lint de três arquivos e sintaxe do script aprovados. Dois RED C5 preexistentes fora desta suíte dirigida permanecem; não se declara suíte global verde.

`SDK.json`: SDK Supabase2.86.0 instalado, adaptador e functionErrors transpilados de snapshots em memória com hashes antes/depois. Fetch totalmente em memória e nenhum servidor/navegador/rede real. Nove verificações (inclui cancelamento prévio e alvo injetado agrupados), oito comandos: recibo positivo, stale, forbidden, ator errado, campos extras, JSON200 truncado, falha de fetch e cancelamento após início. Cada invocação transportada fez exatamente um fetch com o corpo esperado, sem autoridade adicional; nenhuma resposta bruta ou cabeçalho de credencial no relatório.

O teste do SDK confirma transporte/validação no cliente. Não demonstra autorização, CAS, RLS ou idempotência do servidor; resultado perdido não recebe promessa de rollback. Nenhum produto de UI roda neste recorte, portanto não houve prova visual nem integração do botão. Assumir na UI exigirá conversa aberta/escopo atuais, confirmação humana, refresh de lista/detalhe e reconciliação antes de outro comando. Não chamar mark_read (ele envia recibo externo), nem inferir vínculo/identidade/agendamento.

Revisão adversarial independente dos três arquivos contra contrato, SDK instalado e produtor em leitura concluiu sem achados acionáveis. Cross-model skipped: non-interactive context.

Reprodução: `npx vitest run src/features/reception/whatsappClaim.test.ts src/features/reception/whatsappApi.test.ts --pool=forks --maxWorkers=1`; `node scripts/reviews/whatsapp-claim-sdk.mjs`. O script grava SDK.json no diretório desta prova e não usa fetch de rede.

Sem produtor Claude/SQL/migration/hosted/Meta/PersonalMed/SaaS/push. Correções C4/C5 continuam com o dono; o adaptador não aprova esses recortes nem habilita comandos no produto.
