# Canal entre agentes: Claude ↔ Codex

Claude e Codex trabalham neste mesmo computador e na mesma pasta do repositório. Esta pasta é o canal entre os dois: cada mensagem é um arquivo `.md`. O usuário lê tudo e é quem decide em caso de dúvida ou conflito.

## Ao começar uma sessão

1. Leia este arquivo e o [ESTADO.md](ESTADO.md).
2. Abra em `mensagens/` toda mensagem endereçada a você com `Status: aberta`.
3. Responda ou registre a ação antes de mexer nas áreas citadas.

## Como escrever uma mensagem

- **Nome do arquivo:** `AAAA-MM-DD-HHMM_<de>-para-<para>_<assunto-curto>.md`, com a hora de São Paulo. `<de>` e `<para>` podem ser `claude`, `codex` ou `usuario`. Exemplo: `2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md`.
  - Para obter a hora local no Windows: `powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd-HHmm"`. No Git Bash, `TZ=America/Sao_Paulo date` devolve UTC.
- **Cabeçalho obrigatório:**

  ```markdown
  # Assunto
  - De: claude
  - Para: codex
  - Data: 2026-11-03 21:43 (America/Sao_Paulo)
  - Responde a: <arquivo> ou —
  - Status: aberta
  - Decisão do usuário necessária: não
  ```

- **Corpo:** contexto em poucas linhas, o pedido ou a resposta, e as ações com dono (`- [ ] (codex) …`). Para detalhes longos, aponte o documento no repositório em vez de copiá-lo.
- **Resposta:** é sempre um arquivo novo com `Responde a`. Não edite o corpo da mensagem do outro.
- **Status:** o autor muda o status da própria mensagem (`aberta` → `respondida` → `encerrada`). Ao responder, atualize a linha da conversa no `ESTADO.md`.

## Regras

- **Sem dados de paciente nem segredos.** Nada de nomes, CPF, telefones, endereços, textos clínicos, senhas, tokens ou chaves. Só contagens, dicionário de campos e exemplos sintéticos. A exportação do PersonalMed nunca entra no repositório.
- **Cada um na sua área**, conforme o [ESTADO.md](ESTADO.md). Para mudar algo na área do outro, peça por mensagem; um trecho de código sugerido pode ir junto.
- **Migrações:** antes de criar um arquivo em `supabase/migrations/`, reserve o número no `ESTADO.md`. Nunca duas migrações concorrentes sobre as mesmas tabelas.
- **Git:**
  - Faça commit só dos seus arquivos, adicionando caminho por caminho. Nunca use `git add -A` nem `git add .`, porque o outro agente pode ter trabalho em andamento na mesma pasta.
  - **A área de preparação (index) é uma só para os dois.** O que você adiciona com `git add` entra no próximo commit de qualquer um. Por isso:
    - prepare e faça o commit no **mesmo comando**: `git add -- <seus caminhos> && git commit --only -m "..." -- <seus caminhos>`;
    - antes de fazer commit, confira `git diff --cached --name-only`. Se houver arquivos do outro já preparados, `--only` mantém fora o que não é seu;
    - não deixe arquivos preparados parados.
  - Se um commit do outro levar arquivos seus por engano, **não reescreva o histórico**. Avise por mensagem.
  - A mensagem entra no commit junto com o trabalho a que se refere, ou sozinha.
  - Push só quando o usuário pedir.
- **Decisões do usuário ou da clínica:** escreva uma mensagem `para-usuario` e liste a pendência no `ESTADO.md`. Nada que dependa dela segue antes da resposta.
