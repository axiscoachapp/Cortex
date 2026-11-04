# PersonalMed → Cortex: dados e especificação de implementação

Data: 03/11/2026. Autor: Claude, que cuida da frente de dados e migração. Destinatário: Codex, na frente Cortex/CRM.

O documento tem três partes:
- a resposta ao handoff [`docs/product/clinic-crm/DATABASE_HANDOFF.md`](../../product/clinic-crm/DATABASE_HANDOFF.md);
- o dicionário do que existe no legado;
- o que o Cortex precisa implementar para receber esses dados e atender a clínica.

**Privacidade.** Só há contagens, nomes de tabelas e campos, rótulos de configuração e exemplos sintéticos. Nenhum dado de paciente. Os números vêm de três scripts, que apenas leem a exportação:
- [`scripts/personalmed/data-quality.mjs`](../../../scripts/personalmed/data-quality.mjs)
- [`scripts/personalmed/domains.mjs`](../../../scripts/personalmed/domains.mjs)
- [`scripts/personalmed/inventory.mjs`](../../../scripts/personalmed/inventory.mjs)

**Documentos relacionados:**
- [ANALYSIS.md](ANALYSIS.md): estrutura completa do legado. A seção 4 de lá fica substituída por este documento onde houver diferença; por exemplo, CPF, sexo e convênio já têm coluna em `patients`.
- [CADASTRO_E_RECEITAS.md](CADASTRO_E_RECEITAS.md): qualidade do cadastro, exigências legais da receita e modelos.

**Base comum.** A exportação é de 24/08/2026. "Ativos" são os 9.300 pacientes atendidos desde 01/01/2025 ou com consulta marcada. Em 03/11/2026 a clínica aceitou hospedagem em nuvem, não necessariamente num servidor físico; o que isso muda está na §1.3.

---

## 1. Respostas ao handoff

### Prioridade 1

| Pergunta | Resposta |
|---|---|
| Formato e tabelas | Duas bases. São 406 tabelas Paradox 7 (145 com dados, em cp1252). O cadastro e as páginas do prontuário estão num arquivo SQL Server 2000 (`.mdf`), lido por um leitor próprio. O dicionário está em ANALYSIS.md §1–2 e na §2 abaixo. |
| Chaves originais | Todas foram verificadas como únicas: ver §2.1. Paciente: `PCod`. Médico: `UserNumber`. Prontuário: `(PCod, UserNumber)`. Agenda: `(UserNumber, Data, Inicio)`. **Consulta não tem ID** no legado; o atendimento é sintetizado por `(PCod, UserNumber, dia)`. |
| Estabilidade das chaves | `PCod` e `UserNumber` são autoincrementos internos. São estáveis entre exportações da **mesma instalação**. Paciente novo depois da primeira exportação recebe `PCod` novo, que chega como diferença na exportação final. |
| Cadastro único ou por médico? | **O cadastro é único** por pessoa (`Clini_01`), e cada médico tem **seu prontuário** (`Clini_02`). Toda linha clínica traz `UserNumber`. Prontuários com o mesmo `PCod` são a mesma pessoa pela chave do próprio sistema, não por semelhança de nome. 1.666 pessoas têm prontuário com dois ou mais médicos (774 ativas). |
| Autores | Toda linha clínica e todo documento emitido tem `UserNumber`, o médico. As 5 contas de secretária só aparecem em notas de agenda. |
| Telefone, DDD e país | Faltam DDD e país, e há números de família compartilhados. Detalhes logo abaixo da tabela. |
| Responsável | Não há campo de responsável nem vínculo familiar. Há 384 menores de idade: 307 com nome da mãe e 161 com nome do pai, só como texto. |
| E-mail | Só 879 válidos. Em cerca de 7.650 cadastros o campo guarda o **tipo de acomodação do plano**: "enfermaria", "apartamento", "ambulatorial". |
| Agenda futura | Na data da exportação havia **2.954** consultas futuras não canceladas: 2.318 com paciente e **636 só com pré-cadastro** (nome e telefone, sem `PCod`). |
| Bloqueios, retornos e espera | Bloqueios são os slots `age03.Tipo = B` (10.503). O tipo `P` (8.291) tem significado desconhecido. Retorno é o tipo `RET`. Não há lista de espera; `Age09` é uma fila de pronto-atendimento abandonada em 2011. |
| Data de corte | 24/08/2026 é um ensaio. O corte real será a exportação final, com o PersonalMed parado durante a extração. |

Telefone, DDD e país:
- O telefone principal está preenchido em 91,5% dos cadastros e o celular em 37%. O DDD do celular, num campo à parte, só em 4%. Código de país não existe.
- **80% dos ativos estão sem DDD**, e há celulares antigos de 8 dígitos.
- 1.140 cadastros têm vários números no mesmo campo.
- **2.977 números aparecem em dois ou mais cadastros** e envolvem 6.605 cadastros, 20% do total. Dez números se repetem em 6 a 20 cadastros, provavelmente empresas ou a própria clínica.

### Prioridade 2

| Pergunta | Resposta |
|---|---|
| Serviços, valores, pagamentos | `Financas` tem 1.652 lançamentos de 2007-10 a 2023-04, de 3 médicos, com 5 códigos de procedimento. A data de quitação só aparece em 2 lançamentos. **Não serve como livro financeiro.** As tabelas TISS, Unimed e de faturamento estão vazias. |
| Convênios | `Carrier` tem 25 convênios. `Clini_05` tem 62.204 carteiras: "Particular" para quase todos e mais um plano para 28.737 pessoas. 41% das carteiras têm número. Entre as consultas atendidas desde 2025, 77% são Unimed. |
| Documentos fiscais | Nenhum. Não há NFS-e nem recibos no legado. |
| Problemas detectados | São cinco tipos: datas, codificação, texto rico, anexos externos e campos com outro uso. Detalhes logo abaixo da tabela. |
| Staging e mapa de IDs | Ainda não foram construídos. O contrato proposto está na §3. |
| Destino de teste | Uma instância isolada do Cortex, local ou de homologação, com contas sintéticas antes das reais. |
| Tabelas que a migração toca | Não proponho nenhuma alteração em tabelas do CRM. Preciso apenas das tabelas de origem (S1) e dos campos de cadastro (S2), criadas pela sua frente com numeração combinada. |

Problemas detectados no legado:
- **Datas:** a data zero do Delphi, 30/12/1899, deve virar nulo. Há datas impossíveis (um registro em 2088 e validades de carteira até 2099).
- **Codificação:** cp1252 e UTF-16, já tratados pelos leitores.
- **Texto rico:** RTF em todos os textos.
- **Anexos externos:** 172 imagens apontam para arquivos fora da exportação.
- **Histórico corrido:** em 1.481 documentos as datas digitadas estão fora de ordem, e há 52 datas inválidas.
- **Campos com outro uso:** "FAX" guarda o CPF; "e-mail" guarda a acomodação do plano.

### 1.3 Hospedagem em nuvem: o que muda

A clínica pode usar nuvem (decisão D11). Hoje o projeto Supabase de produção está em **us-west-2 (Oregon, EUA)**, ocupa 27 MB e tem só dados de teste: 2 contas e 20 pacientes.

| Tema | Impacto | Recomendação |
|---|---|---|
| Região e LGPD | Dado de saúde fora do Brasil é transferência internacional (LGPD, art. 33). Também aumenta a latência a partir de Curitiba. | Criar o projeto da clínica em **sa-east-1 (São Paulo)**. A região de um projeto não muda depois, e o atual só tem testes; recriar é mais simples que mover. |
| Contrato | O provedor de nuvem passa a ser suboperador da clínica. | Aceitar o DPA do provedor e listá-lo no aviso de privacidade (`src/config/privacy.ts`). |
| Backup e reversão | Na nuvem, backup diário só no plano pago; restauração a um ponto exato (PITR) é um adicional. | Plano Pro com PITR ativo antes da primeira carga real. É o "backup imediatamente antes" da S7. |
| Onde fica a exportação | A exportação e o staging têm dados reais. | Continuam **só no computador do operador**, cifrados. Nada de bucket, chat ou CI. O carregador conecta direto no banco da nuvem com TLS e service role. |
| Ensaios com dados reais | Um projeto de homologação na nuvem com dados reais precisa da mesma proteção da produção. | Ensaio real num Postgres descartável local (o harness que o Codex já usa). Homologação na nuvem só com dados sintéticos. Depois, carga direta na produção. |
| Limites das funções Edge | Tempo e memória limitados. | Nem a carga nem a exportação completa rodam dentro de uma função Edge. A exportação em lotes (S7) fica ainda mais necessária. |
| Tamanho | O texto clínico soma cerca de 80 milhões de caracteres, em 170 mil consultas. | Estimativa abaixo de 2 GB de banco com índices, e menos de 50 MB de arquivos. Cabe com folga no plano Pro. |
| WhatsApp e NFS-e (T12–T22) | O webhook público pode ser uma função Edge, sem gateway nem servidor exposto. | Revisar a seção "WhatsApp e infraestrutura local" do `PRODUCT_SPEC.md` (decisão do Codex). O certificado A1 fica num cofre de segredos. |
| Busca de CEP (S8) | Função Edge consultando um serviço de CEP, só com o CEP. | Sem mudança no desenho. |
| Prazo | O plano de 12 semanas reservava 5 semanas para instalar no servidor da clínica. | Na nuvem, a preparação cai para cerca de 1 a 2 semanas: projeto, domínio, e-mail, backups. |
| Portabilidade | Servidor próprio pode voltar a ser opção no futuro. | Evitar recurso que só existe no Supabase gerenciado. Postgres, Storage, Edge e pg_cron existem também na versão própria. |

---

## 2. O que existe no legado e para onde vai

### 2.1 Entidades, chaves e volumes

| Entidade | Origem | Chave única (verificada) | Linhas | Destino proposto |
|---|---|---|---|---|
| Pessoa / cadastro | `Clini_01` (SQL) | `PCod` | 32.882 | `clinic_contacts` com os campos legais (S2) |
| Prontuário por médico | `Clini_02` (SQL) | `PCod, UserNumber` | 34.796 | `patients` (um por médico), ligado à pessoa |
| Evolução e sinais vitais | `Co28` | `PCod, UserNumber, DataInsert` | 28.598 | Seção da consulta do dia |
| Documento emitido | `Clini_06` | `PCod, UserNumber, ImpNumber` | 72.565 | Seção "Documentos emitidos" da consulta do dia; **nunca** em `prescriptions` |
| CID | `Co12_2` | `PCod, UserNumber, DateInsert, CidCod` | 63.062 | Fora do capítulo Z: `patients.diagnoses`. Capítulo Z: só no texto da consulta. |
| Pré-natal | `Co49_2` | `PCod, UserNumber, NumberGestation, NumberConsultation` | 16.316 | Seção da consulta do dia |
| Gestação | `Co49_1` | `Pcod, UserNumber, NumberGestation` | 4.502 | As 97 em curso viram `clinical_work_items` do tipo `pregnancy`; as demais vão como texto |
| Histórico corrido | `Co12_1` | `PCod, UserNumber` | 26.864 | Dividido por data (§2.3) |
| Páginas do prontuário | `Me` (SQL) | `PCod, UserNumber, CompNumber` | 17.581 | QP/HDA vira consulta da primeira visita; o resto vai para `medical_history` |
| Alerta "Atenção" | `Clini_01.Attention` | `PCod` | 5.277 com texto | Alerta herdado para o médico revisar (§2.5) |
| Carteira de convênio | `Clini_05` | `PCod, CarrierCod` | 62.204 | Convênio do contato (S2) |
| Agendamento | `Age04` com `age03` | `UserNumber, Data, Inicio` | 273.794 | `appointments` (§2.6) |
| Pré-cadastro | `Age04.PreCadastro` (registro binário) | igual ao agendamento | 65.466 | Contato provisório, só para os agendamentos futuros |
| Imagem | `Clini_04`, `Co31_1`, `CO52` | `PCod, ImageCod` e chaves de exame | 48 embutidas, cerca de 4,8 MB; 172 referências externas | `patient_files` (BMP convertido para PNG) |
| Modelo de documento | `Us05`, `Gintxt`, `Pedtxt` | `tabela, ModelNumber` | 1.123 (743 receitas) | Biblioteca de modelos (S3) |
| Agenda: configuração | `age02` (tipos), `age06` (expediente), `age08` (limites por convênio) | — | 54 / 51 / 650 | Tipos e durações por médico (§2.6). `age08` está todo vazio: ignorar. |

**Não migrar** (fica só no arquivo cifrado):
- senhas da equipe (`Us01.Pass`, `Cfg08`, `US12`);
- `AgFone` (924 contatos de terceiros, sem categoria);
- `Messages` (77, quase todas de 2007);
- notas de agenda `age01` e `age05`, que têm dados de terceiros e cerca de 1.300 linhas por ano;
- `Financas`;
- tabelas TISS e de procedimentos;
- a base de medicamentos `Def`;
- as tabelas de CID e de ocupações (CBO);
- nome do pai e "indicado por" (minimização, LGPD art. 6º, III).

### 2.2 Cadastro

Os números estão em CADASTRO_E_RECEITAS.md §2. Para os ativos:

| Item | Situação |
|---|---|
| CPF válido | 67% |
| Telefone com DDD | 20% |
| CEP válido | 61% |
| Endereço completo | 47% |
| Sexo | 80% |
| Nome da mãe | 71% |
| Naturalidade | 67% |

Depois das correções automáticas da §4, 38% dos ativos ficam completos. Faltam então 3.075 CPFs, 3.795 endereços, 1.814 registros de sexo, 1.462 telefones e 243 datas de nascimento. Na exportação, 455 desses pacientes incompletos tinham consulta marcada.

### 2.3 Histórico corrido (`Co12_1`)

| Medida | Valor |
|---|---|
| Documentos com texto | 26.377 |
| Divisíveis pelas datas digitadas no início da linha (2 ou mais datas válidas) | 9.799 |
| Entradas geradas | 99.211 (mediana 5 por documento, máximo 132; mediana de 122 caracteres) |
| Entradas no dia de uma consulta atendida | 71.415 (72%): **confirma que a data digitada é a data da visita** |
| Dias distintos de prontuário | 98.426 |
| Dias que já são atendimento estruturado | 54.574: viram seção dentro da consulta desse dia |
| Dias novos | 43.852: viram consultas novas |
| Documentos com datas fora de ordem | 1.481: dividir assim mesmo, cada entrada com sua data, e marcar para revisão |
| Documentos sem datas suficientes | 16.578: viram uma consulta "Histórico PersonalMed (texto corrido)" na data da última visita |
| Texto antes da primeira data | Mediana de 11 caracteres. Vai no início da primeira entrada; nunca é descartado. |

**Consultas esperadas no total:**

| Origem | Consultas |
|---|---|
| Atendimentos datados | 109.504 |
| Dias novos do histórico | 43.852 |
| Históricos sem datas | 16.578 |
| **Total** | **169.934** |

São mais 13.010 se a página QP/HDA virar consulta (decisão D6).

### 2.4 Outros dados clínicos

- **CID:** 92,5% dos registros são do capítulo Z, que é motivo da consulta (Z01.4 "exame ginecológico" sozinho tem 28.459). Só **4.721 registros, em 2.353 prontuários**, são diagnóstico, e só esses vão para `diagnoses`.
- **Sinais vitais (`Co28`):**
  - peso válido em 27.201 registros;
  - pressão em mmHg válida em 14.342;
  - altura em 5.319;
  - frequência cardíaca e temperatura quase nunca.

  Valor fora da faixa vai como texto original, nunca como dado estruturado.
- **Gestações:** 97 em curso na exportação (DPP posterior a 24/08/2026), todas com DUM e 10 com datação por ultrassom. As flags de risco nunca foram usadas e não migram. Recalcular na exportação final.
- **Páginas `Me`:**
  - QP/HDA: 13.010;
  - Histórico Pessoal: 1.823;
  - Antecedentes: 1.126;
  - Pré-Natal: 422;
  - Aborto Habitual: 295;
  - Estética: 281;
  - Infertilidade: 222;
  - Entrevista pré-parto: 167;
  - Menopausa: 141;
  - Preventivos: 51;
  - Exames: 38.

  Os títulos vêm da configuração de cada médico (`Us04`).
- **Contracepção (`Co50`, 376) e climatério (`Co51`, 292):** viram seções de `medical_history`.

### 2.5 Alerta "Atenção"

Dos 5.277 alertas, a maioria é administrativa:

| Categoria (palavras-chave; um alerta pode ter várias) | Alertas |
|---|---|
| Financeiro (deve, cheque, pagamento…) | 754 |
| Convênio | 312 |
| Doença crônica | 206 |
| Administrativo (ligar, recado, agenda) | 139 |
| Alergia | 123 |
| Medicamento citado | 104 |
| Gestação | 78 |
| Comportamento | 22 |
| Óbito | 15 |
| Nenhuma categoria (textos curtos, mediana de 38 caracteres) | 3.824 |

96 alertas misturam conteúdo clínico e administrativo.

**Consequências:**
- O alerta não pode ir direto para `clinical_notes`, porque misturaria cobrança com prontuário.
- Também não pode ficar visível para a recepção, porque há conteúdo clínico.

**Solução:** um alerta herdado que só o médico vê, com quatro ações: transformar em alergia (como proposta), manter como nota clínica, passar a nota administrativa visível à recepção, ou descartar com auditoria (S6).

### 2.6 Agenda

**Volume:**
- Cerca de 11 a 12 mil consultas atendidas por ano desde 2014 (9 mil em 2020).
- Em 2025: 12.271 atendidas, 1.790 canceladas e 166 faltas (1,3%).

**Duração de slot em 2025 (moda):**
- 20 minutos para os ginecologistas 2, 3, 4 e 5;
- 15 minutos para o urologista 9 e para o médico 11.

Slots longos de 150 a 570 minutos são bloqueios.

**Tipos usados em 2025–2026:**

| Tipo | Consultas |
|---|---|
| CONS (consulta) | 20.877 |
| "cons + c.o" (consulta + citologia oncótica) | 1.682 |
| RET (retorno) | 816 |
| Inserção (DIU) | 38 |
| PREV (preventivo) | 22 |
| NP (não pago) | 21 |

**Estados no legado** (significado inferido):
- T: atendido;
- C: cancelado;
- F: falta;
- A: chegou e não foi atendido;
- E: em atendimento e nunca fechado;
- `-`: sem estado.

Hoje o Cortex não tem estado de falta.

**Operação em 2025:**
- espera mediana de 22 minutos entre a chegada e o início do atendimento (90% esperam até 52);
- o paciente chega em média 7 minutos antes do horário.

**Sobreposição e bloqueios:** a agenda do Cortex recusa horários sobrepostos do mesmo médico.
- No legado, só **27** dos 221.544 agendamentos não cancelados se sobrepõem a outro, e nenhum é de 2025 em diante nem futuro.
- Há **358 bloqueios futuros** (`age03.Tipo = B`) e nenhum agendamento futuro cai dentro deles.

**Pré-cadastro:** dos 65.466, 64.567 têm nome e 636 são futuros. Comparando nome e telefone com o cadastro: 1.199 têm o mesmo nome e telefone, 1.490 só o nome igual, 278 são ambíguos e 61.600 não correspondem a ninguém. **Não ligar automaticamente.** A correspondência só sugere; a secretária confirma (regra do handoff, item 5).

### 2.7 Receitas e modelos

Os detalhes estão em CADASTRO_E_RECEITAS.md §6–7. Para a implementação:

**Modelos de receita:**
- São 743, compartilhados pela clínica toda.
- Usam campos automáticos: `@nome` (723), `@extenso` (369), `@endereco` (353), `@data` (335), `@idade`, `@bairro`, `@cidade`, `@dtnascimento`.
- 254 nomes estão cortados em 20 caracteres.

**Estrutura de um modelo:** cabeçalho "Uso int", "Uso ext" ou "Uso cont", depois uma linha por medicamento ("- NOME ____ quantidade"), seguida da instrução.
- Itens por modelo: 417 têm 1 item, 148 têm 2 ou 3, 74 têm 4 ou mais, e 104 são só texto.
- Das 1.279 linhas de item, 555 casam com um nome comercial do `medication_catalog` e 76 com um princípio ativo. As outras **647 (51%) não casam com nada**: vitaminas, suplementos, dermocosméticos e manipulados. **O item de receita precisa aceitar texto livre.**

**Modelos de texto e de exame:** 297 em `Us05` mais 32 em `Gintxt`/`Pedtxt`.

| Tipo | Modelos |
|---|---|
| Solicitação | 66 |
| Declaração | 46 |
| Atestado | 23 |
| Orientações | 16 |
| Termo | 5 |
| Encaminhamento | 5 |
| Outros | 168 |
| Pedido de exame | 51 |

**Uso entre 01/2025 e 08/2026:** 12.261 receitas.
- 36% são um modelo puro ou quase (80% das linhas iguais ou mais).
- Cerca de 70% partem de um modelo.
- 291 modelos foram usados no período.

**Regulados:**
- Controlados: 9,4%, cerca de 58 por mês (testosterona 672, sertralina 227, fluoxetina 72…). **Hoje o Cortex recusa essas receitas.**
- Antimicrobianos: 3,6%, cerca de 22 por mês.

**Pedidos de exame:** hoje saem como "Texto" ("Solicito…": 2.516 em 2025–2026). O tipo "Sol. exames" quase não é usado (110 no mesmo período).

---

## 3. Contrato de staging (dados → Cortex)

A frente de dados entrega arquivos de staging fora do repositório, cifrados no servidor da clínica. A frente Cortex implementa o carregador que os consome. Os dois lados trabalham em paralelo com fixtures sintéticas que seguem este contrato.

**Envelope** (uma linha NDJSON por registro de destino). É o mesmo formato do handoff, completado:

```json
{
  "sourceSystem": "personalmed",
  "sourceInstance": "pm2005-<sha256 da exportação, 12 caracteres>",
  "sourceEntity": "chart",
  "sourceRecordId": "pcod:1234|user:3",
  "sourceDoctorId": "user:3",
  "batchId": "pm-2026-11-dryrun-01",
  "transformVersion": "pm-v1",
  "targetTable": "patients",
  "targetId": "<uuidv5 determinístico>",
  "payload": { "name": "Paciente Sintética", "date_of_birth": "1990-01-31" },
  "issues": ["phone_ddd_assumed_41"],
  "mappingStatus": "ready"
}
```

- `sourceRecordId` usa a chave da §2.1 sempre no mesmo formato: `campo:valor` unidos por `|`. Dias usam `YYYY-MM-DD`.
- `targetId` é UUIDv5 sob um namespace fixo da migração, gerado a partir de `sourceInstance + sourceEntity + sourceRecordId`. Reprocessar gera os mesmos IDs.
- `mappingStatus` pode ser `ready`, `requires_review` (vai para a lista de pendências, sem carga automática) ou `rejected` (com o motivo em `issues`).
- **Valores brutos não entram no banco.** Ficam no arquivo cifrado e no staging. No banco ficam só o mapa e os códigos de problema (S1), o que atende ao pedido de "área restrita" sem duplicar dado pessoal.
- Para cada lote há um `manifest.json` com contagens por entidade e por médico, SHA-256 de cada arquivo, a versão da transformação e a lista de códigos de problema.
- **Lote real cifrado** (`scripts/personalmed/secure-staging.mjs`):
  - cada entidade vai num arquivo `<entidade>.ndjson.enc`, cifrado com AES-256-GCM no formato `PMS1` + IV de 12 bytes + texto cifrado + tag de 16 bytes;
  - a chave vem só da variável `PM_STAGING_KEY` (64 caracteres hexadecimais, gerada com `--new-key` e guardada num gerenciador de senhas);
  - o gravador recusa gravar dentro do repositório;
  - o `manifest.json` fica em texto claro, só com agregados e o SHA-256 do texto de cada arquivo.

  O carregador lê o lote com `readEncryptedNdjson(arquivo, chave)`. Para gerar: `PM_STAGING_KEY=… node --max-old-space-size=6144 scripts/personalmed/extract.mjs <exportação> --out <pasta fora do repositório>`. Sem `--out`, o extrator só conta e não grava nada.

**Entidades de staging**, em ordem de carga. A ordem foi revista com o Codex na mensagem `2026-11-03-2148`.
1. `person`: identidade legal do legado, um registro por `PCod`. Fica só no staging até a S2 ter especificação própria.
2. `chart`: linha de `patients` por `(PCod, UserNumber)`. Leva cópia de CPF, sexo, telefone com DDD, e-mail válido e convênio da `person`, nos campos que `patients` já tem hoje.
3. `contact`: candidato a `clinic_contacts`. Leva nome e telefone bruto; `phone_normalized` é `55` + DDD + número, igual a `normalize_reception_phone`, ou `null` sem DDD seguro.
4. `contact_chart_link`: `self` só pela chave do legado (mesmo `PCod`); nunca por telefone.
5. `health_plan_card`: carteirinha de convênio, só no staging até a S2 definir o destino. Implementação: `buildHealthPlanCards` em `staging.mjs`.
   - Um registro por carteirinha de `Clini_05`, com operadora, número, nome do titular, validade e marcação de operadora desativada. "Particular" é forma de pagamento, não carteirinha, e não entra.
   - O nome do titular pode ser de outra pessoa (mãe, cônjuge) e fica só no staging cifrado.
   - `primary` marca a primeira carteirinha de operadora ativa que ainda está na validade.
   - Códigos: `card_number_missing`, `card_expired`, `card_duplicated`, `carrier_disabled` e os de data. Todos são informativos: o registro fica `ready` para o staging.
6. `schedule_block`
7. `appointment`
8. `consultation`
9. `diagnosis_set`
10. `pregnancy_item`
11. `medical_history`
12. `legacy_alert`: o campo "Atenção" (S6), especificado abaixo.
13. `file`
14. `template`: modelo de documento para `document_snippets` (S3), especificado abaixo.

**Entidade `legacy_alert`** (04/11/2026). Implementação: `buildLegacyAlert` em `staging.mjs` e `alertCategories` em `transforms.mjs`. O `domains.mjs` usa a mesma função. Exemplos sintéticos em `fixtures/synthetic-batch/legacy_alert.ndjson`.
- **Origem e chave:**
  - `Clini_01.Attention`, um texto por pessoa; `sourceRecordId` é `pcod:N`;
  - texto vazio ou só com pontuação não gera alerta.
- **Destino:** `legacy_alerts`. A tabela é definida pelo Codex na S6, e o nome é provisório.
- **Payload:**
  - `text`;
  - `categories`: palavras-chave para quem revisa (alergia, medicamento citado, gestação, doença crônica, óbito, financeiro, comportamento, administrativo, convênio). Não são diagnóstico;
  - `clinical`, `administrative`;
  - `recipients`: `[{doctor, patientTargetId}]`, com os prontuários construídos para a pessoa;
  - `status: pending_review` e `visibility: doctor_only`.
- **Situação:**
  - `ready` quando a pessoa tem um único prontuário: o alerta vai só para aquele médico;
  - `requires_review` com `alert_multiple_doctors` (depende da D20) ou `alert_no_chart`.
- **Códigos que não bloqueiam:** `alert_clinical_and_admin` e `alert_mentions_death`. Nada vai para a recepção diretamente (D7): uma nota administrativa só existe se o médico decidir criá-la.

**Entidade `template`** (04/11/2026). Implementação: `buildTemplate` em `staging.mjs` e `templateKind`, `templateChunks` e `templateUsage` em `transforms.mjs`. Exemplos sintéticos em `fixtures/synthetic-batch/template.ndjson`. É o formato de staging, **não** uma linha pronta de `document_snippets`. O MVP da tabela exige dono individual e só guarda receita com itens; ver S3.
- **Chave e destino:**
  - `sourceRecordId` é `table:<Us05|Gintxt|Pedtxt>|model:<ModelNumber>`, e `targetTable` é `document_snippets`;
  - `sourceDoctorId` é o `UserNumber` dono ou `null`. Hoje 1.090 dos 1.091 modelos de `Us05` são da clínica toda.
- **Payload:**
  - `kind`, pelo `ModelType`: 1 é `receita`, 3 é `pedido_exame` e os demais são `texto`;
  - `name`, limitado a 120 caracteres;
  - `items`, que só existem em receita: `{name, dosage, instructions}`. `dosage` recebe a quantidade escrita depois do `____`, e `instructions` recebe o cabeçalho de via ("Uso oral") mais as linhas seguintes;
  - `body`, com o texto inteiro, para não perder nada, mais `header` e `footer`;
  - `scope` (`clinic` ou `doctor`), `review_status` (`approved` quando o modelo cabe no formato, por decisão da D19; `imported_unreviewed` nos demais), `source: personalmed` e `source_ref` (`Us05:123`);
  - `merge_fields` e `unsupported_merge_fields`;
  - `regulated`, com as substâncias antimicrobianas e controladas encontradas;
  - `usage`: `{since, uses, by_doctor, last_used}`, só contagens e datas. Um documento emitido conta como uso quando todas as linhas fixas do modelo aparecem nele; modelo com menos de 40 caracteres fixos não é reconhecido.
- **Situação:**
  - `ready`: receita com 1 a 15 itens dentro dos limites da tabela;
  - `requires_review`: `template_kind_not_supported_yet` (texto e pedido de exame, enquanto o Cortex só aceita receita), `template_items_not_found` (receita em texto livre), `template_items_over_limit`, `template_item_too_long` e `template_controlled_substance` (depende da D8);
  - `rejected`: `template_empty`;
  - não bloqueiam: `template_merge_field_unsupported`, `template_rtf_table` (a tabela do RTF vira texto), `template_name_truncated` e `template_name_missing`.
- **Uso no Cortex (D19, 04/11):** cada médico recebe os modelos que usou, já adaptados e **aprovados**, sem revisão prévia, e pode editá-los. Na adaptação, um campo automático (`@sangue`, `@nome`…) dentro de um medicamento vira `____` para o médico preencher, com o código `template_merge_field_blanked`, porque o Cortex não preenche campos dentro dos itens. Os modelos que não cabem no formato ficam no staging até serem adaptados.
- **Fora deste contrato:** o carregador, a importação e a carga real, que continuam separados e sem autorização.

---

## 4. Regras de transformação

Todas são determinísticas e testadas com fixtures sintéticas. Quando a regra não resolve, o valor fica vazio, recebe um código de problema e vai para a secretária ou o médico. Nada é inventado.

**Implementação de referência:** [`scripts/personalmed/transforms.mjs`](../../../scripts/personalmed/transforms.mjs), só com funções puras, e os testes em `transforms.test.mjs` (34 casos, vitest). A lista completa de códigos de problema está no módulo.

| Campo | Regra | Código de problema |
|---|---|---|
| CPF | Procurar CPF com dígito verificador válido em FAX, depois RG, depois e-mail. Guardar só os dígitos. 11 dígitos com dígito errado não entram. | `cpf_checksum_invalid`, `cpf_shared_by_n_contacts` |
| Telefone | Separar números múltiplos (`/`, `,`, ` e `). 10 ou 11 dígitos com DDD válido ficam como estão. Sem DDD: acrescentar 41 **só** se o CEP for de 80000 a 83999 ou a cidade for de Curitiba e região. Celular de 8 dígitos que começa com 6–9 ganha o 9 na frente. Guardar original e normalizado no canal. | `phone_ddd_assumed_41`, `phone_ninth_digit_added`, `phone_no_ddd_outside_41`, `phone_invalid` |
| E-mail | Só entra se for e-mail válido. Texto de acomodação vai para `health_plan_card.accommodation`. | `email_field_reused` |
| CEP | Só dígitos, 8 posições, dentro da faixa de alguma UF. CEP genérico (terminado em 000) ou fora das faixas vira problema. | `cep_generic`, `cep_out_of_range`, `cep_uf_mismatch` |
| UF e cidade | Sigla. Se vazia, deduzir pelo CEP ou pela cidade "Curitiba". Unificar as grafias de Curitiba ("CTBA", "CWB", erros). | `uf_inferred_from_cep` |
| Sexo | F para `feminino`, M para `masculino`. Vazio fica `null`, **nunca** `nao_informado`, que significa recusa do paciente. | `sex_missing` |
| Nome | Retirar espaços extras e manter maiúsculas e minúsculas. 1.038 nomes têm anotações ou números (só 8 ativos): vão para revisão, sem corte. | `name_has_annotation` |
| Datas | A data zero do Delphi (30/12/1899) vira `null`. Data impossível vira problema. Hora local em America/Sao_Paulo, com o banco de fusos IANA, porque havia horário de verão até 2019. | `date_sentinel`, `date_out_of_range` |
| RTF | Converter para texto com `rtf-to-text.mjs`, mantendo as quebras de linha. Contar caracteres antes e depois, por tabela. | — |
| Histórico corrido | Dividir pelas datas no início da linha (§2.3). | `history_dates_out_of_order`, `history_no_dates` |
| Atendimento ↔ agenda | `appointment_id` só quando existe consulta atendida do mesmo médico, paciente e dia. | — |

**Compatibilidade com `validate_patient_registration`:** com essas regras, nenhuma linha dispara a exceção. Copiando os campos diretamente, 66% dos ativos seriam recusados pelo telefone e 20% pelo e-mail.

---

## 5. O que o Cortex precisa implementar

As numerações de migração devem ser combinadas, como pede o handoff. Os rótulos `migration:…` abaixo são só nomes de trabalho. A coluna "Encaixe" liga cada item ao backlog em `tasks/clinic-crm/todo.md`.

### S1. Origem da importação (antes de qualquer carga)

- **Tabela `legacy_import_batches`:** `id`, `source_system`, `source_instance`, `transform_version`, `manifest_sha256`, `status` (`dry_run`, `loading`, `loaded`, `rolled_back`), `started_at`, `finished_at` e `operator_id`.
- **Tabela `legacy_import_map`:** `batch_id`, `source_entity`, `source_record_id`, `target_table`, `target_id` e `imported_at`. É única em `(source_system, source_instance, source_entity, source_record_id, target_table)`.
- **Tabela `legacy_import_issues`:** `batch_id`, `target_table`, `target_id`, `code` e `status` (`open`, `resolved`). Guarda só o código, nunca o valor.
- **Acesso:** tudo só por service role, sem acesso de cliente, e incluído no ciclo de exportação e exclusão.
- **Aceite:** uma segunda carga do mesmo lote cria 0 linhas. A reversão por `batch_id` remove só o que o lote criou e recusa se houver escrita nova posterior (regra do handoff). Teste SQL de idempotência e de reversão.

### S2. Cadastro da pessoa (encaixe: T04 e T05)

> **Adiado (03/11/2026, contraproposta do Codex).** `clinic_contacts` representa quem fala com a recepção, que pode ser um responsável ou familiar. Por isso não serve como fonte única do CPF, do endereço ou do nascimento do paciente.
>
> Enquanto a S2 não tem especificação própria:
> - os campos legais continuam em `patients`;
> - o staging mantém `person` (por `PCod`) separado de `chart` e de `contact`.
>
> A proposta abaixo fica como ponto de partida dessa especificação.

A ideia original era o cadastro legal ficar na pessoa, não em cada prontuário. Isso resolveria as 774 pessoas ativas com mais de um médico e seria o que a recepção edita sem tocar no prontuário.

- **Campos de `clinic_contacts`** (ou de uma tabela 1:1 de cadastro, se preferir separar):
  - nome;
  - data de nascimento;
  - sexo;
  - CPF;
  - **nome da mãe** e **naturalidade** (cidade e UF), exigidos no prontuário pela Res. CFM 1.638/2002;
  - **endereço**: CEP, logradouro, número, complemento, bairro, cidade e UF, exigido na receita comum (Lei 5.991/73, art. 35) e no prontuário;
  - e-mail;
  - `registration_status` (`imported_unverified`, `verified`), `verified_by` e `verified_at`.
- **`contact_channels`:**
  - telefone original e normalizado, tipo, origem e `verified`;
  - **sem UNIQUE no número**: 2.977 números são compartilhados.
- **Convênio:** operadora, número da carteira, acomodação e validade. Hoje `patients.health_insurance` é texto livre de 120 caracteres; vira cache ou deixa de existir.
- **`patient_contact_links`:**
  - tipo `self` liga a pessoa a cada prontuário com o mesmo `PCod`;
  - tipo `responsible` só com confirmação humana, nunca na importação.
- **Uma fonte da verdade:** decidir se `patients.cpf`, `patients.sex`, `patients.phone`, `patients.email` e `patients.health_insurance` passam a ser lidos do contato `self` ou mantidos por gatilho. Recomendo ler do contato, para não haver duas versões do CPF.
- **Validação:** a do contato segue a mesma regra de `validate_patient_registration`. A importação já chega normalizada.
- **Aceite:**
  - a recepção lê e edita o cadastro sem obter nenhuma coluna clínica;
  - corrigir o CPF numa pessoa com dois prontuários reflete nos dois;
  - fixture de família com o mesmo telefone continua como duas pessoas.

### S3. Biblioteca de modelos de documento

> **MVP implementado em 04/11/2026 (Claude, domínio de prescrição).** Migrations `20261104110000_document_snippets.sql` e `20261104120000_document_snippets_custody_epoch.sql`; interface em `PrescriptionTemplatePicker`, dentro do `DocumentComposerModal`.
> - **Tabela `document_snippets`:**
>   - `owner_user_id` **obrigatório**: cada médico tem a própria biblioteca, sem `clinic_id` e sem compartilhamento;
>   - `kind` só aceita `receita`;
>   - `items` é uma lista de 1 a 15 itens no formato `{name, dosage, instructions}`;
>   - `review_status` pode ser `approved`, `imported_unreviewed` ou `archived`;
>   - `source`, `source_ref` e `revision`.
> - **O que o MVP não guarda:** `body`, `quantity`, `catalog_ref`, `regulated` e os campos automáticos. O `generate-prescription` decide a classe regulatória na emissão.
> - **Escrita:** só pelas RPCs `save_document_snippet` e `archive_document_snippet`. Salvar é a revisão explícita: `imported_unreviewed` vira `approved`.
> - **Importação:** o formato de staging (§3, entidade `template`) guarda mais do que a tabela aceita hoje: `body`, `header`/`footer`, uso, campos automáticos e escopo de clínica. Esse formato **não é um payload para inserir direto**. Um `ready` no staging não dispensa `imported_unreviewed`, D2, D19 nem a aprovação do médico. Texto e origem continuam no staging até existir um contrato autorizado de destino.
>
> O texto abaixo é a **proposta original e futura** (vários tipos, biblioteca da clínica, campos automáticos). Ela não descreve o que existe hoje.

- **Tabela `document_snippets`** (o nome fica a seu critério). Não reutilizar `document_templates`, que é estrutura de nota da IA.
  - Campos: `clinic_id`, `owner_user_id` (nulo quando é da clínica toda), `kind` (`receita`, `texto`, `atestado`, `declaracao`, `pedido_exame`, `orientacoes`, `termo`, `encaminhamento`), `name` (até 120 caracteres), `body` (texto), `items` (jsonb com `name`, `quantity`, `instructions` e `catalog_ref` opcional), `regulated` (`none`, `antimicrobial`, `controlled`, calculado no servidor), `review_status` (`imported_unreviewed`, `approved`, `archived`) e a origem.
- **Campos automáticos:**
  - `@nome`, `@data`, `@extenso` (data por extenso; os modelos terminam em "Curitiba, @extenso");
  - `@endereco`, `@bairro`, `@cidade`, `@cep`, `@telefone`;
  - `@idade`, `@dtnascimento`, `@sexo`;
  - `@convenio`, `@hora`.
  - Modelo com campo não suportado (`@sangue`, `@codigo_paciente`, `@nro_impresso`, `@consulta_dia`) entra como `imported_unreviewed`, com o campo destacado.
- **Conversão de receita em itens:** cada linha "- NOME ___ quantidade" vira um item, e as linhas seguintes, até o próximo item, viram as instruções. Item sem correspondência no catálogo continua como texto livre (51% dos casos).
- **Uso:** escolher um modelo preenche a receita, e o médico pode editar antes de emitir, como já acontece na maioria das receitas hoje. Um modelo `controlled` usa o fluxo de S4.
- **Aceite:**
  - importar os 1.123 modelos sem perder texto;
  - os 291 usados em 2025–2026 marcados para revisão primeiro;
  - teste de preenchimento de cada campo automático e da conversão de itens com fixtures sintéticas.

### S4. Receita e PDF

> **Situação em 04/11/2026:**
> - **Implementado:** telefone e RQE do prescritor (migration `20261104100000`, commits `7427926` e `a715210`); CPF quando houver; sexo e idade na receita de antimicrobiano, com recusa clara quando faltam.
> - **Pendente:** endereço do paciente, que depende da S2, e controlados, que dependem da D8.

- **Paciente no PDF:**
  - imprimir o **endereço** em toda receita (Lei 5.991/73, art. 35, II);
  - imprimir **sexo e idade** na de antimicrobiano (RDC 471/2021);
  - imprimir o **CPF** quando houver (Res. CFM 2.381/2024).
  - Faltou o dado obrigatório: o PDF não é gerado, e a recepção vê a pendência.
- **Prescritor:** acrescentar em `user_settings` e em `update_user_settings` o **telefone** (exigido na RDC 471) e/ou e-mail, e o **RQE** quando houver. Esses dados não existem no legado; os médicos informam.
- **Controlados (fase 2, cerca de 58 por mês):** Receita de Controle Especial das listas C1 e C5.
  - **CPF obrigatório** (Portaria 344/98 com a RDC 1.000/2025, em vigor desde 13/02/2026);
  - validade de 30 dias; 2 vias no papel, via única na versão eletrônica (RDC 1.000/2025, art. 10);
  - primeira etapa: impressão para assinatura manual;
  - a versão eletrônica precisa do número do SNCR a partir de 04/03/2027 (RDC 1.046/2026). O Cortex pode se integrar direto ao SNCR, sem credenciamento; ver `reports/Assinatura digital de receitas.md`;
  - Notificações A e B continuam fora, porque usam talão numerado.

  **Confirmar com o jurídico da clínica antes de liberar.**
- **Aceite:** testes do gerador para os três tipos (comum com endereço, antimicrobiano com sexo e idade, controle especial com CPF) e recusa clara quando falta dado.

### S5. Agenda (encaixe: T09, T10 e T11)

- **Estados:** acrescentar falta (`faltou`) e uma forma de registrar chegada e início do atendimento. O legado tem os dois horários e a espera mediana é de 22 minutos. "Chegou" é um estado de presença, separado do estado do agendamento, como na especificação de vocês.
- **Agendamento sem prontuário:** precisa referenciar um contato provisório (`appointments.contact_id` ou equivalente), para os 636 pré-cadastros futuros e para os novos pacientes da recepção.
- **Tipos e serviços:** "consulta + citologia oncótica", inserção de DIU, preventivo, retorno. Duração padrão por médico: 20 minutos na ginecologia e 15 na urologia. Encaixe com o catálogo de serviços (T16) quando existir.
- **Importação:**
  - `T` → `realizado`; `C` → `cancelado`; `F` → `faltou`;
  - `A` e `E` no passado → `realizado`, com o código original em `notes`;
  - `-` no passado: não importar, ou importar como desconhecido (decisão D3);
  - `-` no futuro → `agendado`.
  - Inserir com `google_sync_status = 'idle'` e sem lembretes.
  - Os 27 agendamentos sobrepostos vão para a lista de rejeições. Os horários não são deslocados.
  - Os 358 bloqueios futuros vão para `reception_schedule_blocks`, se o Codex concordar.
- **Aceite:**
  - importar não enfileira sincronização com o Google nem mensagens;
  - os agendamentos futuros conferem com a exportação final;
  - duas reservas simultâneas não duplicam o horário (T10).

### S6. Dados clínicos importados

- **Consultas:**
  - mapeamento da ANALYSIS.md §4.3, mais a divisão do histórico (§2.3): `soap_note` em Markdown com as seções Evolução, Sinais vitais, Pré-natal, CID, Documentos emitidos e Histórico corrido;
  - `chief_complaint` com o rótulo de importação;
  - o prefixo visível `[Importado do PersonalMed em AAAA-MM-DD]`.
- **Diagnósticos:** só fora do capítulo Z, distintos por prontuário, em `{code, description}`.
- **Gestação em curso:** `clinical_work_items` com `kind = 'pregnancy'`, `details.date` igual à DPP, `details.source` igual a `DUM` ou `USG`, e status `open`.
- **Histórico pessoal:** páginas `Me` que não são QP/HDA, mais contracepção e climatério, em seções com o título do médico.
- **Alerta herdado:**
  - por prontuário, visível só ao médico, com status `pending_review`;
  - ações: virar proposta de alergia, virar nota clínica, virar nota administrativa (visível à recepção) ou descartar, sempre com auditoria.
- **Arquivos:** só depois do paciente existir. BMP convertido para PNG, tag `importado-personalmed` e `ai_summary` nulo.
- **Aceite:**
  - contagens da §6 conferem;
  - nenhuma chamada à IA, ao WhatsApp ou ao Google durante a carga;
  - o texto mais longo (cerca de 19 mil caracteres) aparece inteiro na tela.

### S7. Carregador e operação

- **Escrita:**
  - service role, lotes de até 500 linhas por transação e por médico;
  - só inserção, com `last_visit` e `status` já calculados (atualizar depois geraria revisões e fila do Google);
  - `ON CONFLICT (id) DO NOTHING`, gravando o mapa na mesma transação.
- **Trava:** `guard_clinical_write` usa uma trava por médico. Rodar fora do expediente, um médico por vez, e medir o tempo de cada lote no ensaio.
- **Bloqueio conhecido:** `build_data_export_manifest` monta todo o histórico do médico num único jsonb. Com cerca de 40 mil consultas por médico, a exportação precisa ser paginada ou em fluxo **antes** da carga real.
- **Reversão:**
  - antes do corte: por lote, respeitando `guard_parent_deletion` e começando pelos arquivos;
  - depois de escritas novas: correção controlada, sem apagar dado novo.
  - Backup imediatamente antes.
- **Auditoria:** uma linha `chart_access_audit` com `action = 'legacy_import'` por prontuário, com o operador como ator.

### S8. Pendências de cadastro para a recepção (encaixe: T04 e T09)

- **Consulta paginada** de contatos com pendências: CPF, nascimento, sexo, telefone com DDD, endereço completo, CEP, nome da mãe e naturalidade. Filtro por próximo agendamento e por médico delegado. Não devolve nenhum dado clínico.
- **Ações:**
  - "conferido", com quem e quando;
  - correção campo a campo, com auditoria;
  - preenchimento do endereço a partir do CEP, consultando um serviço externo só com o CEP, sem nome do paciente; precisa de internet no servidor da clínica;
  - CPF repetido e CPF com dígito errado como pendências separadas.
- **Aceite:** com os dados do ensaio, a lista mostra cerca de 5.775 ativos com pendência, a começar pelos que têm consulta marcada.

---

## 6. Contagens esperadas para conferir cada carga

Os valores são da exportação de 24/08/2026 e devem ser recalculados na exportação final. Toda diferença precisa de explicação: órfãos, datas zero ou rejeições.

| Entidade | Esperado |
|---|---|
| Contatos (pessoas) | 32.882 (ou o recorte escolhido em D1; ativos: 9.300) |
| Prontuários | 34.796. Por médico: 2 → 6.406; 3 → 8.882; 4 → 10.170; 5 → 5.341; 9 → 3.266; 11 → 731 |
| Vínculos `self` | 34.796 (1.666 pessoas com dois ou mais) |
| Consultas | 169.934 (+13.010 se D6 = consulta) |
| Diagnósticos fora do Z | 4.721 linhas em 2.353 prontuários |
| Gestações em curso | 97 (recalcular) |
| Itens de histórico pessoal | 4.571 páginas `Me` mais 668 de contracepção e climatério |
| Alertas herdados | 5.277. Ensaio de 04/11 sem diferença: 4.702 com um único médico (`ready`); 575 de pessoas com mais de um médico (D20); 96 misturam conteúdo clínico e administrativo; 15 citam óbito |
| Carteiras de convênio | 62.204 linhas de `Clini_05`: 29.518 carteirinhas e 32.686 registros "Particular". Ensaio de 04/11 sem diferença. Das carteirinhas, 13.963 estão vencidas e 3.895 não têm número. |
| Arquivos | 48 embutidos (172 dependem da pasta externa) |
| Modelos | 1.123: 743 receitas, 329 textos e 51 pedidos de exame. Ensaio de 04/11 08:55, sem diferença: 617 receitas `ready`, que entram aprovadas (D19); 126 receitas fora do formato (106 em texto livre, 39 com controlado à espera do tipo controle especial da D8, 3 com mais de 15 itens); 3 com campo automático trocado por `____`; 380 textos e pedidos em revisão até o Cortex aceitar esses tipos. Usados desde 2025: 375. Receitas usadas por médico (tamanho da lista da D19): 5 → 179; 2 → 153; 3 → 132; 4 → 73; 11 → 8; 9 → 1 |
| Agendamentos | Dependem de D3. Futuros na exportação: 2.954; atendidos desde 2025: 19.675; total: 273.794 |
| Caracteres de texto | Total antes e depois da conversão RTF, por tabela (o script já calcula) |

---

## 7. Testes exigidos (só com dados sintéticos)

Fixtures mínimas:
- família com o mesmo telefone;
- paciente de dois médicos;
- menor com responsável;
- CPF no campo FAX com dígito errado;
- celular antigo de 8 dígitos;
- telefone sem DDD fora da área 41;
- CEP genérico;
- UF vazia com CEP válido;
- histórico com datas fora de ordem;
- histórico sem datas;
- pré-cadastro futuro;
- modelo com `@endereco`;
- modelo com controlado;
- alerta com conteúdo financeiro e alergia;
- data zero do Delphi;
- consulta no dia da troca de horário de verão.

SQL (`supabase/tests`):
- idempotência do lote;
- reversão por lote;
- a recepção não lê alerta herdado nem coluna clínica;
- validação do contato;
- importação sem eventos do Google.

Gerador de PDF: os três tipos da S4.

Navegador: 390, 768, 1280 e 1920 px na escala de 150%, como já está definido.

---

## 8. Decisões da clínica (com padrão proposto)

| # | Decisão | Situação em 04/11/2026 (respostas do usuário às 08:40) |
|---|---|---|
| D1 | Quantos pacientes importar | **Decidida:** todos. |
| D2 | Mapa médico do legado → conta Cortex | **Adiada:** a migração fica pronta e roda depois, sobre uma exportação atualizada. Os códigos já foram identificados pelos nomes cadastrados no sistema antigo (`scripts/personalmed/doctors.mjs`): 2 Sinaida Haddad, 3 Patricia Haddad, 4 Marcelo Chemim Nicola, 5 Marcia Regina Chemin Nicola, 9 Osny de Barros Junior (urologia), 11 "Gineco" (login compartilhado, 731 prontuários), 13 Dr Daniel (sem prontuário). Falta, na hora da carga, a conta Cortex de cada um e saber quem usava o "Gineco". |
| D3 | Agendamentos passados | **Decidida:** todos, inclusive os passados. |
| D4 | DDD 41 automático para Curitiba e região | **Decidida:** sim, e o cadastro é revisado na primeira consulta no Cortex. |
| D5 | Modelos: todos ou só os usados | **Decidida:** todos. |
| D6 | QP/HDA como consulta ou como histórico | **Em avaliação:** o usuário pediu uma análise mais funda. |
| D7 | Alertas "Atenção" | **Em avaliação:** o usuário pediu uma revisão. |
| D8 | Controlados no Cortex | **Decidida:** liberar. Vale para a Receita de Controle Especial (listas C1 e C5). As listas A e B continuam em notificação de receita de talão numerado, que o software não emite. |
| D9 | Confirmar inferências | **Delegada ao Claude:** confirmar pelos próprios dados. |
| D10 | Pasta externa de imagens (172) | **Tarefa a fazer:** pedir à clínica. |
| D14 | Agendamento com médico que não tem ficha do paciente (9.900) | **Decidida (08:50):** "como funcionava no PersonalMed". O agendamento fica ligado ao cadastro único do paciente, na agenda daquele médico, e a ficha (as notas) do médico só nasce quando ele atende. Nada de ficha vazia. |
| D19 | Quem recebe os modelos da clínica | **Decidida:** cada médico recebe os modelos que usou em 2025–2026, já adaptados ao formato do Cortex, como **aprovados** (sem revisão prévia) e editáveis. |
| D20 | Alerta "Atenção" de pessoa com mais de um médico | **Decidida (08:50):** **cadastro único do paciente, notas por médico.** Nome, CPF, endereço, convênio e alertas ficam num cadastro só, visto pelos médicos que atendem o paciente. Cada médico vê as próprias consultas e pode compartilhar outras. O alerta entra uma vez, no cadastro, sem cópias. |
| D11 | Hospedagem e região | **Decidida em 03/11:** Supabase em sa-east-1 (São Paulo), projeto novo só da clínica, plano Pro com backup diário (opção B, sem PITR). O de teste em us-west-2 não recebe dados reais. Antes da carga real: `pg_dump` completo e reavaliar o PITR durante a migração. |

---

## 9. Ordem sugerida

1. **Agora, em paralelo:**
   - Cortex: S1 e o modelo de dados de S2, junto com T01–T05.
   - Dados: extrator e transformações gerando staging sintético e real conforme a §3.
2. **Depois:** S3 e S4 (modelos e PDF), que não dependem da carga e destravam o uso diário.
3. **Agenda:** S5 junto com T09–T11.
4. **Ensaio:** S6 e S7 em staging, com contagens da §6 e revisão de 20 a 30 prontuários por médico.
5. **Recepção:** S8, assim que S2 tiver dados.
6. **Corte:** exportação final, carga por médico fora do expediente e conferência.

**Fora deste documento:** WhatsApp, financeiro e NFS-e (T12–T22). O legado não tem nada para importar nesses módulos.

---

## Como reproduzir os números

```sh
node scripts/personalmed/data-quality.mjs "<pasta da exportação>" --json <fora do repositório>
node scripts/personalmed/domains.mjs "<pasta da exportação>" --catalog <medication_catalog.json> --json <fora do repositório>
node scripts/personalmed/inventory.mjs "<pasta da exportação>" --dupes Clini_06:PCod+UserNumber+ImpNumber
```

O `--catalog` recebe um JSON com `{p: nome comercial, a: princípio ativo}` exportado de `medication_catalog`. Os scripts imprimem só agregados. A saída deve ficar fora do repositório.
