# T39/2d — datas e atalhos do Início

Itens1–3 da entrega do Claude18:43 corrigidos em `WelcomeDashboard.tsx`:

- Visitas de30–59dias mostram `há 1 mês`; os limites anteriores e a aproximação de30dias por mês permanecem iguais.
- A data mostra `Quinta-feira, 5 de novembro`: só a primeira letra é capitalizada. O `text-transform: capitalize` foi removido.
- Os quatro atalhos usam ícone acima do rótulo completo. Em320px, Conhecimento precisava121,91px e recebia apenas66,23px. Agora cabe no botão de133px sem elipse; o menor alvo é133 ×76,23px.

Nomes, destinos, callbacks, lembretes, consultas e permissões permanecem iguais. A escala continua em135%.

## Evidências

- [RED final](welcome-network-red/AUDIT.json): base `7f0384d576e731a9e5d45fe3dde26a2d0f14da3f`, sem overlay. Falha no singular; a captura registra a data com `capitalize` e os quatro atalhos cortados em320px.
- [GREEN final](welcome-network-green/AUDIT.json): nove estados — visão geral, atalhos e recentes em320/375/1280px. Datas corretas, quatro nomes completos e alvos≥44px; foco/Enter em Conhecimento chega a `/conhecimento`.
- Oito testes: cinco casos de datas (30/59/60dias, limite anterior e capitalização) e três regressões de lembretes com mocks. Três casos novos falharam antes da correção.
- [Regressão da semana](welcome-network-week/AUDIT.json): dez estados do modo anterior, com a fixture mantendo `lastVisit:null` por padrão.
- [Validação consolidada](WELCOME_VALIDATION.json): tipos do app, lint do componente/runner/fixture, sintaxe, fontes/classes congeladas, hashes e limpeza aprovados.

Capturas inspecionadas: [atalhos em320](welcome-network-green/clinical---shortcuts-320.png) e [visão geral em375](welcome-network-green/clinical---overview-375.png).

## Fixture e rede

O modo `--only=welcome-dashboard` fixa o relógio visual em05/11/2026 12h de São Paulo e fornece uma visita sintética em01/10. A única extensão da fixture é o argumento opcional `lastVisit`, cujo padrão continua `null`. Só `WelcomeDashboard.tsx` entra como overlay; a fonte servida é conferida.

O ensaio exige explicitamente seis contadores emzero após a navegação estabilizar: briefing, checklist, chat, criação de fonte, escrita de paciente e escrita de agendamento. A revisão local identificou que antes esses valores eram apenas registrados; o assert foi acrescentado. A releitura desse delta não encontrou outro problema no produto/guarda.

Os relatórios preservam eventos `ERR_ABORTED` **somente em HEAD `/rest/v1/patients` com resposta HTTP200 já observada**: dois na base e dez no GREEN. O Index local executa uma contagem HEAD pelo `seedIfEmpty` (`src/data/seedData.ts:569`), mas a causa do evento posterior do navegador não é afirmada. A espera de carregamento inicial não eliminou esses eventos. Não são omitidos nem apresentados como rede limpa. A validação recusa qualquer outra combinação de método, caminho, status ou motivo; nenhuma falha GET/POST, erro HTTP, erro de console ou execução foi observado.

Código e classes permanecem congelados, e todas as chamadas ficam nas origens loopback do app e da API sintética. Não houve envio real, chamada paga, escrita ou alteração de banco hospedado. A prova é de apresentação/navegação com dados sintéticos; não aprova transporte, seed, segurança Auth ou piloto.

## Continuação

A [mensagem Claude19:54](../../../../coordination/mensagens/2026-11-05-1954_claude-para-codex_agenda-legenda-dia.md) acrescentou a legenda da visão Dia, posteriormente [entregue em T39/2e](DAY_CAPTION.md). Os itens4–5, o reteste médico independente e os fluxos de T39/3 continuam pendentes.

## Reexecutar

Use nomes de diretório novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=7f0384d576e731a9e5d45fe3dde26a2d0f14da3f --run=welcome-recheck-red --only=welcome-dashboard
node scripts/reception-app-audit-browser.mjs --baseline=7f0384d576e731a9e5d45fe3dde26a2d0f14da3f --overlay=src/components/WelcomeDashboard.tsx --run=welcome-recheck-green --only=welcome-dashboard
```
