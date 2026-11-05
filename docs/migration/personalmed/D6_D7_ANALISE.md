# D6 e D7: análise para a decisão

Análise mais funda pedida pelo usuário, feita em 05/11/2026 sobre a exportação de 24/08/2026. Script: `scripts/personalmed/d6-d7-analysis.mjs`. Só agregados: nenhum nome, identificador, data de pessoa ou texto de prontuário.

## D6: página "QP/HDA"

É a página 201 do prontuário (tabela `Me`), uma por paciente e médico, sem data própria. QP é a queixa principal; HDA, a história da doença atual.

### O que os dados mostram

- **Volume:** 13.010 páginas, 4 delas vazias.

  | Médico | Páginas |
  |---|---|
  | Sinaida Haddad | 5.092 |
  | Marcia Regina Chemin Nicola | 5.047 |
  | Patricia Haddad | 1.597 |
  | Marcelo Chemim Nicola | 796 |
  | "Gineco" (login compartilhado) | 463 |
  | Osny de Barros Junior | 11 |

- **Tamanho:** mediana de 415 caracteres; 10% passam de 2.798; a maior tem 13.088.
- **Dois tipos de página:**
  - **9.617 (74%) sem datas no texto:** é a anotação da primeira consulta (queixa e história).
  - **3.389 (26%) com duas ou mais datas:** viraram um diário de evolução, com 32.750 trechos datados. Desses, 24.962 (76%) caem no dia de um atendimento registrado na agenda. A data digitada é a da visita, como no histórico corrido.
- **Não é cópia do histórico corrido:** 88% das páginas não repetem nenhum trecho do histórico (`Co12_1`), e só 18 repetem 20% ou mais. É conteúdo próprio e precisa ser preservado.
- **Primeira consulta:** das 12.971 páginas com data de primeira consulta, 10.050 (77%) têm atendimento ou registro clínico nesse dia.
- **Atividade da pessoa** (última consulta com o médico):
  - 4.797 páginas (37%) de pacientes vistos em 2025–2026;
  - 2.783 de 2020 a 2024;
  - 4.952 antes de 2020;
  - 474 sem data.

### Opções

**A. Pela data, como o histórico corrido (recomendada)**

- **Página sem datas:** vira a seção "QP/HDA" dentro da consulta da primeira visita. 7.311 entram em consultas que já existem, e 2.306 viram consultas novas nessa data.
- **Página com datas:** é dividida por data, e cada trecho vai para a consulta daquele dia. 25.274 trechos entram em consultas que já existem, e 7.476 dias viram consultas novas.

São cerca de 9.800 consultas novas, com cada trecho no dia certo da linha do tempo.

**B. Uma consulta por página (como está hoje no lote de ensaio)**

Uma consulta "Primeira consulta: QP/HDA" por página, na data da primeira visita, somando 13.010 consultas. Os 32.750 trechos datados ficam presos na data da primeira consulta, fora da linha do tempo.

**C. Tudo no histórico médico do paciente**

Nenhuma consulta nova. Mas a linha do tempo se perde, e os 32.750 trechos datados ficam escondidos num bloco de texto.

## D7: alertas "Atenção"

É o campo "Atenção" do cadastro (`Clini_01`), um por pessoa. Pela D20, fica no cadastro único e é visto pelos médicos que atendem a pessoa. Falta decidir o que fazer com cada alerta na importação.

### O que os dados mostram

- **Volume:** 5.284 alertas com texto, quase sempre curtos (mediana de 40 caracteres; 10% passam de 145).
- **Classificação automática por palavras-chave.** É uma sugestão para o médico, não uma decisão:

  | Ação sugerida | Alertas | De pessoas vistas em 2025–2026 |
  |---|---|---|
  | Nota administrativa (financeiro, convênio, recados, comportamento) | 1.015 | 443 |
  | Nota clínica (doença crônica, gestação, óbito) | 214 | 126 |
  | Proposta de alergia (alergia ou remédio citado) | 128 | 75 |
  | Clínico e administrativo juntos: o médico decide | 96 | 60 |
  | Sem categoria: o médico decide | 3.831 | 2.164 |
  | **Total** | **5.284** | **2.868** |

- **Pistas nos alertas sem categoria:** 1.022 dos 3.831 têm uma pista mais fina:

  | Pista | Alertas |
  |---|---|
  | Parentesco ou indicação | 348 |
  | Retorno ou consulta | 228 |
  | Identificação ou cadastro | 192 |
  | Contracepção | 160 |
  | Procedimento | 128 |
  | Exames | 97 |
  | Particular | 9 |
  | "Não atender" | 5 |

  Os outros 2.809 são textos curtos sem palavra-chave.
- **Atividade:** 2.868 alertas (54%) são de pessoas vistas em 2025–2026.

### Opções

**A. Alerta herdado com ação sugerida, revisado aos poucos (recomendada)**

Todos entram como alerta herdado visível só ao médico, como no desenho S6, já com a ação sugerida acima. O médico confirma em lote.

Na virada, a fila mostra só os 2.868 alertas de pessoas vistas em 2025–2026. Os outros 2.416 aparecem quando a pessoa voltar. Nada administrativo vai para o prontuário, e nada clínico chega à recepção sem o médico.

**B. Revisar todos antes de começar**

Os médicos revisam os 5.284 alertas antes de usar o Cortex.

**C. Importar sem triagem**

Todos viram nota só do médico, sem revisão. É mais rápido, mas mistura cobrança com dado clínico na tela do médico, e nada chega à recepção.

## Como reproduzir

```sh
node scripts/personalmed/d6-d7-analysis.mjs "<pasta da exportação>" --json <fora do repositório>
```
