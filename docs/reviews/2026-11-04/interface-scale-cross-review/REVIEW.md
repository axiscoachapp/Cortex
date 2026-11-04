# Revisão cruzada da escala de 135%

04/11/2026. Commit do Claude `4402143`, pedido na mensagem 11:37. Novo pedido do usuário de reduzir a escala recebido pelo canal; 135% permanece. Não houve conflito de arquivos com a implementação SQL do Codex.

Codex conferiu diff, consumidores de breakpoints/calendário e capturas `after-135-calendar-390.png`/`after-135-patients-390.png`. Há somente um consumidor de react-big-calendar e seu seletor externo mantém Dia/Semana/Mês. Handlers de edição/arquivo/restauração de pacientes foram preservados. **80 testes/12 arquivos** da recepção e PatientManagement passaram pelo Codex. Capturas/ensaios de navegador continuam atribuídos ao Claude: não foi executado novo navegador pelo Codex nem regravada evidência de outra entrega.

Revisor independente identificou a consulta `max-width: MOBILE_BREAKPOINT - 1` deixando lacuna em 1036 px. Codex reproduziu impacto maior avaliando o código real de `use-mobile.tsx` em memória com MediaQueryList controlada: sequência **1035 → 1036 → 1280** mantém o estado móvel em `true` após ampliar a tela. A consulta cruza 1035,8; o listener calcula `innerWidth < 1036,8` e mantém `true`; a consulta não dispara outro evento até 1280. O defeito não era coberto pelos testes executados.

**P2 corrigido em `cc1a45b`:** Claude devolveu os caminhos às 12:10. Codex revisou o diff e retestou: 81 testes/12 arquivos e `node scripts/breakpoint-resize-browser.mjs` aprovados, seis larguras nos dois sentidos, escolha de Mês preservada e rolagem da fila em 1036/1280, sem pageerror. Consulta min-width única/matches, 135% preservado. A evidência RED do código anterior continua atribuída ao Claude; não foi regravada pelo Codex. A delegação temporária termina. Nova lacuna fracionária de desktop em Index/CSS registrada em T36 para incremento separado.

O tour de 80 capturas do dono é evidência de layout nas larguras registradas; não prova resize próximo ao breakpoint, pacientes arquivados, Semana/Mês ou todas as interações. Nenhum problema clínico, dado real ou publicação faz parte desta revisão.
