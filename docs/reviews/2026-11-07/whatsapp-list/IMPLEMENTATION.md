# K1/3c — paginação da lista de conversas

Baseline `589ec42`. [Contrato](../../../product/clinic-crm/WHATSAPP_LIST_PAGES.md).

CLAIM sob verificação: uma página<=50 permanece vinculada ao ator/clínica/filtro/busca/cursor; trocar página substitui os registros e encerra o detalhe, sem exibir resposta abandonada. O retorno às recentes permanece acessível em pending/erro.

RED: sete testes novos falharam contra a implementação anterior (90 anteriores passaram): seis casos da lista e recusa do cursor repetido. `UNIT_RED.json` preserva a execução. Primeira execução posterior:96 verdes/1 falha no teste positivo preexistente que simulava exatamente o cursor agora recusado; entrada do teste ajustada para cursor distinto, mantendo a prova de preservação de bytes. O primeiro ensaio Node falhou por export ainda ausente, sem alegação de RED comportamental; sete casos Node passam após implementação.

## Resultado

Uma página<=50 com cursor completo, sem concatenação. Navegação fecha/cancela detalhe; filtro/busca/contexto reiniciam nas recentes. Retorno às recentes em pending/erro, retry da página recusada, foco no título e supressão de respostas abandonadas cobertos. O teste positivo do adaptador continua provando microssegundos/offset/UUID intactos, agora com cursor de entrada distinto do próximo.

- 101 Vitest/2 arquivos (55 adaptador/46 interface),7 Node da fixture, `tsc --noEmit`, lint dos8 caminhos e sintaxe dos4 scripts passam. Quatro combinações inválidas de CLI recusadas antes de abrir servidor/navegador. `UNIT_GREEN.json`/`VALIDATION.json` registram resultados.
- Navegador Edge isolado/loopback,135%, baseline SHA completo `589ec42d13e7c518aa04057e48c6afae39ad6f33`, dois overlays explícitos (Inbox/adaptador).319 fontes congeladas/19 hashes do executor estáveis, remoção positiva do cache temporário.
- 66 estados:46 regressões existentes (lista/mensagens/bot/histórico/filtros/aba administrativa) e20 estados da paginação da lista em320/375/1440.103 conversas com timestamps iguais, páginas50/50/3, filtro Minhas52, busca exata, troca sem reload, detalhe cancelado, retorno por atualização e retry após recusa. Controles medidos>=44px, sem corte e com hit-test positivo. Capturas da lista são viewport; contagens/ordem de todos os registros são conferidas no DOM. Inspeção visual adicional das capturas320/1440.
- Só seis403 deliberados com os seis erros de console correspondentes; zero outros erros, requests falhos, chamadas externas, leitores clínicos e escritas. Isso valida transporte sintético/interface, não RLS/concorrênciaSQL/Meta/homologação real.
- Revisão adversarial fresca `/root/whatsapp_list_review`: nenhum achado acionável no contrato/diff/testes/fixture. Uma rodada, sem mudança posterior da implementação.

Fonte final: [AUDIT.json](../../2026-11-05/reception-app-audit/whatsapp-list-verified/AUDIT.json) e66 PNGs dessa pasta. Tentativa preliminar `whatsapp-list-first` usou SHA inexistente por erro de transcrição e parou em `git ls-tree` antes do servidor; excluída da prova/commit. Nova execução usa o SHA real obtido do Git. Nenhuma asserção relaxada.

Nenhuma entrada Claude nova;2152 já atendida2353, sem resposta confirmatória adicional. C4/C5 continuam sob correção do dono para futuro reteste; dois testes C5 RED preexistentes não são executados nesta suíte dirigida e não há alegação de Vitest global verde. Próximos independentes K7 pós-consulta/descoberta de áudio local ou comandos K1 no contrato próprio. Não altera domínio Claude, SaaS, PersonalMed, Auth, DDL ou banco hospedado; sem push/deploy/envio.

Cross-model skipped: non-interactive context.
