# Revisão de todas as telas (04/11/2026)

Pedido do usuário: reduzir o zoom (ele usava o navegador em 90%) e revisar todas as telas, por exemplo "Novo paciente".

## Como foi feita

- `scripts/screens-tour-browser.mjs` abre 20 telas em 4 larguras (390, 768, 1280 e 1536 px), sempre com servidores sintéticos locais (os mesmos de `clinic-review-browser.mjs` e `reception-browser.mjs`). Não usa projeto hospedado, dado real nem credencial.
- Telas do médico: entrada, início, prontuário, janela de documentos, configurações, pacientes, novo paciente, agenda, modelos, protocolos, assistente, compartilhamento, pendências, segurança, privacidade e "sobre".
- Telas da recepção: fila, agenda da equipe, contatos e equipe (administrador).
- Para cada tela e largura, o script mede rolagem lateral, controles fora da tela ou da janela e texto cortado em botões. O resultado está em `report.json`; as imagens completas ficam fora do repositório.

## O que mudou

1. **Escala da interface: de 150% para 135%** (`src/lib/interfaceScale.ts` e `src/index.css`). Os 90% do usuário sobre 150% dão exatamente 135%. Os pontos em que o layout muda (celular, tablet, computador) acompanham a escala.
2. **Larguras fixas que ainda eram de 150%:**
   - `index.css`: 1919 px passa a 1727 px (barra inferior e altura das páginas internas);
   - a agenda no celular passa de 639 px para 863 px;
   - na fila da recepção, o 1151 px fixo deu lugar a `MOBILE_BREAKPOINT`.
3. **Lista de pacientes no celular:** sobravam cerca de 60 px entre a foto e os ícones, então o nome aparecia como "Paci…" e "Sem consulta concluída" ficava embaixo dos ícones. Agora o nome ocupa a linha inteira, e a situação, a última visita e as ações vão para a linha de baixo. O título da página trunca com reticências em vez de passar da borda. Ver `before-150-patients-390.png` e `after-135-patients-390.png`.
4. **Agenda:**
   - havia dois seletores de Dia/Semana/Mês, o da página e o do calendário; o do calendário foi escondido;
   - no celular, o CSS do calendário punha a data ao lado dos botões e empurrava "Anterior/Próximo" para fora da tela. Agora a data fica em cima e os botões embaixo.
5. **Testes visuais do Codex:** os quatro scripts que exigiam `24px` (150%) agora calculam o valor esperado a partir de `INTERFACE_SCALE`. Os quatro passaram com 135%.

Resultado final: 80 capturas, nenhum problema detectado e nenhum erro de página.

## Pequenos pontos que ficaram (sem quebra)

- Celular, início: o atalho "Conhecimento" aparece como "Conhecim…".
- Celular, modelos: o nome do modelo trunca ao lado do selo "Cortex".
- Celular: títulos longos de página truncam ("Gerenciar Pacien…").
- O campo de data aparece como mm/dd/aaaa só no navegador de teste, que está em inglês; no navegador em português aparece dd/mm/aaaa.
