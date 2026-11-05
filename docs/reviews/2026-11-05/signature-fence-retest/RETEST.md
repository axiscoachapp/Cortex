# Reteste local da cerca de sessão D17

Snapshot `1ada96f1847dfe5d7c2e507692e47d6b183c1d2c`, revisto em 05/11/2026. Os achados R1–R5 da [revisão anterior](../signature-session-fence-review/REVIEW.md) foram atendidos no recorte testado. Claude pode prosseguir com a integração local dos handlers no domínio D17 já autorizado, usando o contexto verificado do bearer. Este aceite não habilita provedor, certificado, homologação ou produção.

## Evidência

| Verificação | Resultado |
|---|---|
| Banco descartável | 69 migrations e todas as 48 suítes SQL raiz aprovadas, fontes congeladas no Git |
| R1, prova independente | `signature_begin_authorization` conclui com prazo vivo enquanto a transação que apagou o estado OAuth vencido continua aberta; nenhuma espera no bloqueador observado |
| R2, SQL independente | `stored` da tentativa 1 recebe P4094 e preserva ambiguous/2, sem limpeza; o retry humano pertinente de 2 observa a revogação e cancela sem incrementar a tentativa |
| R3, SQL independente | `prepared` após ambiguous e `complete` após cancelled_by_revocation devolvem o JSON da operação atual, conferido separadamente da releitura persistida |
| R3, fluxo em memória | A aguarda o download; B conclui a mesma operação; A retorna completed. Uma chamada PSC e uma auditoria |
| Helper D17 congelado | Corridas RC/RR, ativação junto à sessão travada e contexto malformado junto à barreira aprovadas; controles que recolocam o DELETE ou retiram somente NOWAIT da sessão/fator foram observados esperando; definições restauradas |
| R5, leitura adicional | Validação de forma antes da barreira nas sete funções produtivas; [auth-order.json](auth-order.json) é checagem estática, não sete provas runtime |
| Verificação dirigida | 61 testes aprovados, um ignorado em três arquivos (Flow/PAdES/PSC); Deno 2.9.6 offline de Flow, sintaxe e ESLint dos runners aprovados |

[sql-verification.json](sql-verification.json), [memory.json](memory.json) e [local-verification.json](local-verification.json) registram os snapshots, hashes, resultados e limites. O banco e a rede interna tinham labels próprios, nenhuma porta publicada e remoção conferida. Overlays próprios foram conferidos ao fim. A revisão anterior, seu probe e os relatórios RED permanecem intactos; os modos novos escrevem nesta pasta separada.

## Revisão das provas

O modo novo inicialmente recusou o resultado antigo em `a10919d`: callback antigo cancelava a tentativa atual; a prova em memória também recusou o falso erro terminal. Uma revisão adversarial local identificou dois defeitos no novo probe: `stored` em ambiguous não é um passo pertinente, e descartar o retorno do RPC não prova devolução do histórico. Ambos foram corrigidos; a leitura seguinte não encontrou outro defeito concreto. A primeira execução com o passo incorreto terminou em P4094 e não conta como produto verde. O resultado final acima usa o probe corrigido, com hashes estáveis. Revisão externa dispensada pelo usuário.

```powershell
node scripts/test-signature-delta-review.mjs --session-fence --fence-fixed --source=1ada96f1847dfe5d7c2e507692e47d6b183c1d2c
node scripts/test-signature-flow-review.mjs --fence-fixed --source=1ada96f1847dfe5d7c2e507692e47d6b183c1d2c
```

Não foram repetidos a matriz completa de upgrade/custódia, Native Auth HTTP nas duas versões, navegador/build nem os 818 testes gerais relatados pelo autor. Sessões e fatores aqui são fixtures SQL tipadas. A prova do fluxo usa o módulo real com portas/banco em memória; não é integração entre esse fluxo e SQL. Os campos `reviewResolved=false` nos relatórios mecânicos mantêm essa ausência de aprovação global; `fenceFixesPassed=true` registra o aceite dirigido. Nenhum tipo precisou ser regenerado, pois as assinaturas RPC não mudaram. Sem arquivo Claude editado, dados reais, serviço hospedado, envio, assinatura real, deploy ou push.
