# Plano de melhoria do Cortex

11/11/2026. Resultado da revisão geral pedida pelo usuário: sete revisores independentes (um por área), mais o teste real da IA. Os relatórios completos estão em [`relatorios/`](relatorios/), o teste da IA em [AVALIACAO_IA_PACIENTE_ANTIGO.md](AVALIACAO_IA_PACIENTE_ANTIGO.md) e o registro de decisões em [DIARIO.md](DIARIO.md).

**Situação de cada item:** ✅ feito e publicado · 🟡 feito, chega ao site com o `git push` · ⏳ a fazer · 🔶 depende de decisão sua.

## O quadro geral

- **O que está sólido:** a segurança do servidor (nenhum caminho de leitura entre contas ou clínicas foi encontrado), os cálculos do financeiro, a preservação de rascunhos e a identidade visual.
- **O que impedia o uso real:**
  1. a evolução automática da consulta vinha vazia na maioria das vezes (corrigido);
  2. (não é defeito, ver B1) as telas de cadastro técnico são só leitura porque a configuração de cada clínica é feita pela equipe Cortex;
  3. num notebook comum (1366×768) o app inteiro aparece no formato de celular;
  4. a recepção não consegue responder o WhatsApp, e a caixa não atualiza sozinha;
  5. as proteções de sessão descartam o que a pessoa estava digitando em situações normais (renovação de sessão a cada hora, uma falha de rede).

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

| # | Item | Origem | Tamanho | Situação |
|---|---|---|---|---|
| B1 | Convênios, preços, dados TISS, dados do prescritor e conexão do WhatsApp não têm tela que grave. **Decisão do usuário (11/11): é por desenho.** A equipe Cortex faz a configuração completa de cada clínica; não haverá formulário para a clínica. Fica só o item C13 (dizer na tela como pedir um ajuste) | Financeiro 1–3 | — | Fora do escopo |
| B2 | Gravação interrompida é apagada do navegador antes de estar salva no servidor; pode perder a consulta | Clínico 1 | P | 🟡 Gravação fica guardada até estar no servidor; salva a cada 5 s durante a captura; bloqueio de tela desligado enquanto grava; aviso se o microfone cair |
| B3 | Renovação de sessão (a cada hora) e uma falha de rede descartam o formulário aberto na recepção e escondem a tela inteira | Recepção 3–5 | M | 🟡 Renovação de sessão não esconde nem descarta nada; falha de rede tolerada por 45 s com aviso; atendimento aberto não some |
| B4 | **Notebook recebe o layout de celular** (o layout de computador só começa em 1728 px) | UX médico 1, UX recepção 3 | G | 🟡 Layout de computador a partir de 1200 px de largura, com a letra ampliada mantida |
| B5 | Login: o botão "Entrar" fica abaixo da dobra; diálogo de gravação não cabe no celular | UX médico 4, 6 | P | ⏳ |
| B6 | **WhatsApp:** recepção não consegue responder; caixa não atualiza sozinha; sem contador de não lidas | Recepção 1–2 | G | 🟡 Recepção responde pelo Cortex (texto na janela de 24 h, modelo fora dela); caixa atualiza a cada 15 s; contador de não lidas |
| B7 | Quem cria uma conta fica com uma senha válida dela; a troca obrigatória só é cobrada pelo navegador | Segurança 1–2 | M | ✅ servidor · 🟡 tela. Troca cobrada pelo servidor, senha temporária vale 72 h, nova senha temporária só enquanto a pessoa não definiu a própria |
| B8 | Cobrança é gravada e depois recusada (erro 400); cada nova tentativa duplica | Financeiro 4 | P | ⏳ |
| B9 | Gravação acima de 25 MB (cerca de 30 a 60 min) não é processada por nenhum caminho | IA 2 | M | ⏳ |
| B10 | "Nova consulta" pode começar para um paciente que saiu da tela ao mudar a busca | Clínico 3 | P | 🟡 Mudar a busca limpa a seleção |
| B11 | Alergias, medicações e diagnósticos ficam escondidos durante a consulta no notebook e no celular | UX médico 2 | M | ⏳ |
| B12 | Agendamento às cegas: o diálogo não mostra a agenda do médico nem horários livres; o erro aparece fora da vista | Recepção 6–7, UX recepção 5–6 | M | ⏳ |
| B13 | Quem liga pela primeira vez não pode ser agendado direto da agenda (cerca de 12 passos) | Recepção 8 | M | ⏳ |

## Onda 2 — Defeitos com impacto claro

| # | Item | Origem | Situação |
|---|---|---|---|
| C1 | Editor da consulta manual trava o campo a cada salvamento automático | Clínico 5 | ⏳ |
| C2 | Evolução na tela e na impressão perde linhas fora de S/O/A/P e imprime `**` | Clínico 4 | ⏳ |
| C3 | Segunda proposta de comentário nunca pode ser aplicada (revisão antiga) | Clínico 7 | ⏳ |
| C4 | Alergia ou diagnóstico errado não pode ser removido; sem IA não dá para registrar | Clínico 8 | ⏳ |
| C5 | Receita: não há medicamento por texto livre; o erro manda "preencher manualmente" | Clínico 9 | ⏳ |
| C6 | Receita gerada pode ser bloqueada como pop-up; documentos vencidos não abrem | Clínico 10–11 | ⏳ |
| C7 | No computador, "Início" esconde a consulta aberta sem caminho de volta | Clínico 12 | ⏳ |
| C8 | Modelos: não dá para ativar um modelo nem ver qual está ativo | Clínico 13 | ⏳ |
| C9 | Financeiro: erro de versão desatualizada sem recuperação; "Corrigir retorno" apaga todos os valores digitados | Financeiro 5–6 | ⏳ |
| C10 | XML do lote congela no primeiro download e a tela não avisa; "Enviado" não tem volta | Financeiro 7 | ⏳ |
| C11 | Cobrança particular exige tabela e código TUSS | Financeiro 8 | ⏳ |
| C12 | Editores do formulário de pré-consulta, do robô e das automações perdem edições sem perguntar | Financeiro 9 | ⏳ |
| C13 | "Fale com a equipe de implantação" em dez lugares, sem canal | Financeiro 10, UX | ⏳ |
| C14 | "A faturar" esconde consultas marcadas na agenda própria do médico e as de meses anteriores | Financeiro 11 | ⏳ |
| C15 | Link da pré-consulta: respostas podem ser trocadas depois da conferência do médico; o link fica legível na caixa do WhatsApp | Segurança 3 | ⏳ |
| C16 | Exportação LGPD não inclui modelos de receita nem respostas de pré-consulta | Segurança 4 | ⏳ |
| C17 | Cadastro público de conta: a tela oferece e o servidor supõe desligado; fixar a política | Segurança 5 | 🔶 |
| C18 | Limite diário de IA baixo para os preços novos (bloqueia perto do 10º paciente); o dia vira às 21h | IA 10 | ⏳ |
| C19 | Erros do provedor viram sempre "tente novamente", mesmo os que não adiantam repetir | IA 12 | ⏳ |
| C20 | `process-clinical-notes` grava "insights" da IA no prontuário sem revisão | IA 1 | ⏳ |
| C21 | Agenda da equipe esconde compromissos da agenda própria do médico, mas eles bloqueiam o horário | Recepção 6 | ⏳ |
| C22 | Conversa some depois de "Assumir"; sem telefone, sem status de envio, sem mídia | Recepção 9–10 | ⏳ |
| C23 | Equipe: "Desativar acesso" com um clique e sem volta; "Salvar permissões" falha em delegação aprovada | Recepção 11 | ⏳ |
| C24 | Não existe "Alterar senha" para quem está logado | UX médico 20 | ⏳ |

## Onda 3 — Experiência e consistência

| # | Item | Origem | Situação |
|---|---|---|---|
| D1 | Uma navegação só (início e subpáginas usam barras diferentes); "Sair" com confirmação e fora da barra | UX médico 7–8 | ⏳ |
| D2 | Um padrão de diálogo: título, corpo que rola, rodapé fixo; erros junto do botão, não em aviso flutuante | UX médico 9–11, UX recepção 30 | ⏳ |
| D3 | Agenda do médico: compromissos na primeira tela; agenda da recepção como grade de horários | UX médico 5, UX recepção 4 | ⏳ |
| D4 | Caixas de seleção aparecem redondas (parecem escolha única) | UX médico 16 | ⏳ |
| D5 | Textos: jargão interno ("implantação", "vínculo", "demanda", "leitura"), maiúsculas e nomes diferentes para a mesma coisa | UX médico 13, 31–32, UX recepção 31 | ⏳ |
| D6 | Financeiro ensina a sequência (abas numeradas com contagem; passos do lote); valores alinhados; relatórios | UX recepção 14–16 | ⏳ |
| D7 | Pré-consulta do paciente: erros que somem ao corrigir, mensagens claras, logo da clínica, tela final útil | UX médico 17–18 | ⏳ |
| D8 | Lista de pacientes: 3 por tela; busca por CPF e telefone | UX médico 14 | ⏳ |
| D9 | Indicadores: predefinições de período, rótulos simples, notas de método recolhidas | UX recepção 22 | ⏳ |
| D10 | Fila da recepção: tempo de espera, telefone, busca; próximo passo claro no atendimento | UX recepção 9–10 | ⏳ |
| D11 | Status e datas com um formato só em todo o app | UX médico 24–25 | ⏳ |
| D12 | Nome da clínica piloto fixo no código (impressos e menu) | Clínico 28 | ⏳ |

## Endurecimento (segurança, itens menores)

Comparações de segredo em tempo constante, tokens do Google cifrados, purga de webhooks com falha, lista de tipos de arquivo no bucket, CSP mais estreita, `deno.lock`, link da pré-consulta fora do caminho da URL. Detalhes em [relatorios/seguranca-privacidade.md](relatorios/seguranca-privacidade.md), itens 6 a 17. ⏳

## Decisões que são suas

- **Cadastro público de conta (C17):** deixar desligado e tirar "Criar conta grátis" da tela? Recomendo sim, enquanto o produto é vendido com implantação.
- **Caixa do WhatsApp é da clínica inteira** (não por médico) e **a administração vê as consultas atendidas de todos os médicos no financeiro**. Os dois são escolhas de desenho; confirme se é o que você quer.
- **Especialidade da conta de teste:** está "pré-natal". Trocar para ginecologia melhora os textos gerados.
