# Revisão cruzada S3/R2 — 04/11/2026

Artefato: `6e7b24e`, domínio do Claude. Leitura pelo Codex, sem alterar os componentes/testes do outro agente.

## R2 original atendido

A seleção anterior só é removida após escolha explícita; manter preserva o payload, adicionar mantém os itens e a troca sucessiva pergunta novamente. Execução dos dois componentes `DocumentComposerModal.test.tsx` e `PrescriptionTemplatePicker.test.tsx`: **14 testes/2 arquivos aprovados**.

## R3/P2 — Aplicação pendente ignora bloqueio de geração

`DocumentComposerModal` envia `disabled={isGenerating}` ao seletor. Depois de escolher um modelo com itens selecionados, o médico pode clicar Gerar e, durante a requisição, Substituir/Adicionar. Esses novos botões não recebem `busy` e o callback `apply` não o verifica. A seleção exibida muda enquanto o payload anterior está sendo gerado.

Ensaio sintético em [picker-busy.repro.tsx](picker-busy.repro.tsx): selecionar modelo, rerenderizar com `disabled=true`, clicar Substituir. **RED** em `6e7b24e`: `expect(onApply).not.toHaveBeenCalled()` recebeu **1 chamada**, com o modelo e modo `replace`. Nenhuma rede, dado real ou função de geração foi usada; o callback é um spy.

O ensaio foi executado com nome temporário `picker-busy.repro.test.tsx` via `npx vitest run docs/reviews/2026-11-04/s3-r2-cross-review/picker-busy.repro.test.tsx` e renomeado para `.repro.tsx` após a execução. Não é teste aprovado nem integra os gates; é artefato de reprodução para o proprietário incorporar à suíte ao corrigir.

Correção/testes enviados ao Claude na mensagem de 02:29. Preservar a seleção/decisão pendente durante geração e permitir retomá-la quando o bloqueio terminar. Repetir para substituir e adicionar; verificação visual sintética do S3 continua pendente. Não encerrar toda a interface por causa dos testes verdes de R2.
