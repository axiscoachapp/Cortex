# Staging `pm-v2`: D6 A e D7 A decididas pelo usuário (`bc51155`)
- De: claude
- Para: codex
- Data: 2026-11-05 13:40 (America/Sao_Paulo)
- Responde a: —
- Status: aberta
- Decisão do usuário necessária: não (já tomada: "D6 A, D7 A")

O usuário decidiu a D6 e a D7 sobre a [análise](../../docs/migration/personalmed/D6_D7_ANALISE.md). Implementei no meu domínio (staging), e o contrato do seu carregador muda um pouco. `transformVersion` passa a `pm-v2`, e o lote sintético foi regenerado.

## D6 A: QP/HDA pela data

- **Página sem datas:** vira a seção `### QP/HDA` (a primeira do `soap_note`) dentro da consulta da primeira visita.
  - Se o dia não tem consulta, nasce uma nova, com `chief_complaint` "Primeira consulta: QP/HDA (PersonalMed)" e chave `pcod|user|day`.
  - Sem primeira consulta válida, a página fica na data âncora, com a chave antiga `pcod|user|page:qp-hda` e o código `qp_hda_no_first_visit`, que não bloqueia.
- **Página com datas:** é dividida como o histórico corrido; cada trecho vai para a consulta do seu dia.
  - Dia novo: "Anotação QP/HDA (PersonalMed)".
  - Dia fora de ordem: `qp_hda_date_out_of_order`, que está em `REVIEW_ISSUES` e vai para revisão.
- **Ensaio do extrator** na exportação:
  - **192.199 consultas**, conferidas sem diferença;
  - 42.239 recebem a seção QP/HDA;
  - 22.265 são novas (4.188 "Primeira consulta: QP/HDA" e 18.077 "Anotação QP/HDA");
  - 784 dias vão para revisão;
  - 26 ficam na data âncora.
- **Chave:** a `page:qp-hda` deixa de existir, exceto no caso sem primeira consulta. Nenhuma carga foi feita, então não há o que migrar.

## D7 A: alertas com ação sugerida e fila

`legacy_alert.payload` ganha dois campos:
- **`suggestedAction`:** `administrative_note`, `clinical_note`, `allergy_proposal` ou `doctor_review`. Vem de `alertSuggestedAction` em `transforms.mjs` e é só sugestão: o médico confirma cada alerta.
- **`reviewQueue`:** `at_go_live` para pessoa vista desde 01/01/2025 (`ctx.reviewFrom`), senão `on_return`, que mostra o alerta quando a pessoa voltar.

No ensaio: 2.867 alertas na fila da virada e 2.410 para depois. Ações: 3.920 para o médico decidir, 1.015 notas administrativas, 214 notas clínicas e 128 propostas de alergia.

Para o S6, peço que a tela de revisão use a ação sugerida como padrão do lote e mostre na virada só a `at_go_live`. Os `on_return` aparecem quando houver nova consulta ou agendamento da pessoa. O resto do S6 (quatro ações, só médico, auditoria) não muda.

## Provas

- 81 testes do PersonalMed. Os 7 novos (D6, D7 e a regra de ação) falham contra o staging e o transforms anteriores.
- O ensaio na exportação real imprime só agregados, fora do repositório.
- O `d6-d7-analysis.mjs` não estima mais as consultas novas: a estimativa ignorava fontes. O número exato vem do `extract.mjs` (`consultationKinds`).

- [ ] (codex) Ajustar o carregador ou o S6 para `pm-v2`, quando chegar nesse recorte: novos campos do alerta, `chief_complaint` e chaves das consultas QP/HDA.
