# T39/2e — legenda da visão Dia em português

Complemento enviado pelo Claude19:54 e registrado na resposta20:08. A agenda passa de `quinta-feira nov 05` para `quinta-feira, 5 de novembro`. O botão Próximo mostra `sexta-feira, 6 de novembro`.

`formatCalendarDay` apenas formata o Date recebido com `ptBR`. `Calendar.tsx` o liga a `dayHeaderFormat`, ao lado do formatador semanal já existente. O [localizador oficial date-fns](https://raw.githubusercontent.com/jquense/react-big-calendar/master/src/localizers/date-fns.js) fornece essa chave; o binding instalado do `Day.title` também foi conferido. Nenhuma data, hora, objeto, filtro, evento, callback, permissão ou agendamento muda.

## Evidências

- [RED](day-caption-red/AUDIT.json): base `14292224132e382703a8bceb94061c246223aa61`. Três semanas passam; o quarto estado falha na legenda antiga de Dia em320px.
- [GREEN](day-caption-green/AUDIT.json): 18 estados — três semanas, Dia, próximo Dia e Mês em320/375/1280px. Expectativas literais, navegação pelo botão real, textos completos, raiz135% e ausência de corte/rolagem horizontal conferidas.
- Dezessete testes em dois arquivos: quatro novos de Dia (incluindo29/02, virada de ano e preservação dos milissegundos originais), seis semanais e sete de detalhes/seleção da semana. Os quatro novos falharam antes da implementação; os treze anteriores já passavam.
- [Validação consolidada](DAY_CAPTION_VALIDATION.json): tipos do app, lint da aplicação/runner, sintaxe Node, dois overlays efetivamente servidos, hashes e limpeza aprovados. Revisão local independente sem achado acionável; revisão externa dispensada.

Captura inspecionada: [Dia em320px](day-caption-green/clinical--agenda-day-localized-320.png). O relógio visual continua fixo em05/11/2026 12h de São Paulo, sem pausar timers. A data selecionada pode avançar pelo controle da agenda.

## Escopo e continuação

O modo histórico `--only=week-caption` foi atualizado intencionalmente para incluir o Dia localizado, próximo Dia e320px: agora são seis cenários ×três larguras. A semana e o mês mantêm as legendas anteriores. Relatórios antigos de10estados continuam preservados com suas fontes e expectativas da época.

Navegador e API sintética isolados em loopback, com código/classes congelados e overlays só de `Calendar.tsx` e `calendarLabels.ts`. O ensaio não registra falhas de rede/HTTP/console/execução e não faz submissões ou envios. Não houve novo teste SQL/Auth, build global, carga, alteração de banco hospedado ou implantação. Não aprova transporte, segurança ou piloto.

T39/2e fica concluído. Restam itens4–5 da entrega médica, o reteste independente dos cinco arquivos e os fluxos de T39/3.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=14292224132e382703a8bceb94061c246223aa61 --run=day-recheck-red --only=week-caption
node scripts/reception-app-audit-browser.mjs --baseline=14292224132e382703a8bceb94061c246223aa61 --overlay=src/pages/Calendar.tsx --overlay=src/lib/calendarLabels.ts --run=day-recheck-green --only=week-caption
```
