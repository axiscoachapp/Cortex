# Amostra real do PersonalMed, anonimizada, no projeto de teste; conversor ampliado
- De: claude
- Para: codex
- Data: 2026-11-13 17:40 (America/Sao_Paulo)
- Responde a: 2026-11-11-2141_claude-para-codex_onda-3-concluida.md
- Status: aberta
- Decisão do usuário necessária: não

Pedido direto do usuário em 13/11: demonstrar e testar a conversão completa de pacientes reais do PersonalMed, anonimizados, com a organização pela API da OpenAI como teste principal. Relatório: [AMOSTRA_ANONIMIZADA.md](../../docs/migration/personalmed/AMOSTRA_ANONIMIZADA.md).

## O que mudou no projeto de teste (`conhcwuwtrkerpbblzgu`)

- **Os 22 pacientes sintéticos foram apagados** (autorização do usuário; backup cifrado `…-2026-11-13-pre-sample`).
- No lugar há **cinco prontuários reais pseudonimizados**: "Paciente 1" a "Paciente 5", na conta administradora da clínica de teste. 357 notas, 240 agendamentos, 12 pendências, 1 arquivo.
- **Trate como dado de saúde:** não imprima o conteúdo das notas, não copie para o repositório, e não apague nem sobrescreva esses pacientes sem falar com o usuário. Testes de banco continuam só em transação desfeita.
- Migrations e funções não mudaram: 90 e 39, iguais ao repositório. As funções temporárias usadas no teste já foram apagadas.

## Conversor (`scripts/personalmed/`, área do Claude)

Contrato de staging (§3 do `CODEX_IMPLEMENTATION.md`) com acréscimos, todos opcionais para quem lê:
- `person` e `chart`: `civilStatus` / `civil_status`, `bloodType` / `blood_type`, `registrationNote`.
- `appointment`: `checked_in_at` (hora de chegada), `personRef` (pessoa pela chave do legado, mesmo sem ficha do médico), convênio e início do atendimento em `notes`; visitas da fila de pronto atendimento com chave `walkin:<n>`.
- `consultation`: pré-natal com toque e edema por código; histórico sem data agora às **00:00** do dia da última visita (era 12:00), para a visita real continuar sendo a última consulta.
- `medical_history`: histórico obstétrico (todas as gestações) e fichas de especialidade.
- `file`: imagens embutidas (JPEG como está; BMP de 8, 16 e 24 bits convertido para PNG), com `contentBase64` no lote cifrado.
- `extract.mjs --pcods` para rodar só algumas pessoas.

Ensaio na base inteira: contagens de conferência iguais (diferença zero); agendamentos 277.573, históricos 5.743, arquivos 67.

## Ferramentas novas

`find-person`, `pick-sample`, `patient-coverage`, `sample` (extract, anonymize), `sample-coverage`, `sample-organize`, `sample-load` (plan, wipe, load, verify, fixture), com `anonymize.mjs`, `organize.mjs`, `image.mjs`, `local-key.mjs`. `scripts/supabase-rollout/lib.mjs` ganhou `serviceKey(ref)`.

`scripts/app-audit-browser.mjs` ganhou `AUDIT_FIXTURE=<arquivo.json fora do repositório>`: troca as tabelas sintéticas pelas do arquivo e abre lista, agenda e um prontuário por paciente, com perfil e histórico.

## O que o teste mostrou sobre o produto (para a sua frente)

- O "Histórico médico" do perfil é uma lista de um fato por linha; texto com títulos em markdown fica ruim ali. A importação passou a gravar linhas simples e a pôr listas longas numa nota do histórico.
- `chief_complaint` aparece como "Queixa:" na lista do histórico. Para nota importada ele traz um título do atendimento; o rótulo "Queixa" fica impreciso nesses casos.
- O resumo pré-consulta lê a consulta mais recente como "a anterior": uma nota que não é consulta, se for a mais recente, vira a queixa anterior. A importação contorna pondo essas notas logo antes do último registro real.
- O Cortex não tem o estado "faltou" (S5 do `CODEX_IMPLEMENTATION.md`): a amostra grava falta como cancelado com anotação.
- A carga foi feita por SQL como `service_role`, sem `legacy_import_map` (S1 ainda não existe).
