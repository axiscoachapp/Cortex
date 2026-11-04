# Checkpoint do Codex

Atualizado em 03/11/2026 22:59 (America/Sao_Paulo). Primeira rodada recorrente concluída. Manter este arquivo curto, com evidências e próximos passos; sem dados pessoais ou segredos.

## Rotina

- Automação: `coordenar-cortex-com-claude` — **Coordenar Cortex com Claude**.
- Estado confirmado no app: ativa; intervalo de 15 minutos; retoma este chat local em `E:\Work\Cortex\cortex`.
- Cada rodada consulta `AGENTS.md`, `coordination/README.md`, `ESTADO.md`, mensagens e backlog da clínica. Responde novidade uma vez e continua trabalho independente autorizado. Não repete confirmação de estado inalterado.
- Claude confirmou checagem de cerca de 15 minutos, válida somente enquanto sua sessão estiver aberta. O heartbeat do Codex continua ativo neste chat; nenhuma automação externa foi criada para o Claude.

## Mensagens conhecidas

| Entrada | Conteúdo reconhecido | Tratamento |
|---|---|---|
| `2026-11-03-2143_claude-para-codex_resposta-ao-handoff.md` | SHA-256 `DDF19C1807B2F79D707556D0AA46DC7EEEC8E5BE7782FA51988A840847979E52` | Já respondida pela mensagem Codex de 21:48 e registrada no ESTADO; não responder de novo só pelo cabeçalho aberto |
| `2026-11-03-2148_codex-para-claude_recepcao-e-handoff.md` | Saída do Codex sobre schema/S2/S1/lote sintético | Respondida pelo Claude às 22:13; cabeçalho próprio atualizado |
| `2026-11-03-2211_codex-para-claude_checagem-recorrente.md` | Saída do Codex sobre a rotina | Respondida pelo Claude às 22:13; cabeçalho próprio atualizado |
| `2026-11-03-2213_claude-para-codex_s2-staging-e-nuvem.md` | SHA-256 `05F9A31909F1A938AF1C24F80AA6751CD491BB4F69ACC451409E78E6A7E4BDB4` | Respondida pelo Codex às 22:26: NULLs da agenda, ator dos bloqueios e correção administrativa |
| `2026-11-03-2241_claude-para-codex_lote-sintetico.md` | SHA-256 `C096226D0F687A616B5C26ED2C9F693968FC3A40DE6810004C65F38ED6E0B167` | Respondida pelo Codex às 22:46: pré-cadastro requires_review, telefone só dígitos válido, coorte operacional como proposta |
| `2026-11-03-2226_codex-para-claude_bloqueios-e-contatos.md` / `2026-11-03-2246_codex-para-claude_pre-cadastro-e-coorte.md` | Saídas do Codex | Sem necessidade de confirmação de leitura; processar apenas novo contrato/evidência |

Atualizar os hashes/entradas quando houver mudança relevante de conteúdo. Conferir também `Responde a` e o ESTADO antes de decidir que uma mensagem exige ação. Não criar cadeia de mensagens que apenas confirme outra confirmação.

## Base de desenvolvimento

- Backend da recepção: `c19624e`; interface/evidências: `9af1b68`. O commit `418c1fa` contém o trabalho do Claude e deve ser preservado.
- Novo incremento: correção auditada de nome/telefone do contato, somente admin da clínica, confirmação humana, revisão/CAS, preservação de telefone legado bruto e dos prontuários privados. Retry de criação original preservado por digest privado; contratos anteriores de leitura não mudaram. Migration `20261103003500` implementada antes da reserva futura S1 `04000`.
- Verificação final: **435 testes/66 arquivos**, sete testes do editor, **46 migrations/25 suítes SQL**, corrida real de duas correções, 16 verificações no navegador e telas a 150% aprovadas. Tipos regenerados, lint sem erros (oito avisos preexistentes), build aprovado. Detalhes em `docs/reviews/2026-11-03/contact-corrections/IMPLEMENTATION.md`.
- Primeira execução paralela sob carga teve falhas por timeout em testes antigos; nove testes afetados passaram isolados e toda a suíte serial passou depois. Nenhum limite de tempo ou código de autenticação/nota foi alterado para esconder falha. Revisão adversarial local concluída; revisão externa dispensada em contexto não interativo.
- Código implementado localmente; migrations/Edge/frontend ainda não publicados. Não aplicar em banco hospedado como efeito da checagem.
- Próximo incremento independente: **T05a**, especificar a retificação de vínculo/relação administrativa antes de implementar, considerando FK de agendamentos e preservação do histórico. Não deletar vínculos usados nem mover prontuários; mudanças de paciente/identidade canônica e carga real continuam separadas. Conferir estado e alterações paralelas antes de iniciar.
- T08: regras por serviço dependem de configuração administrativa explícita; não inferir diagnóstico ou converter regras hipotéticas em política real da clínica.
- PersonalMed: extração/staging com Claude. Lote sintético anunciado em `scripts/personalmed/fixtures/synthetic-batch`; não foi importado. Reserva S1 `20261103004000` existe, mas schema/carregador/carga não iniciados. Fonte canônica dos dados legais adiada em S2.

## Pendências e avisos

- Incremento concluído; nenhum bloqueio novo exige ação do usuário nesta rodada. Notificação apenas de conclusão concreta.
- D11 consta no ESTADO como decidida no chat do Claude: novo projeto São Paulo/Pro/backup diário/sem PITR; nenhum recurso criado pelo Codex. D2/D3/D8 seguem pendentes. Não repetir pendências sem mudança ou dependência concreta.
- Preservar trabalho paralelo em `scripts/personalmed/`, `tasks/plan.md`, `tasks/todo.md`, `Cortex/`, produto SaaS, `research_notes/` e documento de deployment de teste. Não adicionar esses caminhos a commits da recepção.
