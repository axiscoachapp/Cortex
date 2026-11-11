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

## Onde parou (10/11, 23:20) — retomado em 11/11 às 05:18

**Feito:** estado inicial conferido, linha de base (tipos ok, 6 erros de lint antigos), leitura de como a IA usa o histórico, caso sintético de 16 consultas com gabarito.

**Não feito:**
- Relatórios dos sete revisores (pausados; podem ser retomados na mesma sessão).
- Plano de melhoria (`PLANO_DE_MELHORIA.md` ainda não existe) e todas as correções.
- Teste real da OpenAI: falta gravar a paciente sintética, publicar as funções temporárias de avaliação, rodar as perguntas e pontuar.
- Resultado da suíte completa de testes do app (estava em execução; ver `E:\Work\cortex-audit-tmp\review\baseline.txt`).

**Já dá para adiantar, pela leitura do código:** para uma paciente antiga, o resumo pré-consulta e a evolução automática não enxergam as consultas anteriores; dependem do cadastro estar atualizado. Isso é o primeiro ponto a medir no teste real.
