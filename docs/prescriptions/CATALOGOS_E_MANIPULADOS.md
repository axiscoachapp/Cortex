# Catálogos e fórmulas manipuladas (no lugar dos catálogos da Mevo)

Pedido do usuário em 04/11/2026: seguir com a proposta de catálogos próprios, incluindo os manipulados. Este documento é o contrato de implementação, no domínio do Claude.

## O que entra

| Item | Fonte oficial | Estado |
|---|---|---|
| Fórmulas manipuladas | Não há catálogo oficial de fórmulas: são os componentes, com os nomes da DCB, mais as fórmulas que cada médico salva | **Servidor pronto** (este documento); tela em seguida |
| Exames com código TUSS | ANS, Terminologia Unificada da Saúde Suplementar | Formato da fonte em levantamento |
| CID-10 | DATASUS | Formato da fonte em levantamento |
| Apresentações dos medicamentos | Lista CMED (Anvisa), sem os preços | Formato da fonte em levantamento |
| Nome genérico oficial (DCB) | Anvisa | Formato da fonte em levantamento |
| Favoritos de cada médico | Modelos do PersonalMed (743 receitas e 51 pedidos de exame) e os do próprio Cortex | Depois dos catálogos |

**Fora do escopo:**
- **Preços e farmácias:** é a parte comercial da Mevo, e a Res. CFM 2.299/2021, art. 11, proíbe direcionar o paciente a uma farmácia.
- **Alerta de interação:** não há base pública confiável; ficaria para uma decisão à parte, com custo.

## Fórmulas manipuladas

**Formato:** um item da receita com o campo `formula`:

```json
{
  "name": "Fórmula manipulada",
  "dosage": "1 cápsula",
  "instructions": "à noite, por 30 dias",
  "formula": {
    "components": [{ "substance": "Progesterona micronizada", "amount": "100 mg" }],
    "vehicle": "Excipiente q.s.p. 1 cápsula",
    "form": "cápsula",
    "quantity": "30 cápsulas"
  }
}
```

**Regras** (`formulaError` em `_shared/regulatedMedications.ts`):
- de 1 a 12 componentes, cada um com nome (até 120 caracteres) e quantidade com número ("100 mg", "1%");
- forma farmacêutica obrigatória (até 40 caracteres). As sugestões estão em `FORMULA_FORMS`, mas qualquer texto vale;
- quanto manipular é obrigatório e precisa ter número ("30 cápsulas", "60 g");
- veículo ou excipiente é opcional (até 80 caracteres);
- campo desconhecido é recusado, e nada é cortado.

**Impressão:** abaixo da linha do item ("1. Fórmula manipulada — 1 cápsula") saem, recuados:
- cada componente com a sua quantidade;
- o veículo;
- "Manipular 30 cápsulas (cápsula).";
- a posologia.

Na receita de controle especial, os componentes saem antes da linha "Quantidade".

**Medicamentos regulados:** cada componente passa pelas mesmas regras de um medicamento registrado.
- Um componente controlado manda para a receita de controle especial (C1/C5) ou para a notificação certa. Por exemplo, testosterona em gel manipulado é C5.
- Um antimicrobiano manda para a receita de antimicrobiano.
- Na RCE, os componentes contam como princípios ativos do item. A concentração da substância controlada continua sendo informada no campo próprio.

**Testes:** `src/lib/regulatedMedications.test.ts` cobre as regras puras, e `src/lib/prescriptionDocuments.test.ts` cobre a impressão, a recusa de fórmula malformada e o desvio de controlado e antimicrobial manipulados.

**Próximos passos:**
1. Tela no compositor: "Adicionar fórmula manipulada", com linhas de componente, forma, quantidade, dose e posologia.
2. Modelos (`document_snippets`): aceitar `formula` nos itens. Isso pede a migration `20261105110000`, na faixa do Claude.
3. Busca de nomes da DCB nos componentes, quando a lista DCB estiver no banco.
