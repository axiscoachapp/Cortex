# Avaliação de IA com os médicos (Parte B)

Ferramentas fora do app para a Parte B de [`docs/ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md`](../../docs/ai/PLANO_IA_EFICIENCIA_E_AVALIACAO.md). Os médicos escolhem a transcrição e o modelo de texto comparando os candidatos às cegas.

**Regras**
- Só casos sintéticos, escritos ou aprovados pelos médicos. Nenhum dado de paciente entra aqui nem passa por um provedor.
- Nenhuma chamada a provedor sem conta de teste criada pelo usuário e sem a decisão D15 (participantes, datas e critérios).
- Os critérios de aprovação são fixados **antes** de ver os resultados (B4).

## Formato de um caso

`cases/<id>/gold.json`. O exemplo é `cases/sintetico-01-itu/`, inventado só para mostrar o formato.

| Campo | Conteúdo |
|---|---|
| `transcript` | `[{speaker, text}]`, com `speaker` igual a `medico`, `paciente` ou `acompanhante` |
| `terms` | `[{name, dose?}]`: medicamentos e exames do roteiro, com a dose quando houver |
| `negations` | `[{cue, subject}]`, por exemplo `{ "cue": "nega", "subject": "alergia" }` |
| `referenceNote` | A evolução SOAP de referência, escrita pelo médico |
| `approvedBy` | Quem aprovou o roteiro; `null` até a aprovação |

O áudio gravado da consulta encenada fica fora do repositório.

## Métricas automáticas (`metrics.mjs`)

- `wordErrorRate`: erro de palavras, ignorando acentos, maiúsculas e pontuação. "100mg" é igual a "100 mg", e "1,5" é igual a "1.5".
- `medicalTermErrors`: medicamento ou exame ausente, e **dose errada**. A dose errada conta como erro crítico.
- `negationErrors`: negação que se perdeu ("nega febre" virou "febre"). Também conta como erro crítico.
- `speakerAccuracy`: acerto de quem falou, depois de associar os rótulos do provedor ("spk_0") aos papéis do gabarito.
- `scoreTranscript`: tudo acima para uma transcrição, mais o total de erros críticos.

## Revisão às cegas (`blind.mjs`)

- `buildBlindPackage(saídas, {seed})`:
  - embaralha as saídas de cada caso e rotula como A, B, C…, com uma ordem diferente em cada caso;
  - exige que todo candidato responda todo caso;
  - a mesma semente reconstrói o mesmo pacote, para auditoria.
- `writeBlindPackage(pasta, pacote)` grava `review/index.html`, a página entregue aos médicos, e `key/key.json`, a chave, que **fica com quem conduz e não vai para os médicos**.
  - A página é um arquivo único, sem internet, em modo claro e escuro, e funciona no celular.
  - Ela tem a rubrica de 1 a 5, os minutos de edição, a marcação de erro crítico e um comentário. O botão "Exportar notas" baixa um JSON.
- `unblind(notasExportadas, chave)` devolve, por candidato: média por critério, erros críticos e mediana de minutos de edição.

Testes: `npx vitest run scripts/ai-eval`.

## A fazer

1. Executor por candidato, quando houver contas de teste.
2. Métricas da evolução e da síntese: recall de fatos-chave, fatos sem fonte e contradições.
3. Relatório final.
