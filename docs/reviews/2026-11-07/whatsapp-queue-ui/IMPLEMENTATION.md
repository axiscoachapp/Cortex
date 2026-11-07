# K1/4l — mudar fila na conversa

Base `ded70b56456e37b5f1a7b4ed305697ec7123d4c3`, main; [contrato](../../../product/clinic-crm/WHATSAPP_QUEUE_UI.md). Conversa fresca aberta/própria oferece Mudar fila, entrada explícita e confirmação mostrando contato/fila atual/destino. Vazio, inválido e mesma fila não enviam; Cancelar/Escape limpam rascunho e restauram foco. Confirmação usa alvo atual e expira por id/revisão/readVersion/owner/fila/contexto, inclusive refetch imediato idêntico.

Compartilha mutex, gerações, cancelamento de observação e conferência dos comandos existentes. Sempre relê lista/detalhe após início, incluindo recibo válido: act não informa queue. Feedback neutro não promete destino aplicado; fila visível vem da nova leitura, inclusive se outra mudança ocorreu. Se a leitura falhar, detalhe oculto e comandos bloqueados; Conferir conversa só relê. Contexto trocado ignora resultado tardio, sem prometer rollback ou retry.

## Provas finais

- UNIT_RED.json: uma reprodução dirigida do botão inexistente; outros casos fora do filtro, sem alegar27RED. UNIT_GREEN.json após a correção final:488 casos/doze arquivos/zero falhas,27novos de UI,121 anteriores de UI e340 dos adaptadores/leitura.
- FIXTURE_RED.txt: uma reprodução dirigida400/200, antes da implementação opt-in. FIXTURE_GREEN.txt:26 casos/seis arquivos. Novo modo exclusivo set_queue, outros modos preservados, mutação só de fila/revisão; replaced simula segunda mudança posterior ao recibo. Política ampla do produtor separada da elegibilidade local.
- Revisão encontrou P2: maxlength nativo cortava41 para40 caracteres, podendo habilitar outro destino. LIMIT_RED.json preserva reprodução real, três estados/zero comandos/cleanup. Removido maxlength; o navegador final exige texto integral41 e confirmação desabilitada. Segunda revisão não encontrou novo achado concreto.
- [AUDIT final](../../2026-11-05/reception-app-audit/whatsapp-queue-ui-reviewed-final/AUDIT.json):60estados/76PNGs em320,375,1280,1920px/135%.339fontes congeladas/31hashes runtime/três overlays estáveis/cleanup.232requests/172chamadas de fixture;16set_queue sintéticos (12aplicados/4conflitos). Quatro403/quatro409 e oito console errors deliberados; zero demais falhas de rede, JS ou externos. Sem leitura clínica ou outros comandos. Capturas320 de confirmação/ações/limite e1920 inspecionadas; em320 nome extremo usa rolagem interna para alcançar ações.
- Tipos globais, lint de nove arquivos, sintaxe de cinco scripts, oito combinações CLI inválidas e controle de omissão explícita do novo diálogo no snapshot aprovados. Sem Chrome DevTools MCP disponível; usado o ensaio existente com Edge/perfil isolados e SDK real sobre HTTP loopback sintético.
- Cross-model skipped: non-interactive context.

Comando principal: `node scripts/reception-app-audit-browser.mjs --baseline=ded70b56456e37b5f1a7b4ed305697ec7123d4c3 --only=whatsapp-read --check-whatsapp-queue --overlay=src/features/reception/WhatsAppInbox.tsx --overlay=src/features/reception/WhatsAppMessages.tsx --overlay=src/features/reception/WhatsAppQueueAction.tsx --run=whatsapp-queue-ui-reviewed-final`.

Vitest dirigido: WhatsAppQueueUI/ReopenUI/CloseUI/ReleaseUI/Inbox e whatsappQueue/Transfer/Reopen/Close/Release/Claim/Api, `--pool=forks --maxWorkers=1`. Node dirigido: whatsapp-queue/reopen/close/release/claim/read-api.node-test.mjs. `npx tsc --noEmit`; ESLint dos quatro arquivos de UI/teste e cinco scripts alterados, sem fix automático.

## Limites e continuidade

Só a execução final revisada compõe o GREEN. O primeiro56-estados, o RED de limite e a rodada acidental da fixture anterior após uma guarda de edição interrompida foram excluídos; nada foi alterado no runtime durante ensaios ativos. Nenhuma operação real/Meta/mark_read/send/banco/hosted/carga/PersonalMed/push. Não prova SQL/CAS/RLS/concorrência/autorização do produtor ou aplicação real de fila. Dois RED C5 existentes fora desta suíte dirigida; não declarar Vitest global verde.

Catálogo/seletor de transferência4j continua no pedido0506 ao Claude, sem bloqueio deste recorte. Outros comandos/MFA/K7 continuam em incrementos próprios. C4/C5 e trabalho Claude/SaaS/PersonalMed preservados. Nenhuma mensagem nova dirigida ao Codex;2152 já atendida/0515 informativa suficiente, sem confirmação duplicada.
