# Revisão incremental de fórmulas e concorrência D17

04/11/2026. Responde à entrada Claude de 18:39, commits `72696f7`/`f8a332d`. Snapshot congelado `c89492f20d4f6ac7719700940529acd7f5e9d401`; nenhum arquivo do Claude alterado. [Resultados](verification.json). Revisão externa dispensada pelo usuário/contexto não interativo.

## Execução

Laboratório próprio: Docker local verificado/fixado, imagem já em cache, rede interna sem portas publicadas, bootstrap sintético e 69 migrations do snapshot. SQL de **catálogos, modelos e assinatura** passou; não foram reexecutadas as 47 suítes nem as 29/16/14/9 da entrega `ab119b4`.

O helper de assinatura foi congelado em arquivo temporário próprio e importado, sem executar seu modo standalone. Todos os cenários dele passaram com holders explícitos: permissões simultâneas, linha ocupada/expiração/controle, UPDATE clínico nas duas ordens, intenção de pacientes/conta e snapshot antigo, revogação, espera no 123, paciente indireto da consulta, DELETE real de Auth nas duas ordens, classificação como recepção e reserva dupla. As duas recusas P2 levaram 336/378 ms nesta execução. Isso registra a execução observada; não transforma o ensaio em prova contra a remoção futura de NOWAIT.

Comparação com `formulaError` real, congelado do mesmo snapshot: **12 vetores, nove concordâncias e três divergências**. Oito formas inválidas (vazia/null/número/array/componentes de tipos errados) e uma fórmula válida concordaram. Os achados anteriores de NULL e controles estão atendidos nos casos SQL adicionados pelo Claude.

| Vetor residual | Servidor | SQL |
|---|---|---|
| substância contendo apenas NBSP U+00A0 | recusa | aceita |
| substância com 61 caracteres U+1F600 | recusa, 122 unidades UTF-16 | aceita, 61 pontos de código |
| quantidade `1` seguida de 40 NBSP | aceita após trim | recusa por comprimento |

PostgreSQL trim remove espaços ASCII e length conta pontos de código; JavaScript usa regras Unicode de trim e unidades UTF-16. Há incompatibilidade efetiva entre salvar e emitir. Os três vetores foram enviados ao dono em `coordination/mensagens/2026-11-04-1910_codex-para-claude_formula-e-ensaio-em-revisao.md`.

Outro achado de revisão **estática**: o teste P2 registra refusedIn sem limitá-lo ou observar que a chamada não esperou. Remover NOWAIT do SELECT da receita permitiria esperar lock_timeout; o handler transforma 55P03 no mesmo 40001 aceito. Solicitei controle que remove NOWAIT no banco descartável e deve ser detectado. Essa mutação não foi executada pelo Codex; não é novo bypass demonstrado, e o produto atual mantém NOWAIT. A correção do holder temporizado foi retestada; a proteção contra essa mutação ainda é pendência do ensaio.

`npx vitest run src/lib/regulatedMedications.test.ts`: **24 testes/um arquivo aprovados**. A comparação de vetores usa o módulo congelado real e não uma reimplementação do validador. Revisão estática com contexto novo confirmou os dois achados residuais; não realizou execução de banco.

Tipos públicos regenerados na mesma base com postgres-meta v0.95.2: única diferença é a função `valid_snippet_text`. `npm run typecheck` passou nos projetos app e node. Nenhuma nova chamada, permissão, interface ou integração real. O JSON preserva hashes de fontes e tipos, contagens e os resultados divergentes. Cleanup por ownership confirmado, temporários individuais removidos. Trabalho paralelo de pades/compositor, SaaS e PersonalMed preservado. Sem dados reais, hosted, carga, envio, emissão, publicação ou push.

**Revisão parcial:** os cenários executados passaram, mas a equivalência Unicode e o controle de mutação P2 continuam abertos com Claude. Não é aprovação integral da emissão nem autorização de provedor/certificado real. M2/Auth/provisionamento permanece separado.
