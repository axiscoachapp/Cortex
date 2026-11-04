# Cadastro, receitas e trabalho da secretária: análise do banco PersonalMed

Data: 03/11/2026. Fonte: exportação da clínica Haddad Nicola de 24/08/2026, a mesma de [ANALYSIS.md](ANALYSIS.md).

**Privacidade.** Este documento não tem nenhum dado de paciente. Ele traz só contagens e percentuais. Os números saem de [`scripts/personalmed/data-quality.mjs`](../../../scripts/personalmed/data-quality.mjs), que lê a exportação sem alterá-la e imprime apenas agregados. A saída foi conferida: não contém nenhum número de CPF, telefone, CEP ou e-mail. Nomes de convênios e de medicamentos aparecem porque não são dados pessoais.

**Pacientes ativos** são os 9.300 atendidos desde 01/01/2025 ou com consulta marcada (775 deles). O total de cadastros é 32.882.

---

## Resumo

1. **CPF.** O CPF está no campo "FAX", como a clínica contou. Entre os ativos, 67% têm um CPF válido. A coleta só virou rotina por volta de 2021: entre os pacientes que chegaram de 2007 a 2020, só 10% a 18% têm CPF.
2. **Telefone.** Só 20% dos ativos têm telefone com DDD. A validação que o Codex criou hoje no Cortex exige DDD, então **66% dos ativos seriam recusados** se os dados fossem importados sem tratamento. Para 93% dos números sem DDD, o paciente mora na área 41, e dá para corrigir automaticamente.
3. **Endereço e CEP.** 86% dos ativos têm rua e número. Só 47% têm endereço completo: rua, número, bairro, cidade, UF e CEP válido. O que mais falta é o CEP (31% vazio) e a UF.
4. **Lei.** Nem toda receita exige CPF e CEP.
   - **Receita comum:** exige o **endereço** (Lei 5.991/73).
   - **Receita de controle especial:** exige o **CPF** desde 13/02/2026 (RDC Anvisa 1.000/2025).
   - **Prontuário:** é onde se exige o **CEP**, junto com nome da mãe e naturalidade (CFM 1.638/2002).

   Na prática, o cadastro precisa ter CPF e endereço completo com CEP.
5. **Trabalho da secretária.** Depois das correções automáticas, 38% dos ativos ficam completos. Faltam 3.075 CPFs, 3.795 endereços, 1.814 registros de sexo e 1.462 telefones.
6. **Modelos de receita.** São 743 modelos de receita, mais 380 de textos e pedidos de exame. São compartilhados por toda a clínica e usam campos automáticos (`@nome`, `@endereco`, `@extenso`…). Quase metade imprime o endereço do paciente.
   - Em 2025–2026, cerca de 70% das receitas partiram de um modelo, mas só 22% saíram sem nenhuma alteração.
   - 291 modelos foram usados no período.
7. **Controlados.** 9,4% das receitas de 2025–2026 têm medicamento controlado, cerca de 58 por mês, a maioria testosterona e antidepressivos. **Hoje o Cortex recusa emitir essas receitas.**
8. **Cadastro duplicado entre médicos.** O Cortex guarda um cadastro por prontuário de médico. 774 pacientes ativos têm prontuário com mais de um médico. Uma correção feita pela secretária em um prontuário não chega ao outro.

---

## 1. O que a lei exige

Pesquisa feita em 03/11/2026, só em fontes oficiais abertas (links no fim).

| Documento | Dados do paciente | Dados do médico | Norma |
|---|---|---|---|
| Receita comum (papel) | Nome e **endereço residencial**, mais o modo de usar. O CFM pede também o CPF "quando houver". | Data, assinatura, CRM e endereço. Pelo CFM, também RQE (se houver) e telefone ou e-mail. | Lei 5.991/73, art. 35; Res. CFM 2.381/2024, art. 2º |
| Receita eletrônica | Nome e número de um documento legal | Nome, CRM, endereço, RQE, data e hora; assinatura ICP-Brasil | Res. CFM 2.299/2021; Lei 14.063/2020, art. 13 |
| Antimicrobiano | Nome, **idade e sexo** | Nome, CRM, endereço completo, **telefone**; validade de 10 dias; 2 vias no papel, via única na eletrônica (RDC 1.000/2025, art. 10) | RDC Anvisa 471/2021, arts. 6º e 9º |
| Receita de controle especial (C1, C5) | Nome e **CPF** (ou passaporte). Desde 13/02/2026 não exige mais endereço. | Nome, conselho e UF; validade de 30 dias; 2 vias no papel, via única na eletrônica | Portaria 344/98, arts. 52 e 55, com redação da RDC 1.000/2025 |
| Notificação de Receita A, B, B2 | Nome e CPF, ou "não possui" | Igual à anterior, com numeração da Vigilância Sanitária | Portaria 344/98, art. 36 (RDC 1.000/2025) |
| **Prontuário** (identificação) | Nome, nascimento, sexo, **nome da mãe**, **naturalidade**, **endereço completo com CEP**. O CPF não está na lista. | Registro com data, hora, assinatura e CRM | Res. CFM 1.638/2002, art. 5º; Código de Ética Médica, art. 87 |

O que mudou recentemente:
- **Notificação eletrônica:** a Anvisa colocou o sistema nacional de numeração de receitas (SNCR) no ar em 30/09/2026. Desde então a notificação pode ser emitida eletronicamente, mas isso é opcional.
- **Prazo de transição:** até 03/03/2027, receitas eletrônicas de controle especial e de antimicrobiano podem sair sem o número do SNCR. A partir de **04/03/2027**, o número é obrigatório (RDC 1.046/2026; a data já mudou duas vezes em 2026).
- **Farmácia Popular:** o CPF é apresentado no balcão; a receita não precisa trazê-lo.

**Não foi confirmado:** a página da plataforma do CFM diz que os modelos atuais de controle especial trazem o endereço do paciente, o que contradiz a RDC 1.000. Até esclarecer, **vale manter o endereço** nesses documentos: ele já é exigido na receita comum e não prejudica nada.

---

## 2. Situação do cadastro hoje

| Item | Ativos (9.300) | Todos (32.882) | Observação |
|---|---|---|---|
| CPF válido | 6.225 (66,9%) | 8.168 (24,8%) | 98% está no campo "FAX" |
| Telefone com DDD | 1.887 (20,3%) | 3.145 (9,6%) | A maioria dos números tem 8 ou 9 dígitos, sem DDD |
| CEP válido | 5.715 (61,5%) | 16.006 (48,7%) | Mais 512 ativos com CEP genérico terminado em 000 |
| Rua e número | 8.342 (89,7%) | 27.735 (84,3%) | |
| Endereço completo | 4.328 (46,5%) | 12.531 (38,1%) | Rua, número, bairro, cidade, UF e CEP válido |
| UF preenchida | 6.273 (67,5%) | 21.655 (65,9%) | Dá para deduzir de 1.839 das 3.027 vazias nos ativos |
| Sexo | 7.486 (80,5%) | 24.785 (75,4%) | |
| Data de nascimento | 9.057 (97,4%) | 29.190 (88,8%) | |
| Nome da mãe | 6.567 (70,6%) | 15.787 (48,0%) | Exigido no prontuário |
| Naturalidade | 6.190 (66,6%) | 21.645 (65,8%) | Exigida no prontuário |
| E-mail válido | 446 (4,8%) | 879 (2,7%) | O campo guarda outra coisa; ver 2.5 |

### 2.1 CPF: onde está e desde quando

O campo "FAX" guarda CPF, telefone ou texto, dependendo da época. A época abaixo é a do primeiro contato do paciente com a clínica.

| Primeiro contato | Pacientes | CPF válido | FAX vazio | FAX com telefone | FAX com texto |
|---|---|---|---|---|---|
| Até 2006 | 1.652 | 24% | 51% | 13% | 10% |
| 2007–2010 | 7.045 | 10% | 78% | 7% | 5% |
| 2011–2015 | 8.476 | 12% | 73% | 5% | 9% |
| 2016–2020 | 7.245 | 18% | 75% | 2% | 4% |
| 2021–2026 | 8.434 | 56% | 38% | 1% | 4% |

Entre os ativos, o percentual de CPF chega a 67% porque pacientes antigos que voltaram tiveram o CPF incluído.

Nos ativos, o campo "FAX" contém:
- 6.075 CPFs válidos;
- 152 números com formato de CPF mas dígito verificador errado, provavelmente erro de digitação, que a secretária corrige;
- 159 telefones;
- 383 textos;
- 2.432 campos vazios.

Também aparecem 137 CPFs no campo do RG e 13 no campo de e-mail.

**CPF repetido:** 24 CPFs aparecem em 49 cadastros, e 23 desses grupos incluem um paciente ativo.
- 8 grupos têm o mesmo nome e a mesma data de nascimento: é cadastro duplicado.
- 15 grupos têm nomes diferentes: provavelmente o CPF do responsável foi lançado no cadastro do filho, ou houve erro de digitação.

Nenhum deve ser unificado automaticamente; todos vão para revisão.

### 2.2 Telefone

| Melhor telefone do cadastro | Ativos |
|---|---|
| Já tem DDD | 1.887 (20,3%) |
| Sem DDD | 4.873 (52,4%) |
| Celular antigo de 8 dígitos (sem DDD e sem o 9 na frente) | 1.652 (17,8%) |
| Inválido | 458 (4,9%) |
| Sem telefone | 430 (4,6%) |

- Dos 6.525 ativos sem DDD, **6.098 moram na área 41** (CEP de 80000 a 83999, ou Curitiba e região), 119 moram fora e 308 não têm endereço.
- 194 ativos têm mais de um número no mesmo campo, por exemplo "residencial / celular".
- **Validação do Cortex:** o telefone precisa ter de 10 a 15 dígitos. Sem tratamento, 6.176 ativos (66%) e 27.313 cadastros no total seriam recusados.

### 2.3 CEP, endereço e UF

| CEP (ativos) | Pacientes |
|---|---|
| Válido | 5.715 (61,5%) |
| Genérico, terminado em 000 | 512 (5,5%) |
| Vazio | 2.911 (31,3%) |
| Outro formato, incluindo 4 CEPs antigos de 5 dígitos | 162 (1,7%) |

- **UF vazia (3.027 ativos):** 1.410 podem ser deduzidas pelo CEP, 429 pela cidade e 1.188 não.
- **Grafia de Curitiba:** aparece com variações ("CTBA", "CWB", erros de digitação) em 610 cadastros ativos e 2.667 no total.
- **Inconsistências:** 71 ativos com cidade Curitiba têm CEP de fora de Curitiba, e 17 têm CEP de outra UF. Esses vão para revisão.
- **Endereço sem número:** 116 ativos.

### 2.4 Sexo e nascimento

- **Sexo vazio:** 1.814 ativos. 1.381 deles só se consultaram com ginecologistas e 433 também com o urologista.
- **Não deduzir o sexo pela especialidade.** No máximo, o sistema sugere e a secretária confirma: há homens atendidos em ginecologia, por exemplo em infertilidade.
- **Valores no Cortex:** feminino, masculino, intersexo e nao_informado. Na importação, F vira feminino e M vira masculino. Campo vazio fica vazio: "nao_informado" quer dizer que o paciente preferiu não informar, o que é diferente de "não coletado".
- **Nascimento vazio:** 243 ativos.

### 2.5 O campo "e-mail" e os convênios

O campo "e-mail" tem só 879 e-mails. Em cerca de 7.650 cadastros ele guarda o **tipo de acomodação do plano**, com grafias como "amb enf", "acomodação apto", "plano enfermaria" e "apartamento".

Todo paciente tem uma carteira "Particular", e 28.737 têm também um plano: Unimed (19.588 carteiras), Amil (3.036), SulAmérica (1.999), Sinan (1.402) e outros 20. 25.623 carteiras têm número.

**Proposta:** levar para o Cortex o convênio, o número da carteira e a acomodação. Hoje existe só o campo `health_insurance`, um texto livre.

---

## 3. Quantos pacientes já atendem a cada exigência

| Documento | Exigência | Ativos que atendem |
|---|---|---|
| Receita comum | Nome e endereço (rua, número, cidade) | 8.038 (86,4%) |
| Antimicrobiano | Nome, idade e sexo | 7.486 (80,5%) |
| Controle especial | Nome e CPF | 6.225 (66,9%) |
| Identificação do prontuário (CFM 1.638) | Nascimento, sexo, mãe, naturalidade e endereço completo com CEP | 2.070 (22,3%) |

---

## 4. Como tratar na migração

Princípios:
- Nada é inventado.
- As correções automáticas são determinísticas e ficam registradas.
- O valor original fica no arquivo do PersonalMed e no mapa de origem (`legacy_import_map`, ver ANALYSIS.md §4.7).
- Todo campo importado e não conferido fica marcado como "importado, conferir".

| Campo | Regra de importação | Efeito nos ativos |
|---|---|---|
| CPF | Procurar CPF válido em FAX, RG e e-mail, nessa ordem. Só entra se o dígito verificador estiver certo. | 6.225 entram. 152 com dígito errado vão para a lista da secretária. |
| Telefone | Separar números múltiplos. Acrescentar o DDD 41 **só** se o CEP ou a cidade forem da área 41. Celular de 8 dígitos ganha o 9 na frente. | De 20% com DDD para 84% |
| Telefone fora da área 41 ou sem endereço | Não adivinhar o DDD; fica para a secretária | 427 ativos |
| E-mail | Só entra se for e-mail válido. A acomodação vai para o convênio. | 446 e-mails; nenhuma recusa |
| CEP | Só dígitos. CEP genérico (terminado em 000) e CEP fora das faixas da UF ficam marcados para conferir. | 5.715 válidos |
| UF | Deduzir do CEP ou da cidade "Curitiba". Nome por extenso vira sigla. | 1.839 deduzidas |
| Cidade | Padronizar as variações de Curitiba | 610 |
| Sexo | F para feminino, M para masculino; vazio fica vazio | 1.814 para conferir |
| Nome da mãe, naturalidade | Importar como estão (são exigidos no prontuário) | Precisam de campo no Cortex |
| Nome do pai, "indicado por" | Não levar para campos ativos (minimização, LGPD art. 6º, III). Ficam no arquivo do PersonalMed. | — |
| RG | Não é exigido em nenhum documento; deixar no arquivo | — |

**Compatibilidade com a validação do Codex** (migração `20261103000200_patient_registration.sql`): com as regras acima, nenhum cadastro é recusado. Copiar os campos diretamente recusaria 66% dos ativos pelo telefone e 20% pelo e-mail.

---

## 5. Trabalho da secretária

### 5.1 O que sobra depois das correções automáticas

São considerados 5 itens: CPF, nascimento, sexo, telefone com DDD e endereço completo com CEP.

| Itens faltando | Ativos |
|---|---|
| Nenhum | 3.525 (37,9%) |
| 1 | 3.044 (32,7%) |
| 2 | 1.598 (17,2%) |
| 3 ou mais | 1.133 (12,2%) |

| Item que falta | Ativos |
|---|---|
| Endereço completo | 3.795; em 2.533 deles falta só o CEP ou o bairro |
| CPF | 3.075 |
| Sexo | 1.814 |
| Telefone | 1.462 |
| Nascimento | 243 |

Além disso, faltam o nome da mãe em 2.733 ativos e a naturalidade em 3.110.

Na data da exportação, 455 pacientes com cadastro incompleto tinham consulta marcada. Essa é a primeira lista de trabalho.

### 5.2 Como pode funcionar

1. **Na véspera:** a agenda mostra quais pacientes do dia seguinte têm cadastro incompleto e o que falta em cada um.
2. **Na recepção:**
   - Conferir documento com foto e CPF (Res. CFM 2.381/2024, art. 3º).
   - Completar CPF, telefone (WhatsApp), CEP (o endereço se preenche pelo CEP), número, complemento, sexo, nascimento, nome da mãe, naturalidade, convênio, carteira e acomodação.
   - Leva de 1 a 2 minutos por paciente.
3. **Marcar o cadastro como conferido**, com quem conferiu e quando. O aviso "importado, conferir" some.
4. **Casos especiais** (CPF repetido, CPF com dígito errado, cidade e CEP que não batem): aparecem como pendências, e a secretária resolve com o paciente.

A clínica tem de 14 mil a 17,5 mil consultas por ano, e os pacientes ativos voltam com frequência. A maior parte do cadastro deve se completar em poucos meses, sem mutirão.

### 5.3 Um cadastro por paciente, não por médico

Hoje o Cortex tem uma linha de `patients` para cada prontuário de médico. Para os 774 ativos com mais de um médico, o cadastro existe em duplicado: se a secretária corrige o CPF no prontuário de um médico, o do outro continua errado.

**Recomendação ao Codex:** um cadastro único da clínica (identificação, contato, endereço, convênio) ligado aos prontuários de cada médico. A outra opção é uma regra que replique a correção para todos os prontuários do mesmo paciente.

### 5.4 Acesso e LGPD

- **Cadastro:** a secretária vê e edita o cadastro e a agenda.
- **Prontuário:** ela **não** vê anamnese, evolução, diagnósticos nem exames (Código de Ética Médica, arts. 78 e 85).
- **Reimpressão de receita:** quando o médico pedir, pode ser uma permissão pontual, com registro.
- **Controles:**
  - login individual (CRM-MG, Parecer 158/2018: senha pessoal e intransferível);
  - termo de sigilo assinado;
  - registro de cada acesso e alteração (LGPD, art. 37).
- **Listas de trabalho com nomes:** são geradas só dentro do Cortex, com controle de acesso, e nunca exportadas para planilha ou WhatsApp.
- **Base legal:** a correção cadastral atende ao direito do paciente de corrigir seus dados (LGPD, art. 18, III). Registros clínicos já assinados não são sobrescritos; corrige-se por adendo.

---

## 6. Modelos de receita

### 6.1 O que existe

| Tabela | Tipo | Modelos |
|---|---|---|
| `Us05` | Receita | 743 |
| `Us05` | Texto (atestados, orientações) | 297 |
| `Us05` | Pedido de exame | 51 |
| `Gintxt` | Textos de ginecologia | 18 |
| `Pedtxt` | Textos de pedidos | 14 |

- **Biblioteca única:** 1.090 dos 1.091 modelos de `Us05` são da clínica toda (sem médico dono) e públicos.
- **Nomes cortados:** 254 nomes têm exatamente 20 caracteres, o limite do campo. 56 modelos repetem o nome de outro.
- **Formato:** o conteúdo é RTF, com mediana de 290 caracteres de texto. 217 modelos usam negrito e 67 usam sublinhado.

**Campos automáticos** que o PersonalMed preenche na impressão:

| Campo | Receitas | Textos | Exames |
|---|---|---|---|
| `@nome` | 723 | 165 | 50 |
| `@extenso` (data por extenso) | 369 | 66 | 23 |
| `@endereco` | **353** | 10 | — |
| `@data` | 335 | 105 | 15 |
| `@idade`, `@dtnascimento`, `@bairro`, `@cidade` | 3–4 cada | 2 cada (bairro, cidade) | — |
| `@sangue`, `@hora`, `@cep`, `@telefone`, `@convenio`, `@codigo_paciente`, `@nro_impresso`, `@consulta_dia` | — | 2–5 cada | — |

Uma receita típica tem esta forma:
- um cabeçalho de via ("Uso int", "Uso ext", "Uso cont"): 682 modelos;
- uma linha por medicamento, no formato "- NOME ______ quantidade": 681;
- instruções em texto livre ("Tome 1 cp vo…"): 693.

Itens por modelo: 417 têm 1 item, 148 têm 2 ou 3, 74 têm 4 ou mais, e 104 são só texto.

**Medicamentos regulados nos modelos:** 46 citam antimicrobiano e 24 citam controlado.

### 6.2 Como são usados (receitas emitidas de 01/2025 a 08/2026)

Foram emitidas 12.261 receitas, cerca de 613 por mês. A comparação foi feita linha a linha com os modelos.

| Origem da receita | Receitas |
|---|---|
| Igual ao modelo; só os campos automáticos preenchidos | 2.640 (21,5%) |
| Modelo com texto acrescentado | 168 (1,4%) |
| Dois ou mais modelos juntos | 273 (2,2%) |
| Modelo editado, mantendo 80% das linhas ou mais | 1.338 (10,9%) |
| Modelo parcialmente parecido, de 50% a 80% das linhas | 4.122 (33,6%) |
| Sem modelo reconhecível | 3.720 (30,3%) |

- **Medida menos precisa:** a faixa de 50% a 80% inclui linhas genéricas comuns a muitos modelos. Com segurança, 36% das receitas são modelo puro ou quase.
- **Por médico:** a parcela parecida com um modelo vai de 67% a 76% (médicos 2, 3, 4 e 5).
- **Concentração:** 291 modelos foram usados no período. Os 50 mais usados somam 74% dos usos reconhecidos, e 446 modelos não foram usados nenhuma vez.

### 6.3 Como levar para o Cortex

Hoje o Cortex monta a receita item por item (medicamento, dose e posologia, buscando na base da Anvisa) e não tem biblioteca de modelos. A função `document_templates` é só o layout de impressão.

**Recomendado:**
1. **Criar a biblioteca de modelos** no Cortex, compartilhada pela clínica, com nomes sem limite de 20 caracteres e com os mesmos campos automáticos. Pelo menos `@nome`, `@data`, `@extenso`, `@endereco`, `@idade`, `@bairro` e `@cidade` precisam funcionar como no PersonalMed.
2. **Converter cada modelo em itens** automaticamente: cada linha "- NOME ___ quantidade" vira um item e as linhas seguintes viram a posologia. Isso cobre bem os 639 modelos com 1 item ou mais. Os 104 modelos só de texto continuam como texto.
3. **Revisão pelos médicos:** primeiro os 291 modelos usados em 2025–2026, a começar pelos 50 mais usados. Os demais entram como "não revisado" ou ficam no arquivo, como a clínica preferir.
4. **Modelos regulados:** os 46 com antimicrobiano vão para o fluxo de antimicrobiano (2 vias no papel, via única na eletrônica). Os 24 com controlado vão para o fluxo de controle especial, assim que ele existir (ver 7).

---

## 7. Controlados e antimicrobianos na prática

Foram identificados pela lista do Cortex, que não é exaustiva; os números são um mínimo.

| De 01/2025 a 08/2026 | Receitas | Por mês | Principais substâncias |
|---|---|---|---|
| Controlado | 1.155 (9,4%) | ~58 | Testosterona 672, sertralina 227, fluoxetina 72, escitalopram 48, bupropiona 44, venlafaxina 13, pregabalina 11 |
| Antimicrobiano | 446 (3,6%) | ~22 | Secnidazol 144, metronidazol 82, nitrofurantoína 69, tetraciclina 46, azitromicina 26, ceftriaxona 25 |

Também há casos raros de opioides e hipnóticos (tramadol, codeína, morfina e zolpidem, 10 no total), que podem exigir notificação.

**Impacto:** hoje o Cortex **recusa** qualquer receita com controlado (`generate-prescription`) e manda emitir em receituário próprio. Na clínica, isso significa cerca de 58 receitas por mês fora do sistema.

Para trazê-las ao Cortex, a receita de controle especial (listas C1 e C5) precisa de:
- **CPF do paciente:** obrigatório desde 02/2026;
- **2 vias no papel**, ou via única na versão eletrônica (RDC 1.000/2025, art. 10);
- **validade de 30 dias**;
- **número do SNCR:** obrigatório a partir de 04/03/2027 na versão eletrônica.

As notificações A e B podem continuar em papel ou na plataforma do CFM.

---

## 8. Dados do médico na receita

- **No PersonalMed:**
  - O cadastro de profissionais (`Sys011`) tem número de registro para 7 dos 13 e nenhum endereço ou telefone.
  - O cabeçalho de impressão (`Us02`) não tem CRM nem endereço; o timbre provavelmente é uma imagem (`Cfg01`).
  - Esses dados terão de vir dos médicos.
- **No Cortex:** `user_settings` tem nome, CRM, UF do CRM e endereço profissional.
- **Faltam no Cortex:**
  - **telefone**, exigido em antimicrobianos pela RDC 471/2021 e, pelo CFM, telefone ou e-mail em toda receita;
  - **RQE**, quando houver.

---

## 9. Lacunas no Cortex (para o planejamento do Codex)

1. **Endereço do paciente:** CEP, logradouro, número, complemento, bairro, cidade e UF, com preenchimento pelo CEP. É exigido na receita comum (Lei 5.991/73) e no prontuário (CFM 1.638).
2. **Nome da mãe e naturalidade**, exigidos no prontuário.
3. **Convênio estruturado:** plano, número da carteira e acomodação. Opcionalmente, um segundo telefone.
4. **PDF da receita:**
   - imprimir o endereço do paciente (Lei 5.991/73, art. 35, II);
   - imprimir o sexo na receita de antimicrobiano (RDC 471);
   - imprimir o CPF quando houver (CFM 2.381) e sempre na receita de controle especial.
5. **Receita de controle especial (C1, C5):** cerca de 58 por mês, hoje recusadas.
6. **Telefone e RQE do médico.**
7. **Biblioteca de modelos de receita** com campos automáticos (seção 6.3).
8. **Cadastro único da clínica**, separado dos prontuários por médico (seção 5.3).
9. **Perfil de secretária** com acesso só ao cadastro e à agenda, lista de pendências, marca de "conferido por/em" e registro de alterações.
10. **Importação compatível com a validação nova** (seção 4): normalizar antes de inserir e nunca copiar campos diretamente.

---

## 10. Perguntas para a clínica

1. Confirmar que o campo "FAX" guarda o CPF e que o campo "e-mail" guarda a acomodação do plano.
2. Desde quando o CPF é pedido de rotina? Os dados indicam 2021.
3. A clínica aceita acrescentar o DDD 41 automaticamente para quem mora em Curitiba e região?
4. Modelos: trazer todos os 743 ou só os 291 usados em 2025–2026? Quem revisa? A biblioteca continua única para a clínica?
5. Receitas de controlados (cerca de 58 por mês): continuam no receituário de papel até o Cortex ter esse fluxo?
6. Quantas secretárias vão usar o sistema? O PersonalMed tem 5 contas de secretária. Elas já assinaram termo de sigilo?
7. A clínica quer que o paciente complete o cadastro antes da consulta, por um link? Isso é opcional e depende de avaliação de LGPD.

---

## 11. Como reproduzir

```sh
node scripts/personalmed/data-quality.mjs "<pasta da exportação>" --json <saída fora do repositório>
```

O script usa os leitores de `scripts/personalmed/` e a lista de medicamentos regulados do Cortex (`supabase/functions/_shared/regulatedMedications.ts`). Ele imprime só contagens. A saída JSON deve ficar fora do repositório.

## Fontes

Acessadas em 03/11/2026.

- [Lei 5.991/1973](https://www.planalto.gov.br/ccivil_03/leis/l5991.htm)
- [Decreto 20.931/1932](https://www.planalto.gov.br/ccivil_03/decreto/1930-1949/d20931.htm)
- [Código de Ética Médica](https://portal.cfm.org.br/images/PDF/cem2019.pdf)
- Resoluções do CFM:
  - [2.381/2024](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2024/2381_2024.pdf)
  - [2.299/2021](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2021/2299_2021.pdf)
  - [1.638/2002](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2002/1638_2002.pdf)
  - [1.821/2007](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2007/1821_2007.pdf)
  - [2.314/2022](https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2022/2314_2022.pdf)
- [Lei 14.063/2020](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm)
- [Lei 13.787/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm)
- [LGPD (Lei 13.709/2018)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- [Portaria SVS/MS 344/1998](https://bvsms.saude.gov.br/bvs/saudelegis/svs/1998/prt0344_12_05_1998_rep.html)
- [RDC Anvisa 471/2021](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00000471&seqAto=000&valorAno=2021&orgao=RDC/DC/ANVISA/MS&codTipo=&desItem=&desItemFim=&cod_menu=1696&cod_modulo=134&pesquisa=true)
- [RDC Anvisa 1.000/2025](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00001000&seqAto=000&valorAno=2025&orgao=RDC%2FDC%2FANVISA%2FMS&codTipo=&desItem=&desItemFim=&cod_menu=1696&cod_modulo=134&pesquisa=true)
- [Perguntas e respostas da Anvisa sobre a RDC 1.000/2025](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/perguntas-e-respostas/perguntas-e-respostas-rdc-1000-2025-1-ed/@@display-file/file)
- [CFM: notificações eletrônicas desde 30/09/2026](https://portal.cfm.org.br/noticias/notificacoes-de-receitas-amarela-azul-e-outras-poderao-ser-emitidas-eletronicamente-a-partir-desta-quarta-feira-30/)
- [Portaria GM/MS 12.091/2026 (Farmácia Popular)](https://www.in.gov.br/web/dou/-/portaria-gm/ms-n-12.091-de-11-de-agosto-de-2026-724732070)
- Pareceres:
  - [CFM 21/2017](https://sistemas.cfm.org.br/normas/arquivos/pareceres/BR/2017/21_2017.pdf)
  - [CRM-MG 158/2018](https://sistemas.cfm.org.br/normas/arquivos/pareceres/MG/2018/158_2018.pdf)
