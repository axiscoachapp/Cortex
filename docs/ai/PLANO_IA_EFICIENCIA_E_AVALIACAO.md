# IA do Cortex: plano de economia de tokens e avaliação com os médicos

Data: 03/11/2026. Autor: Claude. Implementação: Codex (`supabase/`, `src/`) e Claude (ferramenta de avaliação, conjunto de teste sintético).

**Ponto de partida:**
- O provedor de IA ainda não foi escolhido (decisão D13). Os médicos vão participar da escolha por meio da avaliação da Parte B.
- Por isso, tudo aqui é **independente de provedor**.
- O comparativo de mercado está em [`reports/Provedores de IA para saúde.md`](../../reports/Provedores%20de%20IA%20para%20sa%C3%BAde.md).

**Regras que valem para todo o plano:**
- Nenhum dado de paciente real passa por IA antes do contrato aprovado (D13). Testes só com dados sintéticos.
- A Resolução CFM 2.454/2026 já está em vigor e exige:
  - aviso ao paciente e respeito à recusa;
  - registro de uso de IA no prontuário;
  - avaliação de risco antes da produção;
  - decisão final sempre do médico.
- Tudo o que a IA gera continua sendo rascunho ou proposta, até o médico aprovar.

---

## Parte A. Economia de tokens

### Situação atual (código em 03/11/2026)

| Função | O que manda para a IA hoje |
|---|---|
| `transcribe-consultation` | O **áudio inteiro** para o Gemini. A transcrição volta como saída de até 32 mil tokens, e o rascunho vem em seguida. |
| `live-copilot` | Até 4 trechos de áudio por chamada. |
| `generate-prebriefing` | A última consulta (Avaliação/Plano, até 800 caracteres) mais os dados estruturados. Fica em cache pela revisão. |
| `chat-assistant` | As últimas 5 consultas resumidas, mais 8 arquivos, mais a busca por embeddings. |
| `process-comment`, `finalize-consultation`, `suggest-questions` | Contexto pequeno e limitado. |

**Risco novo da migração:** depois da importação, a "última consulta" pode ser um histórico antigo de até 19 mil caracteres. Ao mesmo tempo, o histórico de longo prazo fica invisível para o resumo pré-consulta. A síntese (A1) resolve o custo e a qualidade juntos.

### A0. Base comum, independente de provedor (fazer primeiro)

- **Interface única de IA** em `supabase/functions/_shared/`, com as operações:
  - `transcribe(audio)`, que devolve segmentos com falante e tempo;
  - `draftNote`;
  - `summarize`;
  - `extract`, com JSON validado;
  - `answer`, com fontes;
  - `embed`.

  Cada operação tem modelo e provedor configuráveis por tarefa. Nenhuma função chama um provedor diretamente.
- **Rastreio por chamada:** operação, provedor, **modelo efetivo devolvido pela API** (para detectar trocas automáticas, como a do Gemini em 01/12), versão do prompt, tokens de entrada (normais e em cache), tokens de saída, minutos de áudio, latência e custo estimado. Nada do conteúdo vai para o log. O `usage_daily` já existe; aqui o registro passa a ser por operação.
- **Orçamento e alerta** por clínica e por função, com chave para desligar cada função sem afetar as outras.
- **CFM 2.454:**
  - um campo "paciente recusou IA" no prontuário. Quando marcado, nenhuma chamada de IA acontece para aquele paciente;
  - marca de uso de IA em cada evolução ou documento gerado com IA;
  - aviso ao paciente; o texto do aviso será definido pela clínica.

**Aceite:**
- Trocar o provedor de uma tarefa exige só configuração e teste, não reescrever as funções.
- Cada chamada fica registrada sem conteúdo clínico.
- Um paciente com recusa nunca gera chamada de IA (teste SQL e teste de função).

### A1. Síntese do paciente, salva e complementada (a maior economia)

É uma síntese longitudinal **por prontuário** (por médico), guardada no banco e atualizada aos poucos.

- **Fatos com fonte:** cada fato aponta a consulta e a data de origem, por exemplo "DIU inserido (consulta de 10/03/2024)". Seções sugeridas: antecedentes, cirurgias, gestações, condições crônicas, medicações em uso citadas, exames relevantes, pendências e eventos recentes.
- **Tabela sugerida (`patient_syntheses`):**
  - `patient_id` e `user_id`, seguindo a posse e o compartilhamento do prontuário;
  - `content` (JSON com seções e fatos, cada fato com `source_consultation_id` e data);
  - `covered_until` (consulta e data);
  - `updates_since_rebuild`;
  - `status` (`fresh`, `stale`, `rebuilding`);
  - `model`, `provider` e `prompt_version`;
  - `created_at` e `revision`.

  A tabela entra no ciclo de exportação e exclusão. O número da migração é reservado no `ESTADO.md`.
- **Atualização:** ao finalizar uma consulta aprovada pelo médico, a nova síntese é feita a partir de "síntese anterior + consulta nova". O custo é proporcional à consulta nova, não ao histórico.
- **Reconstrução completa:**
  - a cada 10 atualizações;
  - quando uma consulta antiga for editada (a revisão já é registrada, então a síntese vira `stale`);
  - quando o médico clicar em "refazer".

  Isso evita o acúmulo de erros pequenos, o efeito "telefone sem fio".
- **Uso:** o resumo pré-consulta, o assistente e o copiloto recebem a síntese mais a última consulta e os dados estruturados aprovados. O histórico bruto só entra quando o médico pedir uma busca específica, pelos embeddings.
- **Limites:**
  - alergias, medicações e diagnósticos **continuam vindo das listas aprovadas pelo médico**, nunca só da síntese;
  - a síntese aparece como gerada por IA, com data e "cobre até a consulta de DD/MM/AAAA", e com o link de cada fato para a fonte;
  - nunca é enviada ao paciente.
- **Migração:** a síntese inicial dos ~35 mil prontuários importados é gerada uma vez, por lote, depois da D13. Essa é a etapa em que processar no Brasil tem a melhor relação entre custo e proteção. A frente de dados entrega a entrada em staging.

**Aceite:**
- Fixture sintética com 30 consultas: a síntese incremental, após 10 atualizações, contém todos os fatos da reconstrução completa (recall de fatos-chave ≥ 95% na avaliação da Parte B).
- Nenhum fato fica sem fonte.
- Editar uma consulta antiga marca a síntese como `stale`.
- O médico que não é dono nem recebeu compartilhamento não lê a síntese.

### A2. Transcrição separada do modelo de texto

- O áudio vai para o serviço de transcrição, que separa os falantes. O modelo de texto recebe **só o texto**, com segmentos "falante 1/2/3".
- O modelo de texto atribui os papéis (médico, paciente, acompanhante) pelo conteúdo e marca as atribuições incertas.
- **Consulta gravada:** transcrição síncrona ou em lote do arquivo Opus a 24–32 kbps, cerca de 10 MB por 40 minutos.
- **Copiloto:** o navegador transmite direto ao serviço com um token temporário emitido pela função Edge. O áudio não passa pela função.
- Lista de termos (medicamentos, doses frequentes, exames da clínica) cadastrada no serviço de transcrição, se o serviço escolhido aceitar.

**Aceite:** nenhuma chamada ao modelo de texto carrega áudio, e a transcrição guarda a separação de falantes e os tempos.

### A3. Copiloto por janela

- Só roda com o painel aberto e o copiloto ligado nas configurações.
- Atualiza a cada 60 a 120 segundos ou quando o médico pede, com os **últimos minutos de transcrição** mais a síntese (A1). Nunca a consulta inteira de novo.
- A Anvisa provavelmente classificaria sugestão de conduta ou diagnóstico como dispositivo médico (Classe II). Até a decisão da clínica, manter o copiloto restrito a lembrar perguntas não feitas e itens do roteiro, sem sugerir conduta.

**Aceite:** a entrada por chamada fica limitada e não cresce com a duração da consulta (teste com transcrição sintética de 40 minutos).

### A4. Modelo certo para cada tarefa

A configuração por tarefa fica em A0. As faixas são indicativas; o modelo exato sai da Parte B.

| Tarefa | Faixa |
|---|---|
| Evolução (rascunho), síntese (A1), resumo pré-consulta | Modelo forte |
| Extração de alergias e medicações, sugestão de perguntas, classificação de documentos, copiloto | Modelo rápido e barato, com saída em JSON validado |
| Busca | Embeddings, um modelo só, versionado; trocar de modelo exige reindexar tudo |

### A5. Prompt montado para aproveitar o cache

- A parte fixa vai primeiro: instruções, modelo de evolução da clínica, regras e síntese do paciente. A parte variável vai no fim: transcrição nova, pergunta.
- Ganha mais nas conversas do assistente sobre o mesmo paciente e nas atualizações da síntese.
- **Conferir com o provedor escolhido** se o cache é compatível com retenção zero (ZDR). Se não for, desligar o cache.

### A6. Indexar só o que mudou

Os embeddings ficam identificados pelo hash do texto. Um trecho só é reindexado se o texto mudar. O histórico importado é indexado uma vez.

### Impacto estimado

Estimativa, a medir na Parte B. A conta é para 1.300 consultas por mês.

| | Antes | Depois de A1–A6 |
|---|---|---|
| Tokens de entrada de texto por consulta | ~40 mil (premissa do relatório) | ~12–15 mil |
| Modelo de texto (US$/mês) | ~186 | **~60–80** |
| Pacote recomendado: Azure + OpenAI, sem copiloto ao vivo | US$ 260–330 | **US$ 135–225 (≈ R$ 700–1.150)** |

---

## Parte B. Avaliação com os médicos (são eles que escolhem as IAs)

**Objetivo:** escolher o serviço de transcrição e o modelo de texto pelo desempenho em consultas da própria clínica, com dados sintéticos, comparação às cegas e critérios aprovados pelos médicos antes de olhar os resultados.

### B1. Conjunto de teste (sintético)

- **Roteiros:** de 15 a 20 consultas escritas ou aprovadas pelos médicos da clínica, cobrindo:
  - pré-natal;
  - contracepção e DIU;
  - climatério e menopausa;
  - infertilidade;
  - preventivo;
  - urologia;
  - consulta com acompanhante;
  - retorno com exames.

  Cada roteiro inclui de propósito **nomes de medicamentos e doses**, negações ("nega alergia"), correções ("aliás, foi em março"), números e datas. Personagens inventados.
- **Gravação:** encenada por médicos ou pela equipe, no consultório real, com o microfone real, ruído normal e fala sobreposta. Termo de consentimento de gravação dos participantes.
- **Gabarito:** transcrição correta, lista de termos médicos, quem falou o quê, e a evolução de referência escrita pelo médico.
- **Históricos sintéticos:** 5 prontuários com 20 a 30 consultas, para testar a síntese (A1) e o resumo pré-consulta. Podem partir do gerador sintético da migração.

### B2. Candidatos

| Etapa | Candidatos |
|---|---|
| Transcrição | Azure Speech em Brazil South; AWS Transcribe em sa-east-1; Gemini atual (só como referência de qualidade, porque não pode ser usado clinicamente); opcional, um de referência de mercado (AssemblyAI ou ElevenLabs) |
| Texto | OpenAI (GPT-6.1 Sol e Luna); Anthropic (Claude Sonnet 5.5 e Haiku 5.5); Maritaca (Sabiá-4 `-br-sp`); Gemini atual como referência |

Todos recebem exatamente as mesmas entradas e os mesmos prompts. Cada modelo pode ter um ajuste mínimo de formato, documentado.

### B3. Medidas

**Automáticas:**
- erro de palavras;
- **erro em termos médicos** (medicamento, dose, unidade), que é o critério principal;
- acerto de quem falou;
- latência;
- custo por consulta, em tokens e minutos.

**Revisão dos médicos**, às cegas, com as saídas embaralhadas e rotuladas A/B/C e uma rubrica de 1 a 5:
- fidelidade ao que foi dito;
- **omissões**;
- **informação inventada**;
- negações corretas;
- medicação e dose corretas;
- organização SOAP;
- tempo de edição até ficar aprovável.

**Erro crítico:** dose ou medicamento errado, achado inventado ou negação invertida. É contado à parte.

**Síntese:** recall dos fatos-chave, fatos sem fonte e contradições.

### B4. Decisão

1. **Antes de ver os resultados,** os médicos aprovam os critérios. Sugestão:
   - **zero erro crítico não sinalizado** em todo o conjunto;
   - erro em termos médicos abaixo de um limite fixado por eles;
   - mediana de edição de até 2 minutos por evolução.
2. Entre os aprovados, escolher por preferência dos médicos, depois por custo, depois pelos termos de contrato (ZDR, região, cláusulas da ANPD).
3. **Entregáveis:**
   - um relatório com tabela por candidato e exemplos anonimizados dos erros;
   - a ata de decisão;
   - a avaliação de risco da CFM 2.454, assinada pelo diretor técnico.

### B5. Ferramenta e divisão

**Claude (`scripts/ai-eval/`, fora do app):**
- executor que manda o conjunto para cada candidato;
- cálculo das métricas automáticas;
- pacote de revisão às cegas, com uma página de formulário para os médicos darem as notas;
- relatório final.

**Codex:**
- A0 e a configuração por tarefa, para que o vencedor entre no app sem retrabalho;
- depois, A1–A6 com o provedor escolhido.

**Usuário:**
- criar contas de teste nos candidatos, sem dados reais, com créditos pequenos;
- marcar a sessão de gravação e a sessão de revisão com os médicos.

Custo dos testes: alguns dólares (cerca de 400 minutos de áudio e algumas centenas de milhares de tokens por candidato).

### B6. Cronograma sugerido

| Semana | Atividade |
|---|---|
| 1 | Roteiros aprovados pelos médicos; contas de teste; A0 em andamento |
| 2 | Gravação das consultas encenadas; execução nos candidatos; métricas automáticas |
| 3 | Sessão de revisão às cegas com os médicos (1 a 2 horas); decisão D13; avaliação de risco |
| 4 em diante | Implementação do vencedor (A1–A6); piloto com consentimento do paciente |

**Prazo de 01/12/2026:** o Gemini 2.5 Flash é trocado automaticamente nessa data. Como nenhum paciente real passa pela IA atual, a data não exige pressa na escolha. Exige só que o rastreio do modelo efetivo (A0) esteja pronto para registrar a troca.

---

## Ordem

1. **A0**, já: independente de provedor.
2. **Parte B**: avaliação e decisão D13 com os médicos.
3. **A2 e A4**, com o provedor escolhido.
4. **A1**, a síntese (inclusive a inicial da migração).
5. **A3, A5 e A6.**

Decisões pendentes do usuário e da clínica: **D13** (provedores, pela avaliação), **D15** (quais médicos participam, datas e critérios da Parte B) e **D16** (texto do aviso e da recusa de IA ao paciente).
