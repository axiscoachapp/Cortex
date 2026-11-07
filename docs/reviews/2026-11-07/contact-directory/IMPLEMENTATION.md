# T45 — diretório de contatos fresco

A lista de contatos retira cartões, ausência e paginação durante releitura, pausa ou erro. Ações só usam uma leitura concluída nesta instância e o snapshot ainda atual do QueryClient. Há atualização manual, busca cancelável e paginação humana. Troca de ator/clínica/papel ou perda de acesso/sessão visível desmonta o leitor e reinicia a busca.

Cada montagem tem sua cadeia de páginas, evitando que uma recuperação imediata reutilize cursores do cache anterior. O prefixo de ator/família/clínica continua compatível com as invalidações existentes. Permissões de corrigir contato/consultar vínculos mantidas; callbacks recebem somente a seleção explícita. Erro público estático, sem mensagem privada do transporte.

## Evidências

[Contrato](../../../product/clinic-crm/CONTACT_DIRECTORY_FRESHNESS.md), [controle RED](RED_CONTROL.json), [RED inicial](UNIT_RED.json), [RED de páginas/contexto](SCOPE_RED.json), [GREEN final](UNIT_GREEN.json), [guardas CLI](CLI.json), [validação](VALIDATION.json).

Antes de editar o produto:22RED/um controle em23testes contra a página original do SHA-base. Após revisão, três casos de remount (papel/ocultação/inatividade) reproduziram quatro consultas em vez de três: refazia o cursor antigo. Um ensaio inicial ficou verde por fixture que removia o cursor da primeira página; foi preservado/excluído, corrigido e não conta como prova do defeito. A versão final passa84Vitest/cinco arquivos (28novos), tipos reais da aplicação, lint5, sintaxe2 e seis rejeições CLI pelo motivo esperado.

[Auditoria bruta final](../../2026-11-05/reception-app-audit/contact-directory-final/AUDIT.json):32estados/36PNGs320–1920/135%,353fontes/37hashes/dois overlays por hash e cleanup positivo.32requests de login/contexto/leitura, quatro403/console deliberados, zero outras falhas/JS/clínico/criações/escritas/reservas/externos. O pending do navegador é uma atualização mantida em espera pelo transporte, com cache previamente exibido; erro retira esse cache, retry restaura só leitura. Busca vazia/filtrada e abrir/cancelar atendimento usam a interface real, sem submissão. Capturas320/1920 e ações375 inspecionadas. Página320 pode rolar; o retry abaixo da dobra foi acionado normalmente no ensaio.

Contexto, cancelamento, múltiplas páginas, stale clicks e callbacks administrativos são verificados em unitários, não nessa sessão do navegador. As chaves sem sufixo semeadas nos testes representam cache de leitor anterior; pending/erro/paused na mesma instância cobrem a retirada do cache em uso. O SDK/RPC não mudou; apenas seu sinal opcional já existente é passado pelo diretório.

## Revisão e limites

Primeira revisão: P2 de reutilização da paginação classificado válido/acionável, reproduzido e corrigido. Segunda revisão sem novos achados acionáveis. Cross-model skipped: non-interactive context.

Pequenos ajustes de validação: removida uma opção exact não tipada de getByRole; controle CLI de fonte ausente precisou --run único para não parar em pasta antiga, depois atingiu sua asserção correta. Nenhuma dessas falhas conta como GREEN ou recusa válida anterior à correção.

Recorte só do diretório/callbacks. Editores de correção/vínculos já abertos e seus efeitos assíncronos seguem fora deste incremento; Novo atendimento preserva T44. Sem prova SQL/Auth real/autorização/rollback ou servidor; sem produtor/C5/schema/PersonalMed/SaaS/Meta/hosted/carga/paid/deploy/push. Nenhuma entrada Claude nova:2152 já atendida, sem resposta confirmatória. K1/4j0506/C4/C5 e decisões anteriores permanecem separados.
