# Plano de melhoria do Cortex

11/11/2026. Resultado da revisão geral pedida pelo usuário: sete revisores independentes (um por área), mais o teste real da IA. Os relatórios completos estão em [`relatorios/`](relatorios/), o teste da IA em [AVALIACAO_IA_PACIENTE_ANTIGO.md](AVALIACAO_IA_PACIENTE_ANTIGO.md) e o registro de decisões em [DIARIO.md](DIARIO.md).

**Situação de cada item:** ✅ feito e publicado · 🟡 feito, chega ao site com o `git push` · 🔧 em andamento · ⏳ a fazer · 🔶 depende de decisão sua.

"✅ servidor · 🟡 tela" quer dizer: banco e funções já estão publicados no Supabase; a parte de tela está pronta no repositório e aparece no site depois do `git push`.

## O quadro geral

- **O que está sólido:** a segurança do servidor (nenhum caminho de leitura entre contas ou clínicas foi encontrado), os cálculos do financeiro, a preservação de rascunhos e a identidade visual.
- **O que impedia o uso real:**
  1. a evolução automática da consulta vinha vazia na maioria das vezes (corrigido);
  2. (não é defeito, ver B1) as telas de cadastro técnico são só leitura porque a configuração de cada clínica é feita pela equipe Cortex;
  3. num notebook comum (1366×768) o app inteiro aparecia no formato de celular (corrigido);
  4. a recepção não conseguia responder o WhatsApp, e a caixa não atualizava sozinha (corrigido);
  5. as proteções de sessão descartavam o que a pessoa estava digitando em situações normais (corrigido).

## Onda 0 — IA para paciente antigo (feito)

| # | Item | Situação |
|---|---|---|
| A1 | Evolução do áudio vinha vazia ou cheia de ressalvas: IA passa a identificar médico e paciente pelo contexto | ✅ |
| A2 | Evolução recebe a história médica e o plano da última consulta, como contexto, e alerta sobre alergia e contraindicação registradas | ✅ |
| A3 | Assistente: busca do histórico reescrita (consultas inteiras, as recentes sempre, índice das demais) | ✅ |
| A4 | Resumo pré-consulta com plano completo, história médica e consultas anteriores | ✅ |
| A5 | Ao salvar, propor a retirada da medicação suspensa; não repetir as mantidas | ✅ servidor · 🟡 tela |
| A6 | Pergunta sobre medicação mostra o que o prontuário registra, sem opinar | ✅ |

## Onda 1 — Bloqueios (impedem uma tarefa principal ou perdem trabalho)

| # | Item | Origem | Situação |
|---|---|---|---|
| B1 | Convênios, preços, dados TISS, dados do prescritor e conexão do WhatsApp não têm tela que grave. **Decisão do usuário (11/11): é por desenho.** A equipe Cortex faz a configuração completa de cada clínica. Fica só o item C13 | Financeiro 1–3 | Fora do escopo |
| B2 | Gravação interrompida era apagada do navegador antes de estar salva no servidor | Clínico 1 | 🟡 Gravação fica guardada até estar no servidor; salva a cada 5 s; bloqueio de tela desligado enquanto grava; aviso se o microfone cair |
| B3 | Renovação de sessão e uma falha de rede descartavam o formulário aberto e escondiam a tela | Recepção 3–5 | 🟡 Renovação não esconde nem descarta nada; falha de rede tolerada por 45 s com aviso |
| B4 | Notebook recebia o layout de celular | UX médico 1, UX recepção 3 | 🟡 Layout de computador a partir de 1200 px, com a letra ampliada mantida |
| B5 | Login: "Entrar" abaixo da dobra; diálogo de gravação não cabia no celular | UX médico 4, 6 | 🟡 Login compacto, erro logo acima de "Entrar"; diálogo de gravação rola e cabe no celular |
| B6 | WhatsApp: recepção não respondia; caixa não atualizava; sem contador | Recepção 1–2 | 🟡 Recepção responde pelo Cortex (texto na janela de 24 h, modelo fora dela); atualiza a cada 15 s; contador de não lidas |
| B7 | Senha temporária continuava valendo; troca só cobrada pelo navegador | Segurança 1–2 | ✅ servidor · 🟡 tela. Troca cobrada pelo servidor; senha temporária vale 72 h |
| B8 | Cobrança era gravada e depois recusada; cada tentativa duplicava | Financeiro 4 | ✅ servidor · 🟡 tela. Criar cobrança virou uma operação só, que não duplica ao repetir |
| B9 | Gravação acima de 25 MB não era processada por nenhum caminho | IA 2 | ✅ servidor · 🟡 tela. Gravação em 32 kbps (cerca de 1h40 por 24 MB), aviso aos 20 MB, parada segura aos 24 MB; áudio longo é transcrito primeiro e a evolução vem numa segunda chamada |
| B10 | "Nova consulta" podia começar para um paciente que saiu da tela ao mudar a busca | Clínico 3 | 🟡 Mudar a busca limpa a seleção |
| B11 | Alergias, medicações e diagnósticos escondidos durante a consulta no notebook e no celular | UX médico 2 | 🟡 Linha fixa sob o nome do paciente, em qualquer largura |
| B12 | Agendamento às cegas; erro fora da vista | Recepção 6–7, UX recepção 5–6 | ✅ servidor · 🟡 tela. O diálogo mostra o dia do médico, os horários livres e os períodos ocupados; o erro fica junto do botão |
| B13 | Quem liga pela primeira vez não podia ser agendado direto da agenda | Recepção 8 | 🟡 "Cadastrar e agendar" na própria busca do agendamento |

## Onda 2 — Defeitos com impacto claro

| # | Item | Origem | Situação |
|---|---|---|---|
| C1 | Editor da consulta manual travava o campo a cada salvamento automático | Clínico 5 | 🟡 Salva sem travar nem mover o cursor |
| C2 | Evolução perdia linhas fora de S/O/A/P e imprimia `**` | Clínico 4 | 🟡 Nada é descartado; impressão limpa |
| C3 | Segunda proposta de comentário nunca podia ser aplicada | Clínico 7 | 🟡 Recupera a versão atual e aplica |
| C4 | Alergia ou diagnóstico errado não podia ser removido; sem IA não dava para registrar | Clínico 8 | 🟡 Lista editável à mão no perfil |
| C5 | Receita sem medicamento por texto livre | Clínico 9 | 🟡 Medicamento manual no compositor |
| C6 | Receita gerada bloqueada como pop-up; documentos vencidos não abriam | Clínico 10–11 | 🟡 "Abrir PDF" por clique; link renovado ao abrir |
| C7 | "Início" escondia a consulta aberta sem caminho de volta | Clínico 12 | 🟡 "Voltar à consulta de {nome}" |
| C8 | Modelos: não dava para ativar nem ver o ativo | Clínico 13 | 🟡 "Usar nas evoluções" e marca do modelo em uso |
| C9 | Financeiro: versão desatualizada sem recuperação; "Corrigir retorno" apagava os valores | Financeiro 5–6 | ✅ servidor · 🟡 tela |
| C10 | XML do lote congelava; "Enviado" sem volta | Financeiro 7 | ✅ servidor · 🟡 tela. "Gerar XML de novo" e "Desfazer envio" |
| C11 | Cobrança particular exigia tabela e código TUSS | Financeiro 8 | ✅ servidor · 🟡 tela |
| C12 | Editores de pré-consulta, robô e automações perdiam edições sem perguntar | Financeiro 9 | 🟡 Perguntam antes de descartar |
| C13 | "Fale com a equipe de implantação" sem canal | Financeiro 10, UX | 🟡 Botão "Falar com a equipe Cortex" / "Copiar pedido". O link de WhatsApp ou e-mail aparece quando `VITE_SUPPORT_WHATSAPP` / `VITE_SUPPORT_EMAIL` forem definidos na Vercel |
| C14 | "A faturar" escondia consultas da agenda própria do médico e de meses anteriores | Financeiro 11 | ✅ servidor · 🟡 tela, em parte. Avisa dos atendimentos sem cobrança dos três meses anteriores e leva até eles; para o resto existe "Nova cobrança avulsa". Consultas marcadas só na agenda própria do médico continuam fora da lista automática |
| C15 | Pré-consulta: respostas trocadas depois da conferência; link legível na caixa do WhatsApp | Segurança 3 | ✅ servidor · 🟡 tela. Cada envio fica guardado; quem conferiu vê "Respostas alteradas depois da sua conferência" com antes e depois; a caixa guarda `[link da pré-consulta]` no lugar do link |
| C16 | Exportação LGPD incompleta | Segurança 4 | ✅ Inclui modelos de receita, pré-consultas e assinaturas; um teste falha se uma tabela nova com dado pessoal ficar de fora |
| C17 | Cadastro público de conta | Segurança 5 | ✅ Conferido no projeto: já estava desligado, senha mínima 10. 🟡 A tela deixou de oferecer |
| C18 | Limite diário de IA baixo; o dia virava às 21h | IA 10 | ✅ 8.000 créditos por dia, virada à meia-noite de Brasília, reserva proporcional ao tamanho |
| C19 | Erros do provedor sempre "tente novamente" | IA 12 | ✅ servidor · 🟡 tela. Mensagem diz quando adianta repetir e quando não |
| C20 | "Insights" da IA gravados no prontuário sem revisão | IA 1 | ✅ servidor · 🟡 tela. Viram sugestão que o médico aceita ou descarta; a anotação do médico é sempre salva |
| C21 | Agenda da equipe escondia compromissos da agenda própria do médico | Recepção 6 | ✅ servidor · 🟡 tela. Aparecem como "Ocupado", sem nenhum dado do compromisso |
| C22 | Conversa sumia depois de "Assumir"; sem telefone, status de envio, mídia | Recepção 9–10 | 🟡 |
| C23 | "Desativar acesso" com um clique; "Salvar permissões" falhava | Recepção 11 | 🟡 Pede confirmação; permissões salvam |
| C24 | Não existia "Alterar senha" para quem está logado | UX médico 20 | ✅ servidor · 🟡 tela. Em Segurança, com a senha atual; encerra as outras sessões |

## Onda 3 — Experiência e consistência

| # | Item | Origem | Situação |
|---|---|---|---|
| D1 | Uma navegação só; "Sair" com confirmação e fora da barra | UX médico 7–8 | 🔧 terceira rodada |
| D2 | Um padrão de diálogo; erros junto do botão | UX médico 9–11, UX recepção 30 | 🟡 nos diálogos da agenda da recepção · 🔧 no restante |
| D3 | Agenda do médico com compromissos na primeira tela; agenda da recepção como grade | UX médico 5, UX recepção 4 | 🟡 recepção (dia cronológico denso, com ocupados) · 🔧 médico |
| D4 | Caixas de seleção redondas | UX médico 16 | 🟡 |
| D5 | Textos: jargão interno, maiúsculas, nomes diferentes para a mesma coisa | UX médico 13, 31–32, UX recepção 31 | 🟡 configurações, pré-consulta, fila · 🔧 no restante |
| D6 | Financeiro ensina a sequência; valores alinhados; relatórios | UX recepção 14–16 | 🟡 Abas numeradas com contagem, exportação CSV |
| D7 | Pré-consulta do paciente: erros que somem ao corrigir, mensagens claras, tela final útil | UX médico 17–18 | 🟡 |
| D8 | Lista de pacientes compacta; busca por CPF e telefone | UX médico 14 | 🟡 |
| D9 | Indicadores: predefinições de período, rótulos simples | UX recepção 22 | 🟡 |
| D10 | Fila da recepção: tempo de espera, telefone, busca; próximo passo no atendimento | UX recepção 9–10 | 🟡 |
| D11 | Status e datas com um formato só | UX médico 24–25 | 🟡 peças únicas criadas (`appointmentStatus.ts`, `lastConsultationLabel`) · 🔧 uso em todas as telas |
| D12 | Nome da clínica piloto fixo no código | Clínico 28 | 🟡 Impressos e menu usam o nome da clínica |

## Endurecimento (segurança, itens menores)

| Item | Situação |
|---|---|
| Comparação de segredos em tempo constante | ✅ |
| Tokens do Google cifrados no banco (`GOOGLE_TOKEN_KEYS` criada) | ✅ (a conexão com o Google ainda depende de `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) |
| Purga diária dos webhooks do WhatsApp (conteúdo some em 30 dias, registro em 90) | ✅ |
| Tipos e tamanho de arquivo cobrados pelo Storage | ✅ |
| CORS sem curinga: sem `ALLOWED_ORIGIN`, a função não responde a outro site | ✅ |
| Excluir conta exige senha digitada nos últimos 10 minutos naquela sessão | ✅ servidor · 🟡 tela |
| CSP mais estreita no site | 🟡 |
| `deno.lock` (versões travadas das funções) | ⏳ precisa de rede para gerar; sem risco imediato |
| Link da pré-consulta fora do caminho da URL | ⏳ |

## Decisões que são suas

- **Caixa do WhatsApp é da clínica inteira** (não por médico) e **a administração vê as consultas atendidas de todos os médicos no financeiro**. Os dois são escolhas de desenho; confirme se é o que você quer.
- **Conferência da pré-consulta não trava mais o formulário** (mudou na rodada 2): a paciente pode corrigir pelo mesmo link até a consulta, e quem conferiu é avisado da mudança. Se preferir travar depois da conferência, é uma troca simples.
- **Canal de suporte** (`VITE_SUPPORT_WHATSAPP`, `VITE_SUPPORT_EMAIL`): definir na Vercel para o botão "Falar com a equipe Cortex" abrir direto a conversa.
- **Especialidade da conta de teste:** está "pré-natal". Trocar para ginecologia melhora os textos gerados.
