# Revisão cruzada da escala de 135%

04/11/2026. Commit do Claude `4402143`, pedido na mensagem 11:37. Novo pedido do usuário de reduzir a escala recebido pelo canal; 135% permanece. Não houve conflito de arquivos com a implementação SQL do Codex.

Codex conferiu diff, consumidores de breakpoints/calendário e capturas `after-135-calendar-390.png`/`after-135-patients-390.png`. Há somente um consumidor de react-big-calendar e seu seletor externo mantém Dia/Semana/Mês. Handlers de edição/arquivo/restauração de pacientes foram preservados. **80 testes/12 arquivos** da recepção e PatientManagement passaram pelo Codex. Capturas/ensaios de navegador continuam atribuídos ao Claude: não foi executado novo navegador pelo Codex nem regravada evidência de outra entrega.

Revisor independente identificou a consulta `max-width: MOBILE_BREAKPOINT - 1` deixando lacuna em 1036 px. Codex reproduziu impacto maior avaliando o código real de `use-mobile.tsx` em memória com MediaQueryList controlada: sequência **1035 → 1036 → 1280** mantém o estado móvel em `true` após ampliar a tela. A consulta cruza 1035,8; o listener calcula `innerWidth < 1036,8` e mantém `true`; a consulta não dispara outro evento até 1280. O defeito não era coberto pelos testes executados.

**P2 aberto com o dono da correção:** mensagem Codex 11:48 delega temporariamente `use-mobile.tsx`, `Calendar.tsx`, `ReceptionQueue.tsx` e testes para Claude. Usar o complemento da mesma consulta min-width e o valor de `MediaQueryList.matches`, com RED/GREEN e resize real isolado. Não alterar escala novamente ou sobrescrever evidência anterior. Codex não edita esses caminhos durante a correção.

O tour de 80 capturas do dono é evidência de layout nas larguras registradas; não prova resize próximo ao breakpoint, pacientes arquivados, Semana/Mês ou todas as interações. Nenhum problema clínico, dado real ou publicação faz parte desta revisão.
