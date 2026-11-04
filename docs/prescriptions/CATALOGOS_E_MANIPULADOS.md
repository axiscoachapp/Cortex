# Catálogos e fórmulas manipuladas (no lugar dos catálogos da Mevo)

Pedido do usuário em 04/11/2026: seguir com a proposta de catálogos próprios, incluindo os manipulados. Este documento é o contrato de implementação, no domínio do Claude.

## O que entra

| Item | Fonte oficial | Estado |
|---|---|---|
| Fórmulas manipuladas | Não há catálogo oficial de fórmulas: são os componentes, com os nomes da DCB, mais as fórmulas que cada médico salva | **Servidor e tela prontos**; falta salvar como modelo |
| Exames com código TUSS | ANS, Terminologia Unificada da Saúde Suplementar | **Pronto**: busca no pedido de exames, com o código impresso |
| CID-10 | DATASUS | **Pronto**: sugestões no CID do atestado e da RCE |
| Apresentações dos medicamentos | Lista CMED (Anvisa), sem os preços | Leitor pronto e conferido |
| Nome genérico oficial (DCB) | Anvisa | Leitor pronto e conferido |
| Favoritos de cada médico | Modelos do PersonalMed (743 receitas e 51 pedidos de exame) e os do próprio Cortex | Depois dos catálogos |

**Fora do escopo:**
- **Preços e farmácias:** é a parte comercial da Mevo, e a Res. CFM 2.299/2021, art. 11, proíbe direcionar o paciente a uma farmácia.
- **Alerta de interação:** não há base pública confiável; ficaria para uma decisão à parte, com custo.

## Fontes oficiais (conferidas em 04/11/2026)

| Catálogo | Arquivo | Formato | Conferido |
|---|---|---|---|
| TUSS, tabela 22 | `https://dadosabertos.ans.gov.br/FTP/PDA/terminologia_unificada_saude_suplementar_TUSS-049/pda-049-tuss.zip` (1,4 MB, URL estável) | CSV UTF-8 `;` com aspas: `CD_TERMO;NM_TERMO;DT_INICIO_VIGENCIA;DT_FIM_VIGENCIA;DT_FIM_IMPLANTACAO` | 5.966 termos. Laboratório (403): 1.456; imagem (408 a 411): 510; patologia (406): 44; medicina nuclear (407): 97 |
| CID-10 | `http://www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip` (só HTTP) | CSV latin-1 `;`, linha termina em `;` | 2.045 categorias e 12.451 subcategorias. `RESTRSEXO`: 758 F e 116 M. É a versão de 2008, sem os códigos U07/U09/U10 |
| CMED | `https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv` (17 MB, mensal) | CSV UTF-8 com BOM `;`, 74 colunas. Só guardamos as de apresentação, nunca preço | 26.635 apresentações. Liga com o registro Anvisa pelos 9 primeiros dígitos de `REGISTRO` |
| DCB | Lista consolidada da IN 473/2026 em `bibliotecadigital.anvisa.gov.br` (a URL muda a cada versão: coleção 11933, item "VIGENTE") | XLSX, cabeçalho na linha 2 | 12.760 denominações. As outras 11 linhas da planilha são continuação do histórico, sem número nem nome |

Os leitores ficam em `_shared/referenceCatalogs.ts`:
- CSV com aspas;
- ZIP com o `DecompressionStream` da plataforma;
- XLSX mínimo.

Não usam nenhuma dependência nova. Os testes em `src/lib/referenceCatalogs.test.ts` montam arquivos sintéticos nos mesmos formatos. As contagens acima foram conferidas nos arquivos oficiais, fora do repositório.

**Banco e atualização:**
- **Migration `20261105110000`:** tabelas `exam_catalog`, `cid10_catalog`, `medication_presentations`, `dcb_catalog` e `reference_catalog_versions`, com leitura para qualquer usuário logado e escrita só pelo serviço. Também deixa os modelos de receita guardarem fórmulas manipuladas (`valid_snippet_formula`).
- **Função `refresh-reference-catalogs`:** só aceita a chave de serviço, como a atualização mensal da base de medicamentos.
  - Baixa cada fonte, pula as que não mudaram (SHA-256 igual ao da última carga) e grava em lotes de 500. Depois remove o que saiu da lista oficial e registra fonte, data e contagem.
  - Uma fonte com falha não mexe na tabela dela nem impede as outras.
  - Só aceita endereços gov.br. A DCB vigente é achada a cada execução nas páginas da biblioteca da Anvisa, seguindo só links do próprio site.
- **Conferência:** a orquestração rodou sobre os arquivos oficiais reais (rede simulada) e carregou 5.966 exames, 14.496 códigos CID, 26.635 apresentações e 12.760 nomes DCB, sem descarte.
- **Agendamento mensal:** fica para o deploy, como o da base de medicamentos.

**Na tela** (`src/components/ReferenceSearch.tsx`):
- **Pedido de exames:** "Buscar exame (tabela TUSS)" procura por nome ou pelo começo do código, sem o grupo "outro". O exame escolhido entra na lista como "Nome do exame (TUSS 40304361)", sem repetir, e a lista continua editável à mão. Se a tabela não responder, o médico é avisado e digita.
- **CID do atestado e da receita de controle especial:** sugestões por código ou por descrição. Escolher preenche o código e mostra a descrição; texto livre continua valendo.
- **Testes:** `src/components/ReferenceSearch.test.tsx` cobre consultas, curingas de LIKE removidos e falha da tabela; `DocumentComposerModal.test.tsx` cobre o pedido de exames ponta a ponta.
- **Tipos:** até o Codex gerar os tipos das tabelas novas, só esse arquivo usa uma visão sem tipo do cliente.

**Licenças:**
- TUSS e CMED são dados abertos federais (Decreto 8.777/2016), reutilizáveis com atribuição.
- A DCB é conteúdo de ato normativo.
- O CID-10 é distribuído pelo DATASUS, e a OMS detém o direito sobre a classificação. **Não encontramos licença formal para software comercial**, ponto a confirmar antes de vender o Cortex como SaaS.

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
1. ~~Tela no compositor~~: pronta. O botão "Adicionar fórmula manipulada" abre linhas de componente (até 12), excipiente, forma (com sugestões) e quanto manipular. A validação é a mesma do servidor antes de adicionar, e o item aparece na lista com o selo MANIPULADO e o resumo dos componentes. Testes em `src/components/DocumentComposerModal.test.tsx`.
2. Modelos (`document_snippets`): aceitar `formula` nos itens. Isso pede a migration `20261105110000`, na faixa do Claude.
3. Busca de nomes da DCB nos componentes, quando a lista DCB estiver no banco.
