# Handlers D17 b6c21f8 — correções antes da integração visual

Snapshot `b6c21f8cf46363e109a4a63afa700a01e118b5e5`. Revisão dirigida em 05/11/2026. **Os handlers ainda não estão aprovados para integração visual/piloto.** Há cinco ajustes concretos abaixo; nenhum arquivo de implementação do Claude foi alterado.

## R1 / P1 — retomada fica presa após encerrar a sessão PSC

`signatureFlow.ts:194–198` trata P4031 de `signature_session_token` enviando `advance('prepared', {})` para qualquer estado observado. O SQL agora confere pertinência/imutabilidade antes de observar a revogação:

- Em prepared, os campos persistidos não correspondem aos campos ausentes:22023 e HTTP400. A operação permanece prepared.
- Em ambiguous, prepared não é pertinente: o SQL devolve ambiguous sem cancelar. O handler responde HTTP202 e a operação permanece aberta.
- Prova SQL adicional: mesmo após abrir uma sessão PSC nova e válida, reservar outra operação para o mesmo documento recebe P4093.

[SQL real](sql-resume.json): 69 migrations congeladas, dois cenários, revogação explícita pela API SQL. [Handler + fluxo reais em memória](counterexamples.json): HTTP400/202 e chamadas reserve→session_token→advance. Os ramos de RPC nessa parte são espelhados do SQL; o estado persistido independente é somente o do ensaio SQL. Não foi testado vencimento por relógio nesta prova, nem integração HTTP entre o fluxo e o banco.

A recuperação precisa usar reconciliação/fechamento pertinente ao estado observado, conservar os campos preparados e o CAS da tentativa. Não contornar a imutabilidade nem voltar a cancelar por callback antigo. Acrescentar a retomada com sessão encerrada/substituída e nova tentativa liberada, incluindo ordem concorrente/terminal.

## R2 / P2 — certificado vazio ativa uma sessão que não pode assinar

`signatureHandlers.ts:264–275` apenas calcula SHA-256 do primeiro certificado descoberto e ativa a sessão. `psc.ts` aceita base64 vazio. Com `certificates:[{certificate:''}]`, os módulos reais handler/adaptador/PSC retornam HTTP200 active=true e chamam `signature_activate_session` com o digest dos bytes vazios. A validação da estrutura/chave só ocorre depois, na preparação PAdES.

Prova com SDK/Auth/PSC simulados em memória, sem certificado ou provedor real. Ativar sessão no SQL substitui a anterior; esse efeito é inspeção do SQL, não uma ativação real de certificado neste ensaio. Validar DER e chave suportada antes de ativar, com certificado sintético válido como controle e rejeições sem RPC de ativação. Os testes existentes usam `[9,9,9]` como certificado positivo e encobrem a lacuna.

## R3 / P2 — contrato de state/revoke não corresponde ao adaptador

`signatureDeps.ts:34` usa `requireUserContext`, que mantém o gate MFA comum. Uma resposta Auth com fator verified e JWT aal1 é recusada antes de chegar à regra needsAal2=false do handler. Os módulos reais devolvem403/mfaRequired para state e revoke, sem RPC; controles aal2 devolvem200 com a RPC esperada. Os testes de handler que injetam diretamente o contexto aal1 não exercitam esse caminho.

É uma divergência funcional de contrato; não é bypass de MFA. Auth/getUser foi simulado como validação bem-sucedida e a política real do helper foi executada; nenhum HTTP Native foi usado aqui. Preservar o gate global dos demais handlers. Alinhar uma autenticação especificamente restrita a estas rotas com o Codex, dono do helper, ou ajustar o contrato/testes à exigência efetiva antes da UI. Não remover MFA globalmente para fazer o teste passar.

## R4 / P2 — erro500 de Storage pode virar arquivo ausente

`signatureDeps.ts:21–22` retorna ausente por texto `not found`, mesmo se statusCode=500. Prova do adaptador real com SDK simulado:404/Object not found→null;503/Service unavailable→erro;500/Upstream object route not found→null. Não é uma resposta500 observada em um Storage real: é a classificação incorreta de uma resposta possível na interface do adaptador.

No fluxo stored, null é tratado como objeto inválido e permite fechar/cancelar/limpar; a consequência é leitura do fluxo, não uma remoção de arquivo executada neste ensaio. Restringir ausência a um erro estrutural explicitamente reconhecido e preservar erros/transientes como erros. Provar que uma indisponibilidade não fecha a operação nem remove artefatos.

## R5 / P2 — limite8KiB é conferido depois da leitura inteira

`signatureHandlers.ts:87–93` usa `await req.text()` antes de conferir o tamanho. Um corpo de stream de100KiB é inteiramente consumido, sem cancelamento, e só então recebe400. O limite declarado não limita a memória nem a espera pela conclusão de um corpo crescente.

Prova em memória com Request/ReadableStream reais e contagem de chunks, contexto aal2 válido no adaptador simulado. Nenhum teste de carga contra servidor foi feito. Usar leitura incremental limitada e cancelar ao ultrapassar o limite; incluir corpo sem Content-Length e garantir nenhuma RPC/PSC após rejeição.

## Verificação e limites

- 110 testes aprovados e um ignorado em cinco arquivos: handlers, flow, PAdES, PSC e authAssurance. A seleção inicial não executou um inexistente auth.test.ts; o arquivo correto authAssurance foi executado separadamente.
- Deno2.9.6 offline/cache obrigatório dos dois entrypoints aprovado; sintaxe/ESLint dos dois runners próprios e hashes conferidos.
- SQL: 69 migrations instaladas; dois probes dirigidos, **nenhuma suíte SQL geral da raiz** repetida. Docker local verificado, imagem existente, rede interna sem portas publicadas, labels próprios e remoção conferida.
- [counterexamples.json](counterexamples.json), [sql-resume.json](sql-resume.json) e [verification.json](verification.json). Os runners fixam os contraexemplos atuais; rodar verde neste modo não aprova o produto.

Revisão adversarial local identificou os casos de retomada, MFA e certificado; verificação própria acrescentou Storage e limite de corpo. A revisão das provas corrigiu dois rótulos excessivos (revogação não é ensaio de prazo; estado do fake não é observação persistida) e acrescentou controles aal2/active. Revisão externa dispensada pelo usuário. Não foram repetidos833 testes globais, build, navegador, Auth/Storage/PSC HTTP real, homologação ou assinatura real. Sem deploy, hosted, cron, PersonalMed ou push.

```powershell
node scripts/test-signature-handler-boundaries.mjs --source=b6c21f8cf46363e109a4a63afa700a01e118b5e5
node scripts/test-signature-handler-sql.mjs --source=b6c21f8cf46363e109a4a63afa700a01e118b5e5
```
