# Reteste das bordas R2/R4 — 876875c

Snapshot `876875c8930806ff04310bf1928fe0f33a4119b4`, entrega07:20. **R4 atendido no recorte dirigido; R2 e typecheck ainda precisam de ajuste com Claude.** [Resposta com ações](../../../../coordination/mensagens/2026-11-05-0736_codex-para-claude_der-valores-e-typecheck.md). Nenhum arquivo de implementação do outro agente foi alterado.

Os três certificados malformados anteriores agora recebem409/certificate_invalid, sem activate; o controle sintético RSA2048 válido recebe200/activate. O SDKstorage real2.86, com fetch inteiramente em memória, produz StorageUnknownError/Response como antes, mas os downloads400/404 com statusCode404 agora retornam null.500 com o mesmo corpo continua lançando. Os controles fake404/503/500, MFA state/revoke, corpo limitado/cancelado e retomada espelhada também passaram. [Provas e hashes](boundaries.json), [resumo](verification.json).

## R2 / P2 — valores primitivos e codificação de strings

`pades.ts:202–205` verifica o OID e quantidade de filhos em AlgorithmIdentifier, mas permite parâmetros primitivos com DER inválido. Usando o mesmo algoritmo dentro e fora do TBS, três casos passam por helper null, complete200 e activate:

- NULL com conteúdo: `05 01 00`;
- INTEGER vazio: `02 00`;
- INTEGER não mínimo: `02 02 00 01`.

`isName`, na linha218, verifica a tag da string, mas aceita issuer UTF8String com byteFF e BMPString com um único byte00. Esses dois casos também recebem helper null, complete200 e activate.

O probe gera e assina cada TBS alterado em memória com a chave sintética RSA2048, conservando validade e igualdade dos algoritmos. OpenSSL/X509Certificate recusa todos os cinco; o controle válido passa. Portanto não é exigência de confiança de cadeia nem efeito de assinatura antiga sobre TBS alterado: falta validar a codificação estrutural dos valores. Não salva chave/certificado no repositório. O revisor fresh-context reproduziu os casos independentemente e o Codex acrescentou a ativação pelo handler completo à prova do helper.

O campo remainingDerCases fixa os cinco contraexemplos. Exit0 neste modo confirma que ainda existem, não aprova o produto. Corrigir conteúdo dos primitivos/parâmetros e das strings, com controles válidos, antes da UI.

## Typecheck / P2

`npx --no-install tsc --noEmit -p tsconfig.app.json` sai1 com13TS2322 em signatureHandlers.test.ts:337–349. A tabela usa ReturnType de storageErrorKind, agora Promise, para strings esperadas; precisa do tipo resolvido, como Awaited<ReturnType<...>>. O arquivo continua com Claude. Não há erro reportado nos caminhos novos M2. Não alegar typecheck/build global aprovado.

## Verificação e limites

[Verificações locais](local-checks.json):139 testes assinatura/Auth aprovados e um ignorado em seis arquivos. A execução incluiu também35 testes M2 novos:174 aprovados/um ignorado em sete arquivos, sem somar esse total aos139. Deno2.9.6 offline/cached-only dos dois entrypoints D17 passou; módulo M2 também checado separadamente. Sintaxe/ESLint do runner próprio aprovado. Fontes usadas nos comandos conferidas contra876875c, ignorando somente CRLF.

Migration/suíte SQL D17/helper de concorrência são byte a byte iguais a13a39ad, que já tem prova em signature-handler-retest; não foram repetidos aqui. A matriz Native M2 contemporânea tem outro escopo e não é reteste de SQL/HTTP D17. Sem897 testes globais,29 Deno, build, navegador, Auth/Storage/PSC HTTP real ou homologação nesta rodada. O limite4KiB é o do leitor do adaptador; os testes não são perfil do transporte HTTP produtivo.

```powershell
node scripts/test-signature-handler-boundaries.mjs --edges-fixed --source=876875c8930806ff04310bf1928fe0f33a4119b4
```

Histórico13a39ad preservado em outra pasta. Próximo reteste deve preservar estes cinco contraexemplos de876875c. Somente sintéticos, SDK/transporte simulados nos limites descritos, sem dados pessoais, hosted, chamadas pagas, cron, deploy, push ou edição de arquivos Claude/SaaS/PersonalMed.
