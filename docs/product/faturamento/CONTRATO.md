# Faturamento de convênios (TISS) e financeiro básico (P2): contrato v1

**Pedido do usuário (07/11/2026):** faturamento de convênios e financeiro básico para a Haddad Nicola.
- **Dono:** Claude. **Revisão:** Codex.
- **Migration:** `20261107120000_billing.sql`.
- **Função:** `billing-api`.
- **Módulos puros:** `_shared/tiss.ts` (XML, hash, ZIP) e `_shared/billingHandlers.ts`.
- **Tela:** `/financeiro`, com as abas A faturar, Cobranças, Lotes, Caixa, Relatórios e Cadastros, conforme o papel.
- **Pesquisa e fontes:** [pesquisa/TISS_PESQUISA.md](pesquisa/TISS_PESQUISA.md), de 07/11/2026.

## O que cobre

| Parte | O que faz |
|---|---|
| **Cadastros** (admin) | Dados da clínica para o TISS: razão social, CNPJ e CNES (9999999 sem CNES). Por convênio: registro ANS, código do prestador, versão TISS, codificação do hash, exigência de ZIP e prazos. Tabela de preços por convênio, e a particular, por código TUSS. Por médico: nome, conselho, número, UF (código IBGE), CBO e percentual de repasse |
| **A faturar** (admin e recepção) | Consultas da agenda da clínica já atendidas (`realizado`, ou com chegada registrada e não canceladas) e ainda sem cobrança. A cobrança é preenchida com a carteirinha já salva do paciente ou com o convênio informado na pré-consulta |
| **Cobranças** | Uma cobrança por item: consulta, procedimento ou exame, particular ou por convênio. O particular recebe em uma ou mais parcelas (Pix, dinheiro, débito, crédito, boleto, transferência). Só a administração estorna |
| **Lotes** (admin) | Até 100 guias do mesmo convênio e do mesmo tipo (consulta ou SP/SADT). Numeração sequencial das guias da clínica e dos lotes por convênio. O XML TISS 4.03.00 sai com o hash, ou em ZIP se o convênio exigir. O lote é marcado como enviado, com o protocolo do portal. O retorno do convênio (demonstrativo) é lançado por guia: valor pago e glosa com o código da tabela 38 da TUSS |
| **Caixa** (admin e recepção) | Recebimentos do período por forma de pagamento. A administração também lança e paga despesas e vê o saldo |
| **Relatórios** (admin; o médico vê só a própria produção) | Produção por médico e por convênio (cobrado, recebido, glosado, em aberto), repasse sobre o recebido e glosas por código |

## Quem vê o quê

As regras são conferidas no servidor e, nas operações atômicas, de novo em SQL.

| Papel | Pode |
|---|---|
| Admin ativo da clínica | Tudo |
| Recepção ativa | Cobranças e recebimentos particulares dos médicos no seu escopo (`reception_actor_allowed`). Não vê lotes, cadastros, despesas nem relatórios |
| Médico | Ler as próprias cobranças e o relatório da própria produção |

O financeiro mostra o nome do paciente e o procedimento, que é dado de saúde indireto. Por isso fica nesse recorte. O XML TISS não leva o nome do paciente: desde a versão 4.00.00, o nome falha no XSD.

## TISS

**Formato:**
- Versão `4.03.00`, obrigatória desde 01/07/2026, com o campo `Padrao` sem zero à esquerda.
- **Guia de consulta:** consulta eletiva, tipo de consulta 1 a 4, regime ambulatorial (`01`), indicação de acidente `9`.
- **Guia SP/SADT:** solicitante e executante iguais à clínica, caráter eletivo, tipo de atendimento `23` (exame), um procedimento por guia, autorização opcional (número, senha, data e validade).

**Hash:**
- MD5 da concatenação do texto de todos os elementos folha do cabeçalho e do corpo, sem o epílogo, em ISO-8859-1.
- O XML sai sem indentação.
- Alguns portais calculam o hash em UTF-8. A codificação é configurável por convênio e só muda o resultado quando há acentos.

**Prova:**
- `tiss.test.ts` reconstrói byte a byte o exemplo validado no XSD oficial, com o hash.
- Os lotes gerados (consulta com duas guias, recém-nato e número da operadora; SP/SADT com autorização, quantidade 2 e acentos) passaram no XSD 4.03.00 oficial, pelo validador .NET.
- O exemplo inválido é recusado.

**Arquivo:**
- O nome é `<número do lote com 20 dígitos>_<hash>.xml`. O ZIP guarda o arquivo sem compressão.
- O XML de um lote enviado fica guardado e é baixado de novo sem mudanças.

## API `billing-api`

`POST {action, ...}`, autenticado com JWT e `clinic_access`.

| Ação | Papel | Faz |
|---|---|---|
| `state` | todos | Papel, dados da clínica, convênios, médicos e profissionais. A recepção recebe só os médicos do seu escopo e nenhum dado de repasse; o médico, só os próprios |
| `saveSettings`, `savePayer`, `savePrice`, `deletePrice`, `saveProfessional` | admin | Cadastros. CAS por `revision` (409 se mudou) |
| `prices` | todos | Tabela de preços |
| `toBill` `{from,to}` | admin, recepção | Consultas atendidas sem cobrança, com carteirinhas salvas e o convênio da pré-consulta |
| `charges` `{from,to,status?,payerId?}` | todos (escopo) | Cobranças por data de atendimento. O período vai até 3 meses |
| `createCharge` | admin, recepção | Cria a cobrança. A partir de um agendamento, o médico e o contato vêm do agendamento. Salva a carteirinha |
| `cancelCharge` `{id,revision}` | admin, recepção | Só em aberto e sem pagamento |
| `pay` `{chargeId,revision,amount,method,receivedOn,notes}` | admin, recepção | Recebimento particular (`billing_charge_pay`) |
| `cancelPayment` `{paymentId}` | admin | Estorno de um pagamento particular |
| `batches`, `openForBatch` `{payerId,guideType}`, `batchCharges` `{batchId}` | admin | Leituras dos lotes |
| `createBatch` `{payerId,guideType,chargeIds}` | admin | `billing_batch_create` |
| `cancelBatch` `{batchId,revision}` | admin | Só um lote em rascunho. As guias voltam a ficar em aberto e mantêm o número. O número do lote não é usado de novo (contador por convênio) |
| `batchXml` `{batchId}` | admin | Devolve `{fileName, contentType, base64, hash, revision}`. Na primeira vez, gera o XML e grava o hash e o conteúdo; depois, inclusive em rascunho, devolve sempre o mesmo arquivo |
| `markSent` `{batchId,revision,sentAt,protocol}` | admin | Só depois do XML gerado |
| `updateBatch` `{batchId,revision,nfseNumber?,notes?}` | admin | Número da NFS-e e observações. Só muda o que vier; NFS-e vazia apaga |
| `reopenBatch` `{batchId,revision}` | admin | Reabre um lote com retorno lançado, para corrigir um valor digitado errado: as guias voltam a "Enviada" sem valores, e o recebimento do lote fica estornado (registrado) |
| `settle` `{batchId,revision,paymentDate,items:[{chargeId,paid,denialCode?,denialNote?}]}` | admin | Retorno do convênio: uma linha por guia; código obrigatório quando há glosa |
| `cash` `{from,to}` | admin, recepção | Recebimentos do período, com `patientName` e `description` da cobrança particular, e despesas (só a administração). A recepção vê só os recebimentos particulares do seu escopo; o lote do convênio fica com a administração |
| `saveExpense`, `deleteExpense` | admin | Despesas |
| `report` `{from,to}` | admin, médico | Produção, repasse e glosas |

## Revisão de 07/11 (revisor independente; o Codex estava parado)

- **Leituras paginadas:** as listas de cobranças, recebimentos, despesas e consultas a faturar passam do limite de 1.000 linhas da API. Acima de 20.000 linhas no período, a resposta pede um intervalo menor (413), em vez de mostrar uma lista incompleta.
- **Médico que saiu:** a administração vê as cobranças, a produção e os saldos de médicos que saíram da clínica.
- **Cobrança avulsa:** só para médico ativo da clínica. O contato vem só do agendamento, nunca do pedido.
- **Caixa:** despesas pagas contam pela data do pagamento, e as a pagar, pelo vencimento.
- **SP/SADT:** uma descrição sem texto comum é recusada antes de gerar o XML, porque o XSD exige a descrição.

## Fora da v1

- **Webservice TISS e autorização online:** o caminho comum das operadoras de Curitiba é subir o XML no portal.
- **Importação do demonstrativo em XML e recurso de glosa em XML:** previstos para a fase 2.
- **Emissão de NFS-e:** Curitiba já usa o Emissor Nacional. O Cortex só guarda o número da nota do lote.
- **Guias de honorários e de internação:** a clínica atende em consultório.
- **Tabela TUSS completa:** a clínica cadastra os códigos que usa, com o preço de cada convênio. O catálogo TUSS de exames de `20261105110000` pode servir de busca depois.

## Antes de usar com a clínica

- [ ] A faturista confirma os convênios atendidos. O site mostra Unimed, Amil, Copel, Itaú, Sanepar, SINAM, SulAmérica e Judicimed, mas a página é de 2019.
- [ ] A faturista informa o registro ANS, o código do prestador e as exigências do portal de cada convênio: hash, ZIP e prazos.
- [ ] Cada médico confere o próprio nome, CRM e CBO.
- [ ] Testar o primeiro lote de cada convênio no validador do portal antes de enviar de verdade.
- [ ] **Produção:** aplicar a migration e publicar `billing-api`. Nada foi aplicado.
