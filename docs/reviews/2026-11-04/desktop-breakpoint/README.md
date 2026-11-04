# T36 — mesmo limite de desktop no painel e no CSS

04/11/2026. Correção local, sem mudança de escala, banco, API, permissão, dados reais ou publicação.

O painel inicial misturava `innerWidth < 1728` com uma assinatura `max-width: 1727`. Em uma largura fracionária entre esses valores, o estado inicial e os eventos podiam discordar; após resize, o dashboard podia continuar renderizado no desktop ou faltar no modo compacto. As duas regras do shell de subpáginas também usavam o limite subtraído.

Agora o estado inicial e o listener usam somente o complemento de `(min-width: 1728px)`, assim como Tailwind xl. A assinatura sincroniza seu valor após registrar o listener. Os dois blocos CSS usam `not all and (min-width: 1728px)`. Aba, paciente, URL e componentes montados não são reiniciados pelo resize; escala 135% preservada.

## Evidências

- `UNIT_RED.json`: código anterior, 9 testes passaram e os dois casos novos falharam ao ampliar/reduzir na faixa fracionária. O modelo emula largura fracionária, `innerWidth` inteiro e eventos somente quando a query cruza seu limite.
- `UNIT_GREEN.json`: **92 testes/13 arquivos** (Index, hook móvel e recepção), todos aprovados. Inclui limite exato, dois sentidos, paciente/URL, aba e montagem única da consulta, sem update ou IA na reprodução.
- `node scripts/desktop-breakpoint-browser.mjs`: **13 verificações** em Edge isolado, API local sintética, sete resizes do painel e quatro da agenda. Rascunho, paciente, aba e elemento da consulta preservados; shell reserva a navegação inferior, escala mantida e zero pageerror. Capturas `index-desktop.png` e `agenda-compact.png` conferidas visualmente. Hashes das fontes em `verification.json`.
- `node scripts/desktop-breakpoint-browser.mjs --probe-side-effects`: saída 1 **esperada**, em `PROBE.json`. Uma chamada de IA sintética adiada 50 ms depois do último resize, a um endpoint que devolve 503 sem incrementar contadores da fixture, foi detectada. O modo normal tem zero tentativa proibida. Prova apenas no loopback, sem chamada real/paga.
- `node scripts/clinic-access-browser.mjs`: quatro fluxos de continuidade clínica/recuperação, incluindo captura/portais em 390/768/1280/1920 px a 135%, aprovados. Resultados desta execução copiados para `continuity/`; as evidências históricas originais foram restauradas sem alterações.
- `npm run build`: tipos e build aprovados com URL/chave publicável sintéticas, sem alterar `.env`. `npm run lint`: zero erros/oito avisos anteriores.

Chrome DevTools MCP não está disponível nesta sessão; foi usado o Playwright existente. Chromium arredondou o viewport de um iframe de 1727,5 para 1728 px e esse primeiro ensaio não reproduziu zoom fracionário; não é evidência da falha. A reprodução fracionária é do teste de componente; o navegador real verifica os vizinhos inteiros. Não se alega teste de zoom real fracionário, de microfone físico, ou ausência de efeitos depois da janela observada e dos 600 ms de estabilização.

Revisão adversarial local do código não identificou defeito concreto na correção. A revisão do harness encontrou duas lacunas, corrigidas: contadores incompletos de endpoints e fechamento prematuro de `networkidle`. A observação atual rejeita tentativas de função e escritas relevantes, com allowlist explícita de RPCs de leitura; a sonda adiada exercita a detecção. Revisão externa dispensada pelo usuário, sem CLI/modelo externo.

## Seguimentos

T36 concluída no escopo acima. Foi observado corte vertical dos rótulos dos dias no cabeçalho semanal da agenda na captura compacta; T37 registra essa inspeção independente, sem atribuir causa ainda. M2/corte dos grants legados, T31 e T34 continuam pendentes; não houve alteração de autorização ou SQL nesta rodada.
