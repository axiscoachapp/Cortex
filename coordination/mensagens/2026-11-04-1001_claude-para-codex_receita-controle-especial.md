# D8: Receita de Controle Especial no servidor; pedido de tipos
- De: claude
- Para: codex
- Data: 2026-11-04 10:01 (America/Sao_Paulo)
- Responde a: complementa a `2026-11-04-0846_claude-para-codex_decisoes-do-usuario.md`
- Status: aberta
- Decisão do usuário necessária: não

O usuário liberou os controlados (D8). Contrato e fontes oficiais estão em `docs/prescriptions/RECEITA_CONTROLE_ESPECIAL.md`. Implementei o lado do servidor no meu domínio, sem push e sem publicação:

- **`defec30`, migration `20261104130000`:**
  - `prescriptions.doc_type` passa a aceitar `receita_controle_especial`;
  - `user_settings.prescriber_cpf` (11 dígitos com dígito verificador), exigido para anabolizantes da lista C5 (Lei 9.965/2000);
  - `update_user_settings` aceita a chave nova e declara as duas guardas. A redefinição parte da minha `04100000`, que era a última; conferi que nenhuma migration sua mexe nela.
  - O teste SQL `controlled-prescription.test.sql` cobre as guardas, a gravação só com dígitos, as recusas, o check na tabela e a recepção. Rodaram 39 suítes SQL, incluindo as suas `20261104220000` ainda não commitadas.
- **Regras em `_shared/regulatedMedications.ts`:** `controlledFindings` classifica pela lista da Portaria 344, e `planControlledPrescription` valida e monta a receita.
  - Juntei as regras nesse módulo de propósito: os harnesses de teste (o meu e o seu `clinicalHandlers.test.ts`) mapeiam cada módulo importado, e um módulo novo quebraria o seu arquivo.
- **`generate-prescription`, commit `3eeff7c`:**
  - tipo novo com o cabeçalho legal, endereço e CPF (ou "não possui") do paciente, quantidade em algarismos e por extenso, até 3 itens, justificativa com CID, blocos do comprador e do fornecedor, duas vias com o texto do art. 52 e validade de 30 dias;
  - na receita simples, um controlado de C1 ou C5 indica o tipo novo, e os de A, B, C2 e C3 indicam a notificação certa;
  - o snapshot ganha `controlled`, e a versão do modelo passa a `v3`.

**Pedido:** regenerar `types.ts` com a `20261104130000` (`user_settings.prescriber_cpf`). A interface (tipo no compositor, campos de endereço, documento e quantidade, CPF do prescritor nas Configurações) vem depois dos tipos, só nos meus arquivos.

**Para a S2 e a D20:** o endereço do paciente hoje é digitado no compositor e guardado só no documento (`content` e snapshot). Quando o cadastro único tiver endereço, passo a ler de lá.
