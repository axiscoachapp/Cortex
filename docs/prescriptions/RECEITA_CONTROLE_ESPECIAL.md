# Receita de Controle Especial no Cortex (D8)

Decisão do usuário, em 04/11/2026: liberar os controlados no Cortex. Este documento é o contrato de implementação, no domínio do Claude. As regras vêm de uma pesquisa em fontes oficiais, feita no mesmo dia; as fontes estão no fim. Ele precisa ser revisto sempre que a lista da Anvisa for atualizada.

## O que a lei permite emitir

O software só emite a **Receita de Controle Especial** (RCE), branca e em 2 vias, que vale para:
- as listas **C1** e **C5**;
- os adendos de dose: **codeína** e **tramadol** até 100 mg por unidade (lista A2) e **fenobarbital** (lista B1).

Ficam **bloqueados**, com a mensagem de qual formulário usar:
- **A1, A2 e A3** (opioides fortes, estimulantes): Notificação de Receita A, amarela;
- **B1** (benzodiazepínicos, zolpidem): Notificação B, azul;
- **B2** (anorexígenos): Notificação B2;
- **C2** (retinoides, como isotretinoína): Notificação de Receita Especial;
- **C3** (talidomida): notificação própria;
- **misoprostol**: uso só hospitalar.

As notificações usam numeração da Vigilância Sanitária, e um número de notificação de papel só vale em papel. O software não as imprime.

Implementado em `controlledFindings()` (`supabase/functions/_shared/regulatedMedications.ts`), com testes.

## Conteúdo obrigatório da RCE em papel

- Cabeçalho **"RECEITA DE CONTROLE ESPECIAL"**. Sem ele, a farmácia deve recusar.
- **Emitente:** nome, CRM/UF, endereço completo com cidade e UF; o telefone é opcional.
- **Paciente:** nome completo, **endereço completo** e **CPF**. Sem CPF: "não possui" ou outro documento oficial; estrangeiro: passaporte.
  - A RDC 1.000/2025 retirou o endereço do paciente, mas a Lei 5.991/73 (art. 35) e os modelos oficiais ainda o exigem. **Imprimir os dois endereços.**
- **Por medicamento:** nome pela DCB, concentração, forma farmacêutica, **quantidade em algarismos e por extenso**, e posologia. O texto deve ser legível e sem abreviações.
- **Data.** Com o nome do médico impresso, basta a assinatura dele.
- **Vias:** "1ª via - Retenção da Farmácia ou Drogaria" e "2ª via - Orientação ao Paciente", em destaque em cada página.
- **Blocos do comprador e do fornecedor:** em branco, preenchidos pela farmácia.
- **Validade:** 30 dias a partir da emissão, em todo o país.

## Limites

- No máximo **3 substâncias** C1 ou C5 por receita.
- Quantidade de até **60 dias** de tratamento ou 5 ampolas por substância. Antiparkinsonianos e anticonvulsivantes vão até 6 meses.
- Acima dos limites: **justificativa com CID ou diagnóstico** e a posologia, datada e assinada nas duas vias.
- **Testosterona e outros C5** (Lei 9.965/2000): também exigem o **CPF do médico**, telefone e endereço profissionais, e o **CID**.

## Como o Cortex vai fazer

1. **Classificação:** `controlledFindings()`, já implementada.
2. **Tipo novo `receita_controle_especial`:**
   - migration `20261104130000` (faixa do Claude) acrescenta o tipo ao check de `prescriptions.doc_type`;
   - validade de 30 dias e PDF de 2 páginas com o texto de via;
   - nas outras receitas, o controlado continua recusado, com a indicação do tipo certo.
3. **Dados do paciente:**
   - o **CPF** vem do cadastro; se faltar, o médico escolhe "não possui" ou informa outro documento;
   - o **endereço** é preenchido no compositor e guardado no snapshot do documento (`content`), sem alterar `patients`, enquanto o cadastro único (D20) não tem endereço.
4. **Por item:**
   - **concentração da substância controlada** em campo próprio e obrigatório ("30 mg", "200 mg/ml");
   - para codeína e tramadol, o adendo de até 100 mg por unidade é decidido **só por esse campo**, nunca pelo nome nem pela posologia. Numa associação, vale a concentração do componente controlado: um valor com dois números é recusado com essa orientação;
   - quantidade em número e unidade, com o texto por extenso gerado automaticamente.
   - **Nada é cortado:** endereço (até 300 caracteres), CID (até 20), justificativa (até 600), número de documento (até 40) e unidade (até 40) são recusados com mensagem se passarem do limite. Tudo que é aceito sai inteiro no PDF, no `content` e no snapshot. Isso responde à revisão do Codex de 04/11, 10:15.
5. **Limites:**
   - mais de 3 itens controlados é recusado;
   - o médico pode marcar "acima do limite" e informar a justificativa e o CID, impressos nas duas vias.
6. **C5:**
   - CPF do médico em `user_settings`, por migration na faixa do Claude e na mesma RPC `update_user_settings`, com as guardas declaradas;
   - CID obrigatório no documento.
7. **Eletrônica (depois, com a D17):**
   - via única, assinatura ICP-Brasil do próprio médico e modelo oficial sem logotipos;
   - a partir de **04/03/2027**, número do SNCR obtido pela API, com integração da plataforma e inscrição no CRM;
   - a RCE em papel com assinatura à mão continua valendo até lá e depois.

## Fontes (consultadas em 04/11/2026)

- RDC 1.000/2025, consolidada com a RDC 1.046/2026: Anvisa Legis (`anvisalegis.datalegis.net`, RDC 1000/2025).
- Portaria SVS/MS 344/1998: https://bvsms.saude.gov.br/bvs/saudelegis/svs/1998/prt0344_12_05_1998_rep.html
- Portaria SVS/MS 6/1999: https://www.cff.org.br/userfiles/file/portarias/6.pdf
- RDC 1.023/2026 (lista vigente): Anvisa Legis.
- Modelo vigente da RCE em papel: https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/receituario-fisico/modelos-vigentes/receita-de-controle-especial-rev20260313.docx
- Modelo da RCE eletrônica: https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/receituario-eletronico/modelos-de-receituarios-eletronicos/receita-de-controle-especial-eletronica.pdf
- Perguntas e respostas da RDC 1.000/2025, 2ª edição: https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/documentos-do-sncr/perguntas-e-respostas-rdc-1000-2025-2a-edicao.pdf
- Lei 5.991/1973: https://www.planalto.gov.br/ccivil_03/leis/l5991.htm
- Lei 9.965/2000: https://www.planalto.gov.br/ccivil_03/leis/l9965.htm
- Res. CFM 2.299/2021: https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2021/2299_2021.pdf

Pontos incertos, a confirmar com a Vigilância Sanitária local:
- se o gel de testosterona transdérmico entra na isenção de retenção do uso tópico;
- se o limite de 6 meses dos anticonvulsivantes vale quando a gabapentina ou a pregabalina são usadas para dor.
