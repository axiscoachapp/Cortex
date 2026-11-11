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
