# Amostra de cinco pacientes: conversão completa, anonimização e organização pela OpenAI

13/11/2026. Autor: Claude. Pedido do usuário no mesmo dia: trazer dois pacientes reais indicados por ele, mais três, **anonimizados como "Paciente 1" a "Paciente 5"**, para demonstrar e testar a conversão completa do histórico do PersonalMed para o Cortex. O teste principal é o tratamento pela API da OpenAI: como ela organiza os dados dentro do app. Autorizou apagar os pacientes de teste que estavam no projeto.

**Privacidade deste documento.** Só contagens, nomes de tabelas e regras. Nenhum nome, nenhuma chave do sistema antigo, nenhum trecho de prontuário.

## Resultado

| O quê | Número |
|---|---|
| Pessoas | 5 (as 2 indicadas e 3 escolhidas para cobrir partes diferentes do sistema antigo) |
| Prontuários no PersonalMed | 8 (uma pessoa tem prontuário com 3 médicos; outra com 2) |
| Linhas lidas no sistema antigo | 720, em 20 tabelas |
| Linhas de texto clínico | 2.806; **nenhuma ficou fora** do registro convertido |
| Dias de atendimento convertidos | 345, mais 2 páginas de histórico sem data |
| Agendamentos | 240 (228 da agenda e 12 da fila de pronto atendimento de 2006–2011) |
| Carregado no Cortex | 5 pacientes, 357 notas, 240 agendamentos, 12 pendências, 1 arquivo |
| Identificadores conhecidos que sobraram depois da anonimização | 0 |
| Dias organizados pela IA | 345 de 345; em nenhum apareceu número que não estava no original |
| Itens de perfil escritos pela IA | 413, todos com trecho de origem conferido contra o texto |

As 357 notas são os 347 registros convertidos, mais duas notas por paciente que não são consultas: "Resumo do histórico importado" e "Páginas e fichas do prontuário antigo".

## 1. O que sai do PersonalMed

A amostra passa pelo **mesmo conversor da migração completa** (`extract.mjs` com `--pcods`). Para a conversão ficar completa, o conversor ganhou o que ainda ficava de fora:

| Origem | Linhas na amostra | Destino |
|---|---|---|
| `Clini_01` cadastro | 5 | Paciente. Novos: estado civil, tipo sanguíneo e a observação do cadastro |
| `Clini_02` prontuário por médico | 8 | Um prontuário por médico; na demonstração, uma pessoa só no Cortex (ver §4) |
| `Co28` evoluções e sinais vitais | 64 | Seções "Evolução" e "Sinais vitais" do dia |
| `Clini_06` receitas, textos e pedidos | 153 | Seção "Documentos emitidos" do dia |
| `Co12_1` histórico corrido | 7 | Dividido pelas datas digitadas; o que não tem data vira uma nota |
| `Me` páginas (QP/HDA, antecedentes) | 16 | QP/HDA no dia; demais páginas no histórico. Novo: o segundo campo de texto da página |
| `Co12_2` CID | 154 | Seção "CID registrado" do dia; fora do capítulo Z, lista de CIDs |
| `Co49_2` consultas de pré-natal | 44 | Seção "Pré-natal". Novos: toque e a leitura do código de edema |
| `Co49_1` gestações | 7 | Novo: todas as gestações como "Histórico obstétrico" (antes só a gestação em curso) |
| `Co50` contracepção, `Co51` climatério | 7 | Novo: fichas com os campos preenchidos |
| `Co53`, `Co53_2` mama; `CO55`, `CO55_2` uroginecologia | 4 | Novo: fichas com os campos preenchidos |
| `CO52` exame com imagem | 1 | Novo: ficha e arquivo (BMP convertido para PNG) |
| `Age04` agenda | 228 | Agendamento. Novos: hora de chegada, início do atendimento e convênio do dia |
| `Age09` pronto atendimento | 12 | Novo: agendamento do tipo encaixe |
| `Clini_05` carteirinhas | 10 | Convênio do paciente (5 carteirinhas; as outras 5 linhas são "Particular") |
| `Financas` | 1 | Não migra, por decisão anterior (não é um livro financeiro confiável) |

Também entram, quando existem: `Co51_1`, `Co53_1`, `Co53_3`, `CO54*` (parto e puerpério), `CO55_1`, `CO43` (cirurgias), `Co31*` (laudos), `Clini_08` (laboratório), `Clini_04` (imagens). Não havia linhas dessas tabelas na amostra; estão cobertas por testes com dados inventados.

**Prova de cobertura** (`sample-coverage.mjs`): cada linha de texto das tabelas acima é procurada no registro convertido da mesma pessoa. Resultado: 2.806 linhas, 0 ausentes.

**Inferências a confirmar com a clínica:**
- Código de edema do pré-natal: 1 em 99% das consultas (lido como "ausente"), 2 e 3 no resto (lidos como "+" e "++").
- Estado civil: C, S, D, V e O têm leitura óbvia; o código P (178 cadastros na base) ficou sem rótulo.

## 2. Anonimização

É feita **neste computador, antes de qualquer envio** (OpenAI ou Supabase). O lote identificado e o anonimizado ficam cifrados fora do repositório (`%LOCALAPPDATA%\CortexBackups\pm-sample`), com a chave embrulhada pelo Windows (DPAPI).

| Campo | O que acontece |
|---|---|
| Nome | "Paciente N" |
| CPF, RG, telefones, e-mail, endereço, CEP, nome da mãe, naturalidade, número da carteirinha, titular da carteirinha | Removidos |
| Data de nascimento | Fica só o mês (a idade continua certa) |
| Profissão | Removida (o texto livre podia apontar uma pessoa) |
| Chave do paciente no sistema antigo e identificadores gerados a partir dela | Trocados por identificadores novos, com um sal que só existe no lote cifrado |
| Imagem de exame | Não é enviada: pode ter o nome gravado na própria imagem. Fica um marcador com os dados do arquivo |
| Médicos da clínica | "Médica A", "Médico C"… (os nomes não vão para o texto) |

No **texto livre** (evoluções, receitas, cartas, histórico) são substituídos: o nome completo e partes dele; nome de mãe, pai, indicação e titular; documentos e telefones do cadastro em qualquer pontuação; data de nascimento; e-mails, CPFs, CEPs, telefones e endereços de qualquer pessoa; nomes de terceiros (depois de parentesco ou de "Dr./Dra.", dois ou mais nomes seguidos, e nome próprio sozinho, como o de um bebê anotado com o peso). Palavras de medicamento (8.504, do catálogo público) e termos clínicos que também são nomes ("flora", "cândida", "natal", "Douglas") são protegidos.

**Conferência automática:** depois de anonimizar, o programa procura em todos os campos os identificadores conhecidos de cada pessoa e imprime só contagens. Resultado: 0 em todos. A conferência pegou um vazamento real durante o trabalho (o número da carteirinha dentro de uma chave interna), corrigido antes de qualquer envio.

**O que isso não garante.** Texto clínico livre pode descrever uma pessoa de formas que nenhuma regra pega (um fato raro, o local de trabalho, a história de um parente), e um nome incomum de terceiro, escrito sozinho, pode passar. O resultado é dado de saúde **pseudonimizado**, não anônimo no sentido da LGPD, e deve ser tratado como tal. Em sentido contrário, a regra às vezes apaga uma palavra que não era nome (vi "[nome]" no lugar do que parece uma marca de cosmético).

## 3. Organização pela OpenAI

O texto convertido **continua inteiro no prontuário**. A IA escreve uma camada por cima, que só fica quando pode ser rastreada até esse texto. As chamadas usam o mesmo adaptador do produto (`gpt-6.1-terra`, sem armazenamento no provedor).

**Por dia de atendimento:** título do atendimento e nota em S, O, A e P.
- Regra: só o que está escrito naquele dia; números, doses e datas copiados como estão; abreviação incomum fica entre aspas.
- Conferência: todo número da nota tem de existir no original. Se aparecer um número novo, a nota organizada é descartada e fica só o original.
- Dia telegráfico (menos de 280 caracteres) recebe só o título; o texto fica como está.
- A nota organizada é seguida do "Registro original (PersonalMed)" completo.

**Por paciente:** perfil montado com o histórico inteiro: resumo, problemas (em acompanhamento ou anteriores), medicações em uso e anteriores, alergias e intolerâncias, antecedentes obstétricos, cirurgias, antecedentes familiares, hábitos, exames e rastreamentos, e o que os últimos registros deixam em aberto.
- Cada item cita de um a três trechos literais do histórico, com a data do registro.
- Conferência: o trecho é procurado no texto daquele dia. Achado em outro dia, a data é corrigida. Não achado, o item é descartado. Nas rodadas de ajuste, 1 a 2 itens em cerca de 400 foram descartados; na final, nenhum.
- Alergia sem substância identificada não entra; efeito colateral comum só entra quando o registro diz "não tolera", "intolerância" ou que o remédio foi suspenso por isso.

**Onde aparece no app:**

| Lugar no Cortex | O que recebe |
|---|---|
| Diagnósticos, medicações e alergias do perfil | Problemas em acompanhamento, medicações em uso (com a data do último registro) e alergias |
| "Histórico médico" e "Anamnese social" (um fato por linha) | Tipo sanguíneo, antecedentes obstétricos, cirurgias, antecedentes familiares, problemas anteriores, estado civil, hábitos |
| Nota "Resumo do histórico importado" | Resumo e todas as listas, com a origem de cada item |
| Nota "Páginas e fichas do prontuário antigo" | Texto original das páginas sem data, das fichas e dos CIDs |
| "Pendências e retornos" | O que ficou em aberto (9 itens) e os 3 alertas "Atenção" do cadastro, para o médico decidir |
| Lista do histórico | Cada dia com o título escrito pela IA |

As duas notas ficam logo antes do último registro real, para que a última consulta de verdade continue sendo a "última consulta" do app.

**As funções de IA do próprio produto sobre o histórico importado** (cópias temporárias das funções reais, já apagadas):
- Resumo pré-consulta: 5 a 8 segundos; trouxe a conduta da última consulta e os achados relevantes do histórico.
- Assistente: 9 segundos por pergunta, com as consultas de origem. Perguntado sobre alergias e uso atual, apontou sozinho que a medicação em uso é a mesma substância de uma intolerância registrada anos antes.

**Custo e tempo.** Uma passada completa nos cinco: cerca de 123 mil tokens de entrada e 80 mil de saída, 16 minutos em sequência (cerca de 40 mil tokens e 3 minutos por paciente; são pacientes com 35 a 124 dias de atendimento, muito acima da média da base). Todas as rodadas de ajuste somaram cerca de 625 mil tokens.

## 4. Carga no Cortex

- Projeto de teste `conhcwuwtrkerpbblzgu`, na conta administradora da clínica de teste.
- Antes: backup cifrado `…-2026-11-13-pre-sample` e ensaio da exclusão em transação desfeita. Apagados os 22 pacientes de teste (51 consultas, 1 agendamento, 2 gravações).
- Depois: leitura pela própria conta, com as regras de acesso do banco: 5 pacientes, 357 notas, 240 agendamentos, 12 pendências, 1 arquivo, iguais ao que foi enviado.
- Conferência visual: o app local abriu os cinco pacientes (lista, prontuário, perfil, histórico, notas abertas) em 1366×768 e 375×812, sem erro de página nem rolagem lateral.

**Diferenças desta demonstração para a migração real:**
- Aqui uma conta só recebe os prontuários de todos os médicos, e cada nota diz de quem é ("registro de Médica A"). Na migração real cada médico recebe os seus.
- O Cortex ainda não tem o estado "faltou": falta vira agendamento cancelado com a anotação "Falta registrada no PersonalMed".

## 5. Limites e riscos

1. **O site publicado ainda é o antigo** (o `git push` está pendente). As telas que mostram bem estas notas (seções fora de S/O/A/P preservadas, perfil em linhas, pendências) estão na versão nova. Sem o push, a demonstração no site fica diferente do que conferi no app local.
2. **Dado de saúde pseudonimizado num projeto nos EUA.** A decisão D11 dizia que o projeto de teste em us-west-2 não receberia dados reais. Com a anonimização pedida, tratei como permitido para esta demonstração; a decisão de manter, apagar ou mover é do usuário.
3. **A IA pode errar no sentido** mesmo sem inventar número ou trecho: classificar como "em acompanhamento" algo já encerrado, ou resumir de forma pobre uma anotação telegráfica. Por isso o original fica sempre junto e o perfil diz que foi organizado por IA.
4. **Não entrei na conta do usuário.** A conferência foi por leitura no banco com as regras da conta e pelo app local com as mesmas linhas.
5. Imagem de exame: a conversão foi feita e testada, mas a imagem real não foi enviada (ver §2).

## 6. Decisões tomadas e a confirmar

| Decisão | Situação |
|---|---|
| Anonimizar antes de enviar à OpenAI, inclusive médicos e profissão | Tomada |
| Três pacientes extras escolhidos por variedade (fichas raras e imagem; pré-natal completo; três médicos, um deles o urologista) | Tomada |
| Camada da IA nunca substitui o texto convertido | Tomada |
| Página de histórico sem data fica às 00:00 do dia da última visita (antes 12:00), para não passar por "última consulta" | Tomada; vale para a migração completa |
| Manter os cinco pacientes no projeto de teste depois da demonstração | **Do usuário** |
| Usar a organização pela IA na migração real: todos os pacientes, só os ativos, ou sob demanda quando o médico abre o prontuário | **Do usuário** (custo acima) |
| Leitura dos códigos de edema e do estado civil "P" | **Da clínica** |

## 7. Como repetir

```sh
node scripts/personalmed/find-person.mjs   <exportação> <arquivo com nomes, fora do repositório>
node scripts/personalmed/pick-sample.mjs   <exportação> --exclude <chaves>
node scripts/personalmed/sample.mjs extract   <exportação> --pcods <chaves>
node scripts/personalmed/sample-coverage.mjs  <exportação>
node scripts/personalmed/sample.mjs anonymize <exportação>
node scripts/personalmed/sample-organize.mjs
node scripts/personalmed/sample-load.mjs plan|wipe|load|verify --project <ref>
node scripts/personalmed/sample-load.mjs fixture --project local   # para o app local (AUDIT_FIXTURE)
```

`sample-organize.mjs` precisa de uma função temporária protegida por segredo, que chama o adaptador do produto com a chave do projeto; ela é publicada para o teste e apagada depois, e não fica no repositório. As respostas ficam em cache cifrado: repetir só paga o que mudou.
