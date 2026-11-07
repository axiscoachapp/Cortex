# K1/6 — dados antigos ocultos durante consultas pausadas

Os gates de conexão, lista, mensagens e caminho do robô agora exigem fetchStatus idle para apresentar dados como atuais. O estado paused significa que uma leitura solicitada aguarda a rede; não aproveita status success do cache para manter controles antigos. [Contrato](../../../product/clinic-crm/WHATSAPP_PAUSED_READS.md).

Conexão pausada desmonta a caixa e a consulta de modelos; uma nova verificação exige reescolher a conversa. Lista pausada oculta linhas e detalhe. Mensagens pausadas ocultam corpo, flags e comandos, desfazendo confirmações. O caminho pausado oculta somente o percurso, mantendo o detalhe independente disponível. Mensagens de espera distinguem pausa de erro e vazio; refresh repetido fica desabilitado enquanto a leitura está em curso ou pausada.

Não foram alterados transporte, retry, refetch de foco/reconexão, revisões, comandos ou política do servidor. Uma leitura já solicitada pode continuar ao retornar a rede, sem restaurar confirmação ou repetir comando. Troca de contexto/inatividade descarta a observação antiga.

## Evidências

Base `7bfaaa1073af8ab96f629caf005b335b73f22563`, main. [Validação](VALIDATION.json).

- [UNIT_RED](UNIT_RED.json): dez falhas comportamentais e um controle que já passava. [RED_CONTROL](RED_CONTROL.json): mesmos testes refinados contra as três fontes originais, sem timeout genérico; solução restaurada byte a byte e por hash antes dos demais ensaios. A primeira rodada tinha um timeout de texto e a primeira GREEN esperava seleção sobreviver à desmontagem; essas expectativas foram corrigidas e não contam como prova final.
- [UNIT_GREEN](UNIT_GREEN.json):331testes/dez arquivos,11novos. Cobrem os quatro níveis, três confirmações removidas e não restauradas, refresh explícito/estado inicial/inatividade, nenhuma chamada iniciada durante pausa e retomada de leituras. Regressões de todos os comandos já integrados, modelos e leitura também passam. Não é Vitest global.
- [Browser](../../2026-11-05/reception-app-audit/whatsapp-paused-reads-final/AUDIT.json):27estados/27PNGs320,375,1280,1920px a135%,348fontes congeladas/34hashes runtime/três overlays estáveis e cleanup positivo. Contexto isolado realmente offline, estado de espera observado, contadores de messages/list não avançam até a rede voltar e depois avançam uma vez.56requests/39chamadas de fixture; um403/console403 deliberado na retomada, com recuperação explícita. Zero falhas de rede, JS, clínico, escrita ou externo; snapshot das conversas intacto. Capturas320mensagens/1920lista inspecionadas.
- O navegador cobre somente pausa de mensagens/lista e recuperação, em interrupções curtas. Não abre confirmação antes da pausa nem prova seu descarte, e não cobre pausa do canal/percurso ou indisponibilidade prolongada do gate de acesso. Esses estados de cache/confirmadores estão nos unitários; não desabilitamos a verificação de acesso real para o ensaio.
- Tipos reais da aplicação, lint dos seis arquivos, sintaxe dos dois scripts e [quatro combinações CLI inválidas](CLI.json) passam. Novo modo exclusivo reutiliza a allowlist estrita de auth/clinic_access/whatsapp-api; ações da fixture também ficam restritas a leitura. Sem Chrome DevTools MCP disponível; usado Edge do runner existente, perfil temporário, SDK real e HTTP loopback sintético.
- Revisão adversarial com contexto novo, somente leitura, sem defeito concreto. Limites de prova browser/unit foram incorporados ao relatório. Cross-model skipped: non-interactive context.

Comando browser: `node scripts/reception-app-audit-browser.mjs --baseline=7bfaaa1073af8ab96f629caf005b335b73f22563 --only=whatsapp-read --check-whatsapp-paused --overlay=src/features/reception/WhatsAppInbox.tsx --overlay=src/features/reception/WhatsAppMessages.tsx --overlay=src/features/reception/WhatsAppBotSession.tsx --run=whatsapp-paused-reads-final`.

Nenhuma fonte foi alterada durante o browser. Não houve confirmação, comando, marcação de leitura ou envio. Os testes não comprovam autorização real, rollback, SQL/RLS/CAS/concorrência ou Meta.

K1/T41 continuam abertos; transferência4j/catálogo0506 e retestes C4/C5 após SHAs permanecem separados. Nenhum incoming novo/2152 já atendida, sem troca de confirmação ao Claude. Nenhum produtor/C5/schema/prontuário/identidade/PersonalMed/SaaS alterado, sem hosted/carga/push.
