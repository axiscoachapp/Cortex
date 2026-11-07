# T46 — contexto da correção de contato

A janela fica vinculada ao ator autenticado, clínica, papel administrativo e contato da abertura. Mudança/perda de contexto ou sessão oculta retira campos e invalida a janela até fechar/reabrir, mesmo que o contexto original volte. DTO com outro id não monta o formulário. Uma solicitação já enviada pode ter sido concluída: nenhum aborto/rollback é prometido.

Salvar e recuperar compartilham uma trava síncrona. O envio usa snapshot dos campos com id/revisão congelados e mantém a conferência humana/telefone bruto. Respostas tardias não anunciam sucesso, fecham janela, substituem campos ou iniciam invalidação. A trava de saída é retirada quando o editor perde contexto. Cache relacionado é limitado às famílias com clínica explícita, no ator/clínica de origem; coincidência no texto da busca não amplia o alcance.

## Evidências

[Contrato](../../../product/clinic-crm/CONTACT_CORRECTION_CONTEXT.md), [controle](RED_CONTROL.json), [baseline](BASELINE_CONTROLS.json), [RED inicial](UNIT_RED.json), [RED salvar/recuperar](MUTEX_RED.json), [RED identidade](IDENTITY_RED.json), [GREEN](UNIT_GREEN.json), [CLI](CLI.json), [validação](VALIDATION.json).

Sete testes existentes passaram com contexto administrativo sintético no formulário original. Trinta novos casos produziram25RED/cinco controles antes da edição. Depois, dois testes reproduziram salvar/recuperar simultâneos antes do render; ambos foram corrigidos pela trava comum. Um teste recusou resposta de id diferente, acompanhado de um controle verde para mutação enfileirada após perda de contexto. Sem timeouts genéricos ou troca temporária de fontes. Final:125Vitest/sete arquivos (34novos), tipos reais da aplicação, lint5/sintaxe2/seis rejeições CLI pelo motivo esperado. Sete regressões originais de revisão congelada, confirmação humana, telefone e recuperação continuam verdes.

[Auditoria bruta](../../2026-11-05/reception-app-audit/contact-correction-context-final/AUDIT.json):20estados/36PNGs320–1920/135%,354fontes/38hashes/um overlay/cleanup.34requests de login/contexto/diretório/cadastro, quatro503/console deliberados e zero outras falhas/JS/clínico/criações/escritas/reservas/externos. Navegador administrativo real com transporte em loopback: rascunho conferido sem enviar, falha efetiva na releitura15s do acesso, janela retirada, recuperação latched, fechar e reabrir os valores originais sem confirmação. Capturas320/1920 inspecionadas; ações do diálogo alcançáveis no ensaio. Reabrir prova descarte/reset de conferência; não comprova releitura fresca do servidor.

## Revisão e limites

Uma revisão independente não encontrou achado acionável e rodou41testes da correção. Cross-model skipped: non-interactive context.

Contexto de ator/clínica/permissão/alvo, retornos tardios de escrita/recuperação/invalidação, cache por escopo, trava de operações e id incorreto são unitários; o navegador não envia correção. Mantida a política anterior de leitura/erro no mesmo contexto e rascunho congelado. Frescor/cancelamento desse leitor e ciclo dos vínculos ficam em recortes próprios. Não alterar isso silenciosamente como parte da proteção de contexto.

Sem API/RPC/SQL/schema/migration, importação, campos legais, inferência/fusão de identidade, produtor/C5/Claude/PersonalMed/SaaS, Meta, hosted, carga, paid, deploy ou push. Não prova autorização/transação/rollback no servidor. Nenhuma mensagem Claude nova/alterada (digest68igual);2152 já atendida, sem confirmação duplicada.4j0506/C4/C5 após SHAs continuam separados.
