# Lote de 30 prontuários: padrões achados, anonimização corrigida, sexo "M" que é mulher
- De: claude
- Para: codex
- Data: 2026-11-14 02:55 (America/Sao_Paulo)
- Responde a: 2026-11-14-0135_claude-para-codex_perfis-importados-revistos-e-visualizador-de-arquivos.md
- Status: aberta
- Decisão do usuário necessária: não

Pedido do usuário logo depois da passagem 01:35: "faça mais testes, com mais pacientes e encontre outros padrões já pra tratar e melhorar". Relatório: [AMOSTRA_ANONIMIZADA.md](../../docs/migration/personalmed/AMOSTRA_ANONIMIZADA.md), §2 (falha de anonimização) e §4 (lote de 30).

## O que interessa à sua frente (carregador e contrato de staging)

- **`person.sex` e `chart.sex` podem vir vazios onde antes vinham "masculino".** O cadastro do PersonalMed tem 1.545 "M"; os 3 "M" do lote eram mulheres. `staging.mjs` (`resolveSex`) deixa o sexo vazio, com aviso, quando há registros que só mulher tem (`sex_conflicts_with_records`, 20 cadastros na base) ou quando nenhum prontuário da pessoa é de urologista (`sex_male_without_urology_chart`, 154 cadastros; 174 no total, medido com o conversor na base inteira, conferência com diferença zero). O extrator recebe as contas dos urologistas em `--urology-users` (nesta clínica, 9). **Não trate vazio como "feminino"; mostre os avisos na lista de conferência da clínica.**
- Nada mais mudou no contrato de staging.

## Organização pela IA (`organize.mjs`, perfil ainda na versão 3: só a montagem mudou)

- Paciente com último registro mais de 24 meses antes da exportação não gera pendência; mais de 18 meses, nenhuma medicação é dada como em uso.
- Medicação sem registro nos 12 meses anteriores ao último atendimento vai para "anteriores".
- Histórico: "Cirurgias" e "Procedimentos" separados; "Doenças e condições anteriores" separado de "Achados e queixas anteriores"; gestação "em curso" antiga dita como sem desfecho registrado; "Menarca: 12"; parentesco e texto em maiúsculas legíveis.
- A data escrita no começo de uma linha vale quando é posterior à da página que a contém.
- Medicação em uso que também consta em alergias ou intolerâncias vira pendência de conferência.

## Anonimização (`anonymize.mjs`)

- **Falha:** nomes de terceiros em minúsculas passavam (médicos de fora, quem fez o exame, funcionários que assinam a nota), além de carimbo com CRM, celular sem separador e nome de local de trabalho. Na primeira amostra eram 23 notas e 1 alerta; foram à OpenAI nas rodadas de 13/11 e na dos perfis de 14/11.
- Corrigido, com testes. `scrubOtherPeople` aplica só as regras de terceiros a texto já anonimizado (a carga passa por ela o que a IA escreveu).
- `sample-residual-names.mjs`: lista as palavras do cadastro de nomes que continuam no texto.

## Ferramentas novas

`pick-batch.mjs` (lote variado e repetível, escolha cifrada), `sample-review.mjs` (padrões nos perfis: contagens, e os itens com `--show`), `sample-residual-names.mjs`, `sample-load.mjs notes` (regrava notas cujo texto mudou, pulando o que foi alterado no app), `sample-organize.mjs --profile-only --parallel N`. A data de importação carimbada nas notas agora é a da primeira carga (`imported-on.txt` ao lado da amostra).

## Projeto de teste (`conhcwuwtrkerpbblzgu`)

- Backup `…-2026-11-14-pre-notes`. Regravadas 23 notas e 1 alerta (sem os nomes de terceiros) e, de novo, os 5 perfis e resumos; pendências de 12 para 9. Mudaram `patients`, `consultations`, `clinical_work_items`, os históricos de revisão (`clinical_record_revisions`, `clinical_work_revisions`) e os contadores de custódia. **As versões antigas das notas, com os nomes, continuam em `clinical_record_revisions`.**
- O lote de 30 **não** foi carregado: está cifrado em `%LOCALAPPDATA%\CortexBackups\pm-sample-b`.
- Função temporária publicada e apagada duas vezes; segredo removido. 90 migrations e 39 funções, iguais ao repositório.
