# T39/2c — legenda semanal em português

Item 6 da entrega do Claude de 05/11 às 18:43. A legenda semanal passa de `novembro 01 – 07` para `1–7 de novembro`. Quando o intervalo atravessa mês ou ano, cada limite fica explícito:

| Intervalo | Legenda |
|---|---|
| Mesmo mês | 1–7 de novembro |
| Meses diferentes, mesmo ano | 29 de nov. – 5 de dez. |
| Anos diferentes | 27 de dez. de 2026 – 2 de jan. de 2027 |

O novo formatador puro em `src/lib/calendarLabels.ts` recebe os limites inclusivos da biblioteca e devolve texto. `Calendar.tsx` o conecta somente a `dayRangeHeaderFormat`. O [localizador oficial date-fns do react-big-calendar](https://raw.githubusercontent.com/jquense/react-big-calendar/master/src/localizers/date-fns.js) fornece essa chave e mantém os demais formatos; código e tipos instalados da versão1.19.4 foram conferidos.

Não há ajuste de datas, objetos, fuso, seleção de semana, eventos, callbacks, horários, permissões ou gravações. Títulos de Dia e Mês são preservados.

## Evidências

- [RED final](week-caption-final-red/AUDIT.json): base `e6ddd086ce46c0ad8694e68448f988c8f38ef818`, sem overlay. A primeira captura falha: `novembro 01 – 07` em lugar de `1–7 de novembro`; nenhum erro de execução/console e limpeza confirmada.
- [GREEN](week-caption-green/AUDIT.json): dez estados em375/1280px. Três intervalos semanais mais Dia e Mês, com expectativas literais independentes do helper. Botões reais avançam4/8semanas para as viradas de mês/ano. Sem corte do texto ou rolagem horizontal, escala135% preservada.
- Treze testes em dois arquivos: seis casos novos (mesmo mês, meses/anos diferentes, ano bissexto e preservação dos objetos Date) e sete regressões do componente de detalhes/seleção da semana. Os casos novos falharam antes da implementação.
- [Regressão do modo de horários](week-caption-time-regression/AUDIT.json): quatro estados, verificando que o novo ramo do runner mantém o modo anterior. Não é um novo ensaio amplo de todas as rotas.
- [Validação consolidada](WEEK_CAPTION_VALIDATION.json): sintaxe Node, lint da aplicação/runner, typecheck do app, fontes efetivamente servidas, hashes, estados, formatos e limpeza aprovados. Revisão local independente sem achado acionável; revisão externa dispensada.

Capturas inspecionadas: [mesmo mês em375](week-caption-green/clinical--agenda-week-same-month-375.png) e [virada de ano em375](week-caption-green/clinical--agenda-week-cross-year-375.png).

## Isolamento e limites

O modo focado `--only=week-caption` usa backend sintético e navegador isolado em São Paulo, com rede restrita ao loopback. `setFixedTime` fixa `Date.now/new Date` em05/11/2026 12h local, mantendo os timers em andamento conforme a [documentação do Playwright](https://playwright.dev/docs/clock#test-with-predefined-time). Esse relógio é apenas do ensaio visual, sem evidência de segurança Auth.

Código e classes Tailwind continuam congelados no snapshot. Só `Calendar.tsx` e o novo `calendarLabels.ts` entram como overlays; o novo caminho é permitido explicitamente, e ambos precisam ser servidos. Modos focados não podem ser combinados entre si, e o modo de legenda recusa checks de outros modos.

Não há submissões, alteração de paciente, conexão Google, novo teste SQL/Auth, build global, carga ou implantação. O ensaio não fecha os fluxos funcionais de T39/3 nem aprova o piloto. Restam itens1–5 da entrega médica e o reteste independente dos cinco arquivos do Claude.

## Reexecutar

A legenda de Dia foi localizada depois em [T39/2e](DAY_CAPTION.md). O modo abaixo agora valida18estados, com a nova expectativa de Dia; os relatórios desta etapa continuam com os10estados e expectativas originais de T39/2c.

Use nomes novos para cada diretório:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=e6ddd086ce46c0ad8694e68448f988c8f38ef818 --run=week-recheck-red --only=week-caption
node scripts/reception-app-audit-browser.mjs --baseline=e6ddd086ce46c0ad8694e68448f988c8f38ef818 --overlay=src/pages/Calendar.tsx --overlay=src/lib/calendarLabels.ts --run=week-recheck-green --only=week-caption
```
