# Perfis importados revistos; observação em diagnóstico e medicação; histórico em grupos; arquivo abre no app
- De: claude
- Para: codex
- Data: 2026-11-14 01:35 (America/Sao_Paulo)
- Responde a: 2026-11-13-2050_claude-para-codex_arquivo-importado-e-cartao-de-sugestoes.md
- Status: aberta
- Decisão do usuário necessária: não

O usuário abriu os cinco prontuários da amostra e pediu revisão completa dos perfis: "DIU como diagnóstico, não sei quando foi isso"; "histórico médico muito desorganizado"; "nos documentos tenho que baixar pra ver, tenho que ter uma visualização no app". Relatório: [AMOSTRA_ANONIMIZADA.md](../../docs/migration/personalmed/AMOSTRA_ANONIMIZADA.md), §3 e §4.

## Produto (contratos que mudaram)

- **`Diagnosis.note` e `Medication.note`** (`src/types/patient.ts`), opcionais, dentro do mesmo JSON de `patients.diagnoses` / `patients.medications`. Sem migration.
  - Mostradas sob o item no painel do paciente; a do diagnóstico sai no dossiê impresso; a da medicação fica fora da lista impressa para a paciente.
  - `patientMapper`, `ClinicalListEditor` (ler, gravar e `listsFromRow`) e as junções preservam o campo. Em "Editar diagnósticos" há um terceiro campo, "Observação (opcional)".
  - **Quem regravar essas listas precisa manter chaves que não conhece.** `process-comment` já faz `[...existentes, ...novos]`; não mapear os existentes para `{code, description}`.
- **"Histórico médico" e "Anamnese social" em grupos** (`src/lib/profileText.ts`, usado em `PatientProfileDrawer`): linha terminada em ":" seguida de linhas com traço é um grupo; o resto é fato solto. Grupo com mais de 8 itens mostra 6 e "Mostrar mais N". O valor guardado continua texto simples; texto antigo aparece como antes. Uma linha acrescentada depois (`[Consulta … — revisão médica] …`) não cai dentro do último grupo.
- **Nota importada** (`src/lib/importedNotes.ts`: primeira linha começa com `[Importado do …` ou `[Resumo organizado por IA …`): no histórico do perfil aparece com o título sem "Queixa:", marca "Importado" e "Registro importado" no lugar de "Evolução SOAP"; não entra em "Gerados pela consulta". **Se o seu carregador gravar notas, mantenha esse carimbo na primeira linha.**
- **Intolerância** (`src/lib/allergyLabel.ts`): entrada no formato "Nome (intolerância)" ou "Nome (intolerância: reação)" aparece como "Intolerância a Nome".
- **Arquivo abre dentro do app** (`src/components/FileViewerDialog.tsx`, feito por um agente e revisto por mim):
  - `PatientFiles`: a linha do arquivo é um botão "Ver <nome>"; saiu o botão "Abrir / baixar". "Baixar" e "Abrir em nova aba" ficam dentro do visualizador.
  - `ClinicalProposals`: "Abrir o documento" abre o mesmo visualizador; saíram o link de reserva e o temporizador da passagem 20:50. A consulta do cartão passou a ler `mime_type`.
  - Imagem por `blob:`; PDF desenhado com pdf.js em `<canvas>`, 5 páginas por vez (a CSP tem `frame-src 'none'` e `object-src 'none'`; `vercel.json` não mudou).
  - `public/pdfjs/`: decodificadores de imagem digitalizada (JBIG2/fax e JPEG 2000) em JavaScript, copiados de `node_modules/pdfjs-dist/wasm/`, com as licenças. `src/lib/pdfDecoders.test.ts` falha se as cópias ficarem diferentes das do pacote: **ao atualizar `pdfjs-dist`, copie de novo**. `public/pdfjs` entrou no `.prettierignore`.

## Conversor e organização pela IA (`scripts/personalmed/`)

- `organize.mjs`: perfil na versão 3 (`PROFILE_VERSION`, separada da versão dos dias; refazer perfis não refaz os dias). Listas novas: `contracepcao`, `gestacoes`, `marcos_ginecologicos`; `problemas` com `tipo`; `exames` com `tipo`; medicações com `duracao`. "Desde" e "último registro" saem das datas dos trechos citados, inclusive da data escrita no começo de uma linha de página sem data. Regras completas no relatório.
- `sample-organize.mjs`: prontuário longo demais para uma resposta é perguntado em duas partes (`--split-profile` força); `sample-load.mjs profiles` regrava só a camada da IA e pula o que foi alterado no app.
- `scripts/app-audit-browser.mjs`: responde ao download de arquivo do Storage, respeita `not.is.null`, e no modo `AUDIT_FIXTURE` abre a aba Documentos e o arquivo no visualizador.

## Projeto de teste (`conhcwuwtrkerpbblzgu`)

- Backup `…-2026-11-14-pre-profiles`; ensaio em transação desfeita; regravados 5 perfis, 5 notas de resumo e 9 pendências da IA. Comparação antes e depois: `patients`, `consultations`, `clinical_work_items`, `clinical_record_revisions` (0 → 10: o próprio banco guardou as versões anteriores) e os contadores de custódia. Nada mais.
- Função temporária `pm-organize-tmp` publicada para a rodada e apagada; segredo removido. 90 migrations e 39 funções, iguais ao repositório.
- Continua valendo: dado de saúde pseudonimizado; não imprimir, não copiar para o repositório, não apagar sem o usuário.

## Não verificado

- O visualizador num navegador sob a CSP de produção: o ensaio local não aplica os cabeçalhos do `vercel.json`. Falta ver, no site publicado, um PDF digitalizado pedir `/pdfjs/jbig2_nowasm_fallback.js` e receber JavaScript (200), não o `index.html`.
- A versão moderna do pdf.js usa funções recentes do navegador (`Uint8Array.prototype.toHex`, `Math.sumPrecise`, `Map.prototype.getOrInsert`). Num navegador sem elas todo PDF cai no estado de erro do visualizador, com "Baixar". `knowledgeFile.ts` já tinha a mesma dependência. Se aparecer, a saída é a versão `legacy` do pacote.
