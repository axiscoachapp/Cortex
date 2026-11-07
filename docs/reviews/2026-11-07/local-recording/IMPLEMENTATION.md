# K7/2c — recuperação de áudio local

Baseline `2e91898ff501ca8fa156f0f182b55c02429af4b0`. [Contrato](../../../product/clinic-crm/LOCAL_RECORDING_RECOVERY.md).

CLAIM sob teste: o Início só oferece retomada de áudio do ator atual após conferir o paciente privado disponível, sem devolver blobs/comentários ou usar o nome local antigo; nenhuma abertura inicia processamento ou altera os áudios. Resultado limitado/falhas/cancelamento não simulam completude ou vazio.

RED: teste inicial sem componente falhou na importação (não é prova comportamental). Depois, stub nulo produziu oito falhas comportamentais/zero verdes em `UNIT_RED.json`. Revisão adversarial encontrou paciente com exclusão solicitada ainda nomeado/acionável; `DELETION_RED.json` reproduz a falha (9 verdes/2 falhas incluindo asserção do filtro). A leitura agora inclui `deletion_requested_at IS NULL`; fixture tem esse paciente e mantém seu áudio sem nome/ação. Arquivado sozinho continua acessível por ID privado.

O segundo achado da revisão foi uma lacuna de prova: abort prévio não exercitava transação ativa. O probe Edge/IndexedDB real `active-abort-red.json` reproduziu erro JS ao abortar entre o primeiro evento do cursor e seu handler. Corrigidos guarda de sinal antes de ler cursor, abort seguro e instalação prévia dos handlers de conclusão/erro. `active-abort-final.json`: AbortError, um abort nativo, um fechamento da conexão, registro preservado, zero JS/externo e cleanup positivo; SHA do leitor congelado/verificado.

A revisão fresca `/root/local_recording_review` teve duas rodadas: duas correções acionáveis na primeira, nenhum achado restante na segunda. Depois houve somente fortalecimento determinístico da fixture (aguardar o evento nativo de abort) e filtro de exclusão no diretório sintético para espelhar o SQL, sem nova alteração do produto.

## Limites das execuções preliminares

- `local-recording-first`: allowlist global recusou os dois overlays novos antes de abrir servidor; admissão restrita à flag do recorte.
- `local-recording-scope-verified` e `local-recording-ledger-final`:42 estados verdes antes das duas correções, substituídos pela prova final; não são a entrega aceita.
- `local-recording-active-abort-red`: timeout de navegação/networkidle após25 estados, antes do probe; não usado como RED do produto. Reprodução focada posterior comprovou o erro real.
- `local-recording-reviewed-final`: contador do probe foi lido antes de outro listener nativo de abort completar (0 versus1),31 estados/zero JS. Instrumentação passou a aguardar esse evento, conservando as asserções de um abort/um close. Nenhuma asserção visual/erro foi relaxada.
- Primeira chamada do probe focado com nome de execução em maiúsculas foi recusada antes do browser. A primeira reprodução focada válida teve aviso do scanner Vite por aliases de outros arquivos; entrada de dependências passou a limitar-se ao leitor congelado. O documento vazio desse probe nunca carrega o app ou dados do servidor.

## Entrega verificada

- 69 Vitest/seis arquivos:11 casos novos do aviso, identidade inesperada, troca de ator durante leitura local/servidor, cache/falha/limite; regressões de Index, WelcomeDashboard, ChatPanel, assinatura e consulta remota. Retomada do mesmo paciente relê áudio local; recusa de texto não salvo conserva a leitura anterior. `UNIT_GREEN.json` contém o resultado dirigido, não uma alegação de Vitest global verde (dois RED C5 do Claude permanecem fora deste recorte).
- 15 Node/dois arquivos (3 recuperação e12 regressões do servidor sintético), tipos globais, lint dos12 caminhos e sintaxe dos6 scripts aprovados. Quatro combinações inválidas do runner principal e uma do probe focado recusadas antes de criar serviços.
- App/Auth/SDK do baseline congelado, quatro overlays próprios (WelcomeDashboard, ChatPanel, leitor e aviso),320 fontes/19 hashes do executor; cleanup positivo. [AUDIT final](../../2026-11-05/reception-app-audit/local-recording-final/AUDIT.json) e44 PNGs para42 estados:20 regressões da consulta remota e22 estados locais em320/375/1280/1920, escala135%. Controles medidos>=44px/sem corte/hit-test; capturas de viewport com inspeção visual375/1280, lista com rolagem interna e nomes longos quebrando linhas.
- IndexedDB real: ator estrangeiro ignorado, nome antigo nunca usado, paciente com exclusão solicitada sem ação/identidade, abertura por teclado no paciente exato e releitura do paciente já montado. Comparação integral conserva blobs/comentários/datas/IDs dos registros originais, do acréscimo sintético e dos103 registros de limite. Retorno51/somente três chaves/top51 por desempate de ID, exibição50 com aviso. Falha do IndexedDB e da propriedade retentáveis. Abort antes e durante o cursor, uma transação abortada/um close e dados preservados.
- Ledger completo de206 requests: leituras e login sintético, nenhuma chamada de áudio, Storage, Edge Function ou POST inesperado. Zero escritas/briefing/checklist/chat/fonte nova, JS ou recurso externo.12HTTP503/console deliberados (8 consulta remota,4 propriedade). Dez eventos HEAD `/rest/v1/patients`, status200, `net::ERR_ABORTED` preservados integralmente; apenas essa tupla histórica é aceita, sem inferir sua causa. Demais requests falhos seriam recusados.

Somente `local-recording-final` é prova integrada da fonte entregue. O probe focado final e seu RED real também são preservados; demais diretórios/relatórios preliminares ficam excluídos do commit. Não prova Auth/RLS/concorrência SQL ou produção reais. Nenhum C4/C5/PersonalMed/SaaS/Auth/DDL/provedor/hosted/push alterado.2152 já atendida2353, sem mensagem nova do Claude ou resposta confirmatória. Próximos K7 pós-consulta e retestes C4/C5 após SHAs do dono; comandos K1 no contrato próprio.

Cross-model skipped: non-interactive context.
