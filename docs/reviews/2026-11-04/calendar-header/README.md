# T37 — rótulos sem corte vertical no cabeçalho semanal

04/11/2026. Correção local de CSS; sem mudança de escala, banco, API, permissão, prontuário ou publicação.

Na semana do react-big-calendar, as células flex podiam encolher abaixo da altura da linha. O ensaio RED mediu sete cabeçalhos com cerca de 21 px de caixa, 20 px de área visível e 29 px de conteúdo, sob `overflow: hidden`. O CSS da biblioteca, carregado com a página, permite `min-height: 0`. O texto ficava cortado verticalmente.

Uma regra mais específica, `.rbc-time-view .rbc-header { min-height: min-content; }`, preserva a altura intrínseca dos rótulos. O cabeçalho passa a aproximadamente 30 px, com conteúdo e área visível de 29 px. Não altera fonte, escala 135%, escolhas de período ou eventos; não depende da ordem de carregamento em relação ao seletor menos específico da biblioteca. A regra fica restrita à grade de horários.

## Evidências

- `node scripts/calendar-header-browser.mjs --red`: saída 1 esperada no código anterior, sete rótulos cortados. `RED.json` e `before-1727.png` preservam essa reprodução.
- `node scripts/calendar-header-browser.mjs`: **13 verificações**, com 14 medições de sete rótulos. Semana em 390/768/1035/1036/1280/1727/1728/1920 px; mês em cinco larguras; teclado abre o domingo correto, com retenção do dia em três resizes. A semana escolhida fica 35 dias no futuro e contém uma reserva sintética das 09:00–09:30, preservada ao redimensionar e voltar de Dia/Mês. Não testa só a data padrão de hoje.
- A observação de requisições começa antes de carregar a tela. Somente o login sintético e duas RPCs nomeadas de leitura têm exceção de POST. Nenhum pageerror, tentativa de escrita/função ou incremento dos seis contadores da fixture na execução normal. `verification.json` guarda hashes e medidas; capturas `after-1727.png` e `after-390.png` conferidas.
- `node scripts/calendar-header-browser.mjs --probe-side-effects`: a sonda agenda uma tentativa 50 ms depois da última interação contra uma função desconhecida **somente do servidor sintético**, que devolve 503. O detector precisa registrar a tentativa e sair com erro; resultado em `PROBE.json`. Não é chamada real de IA.
- `npm exec vitest run -- src/hooks/use-mobile.test.tsx src/pages/Index.test.tsx src/features/reception --reporter=json --outputFile=docs/reviews/2026-11-04/calendar-header/UNIT.json`: **97 testes/13 arquivos aprovados**.
- `npm run build`: tipos/build aprovados com URL/chave publicável sintéticas no processo. `npm run lint`: zero erros, oito avisos anteriores. Nenhuma alteração de `.env`.

Chrome DevTools MCP não está disponível; o ensaio usa o Playwright existente, Edge isolado e API própria em loopback, com origens externas bloqueadas. Foram medidos os limites verticais dos rótulos, com tolerância subpixel de 0,5 px. Em telas estreitas, o truncamento horizontal dos sete dias permanece conforme o componente. Não se afirma teste de todas as fontes, outros motores, zoom nativo ou timers além da observação/estabilização de 600 ms.

## Revisão do ensaio

A revisão adversarial local não encontrou defeito concreto no CSS. Corrigiu dois falsos negativos do teste: usar apenas a semana atual e conferir somente a troca para Dia, sem a data escolhida. A versão final usa uma semana futura e verifica o domingo exato ao retornar de Mês. O observador também passou a incluir montagem/login, com exceções explícitas.

Uma versão intermediária procurava a data selecionada no cabeçalho da página, que mostra **hoje** e fica oculto no celular. Era erro de contrato do ensaio; ele foi corrigido para verificar o título real do calendário. O produto não foi alterado para satisfazer essa expectativa. Outro ensaio terminou antes de montar a tela por timeout de navegação durante a execução paralela de build/testes; não conta como aprovação. A execução final foi feita após esses processos e passou. Terceiro ciclo de revisão estática sem novo defeito concreto; não foi revisão externa, dispensada pelo usuário.

T37 concluída neste escopo. A sonda registrou exatamente uma tentativa ao endpoint sintético e terminou com saída 1 esperada; o ensaio normal terminou com saída 0. A captura de 390 px também registra a limitação horizontal da semana/eventos, agora no seguimento T38. M2, T31 e T34 seguem separados, assim como D17 com Claude e a migração do PersonalMed. Nenhuma suíte SQL foi executada para esta alteração de layout. Commit local main/axiscoachapp, sem push ou publicação.
