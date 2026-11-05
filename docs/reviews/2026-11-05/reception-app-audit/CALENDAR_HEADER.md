# T39/2b — cabeçalho da agenda em 320 px

Corrigido o título Agenda cortado e sobreposto ao botão Conectar Google Calendar em 320 px, observado durante T39/2a. A reprodução na base `229d173b91f55fa72ca3f31c1ee3dda50bdf7447` também mostrou o botão Voltar reduzido a 42,125 px de largura.

A correção altera somente duas classes em `Calendar.tsx`: Voltar recebe `shrink-0`, e o ícone decorativo ao lado do título usa `hidden min-[375px]:block`. Abaixo de 375 px, esse ícone cede espaço para o título e os botões. Em 375 px ou mais, ele continua visível. O limiar é local à decoração, conforme os [breakpoints arbitrários do Tailwind](https://v3.tailwindcss.com/docs/responsive-design#arbitrary-values); os breakpoints de navegação e a raiz de 135% permanecem iguais.

Não há alteração de fontes do título, nomes, callbacks, datas, filtros, consulta, confirmação humana ou permissões. O cabeçalho permanece em uma linha, sem mudança de sua altura.

## Evidências

- [RED](header320-red/AUDIT.json): falha no título ao chegar a 320 px, após 15 estados. Título fora do próprio box e sobreposto ao controle Google; Voltar com 42,125 px. Sem erros de execução/console e limpeza confirmada.
- [GREEN](header320-green/AUDIT.json): 37 estados completos, verificações do cabeçalho em 320/375/390/768/1280 px e regressão da navegação inferior, inclusive teclado até Pendências e Conhecimento.
- [Validação consolidada](HEADER_VALIDATION.json): nas cinco larguras, título completo, nenhum controle sobreposto ao título e três alvos maiores que 44 px. Em320, Voltar passa a54 px; menor alvo do conjunto53,97 ×48,59 px. Raiz21,6 px/135%, fontes/overlay servidos, hashes e limpeza conferidos.
- Sintaxe Node, lint do componente e do runner, e recusa de `--only=time-dialogs --check-calendar-header` aprovados. Revisão local independente sem achado acionável; revisão externa dispensada. Nenhum teste novo espelha classes CSS.

Capturas inspecionadas: [antes em320](header320-red/clinical--agenda-320.png), [depois em320](header320-green/clinical--agenda-320.png) e [depois em375](header320-green/clinical--agenda-375.png).

O runner mede a caixa real do texto por Range e os retângulos dos controles. As classes vêm do snapshot congelado, com somente `Calendar.tsx` como overlay. A nova verificação é opcional: as reexecuções históricas de T39/1 e T39/2a não passam a exigir esta correção.

## Limites

No estado desconectado do Google, os controles Google e Novo Agendamento foram verificados por nome, tamanho e posição; não foram ativados. Não houve conexão externa, submissão, reserva ou gravação. O teclado testado é o percurso da navegação inferior já descrito em T39/2a. O erro de DTO da fixture de permissões continua registrado em `visibleAlerts`; não valida o fluxo positivo do backend. Sem novo teste SQL/Auth, build global ou aprovação de piloto. Somente dados sintéticos, browser isolado e loopback.

Restam itens1–6 da entrega médica e o reteste independente dos cinco arquivos do Claude. A legenda semanal ainda não foi alterada neste recorte.

## Reexecutar

Use diretórios novos para não sobrescrever evidências:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=229d173b91f55fa72ca3f31c1ee3dda50bdf7447 --run=header-recheck-red --check-calendar-header
node scripts/reception-app-audit-browser.mjs --baseline=229d173b91f55fa72ca3f31c1ee3dda50bdf7447 --overlay=src/pages/Calendar.tsx --run=header-recheck-green --check-calendar-header --check-mobile-navigation
```

A primeira chamada deve falhar no título da base. A segunda precisa completar os estados, as medições do cabeçalho e o percurso de teclado.
