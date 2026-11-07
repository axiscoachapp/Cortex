# K1/3b — mensagens anteriores em páginas limitadas

[Contrato de leitura](../../../product/clinic-crm/WHATSAPP_HISTORY_READ.md). A conversa agora oferece mensagens anteriores e volta às recentes, uma página de até50 por vez. Cursor opaco completo na consulta, sem acumular histórico; atualizar volta às recentes, retry conserva a página recusada e voltar às recentes permanece possível durante pending/erro. Foco no título do histórico, página vazia distinguida e chave/cancelamento por contexto e cursor.

Bot/fila continuam snapshots atuais, separados do histórico. Cada navegação cria uma geração nova do bot. Resposta antiga não é adotada depois de voltar; fechar/reabrir inicia nas recentes. Nenhum escritor ou mudança do servidor.

## Evidências

- 90Vitest/2arquivos (54adaptador,36caixa): cinco RED iniciais de ausência da navegação/cursor repetido, depois GREEN incluindo troca de páginas, cursor inteiro, mensagens antigas ocultadas, late result, retry na mesma página, retorno durante pending, fim vazio e fechamento/reabertura.
- 6Node da fixture, tipos globais, lint de oito arquivos, sintaxe de quatro scripts e quatro opções inválidas de CLI recusadas antes de iniciar navegador/servidor.
- 103mensagens sintéticas em50/50/3. Todas no mesmo timestamp com seis casas e offset; UUID desempata. Tokens completos conferidos nas chamadas, IDs únicos e conteúdo substituído em cada página.
- 46estados no Edge isolado em320–1920px a135%;14estados específicos de histórico em320/375/1440. Controles medidos, alvo>=44px, dentro da tela e clicáveis por hit-test. Recusa/recuperação e foco após navegação/retry. Regressões anteriores de bot, lista, filtros, conta administrativa e Atendimentos preservadas.
- Snapshot `6bef238915578839377f58591c1c96556927bf7c` com dois overlays,319fontes e19hashes do executor estáveis; cleanup positivo. Cinco403/console deliberados; demais erros, recursos externos, consultas/escritas clínicas e comandos zero.

[Relatório final](../../2026-11-05/reception-app-audit/whatsapp-history-final/AUDIT.json), [validação/execução](VALIDATION.json). Capturas do histórico em320, fim e recusa375 inspecionadas. As capturas de histórico são somente da viewport, roladas até os controles para legibilidade; medidas/asserts continuam sobre o DOM inteiro, inclusive os50 itens. Os outros estados mantêm captura completa. Nenhuma asserção anterior foi retirada.

`whatsapp-history-first` passou42estados, mas é preliminar/excluído: a rodada final acrescenta320px e a medição dos controles. Aumento de timeout nos cinco RED iniciais foi diagnóstico para mostrar ausência de botão; a execução final usa o timeout padrão. Cancelamento/late response são demonstrados com promessas controladas nos testes de UI, não como homologação do banco ou da Meta.

Revisão independente sem achado acionável no incremento de paginação. Cross-model skipped: non-interactive context. Contrato/limites de K1 preservados, sem alterar C4/C5 ou seus achados abertos.

## Próximos

Paginação da lista de conversas ou K7 pós-consulta/áudio local são candidatos independentes. Comandos K1 precisam de recorte/revisão próprios; correções C4/C5 aguardam SHAs do Claude para reteste, sem repetir bloqueios inalterados. M2/MFA/compartilhamento/piloto permanecem abertos.

Sem SQL/migrations, hosted, Meta, push/deploy ou mudanças em SaaS/PersonalMed/implementação Claude. Main/axiscoachapp, somente caminhos Codex.
