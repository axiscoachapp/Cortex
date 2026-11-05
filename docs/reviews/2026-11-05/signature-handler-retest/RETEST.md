# Reteste dos handlers D17 — 13a39ad

Snapshot `13a39adc59b423cb3207d45f24d6358a66a60f7b`, resposta à entrega06:10. **R2 e R4 ainda exigem correção; interface de assinatura aguarda.** Nenhum arquivo de implementação do Claude foi alterado. [Resposta com ações](../../../../coordination/mensagens/2026-11-05-0635_codex-para-claude_reteste-handlers-duas-bordas.md).

## Resultado dirigido

| Item | Resultado |
|---|---|
| R1, retomada após encerrar PSC | Fluxo real usa close com estado/tentativa observados; prepared/ambiguous devolvem409/cancelled_by_revocation no ensaio de memória. SQL separado prova fechamento, cleanup, preservação de hashes e reserva nova liberada |
| R2, certificado vazio | Vazio agora recebe409/certificate_invalid sem activate; controle RSA2048 sintético válido ativa200. **Três estruturas X.509 inválidas ainda ativam200** |
| R3, divergência de contrato | Alinhamento aceito: todas as rotas exigem AAL2, margem120s somente nos passos produtivos. Helper/gate Auth global preservados. state/revoke aal1+fator verified403/sem RPC, aal2+60s200/RPC |
| R4, Storage500 textual | Fake estruturado500/not found agora lança,404 realista retorna null. **O formato efetivo do download do SDK real em400/404 ainda lança em vez de retornar null** |
| R5, corpo inteiro antes do limite |100KiB em chunks de1KiB:400/cancelamento/sem RPC, no máximo10KiB puxados incluindo prefetch. Não afirmar que os10KiB foram todos lidos/bufferizados |

Os handlers/adaptadores/fluxo/PSC/Auth são os módulos congelados reais. SupabaseSDK/Auth e transporte PSC são seams de memória; o caso de download abaixo usa storage-js real, com fetch simulado. [Provas e hashes](boundaries.json). Estados de RPC nesse ensaio são espelhados; não são persistência SQL.

## R2 remanescente / P2 — conteúdo obrigatório do certificado

`pades.ts:166–168` confere tags externas e depois importa o SPKI, sem conferir conteúdo obrigatório de AlgorithmIdentifier/signatureValue. Com o mesmo TBS, RSA2048 e validade do controle, estas três alterações recebem helper null, complete200 e activate com digest dos bytes inválidos:

- AlgorithmIdentifier externo substituído por SEQUENCE vazia;
- signatureValue substituído por BIT STRING vazio;
- primeiro octeto do BIT STRING, unused-bits, alterado para255.

O `node:crypto.X509Certificate` recusa os três; o certificado de controle é aceito por ele e pelo helper/handler. O probe gera chaves/certificados apenas em memória e não salva os bytes. Não exige validação de cadeia ICP ou autoridade certificadora local; são formas inválidas antes da confiança. Corrigir a validação estrutural e provar recusas antes de ativação/assinatura.

## R4 remanescente / P2 — formato real do erro de download

O **storage-js2.86.0 instalado** passa `noResolveJson:true` no download. HTTP404 e HTTP400 legado com corpo statusCode404 resultam em `StorageUnknownError(originalError: Response)`, sem status/statusCode externos. O adaptador congelado lança indisponibilidade nos dois. HTTP500 com o mesmo corpo continua lançando, como deve. Versionamento e hashes dos módulos locais constam no relatório; nenhuma requisição saiu do processo.

Os fakes StorageApiError do primeiro controle não representam o erro real do download. É necessário reconhecer esse formato por resposta estruturada validada/limitada, mantendo500/503 como erro; não voltar a regex textual nem tratar qualquer4xx como ausência. Por leitura de signatureFlow.ts, se um objeto stored desapareceu, null permite cancelar com stored_object_invalid, enquanto o erro atual responde500 sem fechar. Essa consequência é inferência do fluxo; não foi encenado um StorageHTTP real nem observada essa transição numa integração HTTP+SQL nesta rodada.

## SQL, testes e revisão

[SQL independente](sql-resume.json):69 migrations congeladas, quatro cenários prepared/ambiguous com PSC explicitamente revogada. Dois usam close com CAS; dois usam nova reserve para fechar a operação antiga. Os casos de close conferem o resultado imediatamente, antes da reserva, para que ela não mascare uma falha. Controle de sessão viva e CAS de estado/tentativa mantêm o retorno original. Hashes preparados sobrevivem, cleanup só é marcado após tentativa PSC e uma nova reserva fica reserved. A persistência é SQL real com fixtures de Auth, sem NativeHTTP; expiração por relógio não é alegada por esses quatro cenários.

Suíte D17 e helper congelado de concorrência passaram na execução final, resumida em [verification.json](verification.json). O controle negativo substitui somente o close correto por replay histórico e exige a falha específica antes de reserve; o probe real subsequente passa com os mesmos IDs, comprovando rollback. Não é a matriz global de48 suítes SQL, nem upgrade com histórico. Os callbacks antigos e os controles NOWAIT continuam no helper; as fontes são congeladas por SHA, sem ler a migration que o Claude possa alterar em paralelo.

[Verificações locais](local-checks.json):129 testes aprovados/um ignorado em seis arquivos, dois entrypoints Deno2.9.6 offline/cached-only aprovados. Fontes do checkout usadas nesses comandos conferidas contra13a39ad, ignorando somente CRLF. Sintaxe/ESLint dos dois runners próprios aprovados. Não repetir852 testes globais,29 Deno, build ou navegador como execução do Codex.

A revisão adversarial do delta encontrou as duas bordas acima, reproduzidas novamente pelo Codex. Outra revisão das provas identificou que a nova reserve poderia mascarar close e que comparações SQL<> aceitavam NULL; asserções foram tornadas imediatas e NULL-safe antes do resultado final. O startup socket transitório do PostgreSQL também foi corrigido para prontidãoTCP; a tentativa falha fez cleanup antes de repetir. Revisão externa dispensada pelo usuário.

```powershell
node scripts/test-signature-handler-boundaries.mjs --fixed --source=13a39adc59b423cb3207d45f24d6358a66a60f7b
node scripts/test-signature-handler-sql.mjs --fixed --source=13a39adc59b423cb3207d45f24d6358a66a60f7b
```

Esses modos verificam tanto correções quanto contraexemplos remanescentes: exit0 não é aceite do produto. REDs históricos permanecem em signature-handler-boundaries. Próximo reteste precisa preservar estas provas de13a39ad. Somente sintéticos, Docker local/rede interna/sem portas/labels próprios/cleanup. Sem Auth/Storage/PSC HTTP real, certificado ICP, homologação, cron, dados de paciente, PersonalMed, hosted, mensagens externas, chamadas pagas, deploy ou push.
