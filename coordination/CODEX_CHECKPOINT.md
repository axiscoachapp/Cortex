# Checkpoint do Codex

Atualizado em 03/11/2026 23:34 (America/Sao_Paulo). T05b/1 implementada e verificada localmente. Manter este arquivo curto, com evidências e próximos passos; sem dados pessoais ou segredos.

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
| `2026-11-03-2226_codex-para-claude_bloqueios-e-contatos.md` / `2026-11-03-2246_codex-para-claude_pre-cadastro-e-coorte.md` | Saídas do Codex | Incorporadas pelo Claude às 22:41/23:00; cabeçalho próprio de 22:46 atualizado; não repetir confirmação |
| `2026-11-03-2300_claude-para-codex_consultas-e-alerta-gemini.md` | SHA-256 `224F1146CFF92946432AAE0A1814BC7A456BFD411F36F220F2496F5B56E8330C` | Respondida às 23:06; staging clínico sintético reconhecido, D13 verificado em fontes primárias; sem mudança de IA/carregador |
| `2026-11-03-2306_codex-para-claude_d13-verificado-e-vinculos.md` | Saída do Codex | Ressalva administrativa dos termos Cloud e próxima especificação; sem pedido de confirmação de leitura |
| `2026-11-03-2327_claude-para-codex_ensaio-real-contagens.md` | SHA-256 `22498E5EBB61A5124B4426505AB7FD67A6E4BB02E630F18DC92517A1E14E426F` | Respondida às 23:30: D14 exige requires_review também no staging; título neutro é proposta; sem schema/carregador/carga |
| `2026-11-03-2330_codex-para-claude_d14-e-identidade-reserva.md` | Saída do Codex | Aguardar evidência nova da proteção D14; não pedir confirmação de leitura |

Atualizar os hashes/entradas quando houver mudança relevante de conteúdo. Conferir também `Responde a` e o ESTADO antes de decidir que uma mensagem exige ação. Não criar cadeia de mensagens que apenas confirme outra confirmação.

## Base de desenvolvimento

- Backend da recepção: `c19624e`; interface/evidências: `9af1b68`. O commit `418c1fa` contém o trabalho do Claude e deve ser preservado.
- Incremento implementado em `4c94483`: correção auditada de nome/telefone do contato, somente admin da clínica, confirmação humana, revisão/CAS, preservação de telefone legado bruto e dos prontuários privados. Retry de criação original preservado por digest privado; contratos anteriores de leitura não mudaram. Migration `20261103003500` implementada antes da reserva futura S1 `04000`.
- Verificação do código em `4c94483`: **435 testes/66 arquivos**, sete testes do editor, **46 migrations/25 suítes SQL**, corrida real de duas correções, 16 verificações no navegador e telas a 150% aprovadas. Tipos regenerados, lint sem erros (oito avisos preexistentes), build aprovado. Detalhes em `docs/reviews/2026-11-03/contact-corrections/IMPLEMENTATION.md`. Nesta rodada, somente documentação; testes de runtime não repetidos.
- Primeira execução paralela sob carga teve falhas por timeout em testes antigos; nove testes afetados passaram isolados e toda a suíte serial passou depois. Nenhum limite de tempo ou código de autenticação/nota foi alterado para esconder falha. Revisão adversarial local concluída; revisão externa dispensada em contexto não interativo.
- Código implementado localmente; migrations/Edge/frontend ainda não publicados. Não aplicar em banco hospedado como efeito da checagem.
- **T05a concluída como especificação**, em `docs/product/clinic-crm/CONTACT_LINK_CORRECTIONS.md`; duas leituras adversariais locais, sem pendência remanescente no contrato. Nenhuma implementação de vínculos nesta rodada. Proteger beneficiário de CRM, exigir vínculo ativo também na reabertura/remarcação e manter DTO estrito da agenda foram correções incorporadas ao desenho.
- **T05b/1 implementada:** `20261103003600_reception_appointment_identity.sql` fixa o beneficiário de reserva CRM, mesmo para outro paciente do mesmo médico/contato ou escritor privilegiado. Calendário projeta origem e modal impede troca, preserva paciente ao salvar e explica cancelamento/nova reserva. Modal também corrigido contra overflow móvel a 150%. SQL reproduziu a falha antes da guarda; 47 migrations/26 suítes SQL e concorrência existente passaram. Sete verificações reais de navegador passaram em 390/768/1280/1920 px. **442 testes/66 arquivos**, lint sem erros/oito avisos anteriores, tipos/build passaram. Revisão adversarial local concluída; revisão externa dispensada. Evidências em `docs/reviews/2026-11-03/appointment-identity/IMPLEMENTATION.md`.
- Próximo incremento independente: restante de **T05b**, estados/revisão e retificações de vínculo com todos os escritores existentes, seguido de concorrência/contratos/editor. **Reservar outro número antes de criar migration**, pois `03600` foi usada na proteção histórica. Não deletar vínculos usados nem mover prontuários; manutenção/encerramento do compromisso histórico original continuam permitidos. Conferir estado e alterações paralelas antes de iniciar.
- T08: regras por serviço dependem de configuração administrativa explícita; não inferir diagnóstico ou converter regras hipotéticas em política real da clínica.
- PersonalMed: extração/staging com Claude. Lote sintético anunciado em `scripts/personalmed/fixtures/synthetic-batch`; não foi importado. Reserva S1 `20261103004000` existe, mas schema/carregador/carga não iniciados. Fonte canônica dos dados legais adiada em S2.

## Pendências e avisos

- **D13 novo e verificado:** helper local usa Developer API com `gemini-2.5-flash`; fonte oficial anuncia redirecionamento automático em 01/12/2026. Termos Developer/Cloud exigem revisão de finalidade/contrato antes do uso clínico; Cloud tem exceção administrativa. CFM verificado com escopo de apoio à decisão. Evidências em `docs/reviews/2026-11-03/ai-provider-alert/VERIFICATION.md`. Nenhuma troca de modelo/provedor, inferência, implantação ou acesso a dados reais.
- Usuário notificado sobre D13 na rodada de 23:19. Claude informou entrega do comparativo ao usuário; escolha continua pendente. Não repetir alerta enquanto não houver nova evidência, decisão ou mudança de prazo. Recepção sem IA continua independente.
- D14 registrada pelo Claude: agendamentos cujo médico não tem prontuário correspondente. Clínica decide o destino; não criar prontuário/vínculo por inferência nem considerar NULL uma aprovação de carga. Pedido ao Claude: `appointment_chart_missing` deve impedir `ready` e ter teste sintético. Não alterar arquivos do staging. Fonte real não foi acessada pelo Codex.
- D11 consta no ESTADO como decidida no chat do Claude: novo projeto São Paulo/Pro/backup diário/sem PITR; nenhum recurso criado pelo Codex. D2/D3/D8 seguem pendentes. Não repetir pendências sem mudança ou dependência concreta.
- Preservar trabalho paralelo em `scripts/personalmed/`, `tasks/plan.md`, `tasks/todo.md`, `Cortex/`, produto SaaS, `research_notes/`, `reports/` e documento de deployment de teste. Não adicionar esses caminhos a commits da recepção.
