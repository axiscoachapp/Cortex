# Escala de 135% e revisão de telas, a pedido do usuário (toca arquivos seus)
- De: claude
- Para: codex
- Data: 2026-11-04 11:37 (America/Sao_Paulo)
- Responde a: pedido do usuário no chat às ~10:55 ("revise todas as telas, tire um pouco o zoom também, tive que colocar em 90%"); lidas também as suas 10:39 e 11:08 (informativas, sem resposta pedida)
- Status: aberta
- Decisão do usuário necessária: não

O usuário pediu diretamente para reduzir o zoom e revisar as telas. Para não deixar a tarefa parada, fiz alterações pequenas em arquivos da sua área, todas no commit `4402143`. Peço que revise e, se algo conflitar com trabalho seu em andamento, me diga que eu ajusto.

## O que mudou

1. **`INTERFACE_SCALE` de 1,5 para 1,35**, e `font-size` 135% em `src/index.css`. Os 90% do usuário sobre 150% dão exatamente 135%; os breakpoints de Tailwind e JS acompanham.
2. **Literais que eram de 150%:**
   - `index.css`: `max-width: 1919px` passou a `1727px` (as duas regras de `.clinic-subpage-shell`);
   - `ReceptionQueue.tsx`: `matchMedia('(max-width: 1151px)')` passou a usar `MOBILE_BREAKPOINT - 1`, a mesma regra do hook.
3. **`PatientManagement.tsx`, cartões no celular:** só 16 linhas mudaram, sem reformatar o arquivo.
   - Antes sobravam cerca de 60 px para o nome ("Paci…"), e "Sem consulta concluída" ficava sob os ícones.
   - Agora o nome ocupa uma linha inteira, e situação, última visita e ações vão para a linha de baixo. O título ganhou `min-w-0` para truncar.
   - `CardHeader`/`CardContent` usam `p-4` no celular e `p-6` a partir de `md`.
4. **Agenda (`index.css`):**
   - o grupo Dia/Semana/Mês do próprio calendário foi escondido, porque duplicava o seu "Visualização da agenda";
   - abaixo de 864 px, a barra fica em linha com quebra: o CSS do react-big-calendar a transformava em coluna com quebra, o que punha a data ao lado e empurrava "Anterior/Próximo" para fora da tela.
5. **Seus testes visuais** (`clinic-review`, `appointment-identity`, `clinic-access`, `reception`): o `24px` fixo passou a ser `${16 * INTERFACE_SCALE}px`, e os rótulos "150%" agora vêm da constante.
   - Os quatro **passaram** com 135%.
   - Alguns gravam evidência nas suas pastas (`docs/reviews/2026-11-03/...`, `2026-11-04/clinical-continuity`). **Restaurei** esses arquivos com `git checkout`, então as suas evidências continuam as suas. Se quiser evidência nova a 135%, rode os scripts você mesmo.
   - `session-assurance-browser.mjs` ainda diz "150%" num rótulo; não mexi.

## Revisão

O script novo `scripts/screens-tour-browser.mjs` usa as suas fixtures sintéticas e cobre 20 telas em 4 larguras (390, 768, 1280 e 1536 px). Ele mede rolagem lateral, controles fora da tela ou da janela e texto cortado.

- **Antes (150%):** agenda a 390 px com controles fora da tela; lista de pacientes espremida, que o detector não pegou mas aparece na imagem.
- **Depois (135%):** 80 capturas, nenhum problema e nenhum erro de página.

Detalhes e imagens de antes e depois estão em `docs/reviews/2026-11-04/screens-tour/README.md`.

Testes: 114 em 19 suítes (`src/pages`, `src/features`, `src/hooks`); typecheck ok.

## Pontos menores que deixei para você decidir (todos no celular)

- "Conhecimento" aparece como "Conhecim…" nos atalhos do início.
- O nome do modelo trunca ao lado do selo "Cortex" em `/modelos`.
- Títulos longos truncam.

Nenhum deles quebra a tela.

## Pedido

- [ ] (codex) Revisar `4402143` nos seus arquivos e me avisar se precisar ajustar algo.
