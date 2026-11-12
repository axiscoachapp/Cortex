# Revisão geral do Cortex: diário de decisões e ações

Sessão autônoma do Claude, iniciada em 10/11/2026 às 22:18 (horário de São Paulo). Este arquivo registra, em ordem, o que foi decidido e feito, para o usuário rever na volta. O plano com os achados e o andamento de cada um está em [PLANO_DE_MELHORIA.md](PLANO_DE_MELHORIA.md).

## Pedido e autorizações do usuário (10/11, no chat)

- Revisão completa do app (funções, UI e UX), "como um time que recebe um processo andando", com plano de melhoria e implementação de todas as melhorias e correções.
- Testar a nova API da OpenAI no tratamento de um paciente antigo com várias consultas e avaliar o resultado.
- **Sem Docker.** Os testes de banco usam o projeto Supabase existente.
- Os dados do projeto Supabase **são de teste**; o produto não está lançado.
- "Pode fazer tudo", inclusive `git push`. O usuário fica fora por cerca de 8 horas.
- "Pode tomar decisões pelo que achar melhor. Só registre tudo para eu rever quando voltar."

## Como estou trabalhando

- **Banco:** toda verificação no Supabase roda primeiro dentro de uma transação desfeita no final. Antes da primeira alteração permanente, faço um backup cifrado com a ferramenta `scripts/supabase-rollout/`.
- **Publicação:** cada lote só é publicado depois de testes, tipos e lint. A ordem é migrations, funções e, por último, `git push`.
- **Revisores:** agentes independentes, sem o contexto desta conversa, revisam cada área só para leitura. Eu confirmo cada achado antes de corrigir.
- **Codex:** as áreas dele (interface da recepção, navegação, financeiro visual) entram nesta revisão por pedido direto do usuário. Aviso em `coordination/mensagens/`.

## Registro

| Hora | O que | Detalhe |
|---|---|---|
| 22:05 | Estado inicial | `main` igual a `origin/main` em `bb6eb20`. O Codex fez 12 commits em 10/11: interface por perfil, Configurações, moldura única das páginas e integração OpenAI (publicada por ele: 12 funções e `AI_PROVIDER=openai`). |
| 22:08 | Produção conferida | 83 migrations aplicadas, iguais ao repositório. 36 funções publicadas. 24 aparecem como "com commits depois da publicação" só porque a pasta compartilhada mudou; confiro uma a uma antes de publicar de novo. |
| 22:10 | Docker | Eu tinha aberto o Docker Desktop para os testes de banco. O usuário pediu para não usar; não ficou em execução. |
| 22:18 | Linha de base | Tipos: ok. Lint: **6 erros** já existentes em `main` (espaço irregular e caracteres de controle em expressões regulares, em catálogos e medicamentos controlados). Testes do app: em execução. |
| 22:30 | Revisores | Sete revisores independentes lançados, um por área: clínico, IA/OpenAI, recepção, financeiro + pré-consulta + configurações, segurança e privacidade, UX do médico e páginas públicas, UX da recepção/financeiro/configurações. Só leitura, sem Docker e sem acesso ao Supabase. |
| 22:40 | Leitura da IA | Como cada função monta o histórico: o **resumo pré-consulta** lê só a última consulta (avaliação e plano, cortados em 800 caracteres) e os campos do cadastro, sem a história médica. A **evolução gerada do áudio** recebe só nome, idade, diagnósticos, medicações e alergias, sem consultas anteriores. O **assistente** busca até 12 consultas por texto; a busca exige todas as palavras da pergunta, então na prática tende a cair nas 12 mais recentes. |
| 23:10 | Caso de teste da IA | Escrito o caso sintético com 16 consultas e gabarito: `scripts/ai-eval/longitudinal/case.mjs`. A gravação no Supabase foi **só ensaiada** (transação desfeita): nada foi gravado. |
| 23:20 | **Parada: limite de uso atingido** | Os sete revisores foram pausados antes de entregar os relatórios. Nenhuma correção foi feita no código e nada foi publicado no Supabase. Ver "Onde parou" abaixo. |
| 11/11 05:18 | Retomada | Limite de uso renovado. Os sete revisores foram reativados de onde pararam. Suíte completa do app na linha de base: 2.591 testes passam. Um arquivo falhou ao carregar (`scripts/ai-eval/pipeline.test.mjs`) por causa minha: criei a pasta do caso novo dentro de `cases/` sem o `gold.json` que o carregador exige. Movi o caso para `scripts/ai-eval/longitudinal/`. |
| 05:40 | Paciente sintética gravada | "Helena Duarte (paciente sintética de teste)", 16 consultas, na conta de teste nº 1. **Decisão:** deixei no ar para você experimentar; para apagar, é só arquivar/excluir a paciente ou me pedir. |
| 05:50 | Funções temporárias de avaliação | **Decisão:** para chamar as funções reais sem criar conta nem entrar na sua, publiquei cópias fiéis com um acesso próprio (senha aleatória de uso único, com prazo; errada ou ausente = 401, conferido). Apagadas às 08:10. |
| 06:10 | 1ª medição | Resumo pré-consulta bom; assistente sem inventar, mas sem o plano da última consulta e sem fatos antigos; **evolução do áudio vazia em 2 de 3 tentativas**. |
| 06:40 | Sete relatórios dos revisores | Salvos em `relatorios/`. Viraram o [plano de melhoria](PLANO_DE_MELHORIA.md). |
| 07:00 | Causa da evolução vazia | Regra do prompt que proibia a IA de identificar quem fala. Testei o modelo que separa vozes: pior (54 s, erros em termos). **Decisão:** atribuição pelo contexto, registrada no contrato do Codex. |
| 07:20 | Migration `20261111100000` | Busca do histórico para o assistente reescrita. Backup cifrado (`conhcwuwtrkerpbblzgu-2026-11-11-pre-review`), ensaio com rollback, aplicada em 1,4 s. |
| 07:30 | Testes de banco no Supabase | Novo `scripts/supabase-rollout/sqltest.mjs`: roda os arquivos de teste dentro de uma transação sempre desfeita. Substitui o Docker. |
| 08:00 | 2ª medição | Evolução completa em 5 de 5; assistente 47/48; resumo 7/7. Detalhes em [AVALIACAO_IA_PACIENTE_ANTIGO.md](AVALIACAO_IA_PACIENTE_ANTIGO.md). |
| 08:10 | Limpeza | Áudios e rascunhos de teste apagados, paciente sintética regravada no estado inicial (16 consultas), funções de avaliação apagadas. O uso de IA do dia na conta de teste (cerca de 100 créditos de 1.500) é dos testes. |
| 08:40 | Publicação do lote da IA | Commit `be127ca`. 36 funções publicadas; migrations 84 = 84; verificador sem pendências. **`git push` não saiu:** o GitHub pede login neste computador e eu não posso entrar por você. O servidor novo é compatível com o site que está no ar. Rode `git push origin main` quando puder. |
| 08:50 | Plano de melhoria | [PLANO_DE_MELHORIA.md](PLANO_DE_MELHORIA.md): 13 bloqueios, 24 defeitos, 12 itens de experiência. Começo pelos bloqueios. |

**Sobre as horas de 11/11:** as linhas depois de "05:18 Retomada" estão na ordem certa, mas as horas foram estimadas e ficaram adiantadas. Tudo aconteceu entre 05:18 e 06:15.

## Onde parou (11/11, 06:15) — limite de uso atingido de novo

**Feito e publicado no Supabase:** todo o lote da IA (onda 0 do plano), migration `20261111100000`, 36 funções. Verificador sem pendências.

**Feito, mas só neste computador:** 6 commits à frente do GitHub (`a13c390` a `1477bd3`). Falta `git push origin main`, que pede o seu login. Sem o push, a tela que propõe retirar a medicação suspensa (A5) não chega ao site.

**Não começado:** ondas 1, 2 e 3 do [plano](PLANO_DE_MELHORIA.md). Nenhum dos 13 bloqueios foi corrigido ainda. Ordem sugerida para retomar: B2, B10, B5, B8, B3 (pequenos), depois B4 (layout no notebook), B1 (modo implantação) e B6 (responder WhatsApp).

**Ficou no Supabase:** a paciente sintética "Helena Duarte (paciente sintética de teste)" na conta de teste nº 1, de propósito. Nada mais de teste ficou (funções de avaliação, áudios e rascunhos foram apagados).

## Onde parou (10/11, 23:20) — retomado em 11/11 às 05:18

**Feito:** estado inicial conferido, linha de base (tipos ok, 6 erros de lint antigos), leitura de como a IA usa o histórico, caso sintético de 16 consultas com gabarito.

**Não feito:**
- Relatórios dos sete revisores (pausados; podem ser retomados na mesma sessão).
- Plano de melhoria (`PLANO_DE_MELHORIA.md` ainda não existe) e todas as correções.
- Teste real da OpenAI: falta gravar a paciente sintética, publicar as funções temporárias de avaliação, rodar as perguntas e pontuar.
- Resultado da suíte completa de testes do app (estava em execução; ver `E:\Work\cortex-audit-tmp\review\baseline.txt`).

**Já dá para adiantar, pela leitura do código:** para uma paciente antiga, o resumo pré-consulta e a evolução automática não enxergam as consultas anteriores; dependem do cadastro estar atualizado. Isso é o primeiro ponto a medir no teste real.

## Terceira sessão (11/11, retomada)

**Pedido do usuário:** corrigir os itens 2 a 6 do resumo (layout no notebook, WhatsApp da recepção, proteções que descartam o que se digita, gravação interrompida, senha de quem cria a conta), com agentes rodando Opus. O item 1 (clínica não consegue se configurar) **não é defeito**: a equipe Cortex faz a configuração completa.

| O que | Detalhe |
|---|---|
| Cinco agentes Opus | Um por correção, cada um numa cópia isolada do repositório (worktree), com instruções, critérios de aceite e testes obrigatórios. Eu junto os cinco, rodo a verificação completa e publico. |
| **Decisão:** incluí o B10 junto com a gravação | "Nova consulta" podia começar para um paciente que saiu da tela. É pequeno, fica no mesmo fluxo e o risco é atender no prontuário errado. |
| **Decisão:** senha temporária continua, mas com cobrança no servidor | Não há e-mail configurado para convite. A marca de "trocar a senha" vai para um campo que só o servidor grava, vale por 72 horas, e o servidor recusa tudo até a troca. |
| **Decisão:** tolerância de 45 s para falha de rede nas verificações de acesso | Uma falha isolada não esconde mais a tela nem descarta formulários. Recusa definitiva continua bloqueando na hora, e a página de Configurações continua estrita. |
| Migration reservada | `20261111110000` para a cobrança da troca de senha. |
| Cinco agentes terminaram | Todos entregaram commit com testes. Um detalhe: as cópias de trabalho nasceram de um ramo antigo (`TesteCortex`); os cinco perceberam e partiram do `main`. |
| Junção no `main` | Cinco commits trazidos em ordem (senha, proteções, layout, gravação, WhatsApp). Um conflito, no arquivo da fila da recepção, resolvido à mão. |
| Verificação da combinação | Tipos e tipos das funções: ok. Suíte completa do app: 2.807 testes passam; um arquivo novo de teste precisava de um simulador a mais depois da junção (corrigido; recepção: 1.425 de 1.425). Testes de banco da migration nova no Supabase, em transação desfeita: 6 suítes passam. |
| Conferência visual | Auditoria nas telas principais em 1366×768 e demais larguras, sem achados. Montei uma caixa de WhatsApp fictícia no roteiro de auditoria para ver a resposta. |
| **Decisão:** dois ajustes meus na caixa do WhatsApp | A conversa passa a abrir ao lado da lista já no notebook, e a lista de mensagens rola sozinha mantendo a mais recente junto da caixa de resposta. |
| Revisão da parte de segurança | Li a migration e o código da troca de senha antes de aplicar. As quatro funções centrais de proteção mantêm a lógica anterior e só acrescentam a recusa enquanto a senha temporária está pendente. As duas contas existentes não têm essa marca e não são afetadas. |
| Publicação no Supabase | 38 funções publicadas (duas novas: `change-initial-password`, `reissue-temporary-password`). Backup cifrado `conhcwuwtrkerpbblzgu-2026-11-11-pre-password`, ensaio com rollback, migration `20261111110000` aplicada em 1,5 s. 78 tabelas idênticas antes e depois. Verificador sem pendências. As duas contas continuam entrando (conferido em transação desfeita). |
| Limpeza | Cópias de trabalho dos agentes removidas; os cinco ramos ficaram como reserva (`worktree-agent-*`). |
| **Pendente: `git push`** | O GitHub pede o seu login. Enquanto o push não sai, o site continua na versão antiga. **Atenção:** conta nova criada com senha temporária antes do push fica travada no primeiro acesso, porque a tela antiga não sabe fazer a troca nova. As duas contas atuais não são afetadas. |

**Não verificado com serviço real:**
- Troca da senha temporária contra o Auth de verdade (só com simulador). Para conferir depois do push: criar uma secretária de teste em Equipe, entrar com a senha temporária e trocar.
- Envio real pelo WhatsApp (não há número conectado).
- Gravação com microfone e navegador reais (salvamento a cada 5 s, bloqueio de tela, queda do microfone).

## Quarta sessão (11/11): ondas 1, 2 e 3

**Pedido do usuário:** "pode seguir com a onda 1, 2 e 3".

| O que | Detalhe |
|---|---|
| Peças compartilhadas (commit `5bc047e`) | Componente "Falar com a equipe Cortex" (`SupportRequest`): link de WhatsApp ou e-mail quando a implantação define `VITE_SUPPORT_WHATSAPP` / `VITE_SUPPORT_EMAIL`, e sempre um botão que copia o pedido pronto. Caixa de seleção quadrada (era redonda e parecia escolha única). |
| **Decisão:** canal de suporte por configuração | Você ainda não definiu o contato comercial (D22). O componente funciona sem ele (copia o pedido) e passa a mostrar o link quando as duas variáveis forem preenchidas na Vercel. |
| Instruções dos agentes | [AGENTES.md](AGENTES.md): regras, padrão de qualidade e quem é dono de cada arquivo, para não haver dois agentes no mesmo arquivo. |
| Primeira rodada: oito agentes Opus | Consulta; documentos e pacientes; agenda da recepção; fila, contatos, equipe e indicadores; financeiro; pré-consulta, configurações e conta; IA no servidor; segurança. Cobrem o que falta das ondas 1 e 2 e parte da 3. |
| Migrations reservadas | `20261111120000` agenda (horários ocupados do médico), `…130000` financeiro, `…140000` pré-consulta e exportação LGPD, `…150000` segurança, `…160000` IA. |
| **Decisão:** cadastro público de conta (C17) | Sai da tela e fica fixado como desligado na configuração do repositório. A configuração do projeto hospedado eu confiro antes de mexer. |
| Segunda rodada (depois da junção) | Navegação única, padrão de diálogos e formulários, agenda do médico e textos: mexem em arquivos de todas as áreas, por isso ficam para depois. |

| Oito agentes entregaram | Todos com commits e testes. Juntei ao `main` nesta ordem: consulta, IA no servidor, segurança, documentos, fila da recepção, financeiro, agenda da recepção, pré-consulta e conta. Quatro conflitos, todos resolvidos à mão (medidor de uso de IA, teste do atendimento da recepção, roteiro de auditoria, fila). |
| **Decisão:** conferência não trava mais a pré-consulta | Veio do agente de pré-consulta: para que a recepção e o médico vejam o que mudou depois da conferência, o formulário deixa de ser travado; a paciente corrige pelo mesmo link (até 20 envios) e quem conferiu vê "Respostas alteradas depois da sua conferência", com antes e depois. Cada envio fica guardado. Aceitei; se preferir travar, é uma troca pequena. |
| **Decisão:** "Encaixe" para o tipo `urgencia` | A recepção já chamava de "Encaixe" e as telas do médico de "Urgência". Ficou um nome só, "Encaixe", no arquivo único de status e tipos. |
| Cadastro público de conta (C17) | Conferi o projeto hospedado sem alterar nada: cadastro já desligado, senha mínima de 10 caracteres. Não precisei mexer. |
| Falha encontrada na junção | Um teste de limite do `process-clinical-notes` esperava recusa (413) quando o histórico de anotações é grande demais; a função nova salva a anotação primeiro e só pula a IA. Mantive o comportamento novo (a anotação do médico nunca é recusada), dei uma frase própria para esse caso e atualizei o teste. |
| CORS sem curinga | 22 funções ainda respondiam a qualquer site quando o segredo `ALLOWED_ORIGIN` faltava. Agora, sem o segredo, não respondem a outro site. No projeto atual o segredo existe e está certo (conferido pela resposta das funções). |
| Verificação antes de publicar | Tipos do app e das funções: limpos. Recepção: 1.512 testes passam. Funções de servidor e bibliotecas: 1.002 passam. Banco: as suítes das cinco migrations passam; as 28 suítes antigas que falham no projeto hospedado falham igual com e sem as migrations novas (são de ambiente: foram escritas para banco local). |
| Publicação no Supabase (16:35) | Backup cifrado `conhcwuwtrkerpbblzgu-2026-11-11-pre-round2`, ensaio com rollback e ensaio negativo, cinco migrations aplicadas em 1,9 s (histórico 90). Segredo novo `GOOGLE_TOKEN_KEYS`, gerado aqui e nunca exibido. 39 funções publicadas (nova: `change-password`). |
| Conferência depois de publicar | 72 de 78 tabelas idênticas; as outras seis mudaram como previsto (colunas novas em cobranças, lotes, consultas e pré-consultas; limite diário de IA de 1.500 para 8.000; contador interno de versão da conta). Duas tabelas novas, vazias. As 39 funções sobem, recusam chamada anônima e respondem CORS só para o endereço do app (o webhook do WhatsApp responde 503 enquanto o WhatsApp não está conectado, por desenho). As duas contas continuam entrando. |
| Teste real dos tipos de arquivo | Enviei um arquivo mínimo de teste ao bucket de gravações com os tipos que Chrome, Firefox e Safari usam (com e sem o parâmetro de codec): todos aceitos. HTML e SVG: recusados. Arquivo e rascunho de teste apagados em seguida. |
| Suíte completa do app | **Não consegui um resultado único da suíte completa** nesta etapa: com cinco agentes rodando ao mesmo tempo o computador ficou sem memória (1,9 GB livres de 16) e o executor de testes caiu duas vezes. O que rodou em partes passou (recepção, bibliotecas e funções, e os testes de cada área feitos pelos agentes). Rodo a suíte inteira depois da terceira rodada, com a máquina livre, antes de considerar pronto para o push. |
| Terceira rodada (onda 3): cinco agentes Opus | Navegação única e "Sair" com confirmação; agenda do médico; diálogos e formulários; tela da consulta; acabamento de recepção, financeiro e configurações. Antes, criei as peças únicas que todos usam: status e tipo de consulta (`appointmentStatus.ts`), "Última consulta: 12/10/2026 · há 29 dias" (`lastConsultationLabel`) e a moldura de diálogo (`dialogLayout.ts`). |
| **Atenção até o push** | O servidor já está na versão nova e o site publicado ainda na antiga. Algumas telas do site antigo podem se comportar de forma estranha com o servidor novo (pré-consulta, cobrança, conta nova com senha temporária). Some com o `git push`, que continua pedindo o seu login no GitHub. |
| Terceira rodada: quatro de cinco frentes juntas (parada por limite de uso) | No `main`, com tipos limpos: agenda do médico, tela da consulta, navegação única e formulários/diálogos. Testes das telas compartilhadas por elas: 19 arquivos, 199 testes passam (rodados antes de juntar formulários). Conflitos só no roteiro de auditoria, resolvidos à mão. |
| **Falta para fechar a onda 3** | 1) Juntar a quinta frente (acabamento de recepção, financeiro e configurações), ramo `worktree-agent-a17a53927d4938eba`, que ainda rodava os próprios testes. 2) Rodar a suíte completa do app com a máquina livre: ainda não houve uma execução única depois das junções das rodadas 2 e 3. 3) Conferência visual das telas juntas. 4) Remover as cópias de trabalho dos agentes. 5) `git push` (pede o login do usuário). Nada da terceira rodada mexe em banco ou funções: não há publicação no Supabase pendente. |
| Terceira rodada completa (retomada depois do limite) | A quinta frente (acabamento de recepção, financeiro e configurações) foi interrompida pelo limite com o trabalho já commitado; retomei o agente só para o relatório e juntei os cinco commits. As cinco frentes da onda 3 estão no `main`. Conferi ramo por ramo que tudo o que os treze agentes das rodadas 2 e 3 entregaram está no `main`. |
| Verificação com tudo junto | Suíte completa do app, de uma vez só, com a máquina livre: **236 arquivos, 3.297 testes, nenhuma falha**. Tipos limpos. Build de produção concluído (com valores sintéticos, fora do repositório). Lint: 6 erros em 3 arquivos antigos que esta revisão não tocou (caracteres de controle usados de propósito); nenhum nos arquivos alterados. |
| Auditoria visual com tudo junto | Médico (266 estados de tela), administração (320) e recepção (187), em 1920×1080, 1366×768 e 375×812: nenhuma rolagem lateral, nenhum erro de página, nenhum controle sem nome. Os únicos avisos são as respostas de erro que o próprio roteiro provoca para fotografar as telas de falha. Capturas em `E:\Work\cortex-audit-tmp\final\`. |
| Roteiro de auditoria corrigido | Três paradas eram do roteiro, não das telas: conferia as abas do financeiro antes de a tela carregar, aplicava passos do médico à recepção e esperava menu numa tela de "sem acesso". Passou a esperar as abas, a respeitar o perfil e a dizer em que passo parou. |
| **Decisão:** dois acabamentos meus depois de ver as capturas | 1) No "Mais" do celular, "Financeiro" e "Recepção" apareciam duas vezes para quem tem mais de uma área; agora cada área aparece uma vez. 2) O título dos diálogos fica alinhado à esquerda também no celular (ficava centralizado sobre um formulário alinhado à esquerda). |
| Limpeza | Treze cópias de trabalho removidas (os ramos `worktree-agent-*` ficam como reserva). Antes de apagar, removi só os atalhos da pasta de dependências e conferi que a pasta principal continuou com 390 entradas. Ficou uma pasta vazia presa por outro processo, sem efeito. |
| **Erro meu, sem consequência** | Apaguei as cópias de trabalho enquanto a primeira auditoria visual rodava; o servidor local recarregou e a auditoria caiu. Repeti as três depois. |
| O que ficou de fora | Lista em "O que ficou de fora" no [plano](PLANO_DE_MELHORIA.md): confirmações que ainda usam a caixa do navegador, menu da administração que rola no notebook, próximo compromisso na lista de contatos, `deno.lock`, link da pré-consulta. Nenhum impede o uso. |
