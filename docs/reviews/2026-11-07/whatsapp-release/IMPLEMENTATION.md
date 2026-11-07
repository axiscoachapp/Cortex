# K1/4c — adaptador para devolver conversa à fila

Baseline `d8142f1d0d18f27da3b043824161dc9fe3869c44`. [Contrato do cliente](../../../product/clinic-crm/WHATSAPP_RELEASE_COMMAND.md), derivado de act/unassign no contrato WhatsApp v1.2 e no produtor f837c57, inspecionados sem alteração.

CLAIM: o adaptador confere o proprietário do snapshot local com o ator esperado e envia apenas act/unassign/conversationId/revision. Aceita somente recibo estrito open/revisão anterior+1/assignedTo null, não repete comandos e exige releitura depois de resultado inconclusivo.

`whatsappRelease.ts` mantém o escritor separado do leitor e não integra botão neste recorte. Schemas estritos, UUIDs normalizados e revisão PostgreSQL incrementável recusam entradas inválidas/injeção de ator/clínica/alvo/operação antes do transporte. assignedTo e expectedActor só servem à conferência local. O erro específico herda WhatsAppClaimError para preservar a classificação needsRefresh no reconciliador existente; testes conferem ambas as classes. Mensagens locais não mostram respostas ou erros brutos.

36 RED de comportamento sobre scaffold sem implementação;125 Vitest/três arquivos verdes:36 novos,34 do comando de assumir e55 do leitor. `UNIT_RED.json`/`UNIT_GREEN.json` preservam os resultados. TypeScript global, lint dos três arquivos novos e sintaxe do script aprovados. Dois RED C5 preexistentes estão fora desta suíte dirigida; não se declara suíte global verde.

`SDK.json`: SDK Supabase2.86.0 instalado com fetch inteiramente em memória; snapshots de release/claim/functionErrors transpilados e três hashes estáveis antes/depois. Nove verificações/oito comandos: recibo positivo, stale, forbidden, responsável não removido, campo extra, JSON200 truncado, resposta perdida e cancelamento após envio. Pré-cancelamento, alvo injetado e proprietário diferente não enviam nada. Cada chamada transportada fez exatamente um fetch com corpo fixo e sem identidades locais. Nenhum cabeçalho/credencial ou resposta bruta é gravado no relatório.

A conferência de proprietário local não garante autorização do servidor. O produtor atual autoriza recepção/admin para unassign sem devolver o proprietário anterior; nenhuma ampliação/restrição dessa política foi implementada ou provada. O SQL existente remove assigned_to/assigned_at e incrementa revision, deixando fila/estado/vínculos intactos. Não executamos banco, servidor, navegador, Meta ou rede real. O ensaio não demonstra CAS/RLS/concorrência/idempotência reais nem operação visível na interface.

Abort antes do transporte é local e needsRefresh=false. Erros iniciados/abort tardio/recibo inválido são needsRefresh=true; nunca prometem rollback ou sucesso e não recebem retry automático. Próximo K1/4d: botão apenas em conversa aberta sob responsabilidade do usuário, escopo/detalhe frescos, clique explícito e reconciliação por gerações já existente, antes de qualquer repetição humana.

Revisão adversarial independente dos quatro arquivos contra contrato, dependências e produtor em leitura concluiu sem achados concretos. Cross-model skipped: non-interactive context.

Reprodução: `npx vitest run src/features/reception/whatsappRelease.test.ts src/features/reception/whatsappClaim.test.ts src/features/reception/whatsappApi.test.ts --pool=forks --maxWorkers=1`; `node scripts/reviews/whatsapp-release-sdk.mjs`. O segundo grava SDK.json desta prova e não utiliza fetch de rede.

Sem UI/mark_read/envio/close/reopen/transferência/consentimento/agenda/identidade inferida, produtor Claude/SQL/migration/hosted/PersonalMed/SaaS/push. C4/C5 continuam aguardando os SHAs do dono e não são aprovados por este adaptador.
