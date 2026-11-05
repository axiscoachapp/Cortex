# T39/2g — datas e horários sem segundos

Item 4 da entrega médica de 18:43, recebido pela resposta de 18:58. Cinco chamadas a `toLocaleString` passam a usar `{ dateStyle: 'short', timeStyle: 'short' }`, mantendo `pt-BR` e o fuso do navegador:

- Em Trabalho: consulta recuperável, atualização do registro, versões do registro e versões da consulta.
- No prontuário: aviso de gravação interrompida.

A mudança afeta apenas o texto apresentado. Por exemplo, `05/11/2026, 14:03:27` vira `05/11/2026, 14:03`. Os timestamps persistidos mantêm os segundos e os mesmos instantes; queries, filtros, revisões, ações e handlers não mudam.

## Evidências

- [RED final](short-timestamps-focused-red/AUDIT.json): base `2fff1caf59a3adc193672b5c5280ecbeb13f32e3`, sem overlay. A lista inicial em 320 px mostra segundos na consulta recuperável e na atualização; a execução para nesse primeiro estado. Os outros pontos da base não foram capturados pelo RED.
- [GREEN final](short-timestamps-focused-green/AUDIT.json): 15 estados, cinco cenários em 320/375/1280 px, cobrindo os cinco pontos. O teste abre os controles reais Ver versões, Linha do tempo e Comparar revisões, aguarda o conteúdo correspondente e rola até cada alvo antes da captura. Cinco valores de minuto distintos são esperados literalmente no fuso de São Paulo; os rótulos não podem conter segundos.
- Os dados da fixture são comparados antes/depois, e a gravação sintética no IndexedDB é relida para conferir que continua presente com o timestamp original. Todos os contadores de IA e escrita permanecem em zero.
- [Regressão do Início](short-timestamps-focused-welcome/AUDIT.json): nove estados em 320/375/1280 px, incluindo atalhos e navegação por teclado, com o modo antigo e as opções padrão da fixture.
- Oito testes existentes de `ChatPanel.test.tsx`, tipos e lint da aplicação aprovados. Não foram criados testes unitários que apenas repetem os literais da formatação.
- [Validação consolidada](SHORT_TIMESTAMPS_VALIDATION.json): sintaxe/lint do runner e da fixture, hashes, fontes servidas e limpeza. A revisão independente encontrou uma incompatibilidade ao acrescentar um contador à fixture padrão; o contador ficou restrito à opção nova, e a regressão do Início foi executada. Leitura final sem defeito restante; revisão externa já dispensada pelo usuário.

Capturas inspecionadas: [lista em 320 px](short-timestamps-focused-green/clinical--trabalho-audio-list-320.png), [versão da consulta em 320 px](short-timestamps-focused-green/clinical--trabalho-patient-22222222-2222-4222-8222-222222222222-clinical-versions-320.png) e [aviso de recuperação em 320 px](short-timestamps-focused-green/clinical---patient-22222222-2222-4222-8222-222222222222-rescued-recording-320.png).

A inspeção revelou corte horizontal no conteúdo da Linha do tempo preenchida em 320 px. O scanner de rolagem do documento não detecta esse corte interno; as asserções de texto e a rolagem até o alvo não aprovam o layout inteiro. Achado separado em T39/2h, ainda aberto. As capturas preliminares que deixavam o alvo fora da área visível ficam fora do commit.

## Limites

API sintética em loopback e Edge isolado, fontes/classes congeladas e somente dois overlays: `ClinicalWorkspace.tsx` e `ChatPanel.tsx`. O relógio visual está em 05/11/2026, 12h de São Paulo, sem pausar timers. A opção nova da fixture adiciona apenas dados sintéticos de leitura e recusa escrita nesses quatro recursos. A gravação é uma entrada sintética de armazenamento; não se inicia microfone nem se clica em processar, descartar, salvar, concluir ou enviar.

Eventos `HEAD /rest/v1/patients`, HTTP 200 com `net::ERR_ABORTED`, continuam registrados integralmente quando presentes no Início/prontuário. A validação permite somente essa tupla exata, já observada antes desta mudança, sem inferir causa ou declarar rede limpa. Os demais erros de rede, HTTP, página e console devem estar ausentes.

Sem API/SQL/Auth de produção, assinatura, mudança Claude/SaaS, build global, chamada paga, carga, hosted, deploy ou push. T39/2 ainda requer o ajuste T39/2h e o reteste independente dos cinco arquivos médicos entregues pelo Claude. T39/3, decisão de navegação, M2 e piloto permanecem separados.

## Reexecutar

Use nomes de execução novos:

```powershell
node scripts/reception-app-audit-browser.mjs --baseline=2fff1caf59a3adc193672b5c5280ecbeb13f32e3 --run=timestamp-recheck-red --only=short-timestamps
node scripts/reception-app-audit-browser.mjs --baseline=2fff1caf59a3adc193672b5c5280ecbeb13f32e3 --overlay=src/pages/ClinicalWorkspace.tsx --overlay=src/components/ChatPanel.tsx --run=timestamp-recheck-green --only=short-timestamps
```
