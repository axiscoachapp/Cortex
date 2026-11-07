# K1/5b — consulta dos modelos na recepção

A caixa de Conversas agora oferece Consultar modelos. A entrada fica recolhida até uma escolha explícita e preserva a conversa selecionada. Abrir ou atualizar verifica novamente acesso e conexão em consulta própria por ator e clínica; só então lê os modelos armazenados. [Contrato](../../../product/clinic-crm/WHATSAPP_TEMPLATES_UI.md).

A escolha usa nome e idioma exatos. O detalhe mostra nome completo, metadados, quantidade de parâmetros e corpo literal. Não há preenchimento de parâmetros, HTML, links ativos, sincronização ou envio. A lista informa possível incompletude. Vazio não garante ausência de modelos na Meta ou conexão.

Durante leitura, erro ou consulta pausada sem rede, dados anteriores ficam ocultos. Versões locais da verificação e da leitura descartam a seleção mesmo após respostas idênticas/coalescidas. Fechar ou mudar contexto cancela a observação, ignora resposta tardia e devolve foco; acesso perdido desmonta o painel. Componentes separados do leitor evitam colisão de nomes no resolver Windows.

## Evidências

Base `99be03e3c509bbaec045af17571fd17c7364a643`, main. [Validação detalhada](VALIDATION.json).

- [UNIT_RED](UNIT_RED.json): um teste dirigido reproduziu entrada inexistente antes da implementação. [MODULE_RED](MODULE_RED.json): primeira versão da UI falhou por colisão de módulos no Windows, corrigida com nome distinto. [PAUSED_RED](PAUSED_RED.json): dois testes com onlineManager offline e espera de DOM reproduziram dados antigos durante pausa; ambos passam após o gate por fetchStatus. [UNIT_GREEN](UNIT_GREEN.json):258testes/seis arquivos,23novos de UI; sem alegação de Vitest global verde.
- [FIXTURE_RED](FIXTURE_RED.txt): leitura templates recusada400 antes da extensão sintética. [FIXTURE_GREEN](FIXTURE_GREEN.txt):24testes/cinco arquivos, sete novos incluindo defesa do navegador. Corpo templates exato, ator autorizado, dados clonados/vazio/erro, HTTP opt-in e preservação das conversas. A allowlist recusa criar recepcionista, bloquear/desbloquear horário, leitores clínicos/da fila e método incorreto.
- [Browser final](../../2026-11-05/reception-app-audit/whatsapp-templates-ui-visual-final/AUDIT.json):39estados/39PNGs320,375,1280,1920px a135%;347fontes congeladas,33hashes runtime/dois overlays estáveis e cleanup positivo.76requests/64chamadas de fixture,21leituras templates. Oito403/console403 deliberados; zero outras falhas de rede, JS, leitura clínica, escrita ou externo. Corpo320 e detalhe1920 inspecionados; textos longos quebram e controles têm59,39px renderizados. Conversa mantida, escolha limpa após refresh, leitura recusada/recuperação e admin cobertos.
- Tipos reais da aplicação, lint de oito arquivos, sintaxe de cinco scripts e [seis controles CLI](CLI.json) passaram. Component e reader ausentes são recusados antes de abrir browser. Sem Chrome DevTools MCP disponível; usado o runner existente com Edge e perfil temporário isolado, SDK real e HTTP loopback sintético.
- Revisão somente leitura em três rodadas. Três P2 tratados: consulta pausada, capturas que recarregavam página e allowlist de requests incompleta. Reconciliação final sem achados adicionais. Cross-model skipped: non-interactive context.

Comando final: `node scripts/reception-app-audit-browser.mjs --baseline=99be03e3c509bbaec045af17571fd17c7364a643 --only=whatsapp-read --check-whatsapp-templates --overlay=src/features/reception/WhatsAppInbox.tsx --overlay=src/features/reception/WhatsAppTemplateCatalog.tsx --run=whatsapp-templates-ui-visual-final`.

A primeira execução do browser falhou após um estado porque capture navegava por padrão; foi corrigida sem alterar a UI. A execução seguinte37estados foi ampliada com duas capturas do corpo no celular. Só visual-final conta como entrega final. Probes de preparação e asserções síncronas iniciais estão excluídos em VALIDATION; nenhum artefato antigo foi sobrescrito ou apagado. Fontes não foram alteradas durante execuções do browser.

## Continuidade

K1/5 (leitor e consulta) concluído no recorte somente leitura. K1/T41 continuam abertos para outros comandos e integração do restante; transferência4j depende do catálogo pedido0506. C4/C5 retestados só após novos SHAs, dois RED C5 conhecidos separados. Nenhum incoming Claude novo;2152 já atendida e0638 informativa. Sem nova confirmação ao outro agente porque a UI não muda o contrato do produtor.

Sem produtor/C5/schema/SQL/PersonalMed/SaaS, dados reais, Meta/hosted/carga/push. Não comprova autorização real, catálogo completo ou aprovação/envio. Prontuários privados e decisões pendentes preservados.
