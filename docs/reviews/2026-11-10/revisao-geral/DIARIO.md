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
