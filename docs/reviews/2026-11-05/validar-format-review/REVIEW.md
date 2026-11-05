# VALIDAR 4f69118 — revisão do formato e da seleção de PDF

05/11/2026, Codex. **Um P2 de compatibilidade permanece.** A forma oficial, privacidade e guardas contratadas passaram nas verificações abaixo; isso não é homologação no ITI nem aprovação dos handlers D17.

Snapshot: `4f691181f22a34a54c87965f3c08fc2c4abfcaae`. Arquivos de implementação/testes delegados não foram editados pelo Codex.

## P2 — restrição de UUID do validador não existe no produtor

`validate-prescription/index.ts:29` restringe o ID da operação às versões 1–8 e às variantes 8/9/a/b. O produtor D17 aceita `p_operation uuid` não nulo, concatena esse UUID no caminho e seu CHECK aceita toda representação hexadecimal 8-4-4-4-12, sem restringir esses bits. Esse contrato foi conferido por leitura da migration, não por nova chamada SQL ou ao PSC.

A operação canônica `44444444-4444-4444-4444-444444444444` é rejeitada por signedFileOf, enquanto `44444444-4444-4444-8444-444444444444` passa. O helper **real** foi isolado do snapshot e executado com o mesmo dono/receita, status signed, data verificada e caminho exato. O primeiro lança SignatureIncomplete; o handler converte isso em 409 para os três formatos. [Prova](path-counterexample.json).

Harmonizar a regex com a representação canônica aceita pelo produtor, mantendo as âncoras e o vínculo exato dono/receita/operação. Não acrescentar uma restrição nova no produtor para compensar esta divergência. Acrescentar um caso HTTP com esse UUID aceito e conservar casos de outro dono, outra receita, traversal e nome que não seja UUID.

## Verificação

- 64 testes aprovados em três arquivos: securityHandlers, privacyHandlers e prescriptionDocuments. Fontes foram capturadas antes e conferidas após a execução; correspondem à entrega. Nenhum desses arquivos foi editado pelo Codex.
- Deno 2.9.6 offline/cache-only dos dois handlers aprovado; sintaxe/ESLint do probe próprio aprovados.
- Leitura adversarial local identificou o P2 acima; nenhum outro achado concreto no recorte. Não repetida matriz de banco/D17, build ou navegador nesta validação pública.

[Evidências locais](verification.json) e [controle/caso rejeitado](path-counterexample.json). O probe é teste isolado do helper com fonte real, não teste HTTP, certificado real ou chamada ao VALIDAR. Os 64 testes HTTP com dependências simuladas constituem evidência separada.

```powershell
node scripts/test-validate-contract-review.mjs --source=4f691181f22a34a54c87965f3c08fc2c4abfcaae
# Após a correção, com o novo SHA:
node scripts/test-validate-contract-review.mjs --expect-fixed --source=<sha-completo>
```

O [guia ITI](https://validar.iti.gov.br/guia-desenvolvedor.html) foi conferido no contrato de 03:04: JSON version/prescription.signatureFiles, QR de receita com type=prescricao e código _secretCode. Mantemos deliberadamente 404 indistinguível em vez de 401; unsigned/signed incompleto409 e URL/hash original juntos no manifesto legado seguem aquele contrato. Formato aceito não implica assinatura válida, reconhecimento de type dos outros documentos ou homologação.

Sem dados reais, segredos, material de assinatura real, chamada externa, certificado, emissão, hosted, deploy ou push. A delegação dos dois testes permanece com Claude somente para este recorte/correção, até o reteste e devolução.
