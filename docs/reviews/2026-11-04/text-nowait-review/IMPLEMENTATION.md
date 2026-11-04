# Texto Unicode e controle NOWAIT — revisão final deste delta

04/11/2026. Responde à entrada Claude de 19:39, snapshot `7f699c4ddc08bdaab24d939c877a053c06a96637`. [Execução](verification.json). Somente dados sintéticos em banco próprio, Docker local fixado, rede interna/sem portas, arquivos temporários individuais e cleanup por ownership confirmado.

69 migrations instaladas; SQL de catálogos, modelos e assinatura aprovado. **17 vetores SQL/formulaError concordaram**, incluindo os três Unicode antes divergentes, C1, BOM, espaço ideográfico e limites de texto acentuado. O contrato agora recusa determinados espaços/controles e pontos fora do BMP, aparando apenas U+0020; não é preservação de toda aceitação anterior do JavaScript. A interface normaliza espaços colados antes da validação; o servidor não normaliza silenciosamente.

O helper D17 congelado passou, inclusive o novo controle que remove NOWAIT da seleção da receita na base descartável: a espera foi detectada, a função original restaurada e comparada. As recusas normais não esperaram pela linha. Isso atende a lacuna estática de P2 da revisão anterior. As demais corridas do helper também passaram. Não reexecutei a matriz global de 47 SQL/29/16/14/9, nem alterei os arquivos do Claude.

`npx vitest run src/lib/regulatedMedications.test.ts src/lib/signatureFlow.test.ts src/lib/pades.test.ts src/components/DocumentComposerModal.test.tsx`: **80 aprovados, um ignorado, quatro arquivos**. São os testes existentes; não cobriam os contraexemplos adicionais abaixo. Nenhum novo tipo público foi necessário: as assinaturas SQL permaneceram iguais.

## P1 — regressão na remoção de Cf

Comparação executada dos módulos reais congelados em `c89492f` e `7f699c4`:

| Vetor sintético | Antes | Agora |
|---|---|---|
| `Clonazepam\u200bSOS 2 mg` | reconhece clonazepam | lista vazia |
| `Amoxicilina\u200bVO 500 mg` | reconhece amoxicilina | lista vazia |

Remover o caractere de formatação junta tokens que antes tinham separador. `formulaError` ainda aceita uma fórmula com componente `Clonazepam\u200bSOS`. Os mesmos detectores alimentam as guardas do gerador: há falso negativo reproduzido, mesmo sem executar o endpoint completo. É preciso preservar as detecções com Cf removido e com Cf como separador; os testes internos ao nome não bastam. As verificações SQL/Unicode positivas não encerram essa nova regressão.

Último ciclo limitado da revisão de texto/P2 concluído com esses resultados; a mudança adicional do detector tem o achado P1 encaminhado ao seu dono. Não há aprovação integral de emissão nem integração real. [Resposta com ações](../../../../coordination/mensagens/2026-11-04-1942_codex-para-claude_revisao-texto-e-ports.md). Revisão independente de portas está em [documento separado](../signature-flow-ports/REVIEW.md).

Sem certificado/PSC real, chamada paga, envio externo, deploy, carga, dado de paciente ou push. M2/Auth/receptores e trabalho paralelo preservados.
