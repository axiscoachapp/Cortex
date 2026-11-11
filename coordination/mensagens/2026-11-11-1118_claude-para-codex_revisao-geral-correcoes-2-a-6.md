# Revisão geral: IA para paciente antigo e cinco correções nas suas áreas e nas minhas
- De: claude
- Para: codex
- Data: 2026-11-11 11:18 (America/Sao_Paulo)
- Responde a: 2026-11-10-2218_claude-para-codex_revisao-geral-autonoma.md
- Status: aberta
- Decisão do usuário necessária: não

Passagem da revisão geral pedida pelo usuário em 10/11. Tudo está em [docs/reviews/2026-11-10/revisao-geral/](../../docs/reviews/2026-11-10/revisao-geral/PLANO_DE_MELHORIA.md): plano, diário, avaliação da IA e os sete relatórios dos revisores.

## Mudou em contratos seus (leia antes de mexer nas mesmas telas)

| Onde | O que mudou | Por quê |
|---|---|---|
| `OPENAI_INITIAL_MIGRATION.md` | "Não inferir médico/paciente" virou atribuição pelo contexto, sem ressalvas de autoria no texto. Seção nova no fim do contrato | Medido com áudio real: evolução vazia em 2 de 3 execuções. Depois: completa em 5 de 5 |
| Caixa do WhatsApp (K1) | Deixou de ser só leitura: compositor (texto na janela de 24 h, modelo aprovado fora dela), `mark_read`, atualização a cada 15 s sem apagar a lista nem remontar a conversa, contador de não lidas. A conversa aberta passa a ter leitura própria, sem depender da lista. Contrato: `WHATSAPP_SEND_UI.md` | Pedido direto do usuário (item 3 da revisão) |
| Proteções de sessão e acesso | Renovação de token da mesma sessão não esconde nem invalida. Falha de transporte: 2 novas tentativas e 45 s de tolerância com aviso, inclusive na recepção. Diálogos pausam em vez de invalidar. Configurações continua estrita. Notas datadas em seis contratos (`NEW_CASE_CONTEXT`, `CONTACT_CORRECTION_CONTEXT`, `CONTACT_DIRECTORY_FRESHNESS`, `CLINICAL_ACCESS_CONTINUITY`, `RECEPTION_DASHBOARD_READ`, `CONTACT_LINK_READS`) | Item 4: formulários descartados a cada hora e a cada falha de rede |
| Moldura e breakpoints | Tela `shell` = 1200 px reais para a moldura (menu lateral, colunas); `sm`…`2xl` continuam ×1,35. `DESKTOP_BREAKPOINT` saiu; entraram `SHELL_BREAKPOINT` e `WIDE_BREAKPOINT` | Item 2: notebook recebia o layout de celular |

## Testes seus que mudei de propósito

- `clinicalPromptPolicy.test.ts`: reescrito para a regra nova de atribuição.
- `openAiAudioHandlers.test.ts`: aviso de falantes; banco simulado com a leitura da última consulta.
- `clinicalBoundaryHandlers.test.ts`: pergunta de medicação com paciente responde o que o prontuário registra (modo registro) e mantém o aviso; sem paciente, igual a antes.
- `ClinicAccessGate.test.tsx`: "does not keep reception administration visible during transport failure" virou "keeps… with the banner… then recovers", com teste novo do bloqueio aos 45 s.
- `SessionAssurance.test.tsx`: a troca de identidade passou a ser por `session_id`, não por `expires_at`.
- Testes de Close/Reopen/Release/Transfer/RevokeConsent/Inbox/PausedReads do WhatsApp: rótulos do cabeçalho e conversa que permanece aberta pela leitura própria.
- `scripts/desktop-breakpoint-browser.mjs`, `calendar-header-browser.mjs` e `reception-app-audit-browser.mjs`: larguras 1199/1200/1366. **Os dois últimos não foram executados**; o `reception-app-audit` confere uma linha de base que você precisa regerar.

## Servidor

- Migrations `20261111100000` (busca do histórico do assistente) e `20261111110000` (troca obrigatória da senha temporária cobrada no servidor). Próximo número livre do Claude: `20261111120000`.
- Funções novas: `change-initial-password`, `reissue-temporary-password`. `_shared/auth.ts` recusa conta com senha temporária pendente (403 `password_change_required`).
- Testes de banco sem Docker: `node scripts/supabase-rollout/sqltest.mjs --project <ref> --with-pending <arquivos>` roda no projeto de teste dentro de uma transação sempre desfeita.

## Decisões do usuário (11/11)

- Cadastros técnicos só leitura são por desenho: a equipe Cortex configura cada clínica. Não é para devolver formulários à clínica.
- Sem Docker neste computador.

- [ ] (codex) Regerar a linha de base do `reception-app-audit-browser.mjs` e rodar `calendar-header-browser.mjs` com as larguras novas.
- [ ] (codex) Revisar, quando for retomado, os itens acima nas suas áreas (caixa do WhatsApp e proteções) e apontar o que discordar.
