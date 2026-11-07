# K1/4n — retirar autorização na conversa

Base `eacf79d49e430f69c35bcfa8eab7b438fab285ac`, main; [contrato](../../../product/clinic-crm/WHATSAPP_REVOKE_CONSENT_UI.md). Ação só em detalhe fresco aberto/próprio/consented true, revisão incrementável e waId conhecido (7..15 dígitos ASCII). Não inferir telefone de BSUID/contato/paciente. Confirmação identifica contato/telefone e explica efeito sobre outras conversas do mesmo número; mensagens já preparadas/enviadas podem continuar. Cancelar/Escape não enviam e restauram foco.

Key da confirmação inclui id/revisão/readVersion/owner/waId/consented/optedOut/contexto. A lista também tem versão local por leitura bem-sucedida, nunca enviada; key do detalhe inclui snapshot selecionado/geração/versão da lista. Isso descarta confirmação em atualização de owner/telefone/revisão ou refetch coalescido idêntico da lista e força releitura do detalhe.

Mutex/conferência/gerações compartilhados com outros comandos; sempre reler lista/detalhe após início, inclusive recibo válido sem flags. Vigente/Não vigente e optedOut vêm só da leitura fresca; nenhum sucesso/flag de retirada inferido. Leitura recusada oculta detalhe/bloqueia comandos, só retry de leitura. Contexto trocado aborta observação sem prometer rollback. Aviso do telefone marcado para não receber lembretes não atribui pedido à pessoa por inferência.

## Evidências

- UNIT_RED.json: uma reprodução dirigida do botão inexistente, demais casos fora do filtro. UNIT_GREEN.json/VALIDATION.json:579testes aprovados/zero falhas em14arquivos,36novos de UI; não é Vitest global.
- FIXTURE_RED.txt: uma reprodução dirigida400/200. FIXTURE_GREEN.txt:32casos/sete arquivos. Modo exclusivo revoke_opt_in, variantes sintéticas de um telefone e outro número, sem fundir identidades. Mudança só de consentimento/optedOut/revisão; preserva dono/fila/status/vínculos/não lidas.
- Dois P2 da revisão tratados. LIST_RED.json final:2RED reais após esperar notificações da QueryClient. LIST_CONTROL.json: solução2GREEN; retirar só versão local da lista/key do snapshot faz os mesmos2RED, restauração byte a byte antes dos outros checks. Primeiras asserções síncronas eram inconclusivas e foram excluídas. SCOPE_RED.txt: mudança posterior no outro telefone reativava o primeiro; modo regranted agora deriva variantes do alvo. É simulação de outro operador, sem endpoint de concessão disponível no ensaio.
- [AUDIT final](../../2026-11-05/reception-app-audit/whatsapp-revoke-consent-ui-reviewed-final/AUDIT.json):52estados/56PNGs320,375,1280,1920px/135%,343fontes congeladas/32hashes runtime/três overlays/cleanup.240requests/180chamadas de fixture;16revoke_opt_in sintéticos (12aplicados/4conflitos). Quatro403/quatro409 e oito console errors deliberados; zero outras falhas de rede, JS ou externos. Nenhuma leitura clínica/mark_read/send/record_opt_in. Capturas finais320 das ações e1920 inspecionadas; nome extremo em320 usa rolagem interna para alcançar ações.
- Tipos globais, lint dos nove arquivos alterados, sintaxe de cinco scripts, nove combinações CLI inválidas e omissão do novo diálogo no snapshot aprovados. Ajuste final dos testes assíncronos também passou por tipos/lint. Sem Chrome DevTools MCP disponível; usado o runner existente Edge/perfil isolados, SDK real e HTTP loopback sintético.
- Revisão somente leitura, três rodadas incluindo reconciliação do controle assíncrono; nenhum achado adicional no final. Cross-model skipped: non-interactive context.

Comando browser: `node scripts/reception-app-audit-browser.mjs --baseline=eacf79d49e430f69c35bcfa8eab7b438fab285ac --only=whatsapp-read --check-whatsapp-revoke-consent --overlay=src/features/reception/WhatsAppInbox.tsx --overlay=src/features/reception/WhatsAppMessages.tsx --overlay=src/features/reception/WhatsAppRevokeConsentAction.tsx --run=whatsapp-revoke-consent-ui-reviewed-final`.

Vitest dirigido: WhatsAppRevokeConsentUI/QueueUI/ReopenUI/CloseUI/ReleaseUI/Inbox e whatsappRevokeConsent/Queue/Transfer/Reopen/Close/Release/Claim/Api, `--pool=forks --maxWorkers=1`. Node: whatsapp-revoke-consent/queue/reopen/close/release/claim/read-api.node-test.mjs. `npx tsc --noEmit`, ESLint sem fix automático e node --check dos scripts.

## Limites e continuidade

Só o browser reviewed-final e a suíte final validada contam como GREEN. Primeiro browser final/primeira suíte e asserções síncronas da lista excluídos; controle temporário explicitado e fonte restaurada exatamente com hash do browser. Nada mudou em runtime durante ensaios de navegador ativos. Textos TXT têm apenas espaços finais normalizados.

Não prova retirada real, SQL/CAS/RLS/concorrência/autorização do produtor, entrega futura ou cancelamento de mensagens já reservadas/enviadas. Nenhum C4/C5/SQL/prontuário/identidade/campo legal/PersonalMed alterado; sem Meta/hosted/carga/push. Os dois RED C5 existentes estão fora desta suíte, sem afirmação de Vitest global verde. Catálogo4j pedido0506 e outros comandos/MFA/K7 continuam separados.2152 já atendida/0548 informativa, sem nova mensagem de confirmação ao Claude; preservar SaaS/dirt em tasks/plan.md/tasks/todo.md.
