# Reteste dos valores DER — 7310e2f

Snapshot `7310e2fdc7cf4c2d551547332b4a916e02c4f16c`. **Cinco casos anteriores recusados e tipos corrigidos; R2 ainda tem duas classes residuais. UI da assinatura aguarda.** [Resposta e ações](../../../../coordination/mensagens/2026-11-05-0830_codex-para-claude_der-formas-e-escalares.md). Nenhum arquivo de implementação Claude foi alterado.

Os cinco casos de07:36 (parâmetros NULL com conteúdo/INTEGER vazio/não mínimo e strings UTF8 inválida/BMP ímpar) recebem409/certificate_invalid sem activate. Vazio e os três casos estruturais mais antigos continuam recusados; controle RSA2048 válido ativa200. R4 do download real SDK2.86 retorna null em400/404 estruturado e erro em500. Os controles MFA, corpo limitado e retomada espelhada também passaram. [Provas](boundaries.json), [resumo](verification.json).

## R2 remanescente / P2

O revisor fresh-context e o Codex reproduziram estes cinco certificados: helper null, OpenSSL/X509Certificate recusando, complete200 e chamada a activate. Cada TBS alterado foi assinado em memória por RSA2048, com validade atual e o mesmo AlgorithmIdentifier dentro/fora; não é uma assinatura antiga ou exigência de cadeia ICP.

- Parâmetros `10 00` e `11 00`: SEQUENCE/SET em forma primitiva. `primitiveOk`210 cai em default:true. Recusar a forma primitiva e ampliar diferencial nas duas cópias do algoritmo.
- Issuer BMPString `1e 02 d8 00`: surrogate isolado; UniversalString `1c 04 00 00 d8 00`: surrogate; `1c 04 00 11 00 00`: acima de U+10FFFF. Verificar só paridade/tamanho múltiplo de4 aceita esses valores. Não são as exceções PrintableString/IA5String documentadas.

Recomendado ao dono substituir a aprovação genérica de tipos não validados por lista explícita das formas suportadas, com controles legítimos. Não amplia confiança de cadeia, escopo de Auth nem API. Em remainingDerCases, os cinco antigos estão recusados e os cinco novos ainda aceitos; exit0 fixa esse resultado misto, sem aprovar o produto. Certificados e chaves não são gravados.

## Verificação

[Verificações locais](local-checks.json):140 testes assinatura/Auth aprovados e um ignorado em seis arquivos. Seleção com50 testes M2/instalação:190 aprovados/um ignorado em oito; não somar contagens. Dois entrypoints Deno2.9.6 offline/cached-only e lint/sintaxe do runner passaram. Fontes dos comandos conferidas contra7310e2f, ignorando somente CRLF.

O tipo Awaited no teste de Storage foi atendido. O novo teste Atomic do Codex tinha replaceAll fora do lib ES2020; TS2550 foi reproduzido e corrigido com regex. **tsc global passou depois dessas correções.** Nenhum ajuste no arquivo de testes Claude pelo Codex.

Migration/suíte SQL D17/helper de concorrência continuam byte a byte iguais a876875c; não foram repetidos. A matriz Native da instalação M2 usa fontes SQL congeladas e outro escopo. Não alegar913 testes globais,29 Deno, build ou navegador novos.

```powershell
node scripts/test-signature-handler-boundaries.mjs --values-fixed --source=7310e2fdc7cf4c2d551547332b4a916e02c4f16c
```

Históricos anteriores preservados em outras pastas; próximo reteste deve preservar estes cinco contraexemplos. SDKsupabase/Auth/PSC do handler em memória; SDKstorage real com fetch simulado. Sem Auth/Storage/PSC HTTP real, certificado ICP, homologação, dados pessoais, hosted, deploy, push ou arquivos SaaS/PersonalMed alterados.
