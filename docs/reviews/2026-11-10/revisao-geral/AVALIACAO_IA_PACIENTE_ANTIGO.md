# Avaliação da IA (OpenAI) com uma paciente antiga, de várias consultas

11/11/2026. Pedido do usuário: testar a nova API da OpenAI no tratamento de um paciente antigo com várias consultas e avaliar o resultado.

## Resultado em uma frase

O modelo de texto (`gpt-6.1-terra`) e a transcrição (`gpt-transcribe`) são bons: não inventaram nada em nenhum teste. O que estava ruim era o que o Cortex entregava a eles e uma regra do prompt. Com quatro correções, já publicadas, a evolução da consulta passou de "vazia em 2 de 3 tentativas" para completa em 5 de 5, e o assistente passou a responder por inteiro perguntas sobre os 4 anos de histórico.

## Como foi testado

- **Paciente sintética com gabarito:** 16 consultas de ginecologia entre 2022 e 2026, escritas por mim com fatos de propósito difíceis: um fato importante que só aparece numa consulta antiga, medicações suspensas, uma alergia, exames em série e uma contraindicação (trombose em 2019). O caso está em [`scripts/ai-eval/longitudinal/case.mjs`](../../../../scripts/ai-eval/longitudinal/case.mjs). Ela está na conta de teste como "Helena Duarte (paciente sintética de teste)", para você abrir e experimentar.
- **Consulta nova em áudio:** um retorno de 2 min 27 s, com duas vozes sintéticas (médica e paciente), gerado pela própria OpenAI e convertido para o formato que o navegador grava.
- **Paciente de teste que já existia** na conta, com 5 consultas (as respostas ficaram fora do repositório).
- **Código real:** as funções testadas são cópias fiéis das de produção, publicadas temporariamente com um acesso próprio (senha aleatória de uso único, com prazo). Só o módulo de login foi trocado. Não criei conta nem entrei na sua. As cópias já foram apagadas.
- **Antes e depois:** medi a versão que estava publicada, corrigi, e medi de novo com os mesmos dados.

## Resultados

| O que | Antes | Depois |
|---|---|---|
| **Evolução gerada do áudio** | 3 tentativas: 2 voltaram **vazias**; 1 veio cheia de ressalvas ("sem autoria confirmada" 7 vezes) e 4 perguntas ao médico | 5 tentativas: 5 completas, com os 12 fatos da consulta, sem ressalvas e sem nada inventado |
| **Alerta sobre a prescrição** | Nenhum (o modelo não recebia a história da paciente) | Em 4 de 5: "antecedente de trombose; conferir risco; estrogênio oral segue contraindicado" |
| **Assistente: 12 perguntas sobre o histórico** | 41 de 48 itens do gabarito. Faltaram o plano da última consulta, os exames de 2022 e 2023 e o DIU de 2022 | 47 de 48. O item que falta é só de palavra: respondeu "cesarianas" e o gabarito dizia "cesárea" |
| **Pergunta de medicação** ("posso prescrever estradiol oral?") | Só o aviso fixo de que o Cortex não valida medicação | Mostra o que o prontuário registra (trombose, parecer da hematologia para evitar a via oral, com datas) e depois o mesmo aviso |
| **Resumo pré-consulta** | 6 de 7 itens. Faltou o retorno em 60 dias; também não trazia a dosagem de vitamina D nem a evolução real | 7 de 7, com a evolução de 2025 a 2026 e a intolerância à gabapentina |
| **Cadastro depois de salvar** | Propunha só acréscimos: a medicação suspensa ficaria como "em uso" | Propõe retirar o desogestrel, acrescentar estradiol e progesterona e registrar a alergia a dipirona. O médico confirma |
| **Coisas inventadas** | Nenhuma | Nenhuma |

**Transcrição:** dos 316 termos do roteiro, um erro com peso clínico: "junho" virou "julho". Todos os números, doses e nomes de remédio saíram certos.

**Tempo de resposta:**
- transcrição mais evolução: 19 s para 2 min 27 s de áudio;
- resumo pré-consulta: 10 s na primeira vez (depois fica guardado);
- assistente: 3 a 8 s por pergunta.

**Paciente de teste que já existia (5 consultas):** resumo e três perguntas corretos e ancorados no prontuário, com as datas certas. Quando a última consulta não tinha plano registrado, a IA disse isso em vez de preencher.

## O que estava errado e o que mudei

1. **A evolução vinha vazia ou cheia de ressalvas.**
   - Causa: a transcrição nova não separa as vozes, e o prompt proibia a IA de deduzir quem falava e mandava "deixar a evolução vazia" na dúvida.
   - Correção: a IA identifica médico e paciente pelo contexto, como um escriba faria, sem ressalvas no texto. Só registra dúvida quando a troca muda o sentido clínico. O médico continua revisando antes de salvar.
   - Alternativa descartada: o modelo que separa vozes (`gpt-4o-transcribe-diarize`). No mesmo áudio levou 54 s e errou termos ("progesterona" virou "projetar uma", "BI-RADS 1" virou "b radiozoom").
2. **A IA escrevia a evolução sem conhecer a paciente.**
   - Causa: recebia só nome, idade, diagnósticos, medicações e alergias.
   - Correção: recebe também a história médica e a avaliação e o plano da última consulta, num bloco marcado como "contexto, não é conteúdo desta consulta". Isso serve para entender referências ("a trombose de 2019") e para os alertas. Nos 5 testes, nada do histórico vazou para a evolução.
3. **O assistente recebia só o começo de cada consulta.**
   - Causa: a busca exigia todas as palavras da pergunta na mesma consulta. Quase nunca achava, e então mandava as primeiras 100 palavras de cada nota. O plano, que fica no fim, era cortado até na última consulta. Consultas além das 12 mais recentes sumiam sem aviso.
   - Correção (migration `20261111100000`): qualquer palavra da pergunta conta; as 4 consultas mais recentes vão sempre inteiras, mais as 8 que melhor combinam; as demais vão como índice (data, queixa e início da avaliação), para a IA saber que existem.
4. **O resumo pré-consulta cortava o plano em 800 caracteres** e não via a história médica nem as consultas anteriores.
   - Correção: avaliação e plano da última consulta vão inteiros (até 3.000 caracteres), mais a história médica e um resumo das 5 consultas anteriores. O prompt ganhou a regra de não inventar.

Também mudou:
- as anotações do médico entre consultas: quando não cabem, vão as mais recentes (antes iam as mais antigas);
- o nome da paciente não é mais enviado ao provedor no assistente nem no resumo.

## Limites deste teste

- **Um caso só, sintético, de uma especialidade.** Mostra que o encanamento funciona e onde quebrava; não é validação clínica. A avaliação com os médicos (plano em [`docs/ai/`](../../../ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md)) continua necessária antes do uso real.
- **Áudio limpo, de 2 minutos e meio, com vozes sintéticas.** Não testei consulta longa (30 a 60 min), ruído, sotaques, nem três pessoas na sala. O revisor da IA apontou que uma gravação acima de 25 MB não é processada por nenhum caminho do app. Isso está no plano de melhoria.
- **Identificar falantes pelo contexto pode errar** em conversas ambíguas, por exemplo um acompanhante que responde pela paciente. A revisão do médico antes de salvar continua sendo a proteção.
- **A conta de teste está com a especialidade "pré-natal".** Por isso a evolução traz um campo "Datação: não relatado" numa consulta de climatério. Com a especialidade certa isso some.
- **Custo:** não medi em reais. Pela contagem interna, toda a avaliação gastou cerca de 100 créditos do limite diário de 1.500 da conta de teste.

## O que mudou no contrato do Codex

O [contrato da integração OpenAI](../../../product/clinic-crm/OPENAI_INITIAL_MIGRATION.md) dizia "não inferir médico/paciente". Essa regra foi trocada pela atribuição pelo contexto, pelos resultados acima. Registrei a mudança no próprio contrato e na passagem para o Codex.
